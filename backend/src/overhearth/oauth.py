"""Household account linking: a small OAuth 2.1 authorization server and the resource metadata.

Follows what the Alexa+ MCP checklist asks of a server:

- Protected Resource Metadata (RFC 9728) at the root `/.well-known/oauth-protected-resource`,
  plus the path-suffixed form for clients that build it from the MCP URL.
- Authorization server metadata (RFC 8414) that names S256 as the PKCE method.
- Authorization code + PKCE (S256 only) for households; client_credentials for a service token.
- A 401 without `WWW-Authenticate` when `/mcp` is called without a valid token.

Linking creates a new real household. The demo households keep their pre-issued tokens, so
judges never need to sign in.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
from dataclasses import dataclass, field
from datetime import timedelta
from urllib.parse import urlencode, urlsplit

from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from overhearth.assistant import RateLimiter
from overhearth.delivery import valid_email
from overhearth.kinds.base import scrub
from overhearth.models import AuthGrant, DeliverySettings, Household, IssuedToken, new_id, utcnow
from overhearth.store import Store

SCOPES = ("mcp:tools", "mcp:resources")
DEFAULT_SCOPE = " ".join(SCOPES)
ACCESS_TOKEN_TTL = timedelta(hours=1)
REFRESH_TOKEN_TTL = timedelta(days=30)
CODE_TTL = timedelta(minutes=5)
NEW_HOMES_PER_HOUR = 20
"""Town-wide, whatever address the requests come from."""
MAX_REAL_HOUSEHOLDS = 50
"""Linking creates a household, so cap how many a public deployment will accept."""

WEB_CLIENT_ID = "overhearth-web"
DEFAULT_WEB_REDIRECTS = "http://localhost:5173/,http://127.0.0.1:5173/"

_VERIFIER = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")
_NAME = re.compile(r"^[A-Za-z][A-Za-z '\-]{0,23}$")
_TIMEZONE = re.compile(r"^(UTC|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+\-]+){1,2})$")
"""An IANA zone name such as Asia/Tokyo. It is only stored as a label, so its shape is enough."""


@dataclass(frozen=True)
class OAuthClient:
    client_id: str
    redirect_uris: tuple[str, ...]
    name: str
    secret_hash: str | None = field(default=None, repr=False)
    """None for a public client (the browser), which must use PKCE and has no secret."""

    def check_secret(self, secret: str | None) -> bool:
        if self.secret_hash is None:
            return secret in (None, "")
        if not secret:
            return False
        return hmac.compare_digest(self.secret_hash, hashlib.sha256(secret.encode()).hexdigest())


def clients_from_env() -> dict[str, OAuthClient]:
    """The simulated Alexa+ web client, plus confidential clients from OVERHEARTH_OAUTH_CLIENTS.

    OVERHEARTH_OAUTH_CLIENTS is a JSON list of {client_id, client_secret, redirect_uris, name}.
    It comes from the environment (or a secret store), never from the repository.
    """
    redirects = os.environ.get("OVERHEARTH_WEB_REDIRECTS", DEFAULT_WEB_REDIRECTS)
    clients = {
        WEB_CLIENT_ID: OAuthClient(
            client_id=WEB_CLIENT_ID,
            redirect_uris=tuple(r.strip() for r in redirects.split(",") if r.strip()),
            name="Overhearth simulated Alexa+",
        )
    }
    for raw in json.loads(os.environ.get("OVERHEARTH_OAUTH_CLIENTS", "[]")):
        clients[raw["client_id"]] = OAuthClient(
            client_id=raw["client_id"],
            redirect_uris=tuple(raw.get("redirect_uris", [])),
            name=raw.get("name", raw["client_id"]),
            secret_hash=hashlib.sha256(raw["client_secret"].encode()).hexdigest(),
        )
    return clients


def s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def public_base(request: Request) -> str:
    """The public origin of this server. Set OVERHEARTH_PUBLIC_URL behind a proxy or API gateway."""
    configured = os.environ.get("OVERHEARTH_PUBLIC_URL")
    if configured:
        return configured.rstrip("/")
    return f"{request.url.scheme}://{request.url.netloc}"


def _no_store(response: Response) -> Response:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


def _token_error(error: str, description: str, status: int = 400) -> Response:
    return _no_store(JSONResponse({"error": error, "error_description": description}, status_code=status))


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class BearerGate:
    """Reject MCP requests without a valid bearer token: 401, and no WWW-Authenticate header.

    Alexa+ discovers the authorization server from the root resource metadata instead of the
    header, and its checklist asks for the header to be left out.
    """

    def __init__(self, app: ASGIApp, store: Store, *, path: str = "/mcp") -> None:
        self.app = app
        self.store = store
        self.path = path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].startswith(self.path) and scope["method"] != "OPTIONS":
            headers = dict(scope.get("headers") or [])
            auth = headers.get(b"authorization", b"").decode("latin-1")
            kind, _, token = auth.partition(" ")
            if kind.lower() != "bearer" or not token or self.store.resolve_token(token.strip()) is None:
                response = JSONResponse(
                    {"error": "invalid_token", "error_description": "Link this Alexa account to Overhearth first."},
                    status_code=401,
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


def install_oauth_routes(server, store: Store, clients: dict[str, OAuthClient] | None = None) -> None:
    """Add the metadata, /authorize and /token routes to the MCP server's Starlette app."""
    clients = clients if clients is not None else clients_from_env()
    limiter = RateLimiter(limit=30)
    new_homes = RateLimiter(limit=NEW_HOMES_PER_HOUR)

    async def protected_resource(request: Request) -> JSONResponse:
        base = public_base(request)
        return JSONResponse(
            {
                "resource": f"{base}/mcp",
                "authorization_servers": [base],
                "scopes_supported": list(SCOPES),
                "bearer_methods_supported": ["header"],
                "resource_name": "Overhearth",
            }
        )

    server.custom_route("/.well-known/oauth-protected-resource", methods=["GET"])(protected_resource)
    server.custom_route("/.well-known/oauth-protected-resource/mcp", methods=["GET"])(protected_resource)

    @server.custom_route("/.well-known/oauth-authorization-server", methods=["GET"])
    async def authorization_server(request: Request) -> JSONResponse:
        base = public_base(request)
        return JSONResponse(
            {
                "issuer": base,
                "authorization_endpoint": f"{base}/authorize",
                "token_endpoint": f"{base}/token",
                "response_types_supported": ["code"],
                "grant_types_supported": ["authorization_code", "refresh_token", "client_credentials"],
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": ["none", "client_secret_basic", "client_secret_post"],
                "scopes_supported": list(SCOPES),
            }
        )

    def _check_request(params) -> tuple[OAuthClient | None, str | None]:
        """Validate the authorization request. Returns the client, or an error to show (not redirect)."""
        client = clients.get(params.get("client_id", ""))
        if client is None:
            return None, "This app is not registered with Overhearth."
        if params.get("redirect_uri", "") not in client.redirect_uris:
            return None, "This app asked to return to an address Overhearth does not know."
        return client, None

    def _redirect_error(params, error: str, description: str) -> RedirectResponse:
        query = {"error": error, "error_description": description}
        if params.get("state"):
            query["state"] = params["state"]
        return RedirectResponse(f"{params['redirect_uri']}?{urlencode(query)}", status_code=302)

    def _validate_pkce(params) -> tuple[str, str] | None:
        if params.get("response_type") != "code":
            return ("unsupported_response_type", "Only the authorization code flow is supported.")
        if params.get("code_challenge_method") != "S256" or not params.get("code_challenge"):
            return ("invalid_request", "PKCE with S256 is required.")
        requested = set(params.get("scope", DEFAULT_SCOPE).split())
        if not requested <= set(SCOPES):
            return ("invalid_scope", "Unknown scope.")
        return None

    @server.custom_route("/authorize", methods=["GET"])
    async def authorize_page(request: Request) -> Response:
        params = request.query_params
        client, problem = _check_request(params)
        if client is None:
            return _page("Can't link this app", f"<p>{html.escape(problem or '')}</p>", status=400)
        pkce_error = _validate_pkce(params)
        if pkce_error:
            return _redirect_error(params, *pkce_error)
        return _page("Link your home to Overhearth", _consent_form(client, params))

    @server.custom_route("/authorize", methods=["POST"])
    async def authorize_submit(request: Request) -> Response:
        form = await request.form()
        params = {key: str(value) for key, value in form.items()}
        client, problem = _check_request(params)
        if client is None:
            return _page("Can't link this app", f"<p>{html.escape(problem or '')}</p>", status=400)
        pkce_error = _validate_pkce(params)
        if pkce_error:
            return _redirect_error(params, *pkce_error)
        if params.get("decision") != "allow":
            return _redirect_error(params, "access_denied", "The person did not link their home.")
        if not limiter.allow(f"authorize:{_client_ip(request)}") or not new_homes.allow("town"):
            return _page("Please try again later", "<p>Too many homes were linked from here recently.</p>", status=429)

        avatar = " ".join(params.get("avatar", "").split())
        home = scrub(params.get("home", ""))[:60].strip()
        region = scrub(params.get("region", ""))[:40].strip()
        errors = []
        if not _NAME.match(avatar):
            errors.append("Give your avatar a short name using letters (up to 24).")
        if len(home) < 3:
            errors.append("Describe your home in a few words, like “a family flat in Kyoto”.")
        if len(region) < 2:
            errors.append("Add a city or region.")
        email = params.get("email", "").strip()
        if email and not valid_email(email):
            errors.append("That email address doesn't look right. You can also leave it empty.")
        if errors:
            message = "".join(f"<p class='error'>{html.escape(e)}</p>" for e in errors)
            return _page("Link your home to Overhearth", message + _consent_form(client, params), status=400)
        if sum(1 for h in store.households() if h.tier == "real") >= MAX_REAL_HOUSEHOLDS:
            return _redirect_error(params, "temporarily_unavailable", "The town is full right now.")

        timezone = params.get("timezone", "")
        if not _TIMEZONE.match(timezone):
            timezone = "UTC"
        household = Household(
            id=new_id("hh"),
            label=home,
            region=region,
            timezone=timezone,
            tier="real",
            avatar_name=avatar,
        )
        delivery = (
            DeliverySettings(household_id=household.id, email=email, notify_thanks=params.get("notify") == "on")
            if email
            else None
        )
        code = secrets.token_urlsafe(32)
        store.put_auth_code(
            code,
            AuthGrant(
                client_id=client.client_id,
                redirect_uri=params["redirect_uri"],
                code_challenge=params["code_challenge"],
                household_id=household.id,
                scope=params.get("scope") or DEFAULT_SCOPE,
                expires_at=utcnow() + CODE_TTL,
                household=household,
                delivery=delivery,
            ),
        )
        query = {"code": code}
        if params.get("state"):
            query["state"] = params["state"]
        return RedirectResponse(f"{params['redirect_uri']}?{urlencode(query)}", status_code=302)

    def _issue(client_id: str, household_id: str | None, scope: str, *, refresh: bool) -> dict:
        access = secrets.token_urlsafe(32)
        now = utcnow()
        store.put_token(
            access,
            IssuedToken(
                kind="access",
                client_id=client_id,
                household_id=household_id,
                scope=scope,
                expires_at=now + ACCESS_TOKEN_TTL,
            ),
        )
        body = {
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": int(ACCESS_TOKEN_TTL.total_seconds()),
            "scope": scope,
        }
        if refresh:
            refresh_token = secrets.token_urlsafe(32)
            store.put_token(
                refresh_token,
                IssuedToken(
                    kind="refresh",
                    client_id=client_id,
                    household_id=household_id,
                    scope=scope,
                    expires_at=now + REFRESH_TOKEN_TTL,
                ),
            )
            body["refresh_token"] = refresh_token
        household = store.get_household(household_id) if household_id else None
        if household:
            # Extra response parameters are allowed (RFC 6749 section 5.1); the simulated
            # client uses them to label the linked home.
            body["household"] = {"avatar": household.avatar_name, "label": household.label}
        return body

    def _authenticate_client(request: Request, form) -> OAuthClient | None:
        client_id, secret = form.get("client_id"), form.get("client_secret")
        scheme, _, credentials = request.headers.get("authorization", "").partition(" ")
        if scheme.lower() == "basic":
            try:
                client_id, _, secret = base64.b64decode(credentials).decode().partition(":")
            except ValueError:
                return None
        client = clients.get(str(client_id or ""))
        if client is None or not client.check_secret(str(secret) if secret else None):
            return None
        return client

    @server.custom_route("/token", methods=["POST"])
    async def token(request: Request) -> Response:
        if not limiter.allow(f"token:{_client_ip(request)}"):
            return _token_error("slow_down", "Too many requests.", status=429)
        form = await request.form()
        client = _authenticate_client(request, form)
        if client is None:
            return _token_error("invalid_client", "Unknown client or wrong secret.", status=401)
        grant_type = form.get("grant_type")

        if grant_type == "authorization_code":
            verifier = str(form.get("code_verifier") or "")
            grant = store.take_auth_code(str(form.get("code") or ""))
            if grant is None or grant.client_id != client.client_id:
                return _token_error("invalid_grant", "The code is unknown, used or expired.")
            if form.get("redirect_uri") != grant.redirect_uri:
                return _token_error("invalid_grant", "redirect_uri does not match.")
            if not _VERIFIER.match(verifier) or not hmac.compare_digest(s256(verifier), grant.code_challenge):
                return _token_error("invalid_grant", "PKCE verification failed.")
            if grant.household is not None and store.get_household(grant.household.id) is None:
                if sum(1 for h in store.households() if h.tier == "real") >= MAX_REAL_HOUSEHOLDS:
                    return _token_error("temporarily_unavailable", "The town is full right now.", status=503)
                store.add_household(grant.household)
                if grant.delivery is not None:
                    store.put_delivery(grant.delivery)
            return _no_store(JSONResponse(_issue(client.client_id, grant.household_id, grant.scope, refresh=True)))

        if grant_type == "refresh_token":
            presented = str(form.get("refresh_token") or "")
            issued = store.take_token(presented, kind="refresh")  # rotate: each refresh token works once
            if issued is None or issued.client_id != client.client_id:
                return _token_error("invalid_grant", "The refresh token is unknown or expired.")
            return _no_store(JSONResponse(_issue(client.client_id, issued.household_id, issued.scope, refresh=True)))

        if grant_type == "client_credentials":
            if client.secret_hash is None:
                return _token_error("unauthorized_client", "Public clients cannot use client_credentials.")
            return _no_store(JSONResponse(_issue(client.client_id, None, DEFAULT_SCOPE, refresh=False)))

        return _token_error("unsupported_grant_type", "Unsupported grant_type.")


_CARRIED_PARAMS = (
    "client_id",
    "redirect_uri",
    "response_type",
    "code_challenge",
    "code_challenge_method",
    "state",
    "scope",
)


def _consent_form(client: OAuthClient, params) -> str:
    def value(name: str) -> str:
        return html.escape(str(params.get(name, "")), quote=True)

    hidden = "".join(f'<input type="hidden" name="{name}" value="{value(name)}">' for name in _CARRIED_PARAMS)
    host = html.escape(urlsplit(str(params.get("redirect_uri", ""))).netloc)
    return f"""
<p><strong>{html.escape(client.name)}</strong> ({host}) wants to link this Alexa to Overhearth.</p>
<p class="muted">Your home gets an avatar in a shared town. Only what you agree to share ever leaves your
home, and contact details are removed. Other homes see the description below, never who you are.</p>
<form method="post" action="authorize">
  {hidden}
  <input type="hidden" name="timezone" id="timezone" value="{value("timezone")}">
  <label>Your avatar's name <input name="avatar" maxlength="24" required value="{value("avatar")}"
    placeholder="Nori"></label>
  <label>Describe your home in a few words <input name="home" maxlength="60" required value="{value("home")}"
    placeholder="a family flat in Kyoto"></label>
  <label>City or region <input name="region" maxlength="40" required value="{value("region")}"
    placeholder="Kyoto"></label>
  <label>Email for town news in writing (optional) <input name="email" type="email" maxlength="120"
    value="{value("email")}" placeholder="you@example.com"></label>
  <label class="check"><input type="checkbox" name="notify"{" checked" if params.get("notify") == "on" else ""}>
    Email me when know-how I shared is thanked (at most once a day)</label>
  <p class="muted">Your email stays private to your home. Alexa reads back what it will send and asks first.</p>
  <div class="actions">
    <button name="decision" value="allow" type="submit">Link my home</button>
    <button name="decision" value="deny" type="submit" class="ghost" formnovalidate>Not now</button>
  </div>
</form>
<script>
  const tz = document.getElementById("timezone");
  if (!tz.value) tz.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
</script>"""


def _page(title: str, body: str, *, status: int = 200) -> HTMLResponse:
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title><link rel="icon" href="data:,">
<style>
  body {{ margin: 0; background: #0d1118; color: #f2f4f8; font: 16px/1.5 system-ui, sans-serif; }}
  main {{ max-width: 460px; margin: 8vh auto; padding: 28px; background: #161d29; border-radius: 18px; }}
  h1 {{ font-size: 22px; margin: 0 0 12px; }}
  .muted {{ color: #9aa4b5; font-size: 14px; }}
  .error {{ color: #ffb4a8; margin: 4px 0; }}
  label {{ display: grid; gap: 4px; margin: 14px 0; font-size: 14px; color: #c9d1de; }}
  input {{ font: inherit; padding: 9px 12px; border-radius: 10px; border: 1px solid #2c3647;
    background: #0d1118; color: inherit; }}
  label.check {{ display: flex; gap: 8px; align-items: center; }}
  .actions {{ display: flex; gap: 10px; margin-top: 20px; }}
  button {{ font: inherit; font-weight: 600; padding: 9px 16px; border-radius: 10px; border: 0;
    background: #34c6f4; color: #04121a; cursor: pointer; }}
  button.ghost {{ background: transparent; color: #f2f4f8; border: 1px solid #2c3647; }}
</style></head>
<body><main><h1>{html.escape(title)}</h1>{body}</main></body></html>"""
    response = HTMLResponse(page, status_code=status)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
    return _no_store(response)

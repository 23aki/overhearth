"""ASGI entry point, used by uvicorn locally and by the Lambda Web Adapter in AWS."""

from __future__ import annotations

import hmac
import logging
import os
from dataclasses import asdict
from urllib.parse import urlsplit

import anyio
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import ValidationError
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from overhearth.assistant import RateLimiter, TurnRequest, assistant_from_env, tool_defs, trim
from overhearth.delivery import Mailer, mailer_from_env
from overhearth.engine import dialogue_from_env, run_tick
from overhearth.mcp_server import build_server
from overhearth.models import utcnow
from overhearth.oauth import BearerGate, install_oauth_routes
from overhearth.store import Store
from overhearth.store.env import store_from_env
from overhearth.translate import translator_from_env

log = logging.getLogger(__name__)

DEV_TICK_INTERVAL_SECONDS = float(os.environ.get("OVERHEARTH_DEV_TICK_INTERVAL", "30"))


LOCAL_HOSTS = ["127.0.0.1:*", "localhost:*", "[::1]:*"]
LOCAL_ORIGINS = ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"]
MAX_TURN_BODY_BYTES = 64 * 1024
"""A turn is a short conversation; anything bigger is refused before it reaches the model."""


def transport_security() -> TransportSecuritySettings | None:
    """DNS rebinding protection for /mcp that also accepts the deployed host and web origin.

    Without OVERHEARTH_PUBLIC_URL the SDK's localhost-only default applies.
    """
    public = os.environ.get("OVERHEARTH_PUBLIC_URL")
    if not public:
        return None
    netloc = urlsplit(public).netloc
    origins = [o.strip() for o in os.environ.get("OVERHEARTH_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[netloc, f"{netloc}:*", *LOCAL_HOSTS],
        allowed_origins=[o for o in origins if o != "*"] + LOCAL_ORIGINS,
    )


ACCESS_HEADER = "x-overhearth-access"
GATED_PREFIXES = ("/mcp", "/assistant/", "/token", "/dev/", "/town")


class AccessGate:
    """While in development: the API needs a shared access key in a header (OVERHEARTH_ACCESS_KEY).

    The web client gets the key from config.js, which sits behind the site's Basic
    authentication. /health, the OAuth metadata and the /authorize page stay open; a home is
    only created at /token, which is gated. Without the variable, nothing is gated.
    """

    def __init__(self, app: ASGIApp, key: str) -> None:
        self.app = app
        self.key = key.encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] != "OPTIONS" and scope["path"].startswith(GATED_PREFIXES):
            presented = dict(scope.get("headers") or []).get(ACCESS_HEADER.encode(), b"")
            if not hmac.compare_digest(presented, self.key):
                await JSONResponse({"error": "This preview is not open yet."}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


class NoStandaloneStream:
    """Answer GET /mcp with 405: this server is stateless and never sends server-initiated messages.

    The MCP spec allows a server without a GET stream to say so with 405. Without this, the
    client's GET waits for a stream that API Gateway and Lambda cannot deliver, times out, and
    takes the instance down with it.
    """

    def __init__(self, app: ASGIApp, *, path: str = "/mcp") -> None:
        self.app = app
        self.path = path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] == "GET" and scope["path"].rstrip("/") == self.path:
            await PlainTextResponse("Method Not Allowed", status_code=405, headers={"Allow": "POST, DELETE"})(
                scope, receive, send
            )
            return
        await self.app(scope, receive, send)


def create_app(store: Store | None = None, mailer: Mailer | None = None) -> ASGIApp:
    if store is None:
        store = store_from_env()
    mailer = mailer or mailer_from_env()
    server = build_server(store, mailer)

    @server.custom_route("/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    install_oauth_routes(server, store)

    @server.custom_route("/town", methods=["GET"])
    async def town(_: Request) -> JSONResponse:
        """The whole town for the watch page: homes, how often each was thanked, recent events.

        Only what the town view already shows: public labels and avatar names, never contact
        details or tokens.
        """
        state = await anyio.to_thread.run_sync(store.town_state)
        return JSONResponse(state, headers={"Cache-Control": "no-store"})

    @server.custom_route("/town/activity", methods=["GET"])
    async def town_activity(_: Request) -> JSONResponse:
        """Which homes are talking with their Alexa right now, for the watch page (polled often)."""
        active = await anyio.to_thread.run_sync(lambda: store.activity(utcnow()))
        return JSONResponse({"active": active}, headers={"Cache-Control": "no-store"})

    assistant = assistant_from_env()
    limiter = RateLimiter()

    @server.custom_route("/assistant/turn", methods=["POST"])
    async def assistant_turn(request: Request) -> JSONResponse:
        """One turn of the simulated Alexa+ layer. The browser runs the tool calls over MCP."""
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        home = store.household_for_token(token) if scheme.lower() == "bearer" else None
        if home is None:
            return JSONResponse({"error": "This Alexa account is not linked to Overhearth yet."}, status_code=401)
        store.mark_active(home.id, "talk", utcnow())
        if not limiter.allow(token):
            return JSONResponse({"error": "Too many requests. Try again later."}, status_code=429)
        raw = await request.body()
        if len(raw) > MAX_TURN_BODY_BYTES:
            return JSONResponse({"error": "That conversation is too long."}, status_code=413)
        try:
            body = TurnRequest.model_validate_json(raw)
        except (ValueError, ValidationError):
            return JSONResponse({"error": "Malformed turn."}, status_code=400)
        tools = tool_defs(await server.list_tools())
        try:
            result = await anyio.to_thread.run_sync(lambda: assistant.turn(trim(body.messages), tools, home.language))
        except Exception as error:  # the model call failed; the client shows a polite message
            log.warning("assistant turn failed: %s", type(error).__name__)
            return JSONResponse({"error": "Alexa could not answer just now."}, status_code=502)
        return JSONResponse(result.model_dump())

    if os.environ.get("OVERHEARTH_DEV_ENDPOINTS") == "1":
        dialogue = dialogue_from_env()
        translator = translator_from_env()
        tick_limiter = RateLimiter(limit=1, window_seconds=DEV_TICK_INTERVAL_SECONDS)
        tick_lock = anyio.Lock()

        @server.custom_route("/dev/tick", methods=["POST"])
        async def dev_tick(request: Request) -> JSONResponse:
            """Advance town time once, for demos. Off by default.

            Needs a linked home's token, and runs at most once per interval for the whole town,
            because each tick calls the model for every encounter.
            """
            scheme, _, token = request.headers.get("authorization", "").partition(" ")
            if scheme.lower() != "bearer" or store.household_for_token(token) is None:
                return JSONResponse({"error": "Link a home first."}, status_code=401)
            if tick_lock.locked() or not tick_limiter.allow("town"):
                return JSONResponse({"error": "The town is still busy. Try again in a moment."}, status_code=429)
            async with tick_lock:
                result = await anyio.to_thread.run_sync(
                    lambda: run_tick(store, dialogue, mailer=mailer, translator=translator)
                )
            return JSONResponse(asdict(result))

    app = server.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        host=os.environ.get("OVERHEARTH_HOST", "127.0.0.1"),
        transport_security=transport_security(),
    )
    origins = [o.strip() for o in os.environ.get("OVERHEARTH_ALLOWED_ORIGINS", "*").split(",") if o.strip()]
    gated: ASGIApp = BearerGate(NoStandaloneStream(app), store)
    access_key = os.environ.get("OVERHEARTH_ACCESS_KEY")
    if access_key:
        gated = AccessGate(gated, access_key)
    return CORSMiddleware(
        gated,
        allow_origins=origins,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["authorization", "content-type", "mcp-protocol-version", "mcp-session-id", ACCESS_HEADER],
        expose_headers=["mcp-session-id"],
    )


app = create_app()

import base64
import json
import secrets
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from overhearth.devclient import RawMcpClient
from overhearth.oauth import WEB_CLIENT_ID, clients_from_env, s256

REDIRECT = "http://localhost:5173/"


@pytest.fixture
def base(server_url: str) -> str:
    return server_url.removesuffix("/mcp")


@pytest.fixture
def http(base: str):
    with httpx.Client(base_url=base, follow_redirects=False, timeout=10) as client:
        yield client


def _authorize(http: httpx.Client, verifier: str, **overrides: str) -> httpx.Response:
    form = {
        "client_id": WEB_CLIENT_ID,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "code_challenge": s256(verifier),
        "code_challenge_method": "S256",
        "state": "xyz",
        "scope": "mcp:tools mcp:resources",
        "avatar": "Nori",
        "home": "a family flat in Kyoto",
        "region": "Kyoto",
        "timezone": "Asia/Tokyo",
        "decision": "allow",
    }
    form.update(overrides)
    return http.post("/authorize", data=form)


def _redirect_query(response: httpx.Response) -> dict[str, list[str]]:
    assert response.status_code == 302
    location = urlsplit(response.headers["location"])
    assert f"{location.scheme}://{location.netloc}{location.path}" == REDIRECT
    return parse_qs(location.query)


def _code(response: httpx.Response) -> str:
    query = _redirect_query(response)
    assert query["state"] == ["xyz"]
    return query["code"][0]


def _exchange(http: httpx.Client, code: str, verifier: str) -> httpx.Response:
    return http.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT,
            "client_id": WEB_CLIENT_ID,
            "code_verifier": verifier,
        },
    )


def _refresh(http: httpx.Client, refresh_token: str) -> httpx.Response:
    return http.post(
        "/token",
        data={"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": WEB_CLIENT_ID},
    )


def test_metadata_points_clients_at_the_authorization_server(http, base):
    resource = http.get("/.well-known/oauth-protected-resource").json()
    assert resource["resource"] == f"{base}/mcp"
    assert resource["authorization_servers"] == [base]
    assert http.get("/.well-known/oauth-protected-resource/mcp").json() == resource
    server = http.get("/.well-known/oauth-authorization-server").json()
    assert server["issuer"] == base
    assert server["code_challenge_methods_supported"] == ["S256"]
    assert server["token_endpoint"] == f"{base}/token"


def test_unauthenticated_mcp_gets_401_without_www_authenticate(http):
    response = http.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert response.status_code == 401
    assert "www-authenticate" not in response.headers
    assert response.json()["error"] == "invalid_token"


def test_linking_a_home_end_to_end(http, server_url, store):
    verifier = secrets.token_urlsafe(48)
    page = http.get(
        "/authorize",
        params={
            "client_id": WEB_CLIENT_ID,
            "redirect_uri": REDIRECT,
            "response_type": "code",
            "code_challenge": s256(verifier),
            "code_challenge_method": "S256",
            "state": "xyz",
        },
    )
    assert page.status_code == 200
    assert "Link your home" in page.text

    tokens = _exchange(http, _code(_authorize(http, verifier)), verifier)
    assert tokens.status_code == 200
    assert tokens.headers["cache-control"] == "no-store"
    body = tokens.json()
    assert body["token_type"] == "Bearer"
    assert body["household"] == {"avatar": "Nori", "label": "a family flat in Kyoto"}

    home = store.household_for_token(body["access_token"])
    assert home is not None
    assert home.tier == "real"
    assert home.timezone == "Asia/Tokyo"

    client = RawMcpClient(server_url, token=body["access_token"])
    client.initialize()
    result, _ = client.call_tool("town_report")
    assert result["isError"] is False

    refreshed = _refresh(http, body["refresh_token"])
    assert refreshed.status_code == 200
    assert store.household_for_token(refreshed.json()["access_token"]).id == home.id
    # Refresh tokens rotate: the old one no longer works.
    assert _refresh(http, body["refresh_token"]).json()["error"] == "invalid_grant"


def test_code_needs_the_right_verifier_and_works_once(http):
    verifier = secrets.token_urlsafe(48)
    code = _code(_authorize(http, verifier))
    wrong = _exchange(http, code, secrets.token_urlsafe(48))
    assert wrong.status_code == 400
    assert wrong.json()["error"] == "invalid_grant"
    # The failed attempt used the code up.
    assert _exchange(http, code, verifier).json()["error"] == "invalid_grant"


def test_pkce_is_required(http):
    response = _authorize(http, secrets.token_urlsafe(48), code_challenge_method="plain")
    assert _redirect_query(response)["error"] == ["invalid_request"]


def test_unknown_redirect_is_not_followed(http):
    response = _authorize(http, secrets.token_urlsafe(48), redirect_uri="https://evil.example/")
    assert response.status_code == 400
    assert "location" not in response.headers


def test_denying_returns_access_denied(http, store):
    before = len(store.households())
    response = _authorize(http, secrets.token_urlsafe(48), decision="deny")
    assert _redirect_query(response)["error"] == ["access_denied"]
    assert len(store.households()) == before


def test_bad_home_details_show_the_form_again(http, store):
    before = len(store.households())
    response = _authorize(http, secrets.token_urlsafe(48), avatar="<b>Nori</b>", home="x")
    assert response.status_code == 400
    assert "<b>Nori</b>" not in response.text
    assert "&lt;b&gt;Nori&lt;/b&gt;" in response.text
    assert len(store.households()) == before


def test_confidential_clients_come_from_the_environment(monkeypatch):
    monkeypatch.setenv(
        "OVERHEARTH_OAUTH_CLIENTS",
        json.dumps([{"client_id": "alexa", "client_secret": "s3cret", "redirect_uris": ["https://example.com/cb"]}]),
    )
    clients = clients_from_env()
    assert clients["alexa"].check_secret("s3cret")
    assert not clients["alexa"].check_secret("wrong")
    assert not clients["alexa"].check_secret(None)
    assert clients[WEB_CLIENT_ID].check_secret(None)


def test_public_client_cannot_use_client_credentials(http):
    basic = base64.b64encode(f"{WEB_CLIENT_ID}:".encode()).decode()
    response = http.post(
        "/token", data={"grant_type": "client_credentials"}, headers={"Authorization": f"Basic {basic}"}
    )
    assert response.json()["error"] == "unauthorized_client"


def test_linking_can_save_an_email_for_written_news(http, store):
    verifier = secrets.token_urlsafe(48)
    code = _code(_authorize(http, verifier, email="nori@example.com", notify="on"))
    token = _exchange(http, code, verifier).json()["access_token"]
    home = store.household_for_token(token)
    settings = store.get_delivery(home.id)
    assert settings.email == "nori@example.com"
    assert settings.notify_thanks is True
    assert "nori@example.com" not in home.model_dump_json()


def test_a_bad_email_shows_the_form_again(http):
    response = _authorize(http, secrets.token_urlsafe(48), email="not an email")
    assert response.status_code == 400
    assert "email address" in response.text

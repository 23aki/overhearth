"""Regressions for issues found in review (#25)."""

import secrets
from datetime import timedelta

from starlette.testclient import TestClient

from overhearth.asgi import create_app
from overhearth.assistant import Message, ToolCall, trim
from overhearth.dev_seed import seeded_store
from overhearth.engine import TemplateDialogue, run_tick
from overhearth.models import Packet, utcnow
from overhearth.oauth import WEB_CLIENT_ID, s256

INIT = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}},
}
HEADERS = {
    "Authorization": "Bearer demo-tokyo",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
}


def test_the_deployed_host_and_web_origin_reach_mcp(monkeypatch):
    monkeypatch.setenv("OVERHEARTH_PUBLIC_URL", "https://abc.execute-api.us-east-1.amazonaws.com")
    monkeypatch.setenv("OVERHEARTH_ALLOWED_ORIGINS", "https://d123.cloudfront.net")
    app = create_app(seeded_store())
    with TestClient(app, base_url="https://abc.execute-api.us-east-1.amazonaws.com") as client:
        ok = client.post("/mcp", json=INIT, headers={**HEADERS, "Origin": "https://d123.cloudfront.net"})
        assert ok.status_code == 200
        assert client.post("/mcp", json=INIT, headers=HEADERS).status_code == 200  # server to server, no Origin
        evil = client.post("/mcp", json=INIT, headers={**HEADERS, "Origin": "https://evil.example"})
        assert evil.status_code == 403
        wrong_host = client.post("/mcp", json=INIT, headers={**HEADERS, "Host": "evil.example"})
        assert wrong_host.status_code == 421


def test_an_abandoned_link_does_not_create_a_home():
    store = seeded_store()
    before = len(store.households())
    with TestClient(create_app(store)) as client:
        verifier = secrets.token_urlsafe(48)
        response = client.post(
            "/authorize",
            data={
                "client_id": WEB_CLIENT_ID,
                "redirect_uri": "http://localhost:5173/",
                "response_type": "code",
                "code_challenge": s256(verifier),
                "code_challenge_method": "S256",
                "avatar": "Nori",
                "home": "a flat",
                "region": "Kyoto",
                "decision": "allow",
            },
            follow_redirects=False,
        )
        assert response.status_code == 302
    assert len(store.households()) == before


def test_too_big_a_turn_is_refused_before_the_model():
    with TestClient(create_app(seeded_store())) as client:
        response = client.post(
            "/assistant/turn",
            content=b'{"messages": [{"role": "user", "text": "' + b"x" * 70_000 + b'"}]}',
            headers={"Authorization": "Bearer demo-tokyo", "Content-Type": "application/json"},
        )
        assert response.status_code == 413


def test_trim_closes_tool_calls_that_never_got_a_result_and_caps_results():
    messages = [
        Message(role="user", text="hi"),
        Message(role="assistant", tool_calls=[ToolCall(id="a", name="town_report"), ToolCall(id="b", name="ask_town")]),
        Message(role="tool", tool_call_id="a", name="town_report", content={"speech": "x" * 10_000}),
        Message(role="user", text="hello again"),
    ]
    trimmed = trim(messages)
    roles = [(m.role, m.tool_call_id) for m in trimmed]
    assert roles == [("user", None), ("assistant", None), ("tool", "a"), ("tool", "b"), ("user", None)]
    assert trimmed[3].is_error is True
    assert len(trimmed[2].content) <= 4000


def test_thanks_heard_about_before_the_tick_are_still_announced_with_a_real_count():
    store = seeded_store()
    start = utcnow()
    run_tick(store, TemplateDialogue(), at=start)
    tip = store.get_packet("pkt_egg_spinach")
    store.add_packet(
        Packet(
            kind="thanks",
            origin_household="hh_tokyo",
            payload={"what_helped": "egg dinner", "tip_id": tip.id},
            consented_at=start + timedelta(minutes=5),
            created_at=start + timedelta(minutes=5),
        )
    )
    # Osaka listens before the next tick.
    store.mark_report_heard(tip.origin_household, start + timedelta(minutes=10))
    run_tick(store, TemplateDialogue(), at=start + timedelta(minutes=30))
    returns = [i for i in store.latest_report(tip.origin_household).items if i.kind == "thanks_return"]
    assert returns
    assert "0 times" not in returns[0].text
    assert "thanked once" in returns[0].text


def test_get_on_mcp_is_405_instead_of_a_stream_that_never_ends():
    with TestClient(create_app(seeded_store())) as client:
        response = client.get("/mcp", headers={**HEADERS, "Accept": "text/event-stream"})
        assert response.status_code == 405
        assert "POST" in response.headers["allow"]


def test_access_key_gates_the_api_while_in_development(monkeypatch):
    monkeypatch.setenv("OVERHEARTH_ACCESS_KEY", "preview-key")
    with TestClient(create_app(seeded_store()), base_url="http://localhost:8000") as client:
        assert client.get("/health").status_code == 200
        assert client.get("/.well-known/oauth-protected-resource").status_code == 200
        assert client.post("/mcp", json=INIT, headers=HEADERS).status_code == 403
        turn = {"messages": [{"role": "user", "text": "hi"}]}
        assert client.post("/assistant/turn", json=turn, headers=HEADERS).status_code == 403
        assert client.post("/token", data={"grant_type": "refresh_token"}).status_code == 403
        wrong = client.post("/mcp", json=INIT, headers={**HEADERS, "X-Overhearth-Access": "nope"})
        assert wrong.status_code == 403
        ok = client.post("/mcp", json=INIT, headers={**HEADERS, "X-Overhearth-Access": "preview-key"})
        assert ok.status_code == 200
        preflight = client.options(
            "/mcp",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "x-overhearth-access",
            },
        )
        assert preflight.status_code == 200


def test_without_an_access_key_nothing_is_gated(monkeypatch):
    monkeypatch.delenv("OVERHEARTH_ACCESS_KEY", raising=False)
    with TestClient(create_app(seeded_store()), base_url="http://localhost:8000") as client:
        assert client.post("/mcp", json=INIT, headers=HEADERS).status_code == 200


def test_the_watch_page_reads_the_whole_town_without_a_household():
    store = seeded_store()
    run_tick(store, TemplateDialogue(), at=utcnow())
    with TestClient(create_app(store), base_url="http://localhost:8000") as client:
        state = client.get("/town").json()
    assert {h["id"] for h in state["homes"]} >= {"hh_tokyo", "hh_osaka"}
    assert "viewer" not in state
    encounters = [e for e in state["events"] if e["type"] == "encounter" and e["tick"] == 1]
    assert encounters
    assert all("items" in e["detail"] for e in encounters)
    assert "@" not in str(state)


def test_the_view_keeps_every_encounter_of_a_busy_tick():
    from overhearth.town_seed import seeded_town

    store = seeded_town()
    result = run_tick(store, TemplateDialogue(), at=utcnow())
    events = store.town_state()["events"]
    assert sum(e["type"] == "encounter" for e in events) == result.encounters


def test_a_thanks_flow_event_counts_this_ticks_thanks_only():
    store = seeded_store()
    start = utcnow()
    tip = store.get_packet("pkt_egg_spinach")
    for i, home in enumerate(["hh_tokyo", "hh_seattle"]):
        store.add_packet(
            Packet(
                kind="thanks",
                origin_household=home,
                payload={"what_helped": "egg dinner", "tip_id": tip.id},
                consented_at=start,
                created_at=start - timedelta(minutes=50 if i == 0 else 5),
            )
        )
    run_tick(store, TemplateDialogue(), at=start - timedelta(minutes=30))  # sees the first thanks
    run_tick(store, TemplateDialogue(), at=start)  # sees the second
    flows = [e for e in store.town_events(limit=500) if e.type == "thanks_flow" and e.tick == 2]
    assert len(flows) == 1
    assert flows[0].detail["from"] == ["hh_seattle"]
    assert flows[0].detail["count"] == 1
    assert "one home" in flows[0].summary

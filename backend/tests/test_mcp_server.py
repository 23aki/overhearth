import pytest

from overhearth.devclient import RawMcpClient, RpcError
from overhearth.mcp_server import TOWN_UI_URI


def _client(url: str, token: str | None = "demo-tokyo") -> RawMcpClient:
    client = RawMcpClient(url, token=token)
    client.initialize()
    return client


def _structured(result: dict) -> dict:
    assert not result.get("isError"), result
    return result["structuredContent"]


def test_negotiates_2025_11_25(server_url):
    client = RawMcpClient(server_url, token="demo-tokyo")
    info = client.initialize()
    assert info["protocolVersion"] == "2025-11-25"
    assert info["serverInfo"]["name"] == "overhearth"


def test_tools_list_exposes_model_tools_and_ui_binding(server_url):
    result, _ = _client(server_url).request("tools/list")
    tools = {tool["name"]: tool for tool in result["tools"]}
    assert {"record_thanks", "share_with_town", "ask_town", "town_report", "open_town"} <= set(tools)
    assert tools["open_town"]["_meta"]["ui"]["resourceUri"] == TOWN_UI_URI
    assert tools["get_town_state"]["_meta"]["ui"]["visibility"] == ["app"]


def test_town_ui_resource_is_an_mcp_app(server_url):
    result, _ = _client(server_url).request("resources/read", {"uri": TOWN_UI_URI})
    content = result["contents"][0]
    assert content["mimeType"] == "text/html;profile=mcp-app"
    assert "<html" in content["text"]


def test_town_state_is_structured_for_the_view(server_url):
    result, _ = _client(server_url).call_tool("get_town_state")
    state = result["structuredContent"]
    assert state["viewer"] == "hh_tokyo"
    assert {h["id"] for h in state["homes"]} >= {"hh_tokyo", "hh_osaka"}
    assert all({"avatar", "glow", "region"} <= set(h) for h in state["homes"])


def test_unlinked_household_gets_401(server_url):
    with pytest.raises(RpcError) as raised:
        _client(server_url, token="nope")
    assert raised.value.status == 401


def test_town_report_returns_precomputed_report(server_url):
    result, _ = _client(server_url).call_tool("town_report")
    report = _structured(result)
    assert "Ume" in report["met"]
    assert "egg and spinach" in report["speech"]


def test_town_report_only_tells_news_once(server_url):
    client = _client(server_url)
    first = _structured(client.call_tool("town_report")[0])
    assert first["items"]
    again = _structured(client.call_tool("town_report")[0])
    assert again["items"] == []
    assert "quiet" in again["speech"]


def test_ask_town_ranks_by_thanks(server_url):
    result, _ = _client(server_url).call_tool("ask_town", {"question": "quick dinner with eggs and spinach"})
    answers = _structured(result)["answers"]
    assert answers[0]["packet_id"] == "pkt_egg_spinach"
    assert answers[0]["thanks_count"] == 5


def test_share_requires_confirmation(server_url, store):
    client = _client(server_url)
    before = len(store.packets(kind="tip"))
    preview = _structured(
        client.call_tool("share_with_town", {"kind": "tip", "topic": "tea", "text": "Warm the pot."})[0]
    )
    assert preview["needs_confirmation"] is True
    assert len(store.packets(kind="tip")) == before

    done = _structured(
        client.call_tool(
            "share_with_town", {"kind": "tip", "topic": "tea", "text": "Warm the pot.", "confirmed": True}
        )[0]
    )
    assert done["packet_id"]
    assert store.get_packet(done["packet_id"]).origin_household == "hh_tokyo"


def test_thanks_links_back_to_tip(server_url, store):
    _client(server_url).call_tool("record_thanks", {"what_helped": "the egg dinner", "tip_id": "pkt_egg_spinach"})
    linked = [p for p in store.packets(kind="thanks") if p.payload["tip_id"] == "pkt_egg_spinach"]
    assert len(linked) == 6


def test_missing_token_is_rejected(server_url):
    with pytest.raises(RpcError) as raised:
        _client(server_url, token=None)
    assert raised.value.status == 401


def test_rpc_errors_surface_as_exceptions(server_url):
    with pytest.raises(RpcError):
        _client(server_url).request("no/such/method")


def test_dev_tick_is_off_by_default(server_url):
    import urllib.error
    import urllib.request

    request = urllib.request.Request(server_url.replace("/mcp", "/dev/tick"), method="POST")
    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(request, timeout=5)
    assert error.value.code == 404


def test_thanks_for_town_know_how_says_where_it_goes(server_url):
    result = _structured(
        _client(server_url).call_tool("record_thanks", {"what_helped": "egg dinner", "tip_id": "pkt_egg_spinach"})[0]
    )
    assert result["to"] == "a retired cook's home in Osaka"


def test_dev_tick_needs_a_linked_home_and_is_rate_limited(monkeypatch):
    from starlette.testclient import TestClient

    from overhearth.asgi import create_app
    from overhearth.dev_seed import seeded_store

    monkeypatch.setenv("OVERHEARTH_DEV_ENDPOINTS", "1")
    monkeypatch.setenv("OVERHEARTH_DIALOGUE", "template")
    monkeypatch.setenv("OVERHEARTH_ASSISTANT", "scripted")
    with TestClient(create_app(seeded_store())) as client:
        assert client.post("/dev/tick").status_code == 401
        first = client.post("/dev/tick", headers={"Authorization": "Bearer demo-tokyo"})
        assert first.status_code == 200
        assert first.json()["tick"] == 1
        assert client.post("/dev/tick", headers={"Authorization": "Bearer demo-tokyo"}).status_code == 429

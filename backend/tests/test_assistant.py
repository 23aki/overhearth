import json
import urllib.error
import urllib.request

import pytest

from overhearth.assistant import Message, ToolCall, _to_converse, tool_defs, trim
from overhearth.devclient import RawMcpClient


def _turn(server_url: str, messages: list[dict], token: str | None = "demo-tokyo") -> dict:
    request = urllib.request.Request(
        server_url.replace("/mcp", "/assistant/turn"),
        data=json.dumps({"messages": messages}).encode(),
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def _run_tool(server_url: str, call: dict, token: str = "demo-tokyo") -> dict:
    client = RawMcpClient(server_url, token=token)
    client.initialize()
    result, _ = client.call_tool(call["name"], call["arguments"])
    return {
        "role": "tool",
        "tool_call_id": call["id"],
        "name": call["name"],
        "content": result.get("structuredContent"),
        "is_error": bool(result.get("isError")),
    }


def test_turn_requires_a_linked_household(server_url):
    with pytest.raises(urllib.error.HTTPError) as error:
        _turn(server_url, [{"role": "user", "text": "hi"}], token="nope")
    assert error.value.code == 401
    assert "www-authenticate" not in {k.lower() for k in error.value.headers}


def test_malformed_turn_is_rejected(server_url):
    with pytest.raises(urllib.error.HTTPError) as error:
        _turn(server_url, [])
    assert error.value.code == 400


def test_full_loop_town_report_then_thanks_links_the_tip(server_url, store):
    history = [{"role": "user", "text": "What happened in town while I was out?"}]
    first = _turn(server_url, history)
    assert first["tool_calls"][0]["name"] == "town_report"
    history.append({"role": "assistant", "tool_calls": first["tool_calls"]})
    history.append(_run_tool(server_url, first["tool_calls"][0]))
    spoken = _turn(server_url, history)
    assert "egg and spinach" in spoken["speech"]

    history.append({"role": "assistant", "text": spoken["speech"]})
    history.append({"role": "user", "text": "Thank you, that dinner idea is great"})
    thanks = _turn(server_url, history)
    call = thanks["tool_calls"][0]
    assert call["name"] == "record_thanks"
    assert call["arguments"]["tip_id"] == "pkt_egg_spinach"
    before = len(store.packets(kind="thanks"))
    _run_tool(server_url, call)
    assert len(store.packets(kind="thanks")) == before + 1


def test_app_only_tools_are_not_offered_to_the_model(store):
    import asyncio

    from overhearth.mcp_server import build_server

    names = {t.name for t in tool_defs(asyncio.run(build_server(store).list_tools()))}
    assert "get_town_state" not in names
    assert {"record_thanks", "town_report", "ask_town", "open_town", "share_with_town"} <= names


def test_converse_mapping_groups_tool_results():
    messages = [
        Message(role="user", text="hi"),
        Message(role="assistant", tool_calls=[ToolCall(id="a", name="x"), ToolCall(id="b", name="y")]),
        Message(role="tool", tool_call_id="a", name="x", content={"speech": "one"}),
        Message(role="tool", tool_call_id="b", name="y", content="two", is_error=True),
    ]
    converse = _to_converse(messages)
    assert [m["role"] for m in converse] == ["user", "assistant", "user"]
    results = converse[2]["content"]
    assert results[0]["toolResult"]["toolUseId"] == "a"
    assert results[1]["toolResult"]["status"] == "error"


def test_trim_starts_on_a_user_message():
    messages = [Message(role="tool", tool_call_id="a", content={}), Message(role="user", text="x" * 5000)]
    trimmed = trim(messages)
    assert trimmed[0].role == "user"
    assert len(trimmed[0].text) == 1000

"""Development path on the Claude API (#27). No network: the client is faked."""

from types import SimpleNamespace

from overhearth.assistant import ClaudeAssistant, Message, ToolCall, ToolDef, _to_anthropic, assistant_from_env
from overhearth.engine import ClaudeDialogue, FeaturedDialogue
from overhearth.engine.dialogue import dialogue_from_env


class FakeMessages:
    def __init__(self, content):
        self.content = content
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=self.content)


def _client(*blocks):
    return SimpleNamespace(messages=FakeMessages(list(blocks)))


TOOLS = [ToolDef(name="town_report", description="News.", input_schema={"type": "object", "properties": {}})]


def test_history_maps_to_the_messages_api_shape():
    history = [
        Message(role="user", text="What happened?"),
        Message(role="assistant", tool_calls=[ToolCall(id="t1", name="town_report")]),
        Message(role="tool", tool_call_id="t1", name="town_report", content={"speech": "Quiet."}),
        Message(role="tool", tool_call_id="t2", name="ask_town", content="boom", is_error=True),
    ]
    mapped = _to_anthropic(history)
    assert [m["role"] for m in mapped] == ["user", "assistant", "user"]
    assert mapped[1]["content"] == [{"type": "tool_use", "id": "t1", "name": "town_report", "input": {}}]
    first, second = mapped[2]["content"]
    assert first == {"type": "tool_result", "tool_use_id": "t1", "content": '{"speech": "Quiet."}'}
    assert second["is_error"] is True


def test_the_claude_assistant_returns_tool_calls():
    client = _client(SimpleNamespace(type="tool_use", id="toolu_1", name="town_report", input={}))
    result = ClaudeAssistant(client=client, model_id="claude-haiku-5-5").turn(
        [Message(role="user", text="Anything new?")], TOOLS
    )
    assert result.speech is None
    assert result.tool_calls == [ToolCall(id="toolu_1", name="town_report", arguments={})]
    (request,) = client.messages.calls
    assert request["model"] == "claude-haiku-5-5"
    assert request["tools"][0]["input_schema"] == {"type": "object", "properties": {}}
    assert request["thinking"] == {"type": "disabled"}


def test_the_claude_assistant_returns_speech():
    client = _client(SimpleNamespace(type="text", text="It's been quiet."))
    result = ClaudeAssistant(client=client).turn([Message(role="user", text="Hi")], TOOLS)
    assert result.speech == "It's been quiet."
    assert result.tool_calls == []


def test_environment_picks_the_claude_api(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("OVERHEARTH_DIALOGUE", "anthropic")
    monkeypatch.delenv("OVERHEARTH_ASSISTANT", raising=False)
    monkeypatch.delenv("OVERHEARTH_DIALOGUE_SCOPE", raising=False)
    assert isinstance(assistant_from_env(), ClaudeAssistant)
    dialogue = dialogue_from_env()
    assert isinstance(dialogue, FeaturedDialogue)
    monkeypatch.setenv("OVERHEARTH_DIALOGUE_SCOPE", "all")
    assert isinstance(dialogue_from_env(), ClaudeDialogue)

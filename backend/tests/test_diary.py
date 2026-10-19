"""The picture diary (#45). The model and the image generator are faked."""

import json
import random
from datetime import UTC, datetime, timedelta

from starlette.testclient import TestClient

from overhearth.devclient import RawMcpClient
from overhearth.diary import TOWN, Diarist
from overhearth.engine import TemplateDialogue, run_tick
from overhearth.images import LocalImageStore
from overhearth.models import Diary
from overhearth.town_seed import seeded_town

PNG = b"\x89PNG\r\n\x1a\nfake"


class FakeWriter:
    def __init__(self) -> None:
        self.prompts: list[tuple[str, str]] = []

    def complete(self, system: str, user: str, *, max_tokens: int = 1200) -> str:
        self.prompts.append((system, user))
        japanese = "Japanese" in system
        return json.dumps(
            {
                "title": "町の一日" if japanese else "A day in town",
                "text": "今日は広場でUmeに会ったよ。" if japanese else "Today I met Ume by the fountain.",
                "scene": "Two round avatars chatting by a fountain.",
            }
        )


class FakePainter:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def paint(self, prompt: str) -> bytes:
        self.prompts.append(prompt)
        return PNG


def _evening_in_tokyo() -> datetime:
    return datetime(2026, 10, 20, 10, 30, tzinfo=UTC)  # 19:30 in Tokyo, 03:30 in Los Angeles


def test_diaries_are_due_in_each_homes_evening(tmp_path):
    store = seeded_town(now=_evening_in_tokyo())
    diarist = Diarist(store, None, None, LocalImageStore(tmp_path, "http://local"))
    due = diarist.due(_evening_in_tokyo())
    assert {"hh_tokyo", "hh_osaka"} <= set(due)
    assert "hh_seattle" not in due  # still night in Seattle
    assert TOWN not in due
    morning = datetime(2026, 10, 20, 0, 30, tzinfo=UTC)  # 09:30 in Tokyo
    assert "hh_tokyo" not in diarist.due(morning)


def test_a_home_gets_its_diary_in_its_language_with_a_picture_and_a_report_line(tmp_path):
    now = _evening_in_tokyo()
    store = seeded_town(now=now - timedelta(hours=1))
    run_tick(store, TemplateDialogue(), at=now - timedelta(minutes=30), rng=random.Random(3))
    writer, painter = FakeWriter(), FakePainter()
    diarist = Diarist(store, writer, painter, LocalImageStore(tmp_path, "http://local"))
    written = {d.scope: d for d in diarist.write_due(now)}
    tokyo = written["hh_tokyo"]
    assert tokyo.language == "ja"
    assert tokyo.text.startswith("今日は")
    assert tokyo.date == "2026-10-20"
    assert tokyo.image_url == f"http://local/diary/{tokyo.id}.png"
    assert (tmp_path / f"{tokyo.id}.png").read_bytes() == PNG
    assert "No text" in painter.prompts[0]
    report = store.latest_report("hh_tokyo")
    assert any(i.kind == "diary" and "絵日記" in i.text for i in report.items)
    # Written once a day.
    assert "hh_tokyo" not in diarist.due(now + timedelta(minutes=30))
    # The prompt carries the day's events, not personal details.
    system, user = next(p for p in writer.prompts if "Kiri" in p[0])
    assert "Today's events" in user


def test_without_a_model_or_a_painter_the_diary_is_text_only(tmp_path):
    store = seeded_town()
    diary = Diarist(store, None, None, LocalImageStore(tmp_path, "http://local")).write_due(
        _evening_in_tokyo(), scopes=["hh_osaka"]
    )[0]
    assert diary.text
    assert diary.image_url is None


def test_alexa_shows_the_diary(server_url, store):
    client = RawMcpClient(server_url, token="demo-tokyo")
    client.initialize()
    empty = client.call_tool("town_diary")[0]["structuredContent"]
    assert empty["available"] is False
    store.put_diary(
        Diary(scope="hh_tokyo", date="2026-10-20", title="A day", text="I met Ume.", image_url="http://x/p.png")
    )
    store.put_diary(Diary(scope=TOWN, date="2026-10-20", title="The town", text="Busy plaza."))
    shown = client.call_tool("town_diary")[0]["structuredContent"]
    assert shown["available"] is True
    assert shown["image_url"] == "http://x/p.png"
    town = client.call_tool("get_diary", {"scope": "town"})[0]["structuredContent"]
    assert town["text"] == "Busy plaza."


def test_the_watch_page_reads_the_town_diary_and_local_pictures(monkeypatch, tmp_path):
    from overhearth.asgi import create_app
    from overhearth.dev_seed import seeded_store

    monkeypatch.setenv("OVERHEARTH_DIARY_DIR", str(tmp_path))
    (tmp_path / "diary_x.png").write_bytes(PNG)
    store = seeded_store()
    store.put_diary(Diary(scope=TOWN, date="2026-10-20", title="The town", text="Busy plaza."))
    with TestClient(create_app(store), base_url="http://localhost:8000") as client:
        assert client.get("/town/diary").json()["diary"]["text"] == "Busy plaza."
        picture = client.get("/diary/diary_x.png")
        assert picture.status_code == 200
        assert picture.content == PNG
        assert client.get("/diary/..%2Fsecret.png").status_code == 404


def test_the_tick_lambda_draws_diaries_on_request(monkeypatch, tmp_path):
    from overhearth import lambda_tick

    monkeypatch.setenv("OVERHEARTH_STORE", "memory")
    monkeypatch.setenv("OVERHEARTH_SEED", "dev")
    monkeypatch.setenv("OVERHEARTH_DIALOGUE", "template")
    monkeypatch.setenv("OVERHEARTH_DIARY_DIR", str(tmp_path))
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(lambda_tick, "_store", None)
    result = lambda_tick.handler({"diary": ["hh_tokyo", TOWN]}, None)
    assert {d["scope"] for d in result["diaries"]} == {"hh_tokyo", TOWN}

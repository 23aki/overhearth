"""The town grows with thanks (#47): levels, landmarks and the news of them."""

import random
from datetime import UTC, datetime, timedelta

from overhearth import growth
from overhearth.devclient import RawMcpClient
from overhearth.engine import TemplateDialogue, run_tick
from overhearth.models import Household, Packet
from overhearth.store.memory import MemoryStore
from overhearth.town_seed import seeded_town

NOW = datetime(2026, 10, 20, 10, 0, tzinfo=UTC)


def _home(store: MemoryStore, hid: str, language: str = "en", tier: str = "demo") -> Household:
    home = Household(
        id=hid, label=hid, avatar_name=hid.title(), tier=tier, region="Somewhere", timezone="UTC", language=language
    )
    store.add_household(home)
    return home


def _tip(store: MemoryStore, origin: str, topic: str, keywords: list[str]) -> Packet:
    tip = Packet(
        kind="tip",
        origin_household=origin,
        consented_at=NOW,
        payload={"topic": topic, "text": topic, "keywords": keywords},
    )
    store.add_packet(tip)
    return tip


def _thank(store: MemoryStore, origin: str, tip: Packet, times: int) -> None:
    for _ in range(times):
        store.add_packet(
            Packet(
                kind="thanks",
                origin_household=origin,
                consented_at=NOW,
                payload={"what_helped": "it", "tip_id": tip.id},
            )
        )


def test_levels_follow_the_xp_table():
    assert growth.level_for(0) == 1
    assert growth.level_for(149) == 1
    assert growth.level_for(150) == 2
    assert growth.level_for(10**6) == len(growth.LEVELS)


def test_tips_and_everyday_thanks_point_to_a_landmark():
    assert growth.category("Ten-minute dinner", ["cook", "quick"]) == "bakery"
    assert growth.category("Rainy-day games for kids") == "playground"
    assert growth.category("Something entirely unrelated zzz") is None


def test_a_level_up_builds_the_landmark_of_the_most_thanked_topic():
    store = MemoryStore()
    _home(store, "hh_a", "ja")
    _home(store, "hh_b", "en")
    _home(store, "hh_bg", tier="background")
    store.put_growth({"level": 1, "landmarks": [], "chats": 0})
    cooking = _tip(store, "hh_a", "Ten-minute dinner", ["cook", "dinner"])
    kids = _tip(store, "hh_b", "Rainy-day games for kids", ["kids", "rainy"])
    _thank(store, "hh_b", cooking, 40)  # 80 XP + 6 for the tips
    _thank(store, "hh_a", kids, 10)  # 20 XP: 106, still level 1
    assert growth.grow(store, NOW, 1) == ([], {})

    events, lines = growth.grow(store, NOW, 2, chats=50)  # 156: level 2
    assert [e.detail for e in events] == [{"landmark": "bakery", "level": 2}]
    assert events[0].type == "town"
    assert events[0].summary == "A bakery opened in town! It grew from all the thanks for cooking tips."
    assert lines["hh_a"][0].text == "町にパン屋ができました！料理のコツへの感謝がきっかけです。"
    assert lines["hh_a"][0].kind == "growth"
    assert "hh_bg" not in lines  # background homes have nobody to tell
    assert store.get_growth()["level"] == 2
    assert store.get_growth()["chats"] == 50

    # Next level: the bakery is built, so the next most thanked topic gets its landmark.
    events, _ = growth.grow(store, NOW, 3, chats=200)
    assert [e.detail["landmark"] for e in events] == ["playground"]


def test_an_existing_town_starts_quietly_with_what_its_history_earned():
    store = seeded_town(now=NOW)
    events, lines = growth.grow(store, NOW, 1)
    assert events == [] and lines == {}
    record = store.get_growth()
    assert record["level"] > 1
    assert len(record["landmarks"]) == record["level"] - 1
    assert len({lm["kind"] for lm in record["landmarks"]}) == len(record["landmarks"])


def test_every_landmark_is_built_once_then_each_grows_bigger_most_thanked_first():
    store = MemoryStore()
    _home(store, "hh_a", "ja")
    store.put_growth({"level": 1, "landmarks": [], "chats": 0})
    kids = _tip(store, "hh_a", "Rainy-day games for kids", ["kids", "rainy"])
    _thank(store, "hh_a", kids, 5)
    events, lines = growth.grow(store, NOW, 1, chats=growth.LEVELS[-1])
    built = [e.detail["landmark"] for e in events if not e.detail.get("upgrade")]
    bigger = [e.detail["landmark"] for e in events if e.detail.get("upgrade")]
    assert sorted(built) == sorted(growth.LANDMARKS)
    assert built[-1] == "lanterns"
    assert sorted(bigger) == sorted(k for k in growth.LANDMARKS if k != "lanterns")
    assert bigger[0] == "playground"  # the most thanked topic grows first
    assert len(events) == len(growth.LEVELS) - 1
    texts = [item.text for item in lines["hh_a"]]
    assert "公園の遊び場が大きくなりました！子育てのコツへの感謝が続いています。" in texts
    assert lines["hh_a"][-1].key.endswith(":bigger")
    record = store.get_growth()
    assert len(record["upgrades"]) == len(bigger)
    assert growth.grow(store, NOW, 2, chats=1000) == ([], {})
    state = growth.summary(store.packets(), store.get_growth())
    assert state["next_xp"] is None and len(state["upgrades"]) == 11


def test_announcements_read_well_in_every_language():
    for language in growth.BUILT:
        for kind in growth.LANDMARKS:
            text = growth.announce(kind, language)
            assert "{" not in text and text[0] == text[0].upper()
    assert growth.announce("bakery", "ko").startswith("동네에 빵집이 ")
    assert growth.announce("playground", "ko").startswith("동네에 놀이터가 ")
    for language in growth.BUILT:
        for kind in growth.THE:
            text = growth.announce(kind, language, upgrade=True)
            assert "{" not in text
    assert growth.announce("library", "es", upgrade=True).startswith("¡La biblioteca creció!")


def test_ticks_grow_the_town_and_tell_the_homes():
    store = seeded_town(now=NOW)
    rng = random.Random(1)
    built = []
    for i in range(30):
        result = run_tick(store, TemplateDialogue(), at=NOW + timedelta(minutes=30 * (i + 1)), rng=rng)
        built += [e for e in store.town_events(limit=200) if e.type == "town" and e.tick == i + 1]
        assert result.landmarks == len([e for e in built if e.tick == i + 1])
    assert built, "a day of town life should build at least one landmark"
    landmark = built[0].detail["landmark"]
    report = store.latest_report("hh_tokyo")
    assert any(item.kind == "growth" and item.key == f"growth:{landmark}" for item in report.items)
    state = store.town_state()["growth"]
    assert state["level"] == store.get_growth()["level"]
    assert state["level_xp"] <= state["xp"] < state["next_xp"]
    assert landmark in [lm["kind"] for lm in state["landmarks"]]


def test_alexa_tells_about_new_landmarks_and_the_town_view_shows_them(server_url, store):
    store.put_growth({"level": 1, "landmarks": [], "chats": 0})
    run_tick(store, TemplateDialogue(), at=datetime.now(UTC), rng=random.Random(2))
    store.put_growth({"level": 1, "landmarks": [], "chats": growth.LEVELS[-1]})
    run_tick(store, TemplateDialogue(), at=datetime.now(UTC) + timedelta(minutes=30), rng=random.Random(3))
    client = RawMcpClient(server_url, token="demo-tokyo")
    client.initialize()
    speech = client.call_tool("town_report")[0]["structuredContent"]["speech"]
    assert "A bakery opened in town!" in speech
    town = client.call_tool("get_town_state")[0]["structuredContent"]
    assert town["growth"]["level"] == len(growth.LEVELS)
    assert len(town["growth"]["landmarks"]) == len(growth.LANDMARKS)
    assert len(town["growth"]["upgrades"]) == len(growth.LANDMARKS) - 1


def test_the_report_tells_how_far_the_town_has_grown(server_url, store):
    store.put_growth(
        {
            "level": 3,
            "landmarks": [{"kind": "bakery", "level": 2, "at": ""}, {"kind": "cafe", "level": 3, "at": ""}],
            "chats": 0,
        }
    )
    client = RawMcpClient(server_url, token="demo-tokyo")
    client.initialize()
    town = client.call_tool("town_report")[0]["structuredContent"]["town"]
    assert town.startswith("The town is at level 3 of")
    assert "a bakery, a café" in town
    assert growth.describe(None) is None

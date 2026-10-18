import random
from collections import Counter

import pytest

from overhearth.engine import TemplateDialogue, run_tick
from overhearth.models import utcnow
from overhearth.town_seed import QUIET_BEFORE_NOW, load_town_data, seeded_town

DEMO_TOKENS = {"demo-tokyo", "demo-osaka", "demo-seattle", "demo-austin"}


def test_town_has_demo_and_background_households():
    store = seeded_town()
    tiers = Counter(h.tier for h in store.households())
    assert tiers["demo"] == 4
    assert tiers["background"] >= 30
    for token in DEMO_TOKENS:
        assert store.household_for_token(token).tier == "demo"


def test_ids_and_avatar_names_are_unique():
    data = load_town_data()
    ids = [h["id"] for h in data["households"]]
    avatars = [h["avatar"] for h in data["households"]]
    tips = [t["id"] for h in data["households"] for t in h["tips"]]
    assert len(set(ids)) == len(ids)
    assert len(set(avatars)) == len(avatars)
    assert len(set(tips)) == len(tips)


def test_every_theme_is_defined():
    data = load_town_data()
    used = {theme for h in data["households"] for theme in h["gratitude"]}
    assert used <= set(data["themes"])


def test_seed_is_deterministic():
    a, b = seeded_town(seed=1), seeded_town(seed=1)
    assert len(a.packets()) == len(b.packets())
    assert Counter(p.payload.get("tip_id") for p in a.packets(kind="thanks")) == Counter(
        p.payload.get("tip_id") for p in b.packets(kind="thanks")
    )


def test_popular_tips_are_thanked_more():
    store = seeded_town()
    counts = Counter(p.payload.get("tip_id") for p in store.packets(kind="thanks"))
    assert counts["tip_egg_spinach"] > counts["tip_desk_stretch"]


def _report_kinds(store, household_id):
    report = store.latest_report(household_id)
    return {item.kind for item in report.items} if report else set()


def test_seeded_history_is_not_news_on_the_first_tick():
    now = utcnow()
    store = seeded_town(now=now)
    assert max(p.created_at for p in store.packets()) <= now - QUIET_BEFORE_NOW
    run_tick(store, TemplateDialogue(), at=now, rng=random.Random(3), out_ratio=1.0)
    assert not any("thanks_return" in _report_kinds(store, h.id) for h in store.households())


def test_first_tick_produces_trends_and_exchanges():
    store = seeded_town()
    result = run_tick(store, TemplateDialogue(), rng=random.Random(3), out_ratio=1.0)
    assert result.encounters == len(store.households()) // 2
    assert result.exchanges > 0
    assert any("trend" in _report_kinds(store, h.id) for h in store.households())


@pytest.mark.parametrize(
    "question",
    [
        "What can I cook in ten minutes?",
        "fast meal to cook in 10 minutes",
        "quick dinner after getting home late",
    ],
)
def test_everyday_dinner_questions_find_the_egg_dinner(question):
    found = [entry.packet_id for entry in seeded_town().search_knowledge(question)]
    assert "tip_egg_spinach" in found


def test_every_seeded_tip_has_keywords():
    assert all(t.get("keywords") for h in load_town_data()["households"] for t in h["tips"])


def test_feeling_lonely_after_a_move_finds_the_library_tip():
    found = [entry.packet_id for entry in seeded_town().search_knowledge("I feel lonely after moving")]
    assert "tip_library_first" in found

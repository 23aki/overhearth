import random
from datetime import timedelta

from overhearth import i18n
from overhearth.engine import TemplateDialogue, run_tick
from overhearth.engine.residents import simulate_residents
from overhearth.models import utcnow
from overhearth.town_seed import seeded_town


def test_a_quick_demo_tick_adds_almost_nothing():
    store = seeded_town()
    at = utcnow()
    added = simulate_residents(store, since=at - timedelta(seconds=30), at=at, rng=random.Random(1))
    assert added <= 1


def test_residents_keep_thanking_over_a_day_and_thanks_flow_back():
    now = utcnow()
    store = seeded_town(now=now)
    rng = random.Random(3)
    added = 0
    for step in range(1, 49):  # one day of 30-minute ticks
        result = run_tick(store, TemplateDialogue(), at=now + timedelta(minutes=30 * step), rng=rng)
        added += result.resident_thanks
    print("resident thanks in a day:", added)
    # About 30 background homes x 24 h x 0.06 per hour, minus homes with nothing to thank for.
    assert 15 <= added <= 80

    homes = {h.id: h for h in store.households()}
    new = [t for t in store.packets(kind="thanks") if t.created_at > now]
    assert new
    assert all(homes[t.origin_household].tier == "background" for t in new)
    tip_thanks = [t for t in new if t.payload.get("tip_id")]
    assert tip_thanks
    for thanks in tip_thanks:
        tip = store.get_packet(thanks.payload["tip_id"])
        assert tip.origin_household != thanks.origin_household
        assert thanks.payload["tip_id"] in store.carried(thanks.origin_household)
    # Nobody thanks the same tip twice.
    pairs = [(t.origin_household, t.payload["tip_id"]) for t in tip_thanks]
    assert len(pairs) == len(set(pairs))
    # The returns reached the town log.
    flows = [e for e in store.town_events(limit=2000) if e.type == "thanks_flow" and e.at > now]
    assert flows


def test_trends_still_have_something_to_say_after_the_seed_ages_out():
    now = utcnow()
    store = seeded_town(now=now - timedelta(days=8))
    rng = random.Random(5)
    for step in range(1, 25):  # a day of ticks, eight days after seeding
        run_tick(store, TemplateDialogue(), at=now + timedelta(hours=step), rng=rng)
    recent = [t for t in store.packets(kind="thanks") if t.created_at > now - timedelta(days=7)]
    assert recent


def test_an_unheard_report_says_each_returned_tip_once_with_the_total():
    now = utcnow()
    store = seeded_town(now=now)
    rng = random.Random(9)
    for step in range(1, 3 * 48 + 1):
        run_tick(store, TemplateDialogue(), at=now + timedelta(minutes=30 * step), rng=rng)
    report = store.latest_report("hh_osaka")
    returns = [item for item in report.items if item.kind == "thanks_return"]
    assert returns
    assert len({tuple(item.refs) for item in returns}) == len(returns)
    for item in returns:
        tip_id = item.refs[0]
        expected = [
            t
            for t in store.packets(kind="thanks")
            if t.payload.get("tip_id") == tip_id and t.created_at > report.since and t.origin_household != "hh_osaka"
        ]
        language = store.get_household("hh_osaka").language
        assert i18n.count_times(language, len(expected)) in item.text

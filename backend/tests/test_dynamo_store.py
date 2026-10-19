import random
from datetime import timedelta

import boto3
import pytest
from moto import mock_aws

from overhearth.engine import run_tick
from overhearth.engine.dialogue import TemplateDialogue
from overhearth.models import AuthGrant, utcnow
from overhearth.store.dynamo import DynamoStore, create_table
from overhearth.town_seed import seeded_town


@pytest.fixture
def dynamo(monkeypatch: pytest.MonkeyPatch):
    for name, value in {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_DEFAULT_REGION": "us-east-1",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    with mock_aws():
        resource = boto3.resource("dynamodb", region_name="us-east-1")
        create_table(resource, "overhearth-test")
        yield DynamoStore("overhearth-test", resource=resource)


def test_a_tick_gives_the_same_town_as_the_memory_store(dynamo):
    now = utcnow()
    memory = seeded_town(now=now)
    dynamo.load_from(seeded_town(now=now))
    assert not dynamo.is_empty()

    at = now + timedelta(minutes=30)
    expected = run_tick(memory, TemplateDialogue(), at=at, rng=random.Random(7))
    actual = run_tick(dynamo, TemplateDialogue(), at=at, rng=random.Random(7))

    assert actual == expected
    for home in ("hh_tokyo", "hh_osaka"):
        assert dynamo.latest_report(home).items == memory.latest_report(home).items
    assert [e.summary for e in dynamo.town_events(limit=30)] == [e.summary for e in memory.town_events(limit=30)]
    assert dynamo.town_state()["homes"] == memory.town_state()["homes"]
    question = "what can I cook in ten minutes"
    assert dynamo.search_knowledge(question) == memory.search_knowledge(question)


def test_the_clock_counts_ticks_and_remembers_the_last_one(dynamo):
    first_at = utcnow()
    tick, previous = dynamo.next_tick(first_at)
    assert tick == 1
    assert previous < first_at
    tick, previous = dynamo.next_tick(first_at + timedelta(minutes=30))
    assert tick == 2
    assert previous == first_at


def test_an_authorization_code_works_once(dynamo):
    grant = AuthGrant(
        client_id="c",
        redirect_uri="http://localhost/",
        code_challenge="x",
        household_id="hh",
        scope="mcp:tools",
        expires_at=utcnow() + timedelta(minutes=5),
    )
    dynamo.put_auth_code("code", grant)
    assert dynamo.take_auth_code("code") == grant
    assert dynamo.take_auth_code("code") is None


def test_events_keep_their_order_across_calls(dynamo):
    from overhearth.models import TownEvent

    at = utcnow()
    for name in ("a", "b", "c"):
        dynamo.add_town_events([TownEvent(tick=1, at=at, type="town", summary=name)])
    assert [e.summary for e in dynamo.town_events(limit=2)] == ["b", "c"]


def test_refresh_updates_homes_and_tips_but_keeps_history(dynamo):
    old = seeded_town()
    egg = old.get_packet("tip_egg_spinach")
    old.add_packet(egg.model_copy(update={"payload": {**egg.payload, "text": "old english text"}}))
    dynamo.load_from(old)
    thanks_before = len(dynamo.packets(kind="thanks"))
    dynamo.refresh_from(seeded_town())
    assert "ほうれん草" in dynamo.get_packet("tip_egg_spinach").payload["text"]
    assert dynamo.get_household("hh_osaka").language == "ja"
    assert len(dynamo.packets(kind="thanks")) == thanks_before

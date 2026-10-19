"""Avatars go home while their person talks to Alexa (#43)."""

from datetime import timedelta

from overhearth.devclient import RawMcpClient
from overhearth.models import utcnow


def test_talking_and_its_kind_fade_with_time(store):
    now = utcnow()
    store.mark_active("hh_tokyo", "thanks", now)
    store.mark_active("hh_tokyo", "talk", now + timedelta(seconds=10))
    assert store.activity(now + timedelta(seconds=12))["hh_tokyo"] == {"kind": "thanks", "ago": 2}
    # Plain talk long after the thanks: still at home, just talking.
    store.mark_active("hh_tokyo", "talk", now + timedelta(seconds=50))
    assert store.activity(now + timedelta(seconds=51))["hh_tokyo"]["kind"] == "talk"
    # Quiet for a while: back out in town.
    assert "hh_tokyo" not in store.activity(now + timedelta(seconds=50 + 91))


def test_tools_mark_the_home_active_and_the_town_shows_only_the_kind(server_url, store):
    client = RawMcpClient(server_url, token="demo-tokyo")
    client.initialize()
    client.call_tool("record_thanks", {"what_helped": "the secret family recipe for my aunt's birthday"})
    active = store.activity(utcnow())
    assert active["hh_tokyo"]["kind"] == "thanks"
    assert "hh_osaka" not in active
    state = store.town_state()
    assert state["active"]["hh_tokyo"]["kind"] == "thanks"
    assert "recipe" not in str(state["active"])


def test_the_watch_page_reads_activity_without_a_household(server_url):
    import json
    import urllib.request

    client = RawMcpClient(server_url, token="demo-osaka")
    client.initialize()
    client.call_tool("town_report")
    with urllib.request.urlopen(server_url.replace("/mcp", "/town/activity"), timeout=5) as response:
        body = json.loads(response.read())
    assert body["active"]["hh_osaka"]["kind"] == "news"

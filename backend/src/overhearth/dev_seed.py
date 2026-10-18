"""A tiny hand-written town for local development and tests.

The full set of background residents and demo households is generated separately; this
seed only has to be large enough for every tool to return something meaningful.
All households here are simulated.
"""

from __future__ import annotations

from datetime import timedelta

from overhearth.models import (
    Household,
    Packet,
    PacketContext,
    Report,
    ReportItem,
    TownEvent,
    utcnow,
)
from overhearth.store.memory import MemoryStore

DEMO_TOKENS = {
    "demo-tokyo": "hh_tokyo",
    "demo-osaka": "hh_osaka",
}


def seeded_store() -> MemoryStore:
    store = MemoryStore()
    now = utcnow()

    tokyo = Household(
        id="hh_tokyo",
        label="a studio apartment in Tokyo",
        region="Tokyo",
        timezone="Asia/Tokyo",
        tier="demo",
        avatar_name="Kiri",
        personality=["curious", "night owl"],
    )
    osaka = Household(
        id="hh_osaka",
        label="a retired cook's home in Osaka",
        region="Osaka",
        timezone="Asia/Tokyo",
        tier="demo",
        avatar_name="Ume",
        personality=["warm", "loves cooking"],
    )
    seattle = Household(
        id="hh_seattle",
        label="a family of four in Seattle",
        region="Washington",
        timezone="America/Los_Angeles",
        tier="background",
        avatar_name="Juniper",
        personality=["busy", "cheerful"],
    )
    austin = Household(
        id="hh_austin",
        label="a student in Austin",
        region="Texas",
        timezone="America/Chicago",
        tier="background",
        avatar_name="Pip",
        personality=["thrifty"],
    )
    for household in (tokyo, osaka, seattle, austin):
        token = next((t for t, h in DEMO_TOKENS.items() if h == household.id), None)
        store.add_household(household, token=token)

    egg_tip = Packet(
        id="pkt_egg_spinach",
        kind="tip",
        origin_household=osaka.id,
        payload={
            "topic": "quick dinner",
            "text": "Ten-minute egg and spinach: wilt the spinach in sesame oil, pour in beaten egg with a "
            "splash of soy sauce, fold twice and serve on rice.",
        },
        context=PacketContext(topics=["cooking", "eggs", "spinach"], region="Osaka"),
        consented_at=now - timedelta(days=3),
    )
    rice_tip = Packet(
        id="pkt_leftover_rice",
        kind="tip",
        origin_household=seattle.id,
        payload={
            "topic": "leftover rice",
            "text": "Freeze leftover rice in flat portions while it is still warm; it reheats fluffy in two minutes.",
        },
        context=PacketContext(topics=["cooking", "rice"], region="Washington"),
        consented_at=now - timedelta(days=2),
    )
    store.add_packet(egg_tip)
    store.add_packet(rice_tip)

    for i, thanker in enumerate([seattle, austin, tokyo, seattle, austin]):
        store.add_packet(
            Packet(
                kind="thanks",
                origin_household=thanker.id,
                payload={"what_helped": "the ten-minute egg and spinach dinner", "tip_id": egg_tip.id},
                refs=[egg_tip.id],
                consented_at=now - timedelta(hours=20 - i),
            )
        )

    store.add_town_events(
        [
            TownEvent(
                tick=1,
                at=now - timedelta(hours=6),
                type="encounter",
                actors=[tokyo.id, osaka.id],
                summary="Kiri and Ume met by the bakery and talked about quick dinners.",
                refs=[egg_tip.id],
            ),
            TownEvent(
                tick=1,
                at=now - timedelta(hours=6),
                type="thanks_flow",
                actors=[seattle.id, osaka.id],
                summary="Thanks from Seattle travelled to Osaka.",
                refs=[egg_tip.id],
            ),
        ]
    )

    store.put_report(
        Report(
            household_id=tokyo.id,
            generated_at=now - timedelta(minutes=30),
            since=now - timedelta(hours=12),
            met=["Ume", "Juniper"],
            items=[
                ReportItem(
                    kind="tip",
                    text="Ume from a retired cook's home in Osaka shared a ten-minute egg and spinach dinner, "
                    "and it has been thanked 5 times in 3 homes.",
                    refs=[egg_tip.id],
                ),
                ReportItem(
                    kind="thanks",
                    text="Around town this week, people keep thanking their Alexa for reminders to call family.",
                ),
            ],
        )
    )
    return store

"""The simulated background residents keep living between ticks.

Their people are simulated too, so now and then one of them thanks its Alexa: for a tip its
avatar brought home from town, or for one of the everyday things that home is usually
thankful for. This keeps returns and trends flowing over weeks. Demo and linked homes never
do this; they only thank when a person does.

Rates are per hour of town time, so frequent demo ticks add almost nothing and a month of
30-minute ticks adds about forty thanks a day across the town.
"""

from __future__ import annotations

import math
import random
from datetime import datetime

from overhearth.models import Household, Packet, PacketContext
from overhearth.store import Store

TIP_THANKS_PER_HOUR = 0.04
"""How often a background home thanks its Alexa for a tip carried home from town."""
EVERYDAY_THANKS_PER_HOUR = 0.02
"""How often a background home is thankful for one of its usual things."""
MAX_HOURS = 6.0
"""Cap on how much time one tick may catch up on, after a long pause."""


def _chance(per_hour: float, hours: float) -> float:
    return 1 - math.exp(-per_hour * hours)


def _what_helped(tip: Packet, thanks: list[Packet]) -> str:
    """Reuse how people already put it, so trend lines read naturally."""
    for packet in thanks:
        if packet.payload.get("tip_id") == tip.id and packet.payload.get("what_helped"):
            return packet.payload["what_helped"]
    return f"the tip about {tip.payload['topic']}"


def _thanks(home: Household, what_helped: str, at: datetime, tip_id: str | None = None) -> Packet:
    return Packet(
        kind="thanks",
        origin_household=home.id,
        payload={"what_helped": what_helped, "tip_id": tip_id},
        refs=[tip_id] if tip_id else [],
        context=PacketContext(region=home.region),
        consented_at=at,
        created_at=at,
    )


def simulate_residents(store: Store, *, since: datetime, at: datetime, rng: random.Random) -> int:
    """Add the thanks the simulated people said since the last tick. Returns how many."""
    hours = min(MAX_HOURS, max(0.0, (at - since).total_seconds() / 3600))
    if hours == 0:
        return 0
    tip_chance = _chance(TIP_THANKS_PER_HOUR, hours)
    everyday_chance = _chance(EVERYDAY_THANKS_PER_HOUR, hours)
    all_thanks = store.packets(kind="thanks")
    added = 0
    for home in store.households():
        if home.tier != "background":
            continue
        own_thanks = [t for t in all_thanks if t.origin_household == home.id]
        if rng.random() < tip_chance:
            thanked = {t.payload.get("tip_id") for t in own_thanks}
            carried = [p for pid in store.carried(home.id) if (p := store.get_packet(pid))]
            tips = [p for p in carried if p.kind == "tip" and p.origin_household != home.id and p.id not in thanked]
            if tips:
                tip = rng.choice(tips)
                store.add_packet(_thanks(home, _what_helped(tip, all_thanks), at, tip.id))
                added += 1
        if rng.random() < everyday_chance:
            everyday = sorted({t.payload["what_helped"] for t in own_thanks if not t.payload.get("tip_id")})
            if everyday:
                store.add_packet(_thanks(home, rng.choice(everyday), at))
                added += 1
    return added

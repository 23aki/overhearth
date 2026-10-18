"""Build the demo town from `fixtures/town.json`.

The file holds the simulated households, the tips they shared and the questions they
asked. Thanks are generated deterministically from each tip's popularity and each
household's recurring gratitude themes, so the town has history and trends from the first
tick. Everything is dated at least two hours in the past, so the first tick does not
treat seeded thanks as news.
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta
from importlib import resources
from typing import Any

from overhearth import kinds
from overhearth.models import Household, Packet, PacketContext, utcnow
from overhearth.store.memory import MemoryStore

QUIET_BEFORE_NOW = timedelta(hours=2)


def load_town_data() -> dict[str, Any]:
    text = resources.files("overhearth").joinpath("fixtures/town.json").read_text(encoding="utf-8")
    return json.loads(text)


def _between(rng: random.Random, start: datetime, end: datetime) -> datetime:
    if end <= start:
        return start
    return start + (end - start) * rng.random()


def _packet(kind: str, origin: Household, payload: dict[str, Any], at: datetime, **extra: Any) -> Packet:
    return Packet(
        kind=kind,
        origin_household=origin.id,
        payload=kinds.get(kind).validate(payload),
        context=PacketContext(region=origin.region, topics=extra.pop("topics", [])),
        consented_at=at,
        created_at=at,
        **extra,
    )


def seeded_town(*, seed: int = 42, now: datetime | None = None) -> MemoryStore:
    now = now or utcnow()
    latest = now - QUIET_BEFORE_NOW
    rng = random.Random(seed)
    data = load_town_data()
    store = MemoryStore()

    households: list[Household] = []
    for raw in data["households"]:
        household = Household(
            id=raw["id"],
            label=raw["label"],
            region=raw["region"],
            timezone=raw["timezone"],
            tier=raw["tier"],
            avatar_name=raw["avatar"],
            personality=raw.get("personality", []),
        )
        store.add_household(household, token=raw.get("token"))
        households.append(household)
    by_id = {h.id: h for h in households}

    for raw in data["households"]:
        origin = by_id[raw["id"]]
        others = [h for h in households if h.id != origin.id]
        for tip in raw.get("tips", []):
            shared_at = now - timedelta(days=rng.uniform(3, 6))
            packet = _packet(
                "tip",
                origin,
                {"topic": tip["topic"], "text": tip["text"], "keywords": tip.get("keywords", [])},
                shared_at,
                id=tip["id"],
                topics=[tip["topic"]],
            )
            store.add_packet(packet)
            for _ in range(tip["popularity"] * 2 + rng.randint(0, 2)):
                thanker = rng.choice(others)
                store.add_packet(
                    _packet(
                        "thanks",
                        thanker,
                        {"what_helped": tip["phrase"], "tip_id": packet.id},
                        _between(rng, shared_at, latest),
                        refs=[packet.id],
                    )
                )
        for question in raw.get("questions", []):
            asked_at = now - timedelta(days=rng.uniform(0.5, 2))
            store.add_packet(_packet("question", origin, question, asked_at, topics=[question["topic"]]))
        for theme in raw.get("gratitude", []):
            for _ in range(rng.randint(1, 2)):
                said_at = _between(rng, now - timedelta(days=6), latest)
                store.add_packet(_packet("thanks", origin, {"what_helped": data["themes"][theme]}, said_at))
    return store

"""Read-side logic shared by every store, so each backend only has to fetch the data."""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Any

from overhearth.models import Household, KnowledgeEntry, Packet, ReportItem, TownEvent
from overhearth.text import MIN_SEARCH_RELEVANCE, answers, relevance

TOWN_VIEW_SCAN = 400
"""How many recent events to look through for the town view."""
TOWN_VIEW_TICKS = 2
"""Every encounter and thanks flow of this many latest ticks goes to the view, for the replay."""
TOWN_VIEW_EXCHANGES = 30
"""Plus this many of the latest exchanges, for the log."""


def select_view_events(events: list[TownEvent]) -> list[TownEvent]:
    ticks = sorted({e.tick for e in events})[-TOWN_VIEW_TICKS:]
    exchanges = {id(e) for e in [e for e in events if e.type == "exchange"][-TOWN_VIEW_EXCHANGES:]}
    return [e for e in events if (e.type != "exchange" and e.tick in ticks) or id(e) in exchanges]


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def rank_knowledge(
    query: str,
    tips: Iterable[Packet],
    thanks: Iterable[Packet],
    households: dict[str, Household],
    *,
    limit: int = 3,
) -> list[KnowledgeEntry]:
    """Tips ranked by relevance, then by how much they were thanked."""
    thanks_by_tip: dict[str, list[Packet]] = {}
    for packet in thanks:
        tip_id = packet.payload.get("tip_id")
        if tip_id:
            thanks_by_tip.setdefault(tip_id, []).append(packet)
    scored: list[tuple[int, int, KnowledgeEntry]] = []
    for tip in tips:
        keywords = tip.payload.get("keywords")
        if not answers(query, tip.payload["topic"], tip.payload["text"], keywords, min_score=MIN_SEARCH_RELEVANCE):
            continue
        score = relevance(query, tip.payload["topic"], tip.payload["text"], keywords)
        received = thanks_by_tip.get(tip.id, [])
        origin = households.get(tip.origin_household)
        entry = KnowledgeEntry(
            packet_id=tip.id,
            topic=tip.payload["topic"],
            text=tip.payload["text"],
            thanks_count=len(received),
            households_thanked=len({t.origin_household for t in received}),
            origin_label=origin.label if origin else "a neighbor",
        )
        scored.append((score, entry.thanks_count, entry))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    return [entry for _, _, entry in scored[:limit]]


ACTIVE_FOR = timedelta(seconds=90)
"""A home counts as talking with its Alexa until this long after the last exchange."""
KIND_FOR = timedelta(seconds=30)
"""What the talk is about (thanks, a question, ...) shows this long; after that it is just talk."""


def describe_activity(records: dict[str, dict[str, Any]], now: datetime) -> dict[str, dict[str, Any]]:
    """Homes talking with their Alexa right now: what about, and how long ago. Never the content."""
    active: dict[str, dict[str, Any]] = {}
    for household_id, record in records.items():
        at = record["at"]
        if now - at > ACTIVE_FOR:
            continue
        kind_at = record.get("kind_at")
        kind = record.get("kind") if kind_at and at - kind_at <= KIND_FOR else "talk"
        active[household_id] = {"kind": kind or "talk", "ago": max(0, int((now - at).total_seconds()))}
    return active


def merge_report_items(pending: list[ReportItem], new: list[ReportItem]) -> list[ReportItem]:
    """Append new items; an item with a key replaces any pending item with the same key."""
    replaced = {item.key for item in new if item.key}
    return [item for item in pending if item.key not in replaced or item.key is None] + new


def build_town_state(
    households: Iterable[Household],
    tip_origins: dict[str, str],
    thanks: Iterable[Packet],
    events: list[TownEvent],
) -> dict[str, Any]:
    """Homes with how often their know-how was thanked, and the latest events."""
    glow: dict[str, int] = {}
    for packet in thanks:
        origin = tip_origins.get(packet.payload.get("tip_id") or "")
        if origin:
            glow[origin] = glow.get(origin, 0) + 1
    return {
        "homes": [
            {
                "id": h.id,
                "label": h.label,
                "avatar": h.avatar_name,
                "tier": h.tier,
                "region": h.region,
                "language": h.language,
                "glow": glow.get(h.id, 0),
            }
            for h in households
        ],
        "events": [e.model_dump(mode="json") for e in select_view_events(events)],
    }

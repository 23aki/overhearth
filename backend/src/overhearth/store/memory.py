"""In-process store for local development and tests."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from overhearth.models import Household, KnowledgeEntry, Packet, Report, ReportItem, TownEvent
from overhearth.text import MIN_SEARCH_RELEVANCE, answers, relevance

FIRST_TICK_LOOKBACK = timedelta(hours=1)
"""On the very first tick, aggregate what happened in the last hour."""


class MemoryStore:
    def __init__(self) -> None:
        self._households: dict[str, Household] = {}
        self._tokens: dict[str, str] = {}
        self._packets: dict[str, Packet] = {}
        self._reports: dict[str, Report] = {}
        self._events: list[TownEvent] = []
        self._carried: dict[str, list[str]] = {}
        self._tick = 0
        self._last_tick_at: datetime | None = None

    # households -------------------------------------------------------------

    def add_household(self, household: Household, *, token: str | None = None) -> None:
        self._households[household.id] = household
        if token:
            self._tokens[token] = household.id

    def household_for_token(self, token: str) -> Household | None:
        household_id = self._tokens.get(token)
        return self._households.get(household_id) if household_id else None

    def get_household(self, household_id: str) -> Household | None:
        return self._households.get(household_id)

    def households(self) -> list[Household]:
        return list(self._households.values())

    # packets ----------------------------------------------------------------

    def add_packet(self, packet: Packet) -> None:
        self._packets[packet.id] = packet

    def get_packet(self, packet_id: str) -> Packet | None:
        return self._packets.get(packet_id)

    def packets(self, *, kind: str | None = None, origin: str | None = None) -> list[Packet]:
        return [
            p
            for p in self._packets.values()
            if (kind is None or p.kind == kind) and (origin is None or p.origin_household == origin)
        ]

    # knowledge --------------------------------------------------------------

    def search_knowledge(self, query: str, *, limit: int = 3) -> list[KnowledgeEntry]:
        """Tips ranked by relevance, then by how much they were thanked."""
        scored: list[tuple[int, int, KnowledgeEntry]] = []
        for tip in self.packets(kind="tip"):
            keywords = tip.payload.get("keywords")
            if not answers(query, tip.payload["topic"], tip.payload["text"], keywords, min_score=MIN_SEARCH_RELEVANCE):
                continue
            score = relevance(query, tip.payload["topic"], tip.payload["text"], keywords)
            thanks = [t for t in self.packets(kind="thanks") if t.payload.get("tip_id") == tip.id]
            origin = self._households.get(tip.origin_household)
            entry = KnowledgeEntry(
                packet_id=tip.id,
                topic=tip.payload["topic"],
                text=tip.payload["text"],
                thanks_count=len(thanks),
                households_thanked=len({t.origin_household for t in thanks}),
                origin_label=origin.label if origin else "a neighbor",
            )
            scored.append((score, entry.thanks_count, entry))
        scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
        return [entry for _, _, entry in scored[:limit]]

    # reports and events -----------------------------------------------------

    def latest_report(self, household_id: str) -> Report | None:
        return self._reports.get(household_id)

    def put_report(self, report: Report) -> None:
        self._reports[report.household_id] = report

    def append_report(self, household_id: str, items: list[ReportItem], *, met: list[str], at: datetime) -> None:
        report = self._reports.get(household_id)
        if report is None:
            report = Report(household_id=household_id, generated_at=at, since=at)
        merged_met = report.met + [name for name in met if name not in report.met]
        self._reports[household_id] = report.model_copy(
            update={"generated_at": at, "met": merged_met, "items": report.items + items}
        )

    def mark_report_heard(self, household_id: str, at: datetime) -> None:
        self._reports[household_id] = Report(household_id=household_id, generated_at=at, since=at)

    # avatars and the town clock ---------------------------------------------

    def carried(self, household_id: str) -> list[str]:
        return list(self._carried.get(household_id, []))

    def add_carried(self, household_id: str, packet_id: str) -> None:
        carried = self._carried.setdefault(household_id, [])
        if packet_id not in carried:
            carried.append(packet_id)

    def next_tick(self, at: datetime) -> tuple[int, datetime]:
        previous = self._last_tick_at or at - FIRST_TICK_LOOKBACK
        self._tick += 1
        self._last_tick_at = at
        return self._tick, previous

    def town_events(self, *, limit: int = 50) -> list[TownEvent]:
        return self._events[-limit:]

    def add_town_events(self, events: list[TownEvent]) -> None:
        self._events.extend(events)

    def town_state(self) -> dict[str, Any]:
        glow: dict[str, int] = {}
        for thanks in self.packets(kind="thanks"):
            tip = self._packets.get(thanks.payload.get("tip_id") or "")
            if tip:
                glow[tip.origin_household] = glow.get(tip.origin_household, 0) + 1
        return {
            "homes": [
                {
                    "id": h.id,
                    "label": h.label,
                    "avatar": h.avatar_name,
                    "tier": h.tier,
                    "glow": glow.get(h.id, 0),
                }
                for h in self._households.values()
            ],
            "events": [e.model_dump(mode="json") for e in self.town_events(limit=20)],
        }

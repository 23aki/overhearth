"""In-process store for local development and tests."""

from __future__ import annotations

import re
from typing import Any

from overhearth.models import Household, KnowledgeEntry, Packet, Report, TownEvent

_WORD = re.compile(r"[a-z0-9]+")


def _words(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


class MemoryStore:
    def __init__(self) -> None:
        self._households: dict[str, Household] = {}
        self._tokens: dict[str, str] = {}
        self._packets: dict[str, Packet] = {}
        self._reports: dict[str, Report] = {}
        self._events: list[TownEvent] = []

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
        """Tips ranked by word overlap, then by how much they were thanked."""
        wanted = _words(query)
        scored: list[tuple[int, int, KnowledgeEntry]] = []
        for tip in self.packets(kind="tip"):
            overlap = len(wanted & _words(f"{tip.payload['topic']} {tip.payload['text']}"))
            if not overlap:
                continue
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
            scored.append((overlap, entry.thanks_count, entry))
        scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
        return [entry for _, _, entry in scored[:limit]]

    # reports and events -----------------------------------------------------

    def latest_report(self, household_id: str) -> Report | None:
        return self._reports.get(household_id)

    def put_report(self, report: Report) -> None:
        self._reports[report.household_id] = report

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

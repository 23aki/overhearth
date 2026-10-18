"""In-process store for local development and tests."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from overhearth.models import (
    AuthGrant,
    Household,
    IssuedToken,
    KnowledgeEntry,
    Packet,
    Report,
    ReportItem,
    TownEvent,
    utcnow,
)
from overhearth.store.common import (
    TOWN_VIEW_EVENTS,
    build_town_state,
    merge_report_items,
    rank_knowledge,
    token_hash,
)

FIRST_TICK_LOOKBACK = timedelta(hours=1)
"""On the very first tick, aggregate what happened in the last hour."""


class MemoryStore:
    def __init__(self) -> None:
        self._households: dict[str, Household] = {}
        self._tokens: dict[str, IssuedToken] = {}
        """Token hash to what it stands for."""
        self._codes: dict[str, AuthGrant] = {}
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
            self.put_token(
                token, IssuedToken(kind="access", client_id="demo", household_id=household.id, scope="mcp:tools")
            )

    def household_for_token(self, token: str) -> Household | None:
        issued = self.resolve_token(token)
        return self._households.get(issued.household_id) if issued and issued.household_id else None

    # tokens and authorization codes -----------------------------------------

    def resolve_token(self, token: str, *, kind: str = "access") -> IssuedToken | None:
        issued = self._tokens.get(token_hash(token))
        if issued is None or issued.kind != kind:
            return None
        if issued.expires_at is not None and issued.expires_at <= utcnow():
            return None
        return issued

    def put_token(self, token: str, issued: IssuedToken) -> None:
        self._tokens[token_hash(token)] = issued

    def revoke_token(self, token: str) -> None:
        self._tokens.pop(token_hash(token), None)

    def put_auth_code(self, code: str, grant: AuthGrant) -> None:
        self._codes[token_hash(code)] = grant

    def take_auth_code(self, code: str) -> AuthGrant | None:
        grant = self._codes.pop(token_hash(code), None)
        if grant is None or grant.expires_at <= utcnow():
            return None
        return grant

    def get_household(self, household_id: str) -> Household | None:
        return self._households.get(household_id)

    def households(self) -> list[Household]:
        return sorted(self._households.values(), key=lambda h: h.id)

    # packets ----------------------------------------------------------------

    def add_packet(self, packet: Packet) -> None:
        self._packets[packet.id] = packet

    def get_packet(self, packet_id: str) -> Packet | None:
        return self._packets.get(packet_id)

    def packets(self, *, kind: str | None = None, origin: str | None = None) -> list[Packet]:
        found = [
            p
            for p in self._packets.values()
            if (kind is None or p.kind == kind) and (origin is None or p.origin_household == origin)
        ]
        return sorted(found, key=lambda p: (p.created_at, p.id))

    # knowledge --------------------------------------------------------------

    def search_knowledge(self, query: str, *, limit: int = 3) -> list[KnowledgeEntry]:
        """Tips ranked by relevance, then by how much they were thanked."""
        return rank_knowledge(
            query, self.packets(kind="tip"), self.packets(kind="thanks"), self._households, limit=limit
        )

    # reports and events -----------------------------------------------------

    def latest_report(self, household_id: str) -> Report | None:
        return self._reports.get(household_id)

    def put_report(self, report: Report) -> None:
        self._reports[report.household_id] = report

    def append_report(
        self,
        household_id: str,
        items: list[ReportItem],
        *,
        met: list[str],
        at: datetime,
        since: datetime | None = None,
    ) -> None:
        report = self._reports.get(household_id)
        if report is None:
            report = Report(household_id=household_id, generated_at=at, since=since or at)
        merged_met = report.met + [name for name in met if name not in report.met]
        self._reports[household_id] = report.model_copy(
            update={"generated_at": at, "met": merged_met, "items": merge_report_items(report.items, items)}
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
        tip_origins = {p.id: p.origin_household for p in self.packets(kind="tip")}
        return build_town_state(
            self.households(),
            tip_origins,
            self.packets(kind="thanks"),
            self.town_events(limit=TOWN_VIEW_EVENTS),
        )

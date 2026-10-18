"""Storage interface.

The MCP tools must answer in well under 500 ms, so they only read data that the town
engine has already computed (reports, the knowledge index, the town state). Writes from
tools are limited to appending packets.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from overhearth.models import (
    AuthGrant,
    Household,
    IssuedToken,
    KnowledgeEntry,
    Packet,
    Report,
    ReportItem,
    TownEvent,
)


class Store(Protocol):
    def add_household(self, household: Household, *, token: str | None = None) -> None:
        """Add a household. `token` pre-issues a non-expiring access token (demo homes only)."""
        ...

    def household_for_token(self, token: str) -> Household | None: ...

    def resolve_token(self, token: str, *, kind: str = "access") -> IssuedToken | None:
        """What a bearer token stands for, or None if it is unknown or expired."""
        ...

    def put_token(self, token: str, issued: IssuedToken) -> None:
        """Remember an OAuth token. Only its hash is kept."""
        ...

    def revoke_token(self, token: str) -> None: ...

    def put_auth_code(self, code: str, grant: AuthGrant) -> None: ...

    def take_auth_code(self, code: str) -> AuthGrant | None:
        """Return the grant for a code and forget it, so a code works once."""
        ...

    def get_household(self, household_id: str) -> Household | None: ...

    def households(self) -> list[Household]: ...

    def add_packet(self, packet: Packet) -> None: ...

    def get_packet(self, packet_id: str) -> Packet | None: ...

    def packets(self, *, kind: str | None = None, origin: str | None = None) -> list[Packet]: ...

    def search_knowledge(self, query: str, *, limit: int = 3) -> list[KnowledgeEntry]: ...

    def latest_report(self, household_id: str) -> Report | None:
        """The report of everything not yet heard by the household."""
        ...

    def put_report(self, report: Report) -> None: ...

    def append_report(self, household_id: str, items: list[ReportItem], *, met: list[str], at: datetime) -> None:
        """Add lines to the household's pending report."""
        ...

    def mark_report_heard(self, household_id: str, at: datetime) -> None: ...

    def carried(self, household_id: str) -> list[str]:
        """Packet ids the household's avatar has picked up in town, oldest first."""
        ...

    def add_carried(self, household_id: str, packet_id: str) -> None: ...

    def next_tick(self, at: datetime) -> tuple[int, datetime]:
        """Advance the town clock. Returns the new tick number and when the previous tick ran."""
        ...

    def town_events(self, *, limit: int = 50) -> list[TownEvent]: ...

    def add_town_events(self, events: list[TownEvent]) -> None: ...

    def town_state(self) -> dict[str, Any]: ...

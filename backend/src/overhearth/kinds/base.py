"""The extension point for exchange kinds.

A kind is one `KindHandler` subclass. Handlers never mutate the store: they return
`Effect`s (an avatar carries a packet home, a line goes into a household's report, a
town event is recorded) and the engine applies them. Adding a kind (mood,
recommendation, request, event, ...) is a matter of writing one handler and
registering it.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any, ClassVar

from pydantic import BaseModel

from overhearth.models import Household, Packet, ReportItem, TownEvent

if TYPE_CHECKING:
    from overhearth.store import Store

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"\+?\d[\d\s().-]{7,}\d")
_URL = re.compile(r"https?://\S+")


def scrub(text: str) -> str:
    """Remove contact details that must never travel between households."""
    text = _EMAIL.sub("[email removed]", text)
    text = _URL.sub("[link removed]", text)
    text = _PHONE.sub("[number removed]", text)
    return " ".join(text.split())


@dataclass(frozen=True)
class Carry:
    """The household's avatar now carries this packet and may pass it on."""

    household_id: str
    packet_id: str


@dataclass(frozen=True)
class ReportLine:
    """A line for the household's "what happened in town" report."""

    household_id: str
    item: ReportItem


@dataclass(frozen=True)
class Event:
    event: TownEvent


Effect = Carry | ReportLine | Event


@dataclass
class TickContext:
    tick: int
    at: datetime
    since: datetime
    """When the previous tick ran; aggregation looks at packets newer than this."""
    store: Store
    out: set[str] = field(default_factory=set)
    """Households whose avatars were out in town this tick."""

    def household(self, household_id: str) -> Household | None:
        return self.store.get_household(household_id)

    def label(self, household_id: str) -> str:
        household = self.store.get_household(household_id)
        return household.label if household else "a neighbor"


class KindHandler(ABC):
    kind: ClassVar[str]
    payload_model: ClassVar[type[BaseModel]]
    encounter_order: ClassVar[int] = 100
    """Lower runs first when several packets change hands in one encounter."""

    def validate(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Check the payload against the kind's schema and scrub free text."""
        model = self.payload_model.model_validate(payload)
        cleaned = {key: scrub(value) if isinstance(value, str) else value for key, value in model.model_dump().items()}
        return self.payload_model.model_validate(cleaned).model_dump()

    @abstractmethod
    def to_town_summary(self, packet: Packet) -> str:
        """How avatars talk about this packet in town. Never the raw utterance."""

    def on_encounter(self, packet: Packet, carrier: Household, listener: Household, ctx: TickContext) -> list[Effect]:
        """The carrier's avatar passed this packet to the listener's avatar."""
        return []

    def aggregate(self, ctx: TickContext) -> list[Effect]:
        """End-of-tick work over all packets of this kind."""
        return []

    def visual(self, packet: Packet) -> dict[str, Any]:
        """How the town view draws this packet."""
        return {"kind": self.kind}

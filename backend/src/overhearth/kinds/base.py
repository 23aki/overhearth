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
    from overhearth.translate import Localizer

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
    localizer: Localizer | None = None
    """Translates content for the homes that hear it; None keeps everything original."""

    def household(self, household_id: str) -> Household | None:
        return self.store.get_household(household_id)

    def language(self, household_id: str) -> str:
        household = self.store.get_household(household_id)
        return household.language if household else "en"

    def featured(self, household_id: str) -> bool:
        """A demo or linked home: a person reads its reports, so its lines are worth translating."""
        household = self.store.get_household(household_id)
        return bool(household and household.tier in ("demo", "real"))

    def label(self, household_id: str, for_household: str | None = None) -> str:
        """A home's public label, in the language of the home that hears it."""
        household = self.store.get_household(household_id)
        if household is None:
            return "a neighbor"
        if for_household is None or self.localizer is None:
            return household.label
        return self.localizer.fields(
            f"label:{household.id}",
            {"label": household.label},
            "en",
            self.language(for_household),
            allow_model=self.featured(for_household),
        )["label"]

    def localized(self, packet: Packet, for_household: str, fields: tuple[str, ...]) -> dict[str, str]:
        """Some payload fields of a packet, in the language of the home that hears them."""
        original = {f: str(packet.payload[f]) for f in fields if packet.payload.get(f)}
        if self.localizer is None:
            return original
        return self.localizer.fields(
            f"packet:{packet.id}",
            original,
            packet.context.language,
            self.language(for_household),
            allow_model=self.featured(for_household),
        )


class KindHandler(ABC):
    kind: ClassVar[str]
    payload_model: ClassVar[type[BaseModel]]
    encounter_order: ClassVar[int] = 100
    """Lower runs first when several packets change hands in one encounter."""
    offer_priority: ClassVar[int] = 100
    """Lower is offered first when an avatar picks what to bring into town."""

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

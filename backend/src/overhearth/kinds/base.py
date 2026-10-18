"""The extension point for exchange kinds.

A kind is one `KindHandler` subclass. The engine and the MCP tools only talk to handlers
through this interface, so adding a kind (mood, recommendation, request, event, ...) is a
matter of writing one handler and registering it.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from typing import Any, ClassVar

from pydantic import BaseModel

from overhearth.models import Household, Packet, ReportItem, TownEvent

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"\+?\d[\d\s().-]{7,}\d")
_URL = re.compile(r"https?://\S+")


def scrub(text: str) -> str:
    """Remove contact details that must never travel between households."""
    text = _EMAIL.sub("[email removed]", text)
    text = _URL.sub("[link removed]", text)
    text = _PHONE.sub("[number removed]", text)
    return " ".join(text.split())


class KindHandler(ABC):
    kind: ClassVar[str]
    payload_model: ClassVar[type[BaseModel]]

    def validate(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Check the payload against the kind's schema and scrub free text."""
        model = self.payload_model.model_validate(payload)
        cleaned = {key: scrub(value) if isinstance(value, str) else value for key, value in model.model_dump().items()}
        return self.payload_model.model_validate(cleaned).model_dump()

    @abstractmethod
    def to_town_summary(self, packet: Packet) -> str:
        """How avatars talk about this packet in town. Never the raw utterance."""

    def on_encounter(self, packet: Packet, carrier: Household, listener: Household) -> list[TownEvent]:
        """What changes hands when the carrier's avatar meets the listener's avatar."""
        return []

    def aggregate(self, packets: list[Packet]) -> dict[str, Any]:
        """End-of-tick aggregation over all packets of this kind."""
        return {}

    def report_lines(self, household: Household, aggregates: dict[str, Any]) -> list[ReportItem]:
        """Lines for the household's "what happened in town" report."""
        return []

    def return_to_origin(self, household: Household, aggregates: dict[str, Any]) -> list[ReportItem]:
        """What flows back to the household a packet originally came from."""
        return []

    def visual(self, packet: Packet) -> dict[str, Any]:
        """How the town view draws this packet."""
        return {"kind": self.kind}

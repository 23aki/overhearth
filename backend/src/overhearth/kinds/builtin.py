"""The kinds shipped with the first release: thanks, tip, question."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from overhearth.kinds.base import KindHandler
from overhearth.models import Packet


class ThanksPayload(BaseModel):
    what_helped: str = Field(min_length=1, max_length=200)
    """What the person was grateful for, in a few words."""
    tip_id: str | None = None
    """The tip that helped, when the thanks is for something brought back from town."""


class Thanks(KindHandler):
    kind = "thanks"
    payload_model = ThanksPayload

    def to_town_summary(self, packet: Packet) -> str:
        return f"My person thanked me for: {packet.payload['what_helped']}"

    def visual(self, packet: Packet) -> dict[str, Any]:
        return {"kind": self.kind, "glow": True, "flows_to": packet.payload.get("tip_id")}


class TipPayload(BaseModel):
    topic: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=500)


class Tip(KindHandler):
    kind = "tip"
    payload_model = TipPayload

    def to_town_summary(self, packet: Packet) -> str:
        return f"A tip about {packet.payload['topic']}: {packet.payload['text']}"

    def visual(self, packet: Packet) -> dict[str, Any]:
        return {"kind": self.kind, "topic": packet.payload["topic"]}


class QuestionPayload(BaseModel):
    topic: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=300)


class Question(KindHandler):
    kind = "question"
    payload_model = QuestionPayload

    def to_town_summary(self, packet: Packet) -> str:
        return f"My person is wondering about {packet.payload['topic']}: {packet.payload['text']}"

    def visual(self, packet: Packet) -> dict[str, Any]:
        return {"kind": self.kind, "topic": packet.payload["topic"]}

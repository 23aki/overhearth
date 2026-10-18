"""Core data model.

Everything a household lets its avatar carry into the town is a `Packet`. Packets are
typed by `kind` (thanks, tip, question, ...) and each kind is handled by a `KindHandler`
(see `overhearth.kinds`), so new kinds of exchange can be added without touching the
engine or the MCP tools.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Visibility(StrEnum):
    TOWN = "town"
    """Any avatar in the town may hear about it."""
    ENCOUNTER = "encounter"
    """Only avatars the carrier meets in person."""
    ORIGIN_ONLY = "origin_only"
    """Never shared; only returned to the household it came from."""


class PacketContext(BaseModel):
    topics: list[str] = Field(default_factory=list)
    region: str | None = None
    """Coarse region only (prefecture / state). Never an address."""
    language: str = "en"


class Packet(BaseModel):
    id: str = Field(default_factory=lambda: new_id("pkt"))
    kind: str
    origin_household: str
    payload: dict[str, Any]
    context: PacketContext = Field(default_factory=PacketContext)
    refs: list[str] = Field(default_factory=list)
    """Related packets, e.g. a thanks packet refers to the tip that helped."""
    consented_at: datetime
    """When the person said this may be taken to the town."""
    visibility: Visibility = Visibility.TOWN
    created_at: datetime = Field(default_factory=utcnow)


HouseholdTier = Literal["background", "demo", "real"]


class Household(BaseModel):
    id: str
    label: str
    """Public, non-identifying label such as "a studio apartment in Tokyo"."""
    region: str
    timezone: str
    tier: HouseholdTier
    avatar_name: str
    personality: list[str] = Field(default_factory=list)


class KnowledgeEntry(BaseModel):
    """A tip as the town knows it, ranked by how much it has been thanked."""

    packet_id: str
    topic: str
    text: str
    thanks_count: int = 0
    households_thanked: int = 0
    origin_label: str
    """Who it came from, at the same coarse level as `Household.label`."""


class ReportItem(BaseModel):
    kind: str
    text: str
    refs: list[str] = Field(default_factory=list)


class Report(BaseModel):
    """What happened in the town since the household last talked to its Alexa."""

    household_id: str
    generated_at: datetime
    since: datetime
    met: list[str] = Field(default_factory=list)
    """Avatar names the household's avatar met."""
    items: list[ReportItem] = Field(default_factory=list)


TownEventType = Literal["encounter", "exchange", "thanks_flow", "return", "town"]


class TownEvent(BaseModel):
    id: str = Field(default_factory=lambda: new_id("evt"))
    tick: int
    at: datetime
    type: TownEventType
    actors: list[str] = Field(default_factory=list)
    """Household ids involved."""
    summary: str
    refs: list[str] = Field(default_factory=list)

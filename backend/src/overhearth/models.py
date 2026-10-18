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
    detail: dict[str, Any] = Field(default_factory=dict)
    """Extra data for the town view, such as the dialogue lines of an encounter."""


class AuthGrant(BaseModel):
    """An authorization code waiting to be exchanged. Stored under the code's hash, used once."""

    client_id: str
    redirect_uri: str
    code_challenge: str
    household_id: str
    scope: str
    expires_at: datetime


class IssuedToken(BaseModel):
    """What a bearer token stands for. OAuth tokens are stored under their hash only."""

    kind: Literal["access", "refresh"]
    client_id: str
    household_id: str | None
    """None for a service token (client_credentials): it may list tools but acts for no home."""
    scope: str
    expires_at: datetime | None = None
    """None for the pre-issued demo tokens, which never expire."""

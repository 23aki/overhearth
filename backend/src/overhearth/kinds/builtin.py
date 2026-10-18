"""The kinds shipped with the first release: thanks, tip, question."""

from __future__ import annotations

import random
from collections import defaultdict
from datetime import timedelta
from typing import Annotated, Any

from pydantic import BaseModel, Field

from overhearth.kinds.base import Carry, Effect, Event, KindHandler, ReportLine, TickContext
from overhearth.models import Household, Packet, ReportItem, TownEvent
from overhearth.text import answers, relevance

TREND_WINDOW = timedelta(days=7)
TREND_CANDIDATES = 6
"""Each home hears two of the most-thanked themes, picked per home so trends vary."""


class TipPayload(BaseModel):
    topic: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=500)
    keywords: list[Annotated[str, Field(max_length=24)]] = Field(default_factory=list, max_length=16)
    """Search words (synonyms, related needs) so everyday questions can find the tip."""


class Tip(KindHandler):
    """Know-how a household chose to share. Avatars pass it along as they meet."""

    kind = "tip"
    payload_model = TipPayload
    offer_priority = 10

    def to_town_summary(self, packet: Packet) -> str:
        return f"A tip about {packet.payload['topic']}: {packet.payload['text']}"

    def on_encounter(self, packet: Packet, carrier: Household, listener: Household, ctx: TickContext) -> list[Effect]:
        if packet.origin_household == listener.id or packet.id in ctx.store.carried(listener.id):
            return []
        topic = packet.payload["topic"]
        return [
            Carry(listener.id, packet.id),
            ReportLine(
                listener.id,
                ReportItem(
                    kind="tip",
                    text=f"{carrier.avatar_name} passed on a tip about {topic} from "
                    f"{ctx.label(packet.origin_household)}: {packet.payload['text']}",
                    refs=[packet.id],
                ),
            ),
            Event(
                TownEvent(
                    tick=ctx.tick,
                    at=ctx.at,
                    type="exchange",
                    actors=[carrier.id, listener.id],
                    summary=f"{carrier.avatar_name} told {listener.avatar_name} a tip about {topic}.",
                    refs=[packet.id],
                    detail={"kind": self.kind},
                )
            ),
        ]

    def visual(self, packet: Packet) -> dict[str, Any]:
        return {"kind": self.kind, "topic": packet.payload["topic"]}


class QuestionPayload(BaseModel):
    topic: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=300)


class Question(KindHandler):
    """Something a household wants the town to ask around about.

    If the avatar it meets knows a matching tip, the answer goes straight back to the
    household that asked. Otherwise the question travels on, and the listener's home
    hears that someone in town is wondering about it.
    """

    kind = "question"
    payload_model = QuestionPayload
    encounter_order = 0
    offer_priority = 0
    """Answer questions before tips in the same encounter are handed over as plain tips."""

    def to_town_summary(self, packet: Packet) -> str:
        return f"My person is wondering about {packet.payload['topic']}: {packet.payload['text']}"

    def _best_known_tip(self, question: Packet, knower_id: str, ctx: TickContext) -> Packet | None:
        """The best tip the household knows (shared or picked up) that answers the question."""
        query = f"{question.payload['topic']} {question.payload['text']}"
        known = ctx.store.packets(kind="tip", origin=knower_id)
        known += [p for pid in ctx.store.carried(knower_id) if (p := ctx.store.get_packet(pid)) and p.kind == "tip"]
        scored = [
            (relevance(query, p.payload["topic"], p.payload["text"], p.payload.get("keywords")), p)
            for p in known
            if answers(query, p.payload["topic"], p.payload["text"], p.payload.get("keywords"))
        ]
        return max(scored, key=lambda s: s[0])[1] if scored else None

    def on_encounter(self, packet: Packet, carrier: Household, listener: Household, ctx: TickContext) -> list[Effect]:
        asker_id = packet.origin_household
        if listener.id == asker_id or self._best_known_tip(packet, asker_id, ctx):
            return []  # asked by this home, or the home already has an answer
        topic = packet.payload["topic"]
        tip = self._best_known_tip(packet, listener.id, ctx)
        if tip:
            return [
                Carry(asker_id, tip.id),
                ReportLine(
                    asker_id,
                    ReportItem(
                        kind="answer",
                        text=f"You wondered about {topic}. {listener.avatar_name} knew something from "
                        f"{ctx.label(tip.origin_household)}: {tip.payload['text']}",
                        refs=[tip.id, packet.id],
                    ),
                ),
                Event(
                    TownEvent(
                        tick=ctx.tick,
                        at=ctx.at,
                        type="exchange",
                        actors=[listener.id, asker_id],
                        summary=f"{listener.avatar_name} had an answer about {topic} for {carrier.avatar_name}.",
                        refs=[tip.id, packet.id],
                        detail={"kind": self.kind, "answered": True},
                    )
                ),
            ]
        if packet.id in ctx.store.carried(listener.id):
            return []
        return [
            Carry(listener.id, packet.id),
            ReportLine(
                listener.id,
                ReportItem(
                    kind="question",
                    text=f"Someone from {ctx.label(asker_id)} is wondering about {topic}: "
                    f"{packet.payload['text']} If you know, tell me and I'll take it to town.",
                    refs=[packet.id],
                ),
            ),
            Event(
                TownEvent(
                    tick=ctx.tick,
                    at=ctx.at,
                    type="exchange",
                    actors=[carrier.id, listener.id],
                    summary=f"{carrier.avatar_name} asked {listener.avatar_name} about {topic}.",
                    refs=[packet.id],
                    detail={"kind": self.kind, "answered": False},
                )
            ),
        ]

    def visual(self, packet: Packet) -> dict[str, Any]:
        return {"kind": self.kind, "topic": packet.payload["topic"]}


class ThanksPayload(BaseModel):
    what_helped: str = Field(min_length=1, max_length=200)
    """What the person was grateful for, in a few words."""
    tip_id: str | None = None
    """The tip that helped, when the thanks is for something brought back from town."""


class Thanks(KindHandler):
    """A "thank you" said to Alexa.

    Avatars gossip about what their homes were thankful for, which surfaces as town
    trends. Thanks for a tip travel back to the home the tip came from.
    """

    kind = "thanks"
    payload_model = ThanksPayload
    offer_priority = 20

    def to_town_summary(self, packet: Packet) -> str:
        return f"My person thanked me for: {packet.payload['what_helped']}"

    def on_encounter(self, packet: Packet, carrier: Household, listener: Household, ctx: TickContext) -> list[Effect]:
        if packet.id in ctx.store.carried(listener.id):
            return []
        return [
            Carry(listener.id, packet.id),
            Event(
                TownEvent(
                    tick=ctx.tick,
                    at=ctx.at,
                    type="exchange",
                    actors=[carrier.id, listener.id],
                    summary=f"{carrier.avatar_name} told {listener.avatar_name} its home was thankful for "
                    f"{packet.payload['what_helped']}.",
                    refs=[packet.id],
                    detail={"kind": self.kind},
                )
            ),
        ]

    def aggregate(self, ctx: TickContext) -> list[Effect]:
        return self._returns(ctx) + self._trends(ctx)

    def _returns(self, ctx: TickContext) -> list[Effect]:
        """Thanks for a tip flow back to whoever shared the tip."""
        all_by_tip: dict[str, list[Packet]] = defaultdict(list)
        for thanks in ctx.store.packets(kind=self.kind):
            if thanks.payload.get("tip_id"):
                all_by_tip[thanks.payload["tip_id"]].append(thanks)
        effects: list[Effect] = []
        for tip_id, every in all_by_tip.items():
            tip = ctx.store.get_packet(tip_id)
            if tip is None:
                continue
            every = [t for t in every if t.origin_household != tip.origin_household]
            thanks = [t for t in every if t.created_at > ctx.since]
            if not thanks:
                continue
            # The report line counts everything since the home last heard its report, and
            # replaces the earlier line about the same tip, so it is said once and up to date.
            pending = ctx.store.latest_report(tip.origin_household)
            heard_at = min(pending.since, ctx.since) if pending else ctx.since
            unheard = [t for t in every if t.created_at > heard_at] or thanks
            homes = sorted({t.origin_household for t in unheard})
            times = "once" if len(unheard) == 1 else f"{len(unheard)} times"
            places = "one home" if len(homes) == 1 else f"{len(homes)} homes"
            effects.append(
                ReportLine(
                    tip.origin_household,
                    ReportItem(
                        kind="thanks_return",
                        text=f"Your tip about {tip.payload['topic']} was thanked {times} in {places} "
                        "since we last talked.",
                        refs=[tip_id],
                        key=f"thanks_return:{tip_id}",
                    ),
                )
            )
            effects.append(
                Event(
                    TownEvent(
                        tick=ctx.tick,
                        at=ctx.at,
                        type="thanks_flow",
                        actors=[*homes, tip.origin_household],
                        summary=f"Thanks from {places} found their way back to {ctx.label(tip.origin_household)}.",
                        refs=[tip_id],
                        detail={"from": homes, "to": tip.origin_household, "count": len(thanks)},
                    )
                )
            )
        return effects

    def _trends(self, ctx: TickContext) -> list[Effect]:
        """What other homes have been thankful for lately, for avatars that were out."""
        recent = [t for t in ctx.store.packets(kind=self.kind) if t.created_at > ctx.at - TREND_WINDOW]
        homes_by_theme: dict[str, set[str]] = defaultdict(set)
        for thanks in recent:
            homes_by_theme[thanks.payload["what_helped"].strip().rstrip(".").lower()].add(thanks.origin_household)
        effects: list[Effect] = []
        for household_id in sorted(ctx.out):
            pending = ctx.store.latest_report(household_id)
            if pending and any(item.kind == "trend" for item in pending.items):
                continue
            ranked = sorted(
                ((len(homes - {household_id}), theme) for theme, homes in homes_by_theme.items()),
                reverse=True,
            )
            candidates = [theme for count, theme in ranked if count >= 2][:TREND_CANDIDATES]
            themes = random.Random(f"{household_id}:{ctx.tick}").sample(candidates, min(2, len(candidates)))
            if not themes:
                continue
            effects.append(
                ReportLine(
                    household_id,
                    ReportItem(
                        kind="trend",
                        text=f"Around town lately, people have been thankful for {' and '.join(themes)}.",
                    ),
                )
            )
        return effects

    def visual(self, packet: Packet) -> dict[str, Any]:
        return {"kind": self.kind, "glow": True, "flows_to": packet.payload.get("tip_id")}

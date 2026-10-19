"""One tick of town life.

Avatars that are out get paired up, each pair has a short conversation, the kind
handlers decide what changed hands, and every household's pending report is updated.
The MCP tools later read those reports without doing any of this work.
"""

from __future__ import annotations

import random
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime

from overhearth import growth, kinds
from overhearth.delivery import Mailer, notify_thanks
from overhearth.diary import Diarist
from overhearth.engine.dialogue import AvatarBrief, DialogueGenerator, EncounterScript, Offer
from overhearth.engine.residents import simulate_residents
from overhearth.kinds import Carry, Effect, Event, ReportLine, TickContext
from overhearth.models import Household, ReportItem, TownEvent, Visibility, utcnow
from overhearth.store import Store
from overhearth.translate import Localizer, Translator

MAX_OFFERS = 4


@dataclass
class TickResult:
    tick: int
    out: int
    encounters: int
    exchanges: int
    report_lines: int
    resident_thanks: int = 0
    thanks_emails: int = 0
    diaries: int = 0
    landmarks: int = 0


def _offers(household: Household, store: Store) -> tuple[Offer, ...]:
    """What the household's avatar brings into town.

    Ordered by each kind's `offer_priority`, then the home's own items before ones it
    picked up, then newest first. Items that would read the same are offered once.
    """
    own = store.packets(origin=household.id)
    relayed = [p for pid in store.carried(household.id) if (p := store.get_packet(pid))]
    candidates = [(p, 0) for p in own] + [(p, 1) for p in relayed]
    candidates = [(p, hop) for p, hop in candidates if p.visibility == Visibility.TOWN]
    candidates.sort(key=lambda c: (kinds.get(c[0].kind).offer_priority, c[1], -c[0].created_at.timestamp()))
    offers: dict[str, Offer] = {}
    for packet, _ in candidates:
        summary = kinds.get(packet.kind).to_town_summary(packet)
        offers.setdefault(summary.lower(), Offer(packet.id, packet.kind, summary))
        if len(offers) == MAX_OFFERS:
            break
    return tuple(offers.values())


def _brief(household: Household, store: Store) -> AvatarBrief:
    return AvatarBrief(
        household_id=household.id,
        name=household.avatar_name,
        home=household.label,
        personality=tuple(household.personality),
        offers=_offers(household, store),
        featured=household.tier in ("demo", "real"),
        language=household.language,
    )


def _apply(effects: list[Effect], store: Store, lines: dict[str, list[ReportItem]]) -> None:
    for effect in effects:
        if isinstance(effect, Carry):
            store.add_carried(effect.household_id, effect.packet_id)
        elif isinstance(effect, ReportLine):
            lines[effect.household_id].append(effect.item)
        elif isinstance(effect, Event):
            store.add_town_events([effect.event])


PRETRANSLATE_PER_TICK = 4
"""How many of the most-thanked tips to translate ahead each tick, per language of a demo or
linked home, so ask_town can answer in that language without calling a model."""


def pretranslate(store: Store, localizer: Localizer) -> int:
    languages = {h.language for h in store.households() if h.tier in ("demo", "real")}
    thanks_count: dict[str, int] = defaultdict(int)
    for thanks in store.packets(kind="thanks"):
        if thanks.payload.get("tip_id"):
            thanks_count[thanks.payload["tip_id"]] += 1
    tips = sorted(store.packets(kind="tip"), key=lambda p: (-thanks_count[p.id], p.id))
    done = 0
    for language in sorted(languages):
        budget = PRETRANSLATE_PER_TICK
        for tip in tips:
            if budget == 0:
                break
            fields = {f: str(tip.payload[f]) for f in ("topic", "text", "phrase") if tip.payload.get(f)}
            if tip.context.language == language or localizer.has(f"packet:{tip.id}", language, tuple(fields)):
                continue
            localizer.fields(f"packet:{tip.id}", fields, tip.context.language, language, allow_model=True)
            budget -= 1
            done += 1
    return done


def run_tick(
    store: Store,
    dialogue: DialogueGenerator,
    *,
    at: datetime | None = None,
    rng: random.Random | None = None,
    out_ratio: float = 0.7,
    max_workers: int = 8,
    mailer: Mailer | None = None,
    translator: Translator | None = None,
    diarist: Diarist | None = None,
) -> TickResult:
    at = at or utcnow()
    rng = rng or random.Random()
    tick, since = store.next_tick(at)

    # Demo and linked homes always go out, so they always have something to report.
    out = [h for h in store.households() if h.tier in ("demo", "real") or rng.random() < out_ratio]
    rng.shuffle(out)
    pairs = list(zip(out[0::2], out[1::2], strict=False))
    localizer = Localizer(store, translator)
    ctx = TickContext(tick=tick, at=at, since=since, store=store, out={h.id for h in out}, localizer=localizer)

    briefs = [(_brief(a, store), _brief(b, store)) for a, b in pairs]
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        scripts: list[EncounterScript] = list(pool.map(lambda ab: dialogue.generate(*ab), briefs))

    lines: dict[str, list[ReportItem]] = defaultdict(list)
    met: dict[str, list[str]] = defaultdict(list)
    exchanges = 0
    for (a, b), (brief_a, _), script in zip(pairs, briefs, scripts, strict=True):
        met[a.id].append(b.avatar_name)
        met[b.id].append(a.avatar_name)
        offered_by_a = {o.packet_id for o in brief_a.offers}
        exchanged = [p for pid in script.exchanged if (p := store.get_packet(pid))]
        exchanged.sort(key=lambda p: kinds.get(p.kind).encounter_order)
        handed = [{"kind": p.kind, "from": a.id if p.id in offered_by_a else b.id} for p in exchanged]
        store.add_town_events(
            [
                TownEvent(
                    tick=tick,
                    at=at,
                    type="encounter",
                    actors=[a.id, b.id],
                    summary=script.summary,
                    refs=script.exchanged,
                    detail={"lines": [line.model_dump() for line in script.lines], "items": handed},
                )
            ]
        )
        for packet in exchanged:
            packet_id = packet.id
            carrier, listener = (a, b) if packet_id in offered_by_a else (b, a)
            effects = kinds.get(packet.kind).on_encounter(packet, carrier, listener, ctx)
            exchanges += sum(isinstance(e, Carry) for e in effects)
            _apply(effects, store, lines)

    # The simulated people in background homes thanked their Alexas in the meantime.
    resident_thanks = simulate_residents(store, since=since, at=at, rng=rng)

    for kind in kinds.all_kinds():
        _apply(kinds.get(kind).aggregate(ctx), store, lines)

    # All that thanks and know-how grows the town: a level-up builds a landmark.
    built, growth_lines = growth.grow(store, at, tick, chats=len(pairs))
    store.add_town_events(built)
    for household_id, items in growth_lines.items():
        lines[household_id].extend(items)

    for household_id in set(lines) | set(met):
        store.append_report(
            household_id, lines.get(household_id, []), met=met.get(household_id, []), at=at, since=since
        )

    if translator is not None:
        pretranslate(store, localizer)

    # In the evening, avatars (and the town) write the day's picture diary.
    diaries = len(diarist.write_due(at)) if diarist is not None else 0

    thanked = {hid for hid, items in lines.items() if any(item.kind == "thanks_return" for item in items)}
    emails = notify_thanks(store, mailer, thanked, at) if mailer is not None else 0

    return TickResult(
        tick=tick,
        out=len(out),
        encounters=len(pairs),
        exchanges=exchanges,
        report_lines=sum(len(v) for v in lines.values()),
        resident_thanks=resident_thanks,
        thanks_emails=emails,
        diaries=diaries,
        landmarks=len(built),
    )

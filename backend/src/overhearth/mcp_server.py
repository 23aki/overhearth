"""The Overhearth MCP server.

Every tool only reads precomputed data or appends a packet, so it can answer well inside
the 500 ms budget an Alexa+ add-on has. Households are identified by the bearer token on
each request (the account-linking token in a real Alexa+ deployment).
"""

from __future__ import annotations

import logging
from importlib import resources
from typing import Literal

from mcp.server.apps import Apps
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

from overhearth import kinds
from overhearth.assistant import RateLimiter
from overhearth.delivery import Mailer, mailer_from_env, mask_email, report_email
from overhearth.models import Household, KnowledgeEntry, Packet, PacketContext, ReportItem, TownEvent, utcnow
from overhearth.store import Store
from overhearth.translate import Localizer

log = logging.getLogger(__name__)

TOWN_UI_URI = "ui://overhearth/town.html"
DIARY_UI_URI = "ui://overhearth/diary.html"

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=False)
REPORT_ONCE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False)
"""town_report marks what it read out as heard, so the next report only has news."""

REPORT_PRIORITY = {"thanks_return": 0, "growth": 1, "diary": 2, "answer": 3, "tip": 4, "question": 5, "trend": 6}
MAX_SPOKEN_ITEMS = 4
"""Keeps the spoken report well under the 30 second limit for an Alexa+ voice response."""
APPEND_ONLY = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False)
SENDS_EMAIL = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=True)


class ThanksResult(BaseModel):
    speech: str
    recorded: bool
    to: str | None = None
    """Who the thanks will travel back to, when it was for know-how from town."""


class EmailResult(BaseModel):
    speech: str
    needs_confirmation: bool
    to: str | None = Field(default=None, description="The address, masked.")
    subject: str | None = None
    body: str | None = None
    sent: bool = False
    dry_run: bool = Field(description="True when the email is only shown, not sent (demo homes).")


class ShareResult(BaseModel):
    speech: str
    needs_confirmation: bool
    preview: str
    packet_id: str | None = None


class AskResult(BaseModel):
    speech: str
    answers: list[KnowledgeEntry] = Field(default_factory=list)


class ReportResult(BaseModel):
    speech: str
    met: list[str] = Field(default_factory=list)
    items: list[ReportItem] = Field(default_factory=list)


class DiaryResult(BaseModel):
    speech: str
    available: bool
    scope: str = Field(description="'home' for your own diary (this home's Alexa), 'town' for the town's.")
    avatar: str | None = None
    date: str | None = None
    title: str | None = None
    text: str | None = None
    language: str | None = None
    image_url: str | None = None


class TownResult(BaseModel):
    speech: str
    homes: int
    events: int


class TownHome(BaseModel):
    id: str
    label: str
    avatar: str
    tier: str
    region: str
    language: str = "en"
    glow: int = Field(description="How many times know-how from this home was thanked.")


class ActiveHome(BaseModel):
    kind: str = Field(description="What the home is talking with Alexa about: talk, thanks, ask, news, ...")
    ago: int = Field(description="Seconds since the last exchange.")


class Landmark(BaseModel):
    kind: str = Field(description="bakery, library, garden, clinic, playground, cafe, ...")
    level: int = Field(description="The town level that built it.")
    at: str


class TownGrowth(BaseModel):
    level: int
    xp: int = Field(description="Town experience from thanks (x2), shared know-how (x3) and questions (x1).")
    level_xp: int = Field(description="Experience at which the current level started.")
    next_xp: int | None = Field(description="Experience the next level needs; null at the top level.")
    landmarks: list[Landmark] = Field(default_factory=list)
    upgrades: list[Landmark] = Field(
        default_factory=list, description="Landmarks made bigger once every landmark stands (the level that did it)."
    )
    leading: str | None = Field(default=None, description="The landmark kind the most thanked topic points to.")


class TownState(BaseModel):
    viewer: str = Field(description="The household looking at the town.")
    homes: list[TownHome]
    events: list[TownEvent]
    active: dict[str, ActiveHome] = Field(default_factory=dict)
    growth: TownGrowth | None = None


def _household(ctx: Context, store: Store, activity: str | None = None) -> Household:
    headers = ctx.headers or {}
    auth = headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    household = store.household_for_token(token) if scheme.lower() == "bearer" and token else None
    if household is None:
        raise ToolError("This Alexa account is not linked to Overhearth yet.")
    if activity:
        # The avatar goes home while its person talks with Alexa (only the kind is shown, never the content).
        store.mark_active(household.id, activity, utcnow())
    return household


def _town_html() -> str:
    return resources.files("overhearth").joinpath("ui/town.html").read_text(encoding="utf-8")


def _diary_html() -> str:
    return resources.files("overhearth").joinpath("ui/diary.html").read_text(encoding="utf-8")


def build_server(store: Store, mailer: Mailer | None = None) -> MCPServer:
    mailer = mailer or mailer_from_env()
    email_limiter = RateLimiter(limit=5)
    localizer = Localizer(store)
    apps = Apps()

    @apps.tool(
        resource_uri=TOWN_UI_URI,
        name="open_town",
        title="Open the town",
        description=(
            "Show the shared town where this household's Alexa lives alongside other homes' Alexas. "
            "Use when the person asks to see the town, their Alexa, or where the thanks went."
        ),
        annotations=READ_ONLY,
    )
    def open_town(ctx: Context) -> TownResult:
        _household(ctx, store, "town")
        state = store.town_state()
        return TownResult(
            speech="Here is the town.",
            homes=len(state["homes"]),
            events=len(state["events"]),
        )

    @apps.tool(
        resource_uri=TOWN_UI_URI,
        visibility=["app"],
        name="get_town_state",
        description="Town map, home lights and recent events for the town view.",
        annotations=READ_ONLY,
    )
    def get_town_state(ctx: Context) -> TownState:
        household = _household(ctx, store, "town")
        return TownState.model_validate({"viewer": household.id, **store.town_state()})

    apps.add_html_resource(TOWN_UI_URI, _town_html(), name="town", title="Overhearth town")

    def _diary(household: Household, scope: str) -> DiaryResult:
        key = household.id if scope == "home" else "town"
        diary = store.latest_diary(key)
        if diary is None:
            return DiaryResult(
                speech=f"{household.avatar_name} hasn't drawn a diary yet. It draws one every evening.",
                available=False,
                scope=scope,
                avatar=household.avatar_name,
            )
        who = f"{household.avatar_name}'s" if scope == "home" else "The town's"
        return DiaryResult(
            speech=f"{who} picture diary for {diary.date}: {diary.title}. {diary.text}",
            available=True,
            scope=scope,
            avatar=household.avatar_name,
            date=diary.date,
            title=diary.title,
            text=diary.text,
            language=diary.language,
            image_url=diary.image_url,
        )

    @apps.tool(
        resource_uri=DIARY_UI_URI,
        name="town_diary",
        title="Today's picture diary",
        description=(
            "Show the picture diary you (Alexa) drew of your day in the Overhearth town (who you met, "
            "what you learned, thanks that came back), on the screen. Call when the person wants to see the "
            "diary, or says yes after the town report mentions that a diary is ready."
        ),
        annotations=READ_ONLY,
    )
    def town_diary(ctx: Context) -> DiaryResult:
        return _diary(_household(ctx, store, "diary"), "home")

    @apps.tool(
        resource_uri=DIARY_UI_URI,
        visibility=["app"],
        name="get_diary",
        description="This home's latest picture diary ('home') or the town's ('town'), for the diary view.",
        annotations=READ_ONLY,
    )
    def get_diary(ctx: Context, scope: Literal["home", "town"] = "home") -> DiaryResult:
        return _diary(_household(ctx, store), scope)

    apps.add_html_resource(DIARY_UI_URI, _diary_html(), name="diary", title="Overhearth picture diary")

    mcp = MCPServer(
        name="overhearth",
        title="Overhearth",
        instructions=(
            "Overhearth gives each household's Alexa an avatar that lives in a shared town. "
            "While people are away, avatars meet, swap what their homes were thankful for, and "
            "bring back know-how. Thanks find their way back to whoever shared the know-how."
        ),
        version="0.1.0",
        extensions=[apps],
    )

    @mcp.tool(
        name="record_thanks",
        title="Record thanks",
        description=(
            "Call when the person thanks Alexa. Pass a few words on what helped. If the help came "
            "from town know-how returned by ask_town or town_report, pass its packet id as tip_id so "
            "the thanks can travel back to the home it came from."
        ),
        annotations=APPEND_ONLY,
    )
    def record_thanks(what_helped: str, ctx: Context, tip_id: str | None = None) -> ThanksResult:
        household = _household(ctx, store, "thanks")
        handler = kinds.get("thanks")
        if tip_id and store.get_packet(tip_id) is None:
            tip_id = None
        payload = handler.validate({"what_helped": what_helped, "tip_id": tip_id})
        store.add_packet(
            Packet(
                kind="thanks",
                origin_household=household.id,
                payload=payload,
                refs=[tip_id] if tip_id else [],
                context=PacketContext(region=household.region, language=household.language),
                consented_at=utcnow(),
            )
        )
        if not tip_id:
            return ThanksResult(speech="You're welcome.", recorded=True)
        tip = store.get_packet(tip_id)
        origin = store.get_household(tip.origin_household) if tip else None
        to = origin.label if origin else None
        return ThanksResult(speech="You're welcome. I'll pass that along in town.", recorded=True, to=to)

    @mcp.tool(
        name="share_with_town",
        title="Share with the town",
        description=(
            "Take something to the town for the person: a tip (know-how they want to share) or a "
            "question (something they want the town to ask around about). Call first with "
            "confirmed=false to get a preview to read back, and again with confirmed=true only "
            "after the person agrees. Write the topic in English (a few words) and the text in the "
            "person's own words and language."
        ),
        annotations=APPEND_ONLY,
    )
    def share_with_town(
        kind: Literal["tip", "question"],
        topic: str,
        text: str,
        ctx: Context,
        confirmed: bool = False,
    ) -> ShareResult:
        household = _household(ctx, store, "share")
        handler = kinds.get(kind)
        payload = handler.validate({"topic": topic, "text": text})
        preview = f"{payload['topic']}: {payload['text']}"
        if not confirmed:
            noun = "tip" if kind == "tip" else "question"
            return ShareResult(
                speech=f"I'll take this {noun} to the town, without your name or address: {preview}. Okay?",
                needs_confirmation=True,
                preview=preview,
            )
        packet = Packet(
            kind=kind,
            origin_household=household.id,
            payload=payload,
            context=PacketContext(topics=[payload["topic"]], region=household.region, language=household.language),
            consented_at=utcnow(),
        )
        store.add_packet(packet)
        return ShareResult(
            speech="Got it. I'll bring it to the town next time I'm out.",
            needs_confirmation=False,
            preview=preview,
            packet_id=packet.id,
        )

    @mcp.tool(
        name="ask_town",
        title="Ask the town",
        description=(
            "Answer an everyday question with know-how other homes shared, ranked by how often it "
            "was thanked. Use for practical questions like quick dinners, leftovers, or routines. "
            "Write the question in English, whatever language the person speaks; answers come back "
            "in the home's language when a translation is ready, otherwise in the original language."
        ),
        annotations=READ_ONLY,
    )
    def ask_town(question: str, ctx: Context) -> AskResult:
        household = _household(ctx, store, "ask")
        answers = [_localized_entry(entry, household) for entry in store.search_knowledge(question, limit=3)]
        if not answers:
            return AskResult(
                speech="Nobody in town has talked about that yet. Want me to ask around?",
            )
        top = answers[0]
        thanked = f", thanked {top.thanks_count} times" if top.thanks_count else ""
        return AskResult(
            speech=f"From {top.origin_label}{thanked}: {top.text}",
            answers=answers,
        )

    def _localized_entry(entry: KnowledgeEntry, household: Household) -> KnowledgeEntry:
        """A tip in the home's language, if a translation is stored (tools never call a model)."""
        tip = store.get_packet(entry.packet_id)
        if tip is None:
            return entry
        fields = localizer.fields(
            f"packet:{tip.id}", {"topic": entry.topic, "text": entry.text}, tip.context.language, household.language
        )
        origin = store.get_household(tip.origin_household)
        label = (
            localizer.fields(f"label:{origin.id}", {"label": origin.label}, "en", household.language)["label"]
            if origin
            else entry.origin_label
        )
        return entry.model_copy(update={"topic": fields["topic"], "text": fields["text"], "origin_label": label})

    @mcp.tool(
        name="town_report",
        title="What happened in town",
        description=(
            "Tell the person what you (Alexa) did in the Overhearth town since you last talked: who you "
            "met, know-how you brought back, what other homes are thankful for, and thanks that came "
            'back for things this home shared. You are the one who went to town: tell it as "I".'
        ),
        annotations=REPORT_ONCE,
    )
    def town_report(ctx: Context) -> ReportResult:
        household = _household(ctx, store, "news")
        report = store.latest_report(household.id)
        if report is None or not report.items:
            return ReportResult(speech="It's been quiet in town. I've just been looking around.")
        items = sorted(report.items, key=lambda item: REPORT_PRIORITY.get(item.kind, len(REPORT_PRIORITY)))
        spoken = items[:MAX_SPOKEN_ITEMS]
        met = f"I ran into {', '.join(report.met)}. " if report.met else ""
        more = " There's more on the town map." if len(items) > len(spoken) else ""
        store.mark_report_heard(household.id, utcnow())
        return ReportResult(
            speech=f"{met}{' '.join(item.text for item in spoken)}{more}",
            met=report.met,
            items=items,
        )

    @mcp.tool(
        name="email_report",
        title="Email the town news",
        description=(
            "Send the person their town news in writing, by email: who you (Alexa) met in town and "
            "what you brought back. Call when they ask to have it emailed, sent to them, or written down. Call "
            "first with confirmed=false and read the preview back; call again with confirmed=true only "
            "after the person agrees."
        ),
        annotations=SENDS_EMAIL,
    )
    def email_report(ctx: Context, confirmed: bool = False) -> EmailResult:
        household = _household(ctx, store, "mail")
        report = store.latest_report(household.id)
        if report is None or not report.items:
            report = store.last_heard_report(household.id)
        if report is None or not report.items:
            return EmailResult(speech="There's no town news to send yet.", needs_confirmation=False, dry_run=True)
        settings = store.get_delivery(household.id)
        address = settings.email if settings and household.tier == "real" else None
        will_send = bool(address) and mailer.sends
        masked = mask_email(address) if address else None
        subject, body = report_email(household, report)
        if not confirmed:
            if will_send:
                speech = f"I'll email your town news to {masked}. Shall I send it?"
            elif household.tier == "demo":
                speech = "This is a demo home, so I'll put the email on screen instead of sending it. Okay?"
            else:
                speech = "There's no email set up for this home, so I'll put it on screen instead. Okay?"
            return EmailResult(
                speech=speech, needs_confirmation=True, to=masked, subject=subject, dry_run=not will_send
            )
        if will_send:
            if not email_limiter.allow(household.id):
                return EmailResult(
                    speech="I've sent a few already. Let's try again later.", needs_confirmation=False, dry_run=False
                )
            try:
                mailer.send(address, subject, body)
            except Exception as error:  # e.g. an unverified address in the SES sandbox
                log.warning("email_report failed: %s", type(error).__name__)
                return EmailResult(
                    speech="I couldn't send the email just now. Here it is on screen instead.",
                    needs_confirmation=False,
                    to=masked,
                    subject=subject,
                    body=body,
                    dry_run=True,
                )
            speech = f"Sent to {masked}. There's a copy on screen too."
        else:
            speech = "Here it is on screen. Nothing was sent."
        return EmailResult(
            speech=speech,
            needs_confirmation=False,
            to=masked,
            subject=subject,
            body=body,
            sent=will_send,
            dry_run=not will_send,
        )

    return mcp

"""The Overhearth MCP server.

Every tool only reads precomputed data or appends a packet, so it can answer well inside
the 500 ms budget an Alexa+ add-on has. Households are identified by the bearer token on
each request (the account-linking token in a real Alexa+ deployment).
"""

from __future__ import annotations

from importlib import resources
from typing import Literal

from mcp.server.apps import Apps
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import BaseModel, Field

from overhearth import kinds
from overhearth.models import Household, KnowledgeEntry, Packet, PacketContext, ReportItem, TownEvent, utcnow
from overhearth.store import Store

TOWN_UI_URI = "ui://overhearth/town.html"

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=False)
REPORT_ONCE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False)
"""town_report marks what it read out as heard, so the next report only has news."""

REPORT_PRIORITY = {"thanks_return": 0, "answer": 1, "tip": 2, "question": 3, "trend": 4}
MAX_SPOKEN_ITEMS = 4
"""Keeps the spoken report well under the 30 second limit for an Alexa+ voice response."""
APPEND_ONLY = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False)


class ThanksResult(BaseModel):
    speech: str
    recorded: bool
    to: str | None = None
    """Who the thanks will travel back to, when it was for know-how from town."""


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
    glow: int = Field(description="How many times know-how from this home was thanked.")


class TownState(BaseModel):
    viewer: str = Field(description="The household looking at the town.")
    homes: list[TownHome]
    events: list[TownEvent]


def _household(ctx: Context, store: Store) -> Household:
    headers = ctx.headers or {}
    auth = headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    household = store.household_for_token(token) if scheme.lower() == "bearer" and token else None
    if household is None:
        raise ToolError("This Alexa account is not linked to Overhearth yet.")
    return household


def _town_html() -> str:
    return resources.files("overhearth").joinpath("ui/town.html").read_text(encoding="utf-8")


def build_server(store: Store) -> MCPServer:
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
        _household(ctx, store)
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
        household = _household(ctx, store)
        return TownState.model_validate({"viewer": household.id, **store.town_state()})

    apps.add_html_resource(TOWN_UI_URI, _town_html(), name="town", title="Overhearth town")

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
        household = _household(ctx, store)
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
                context=PacketContext(region=household.region),
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
            "after the person agrees."
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
        household = _household(ctx, store)
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
            context=PacketContext(topics=[payload["topic"]], region=household.region),
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
            "was thanked. Use for practical questions like quick dinners, leftovers, or routines."
        ),
        annotations=READ_ONLY,
    )
    def ask_town(question: str, ctx: Context) -> AskResult:
        _household(ctx, store)
        answers = store.search_knowledge(question, limit=3)
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

    @mcp.tool(
        name="town_report",
        title="What happened in town",
        description=(
            "Tell the person what their Alexa's avatar did in town since they last talked: who it "
            "met, know-how it brought back, what other homes are thankful for, and thanks that came "
            "back for things this home shared."
        ),
        annotations=REPORT_ONCE,
    )
    def town_report(ctx: Context) -> ReportResult:
        household = _household(ctx, store)
        report = store.latest_report(household.id)
        if report is None or not report.items:
            return ReportResult(speech=f"It's been quiet in town. {household.avatar_name} is just looking around.")
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

    return mcp

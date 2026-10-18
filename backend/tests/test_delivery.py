import random
from datetime import timedelta

from overhearth.assistant import Message, ScriptedAssistant, ToolCall
from overhearth.delivery import DryRunMailer, mask_email, notify_thanks
from overhearth.devclient import RawMcpClient
from overhearth.engine import TemplateDialogue, run_tick
from overhearth.models import DeliverySettings, Household, Packet, ReportItem, utcnow

REAL_TOKEN = "real-home-token"


def _structured(result: dict) -> dict:
    assert result["isError"] is False, result
    return result["structuredContent"]


def _client(url: str, token: str = "demo-tokyo") -> RawMcpClient:
    client = RawMcpClient(url, token=token)
    client.initialize()
    return client


def _real_home(store, *, email: str | None = "nori@example.com", notify: bool = True) -> Household:
    home = Household(
        id="hh_real",
        label="a family flat in Kyoto",
        region="Kyoto",
        timezone="Asia/Tokyo",
        tier="real",
        avatar_name="Nori",
    )
    store.add_household(home, token=REAL_TOKEN)
    if email:
        store.put_delivery(DeliverySettings(household_id=home.id, email=email, notify_thanks=notify))
    return home


def test_a_demo_home_previews_and_shows_the_email_without_sending(mail_server_url, mailer):
    client = _client(mail_server_url)
    preview = _structured(client.call_tool("email_report", {})[0])
    assert preview["needs_confirmation"] is True
    assert preview["dry_run"] is True
    assert "demo home" in preview["speech"]
    assert preview["body"] is None

    shown = _structured(client.call_tool("email_report", {"confirmed": True})[0])
    assert shown["sent"] is False
    assert "egg and spinach" in shown["body"]
    assert mailer.outbox == []


def test_a_linked_home_with_email_gets_it_after_confirming(mail_server_url, mailer, store):
    home = _real_home(store)
    store.append_report(
        home.id, [ReportItem(kind="tip", text="Ume passed on a tip about quick dinners.")], met=["Ume"], at=utcnow()
    )
    client = _client(mail_server_url, REAL_TOKEN)
    preview = _structured(client.call_tool("email_report", {})[0])
    assert preview["needs_confirmation"] is True
    assert preview["to"] == "n***@example.com"
    assert "nori@example.com" not in preview["speech"]
    assert mailer.outbox == []

    sent = _structured(client.call_tool("email_report", {"confirmed": True})[0])
    assert sent["sent"] is True
    assert sent["dry_run"] is False
    ((to, subject, body),) = mailer.outbox
    assert to == "nori@example.com"
    assert "Nori" in subject
    assert "quick dinners" in body


def test_the_report_just_heard_can_still_be_emailed(mail_server_url, store):
    client = _client(mail_server_url)
    _structured(client.call_tool("town_report")[0])
    shown = _structured(client.call_tool("email_report", {"confirmed": True})[0])
    assert "egg and spinach" in shown["body"]


def test_thanks_emails_go_to_opted_in_linked_homes_at_most_once_a_day(store, mailer):
    home = _real_home(store)
    now = utcnow()
    item = ReportItem(kind="thanks_return", text="Your tip about rice was thanked once.", key="thanks_return:x")
    store.append_report(home.id, [item], met=[], at=now)
    assert notify_thanks(store, mailer, {home.id, "hh_tokyo"}, now) == 1
    assert mailer.outbox[0][0] == "nori@example.com"
    assert notify_thanks(store, mailer, {home.id}, now + timedelta(hours=2)) == 0
    assert notify_thanks(store, mailer, {home.id}, now + timedelta(hours=21)) == 1
    assert notify_thanks(store, DryRunMailer(), {home.id}, now + timedelta(days=3)) == 0


def test_homes_that_did_not_opt_in_get_no_thanks_email(store, mailer):
    home = _real_home(store, notify=False)
    store.append_report(home.id, [ReportItem(kind="thanks_return", text="x")], met=[], at=utcnow())
    assert notify_thanks(store, mailer, {home.id}, utcnow()) == 0


def test_a_tick_emails_the_home_whose_tip_was_thanked(store, mailer):
    home = _real_home(store)
    now = utcnow()
    tip = Packet(
        kind="tip",
        origin_household=home.id,
        payload={"topic": "rice", "text": "Freeze rice flat.", "keywords": ["rice"]},
        consented_at=now,
        created_at=now - timedelta(days=1),
    )
    store.add_packet(tip)
    store.add_packet(
        Packet(
            kind="thanks",
            origin_household="hh_tokyo",
            payload={"what_helped": "the rice tip", "tip_id": tip.id},
            consented_at=now,
            created_at=now,
        )
    )
    result = run_tick(store, TemplateDialogue(), at=now + timedelta(minutes=1), rng=random.Random(1), mailer=mailer)
    assert result.thanks_emails == 1
    assert "rice" in mailer.outbox[0][2]


def test_masking_keeps_the_domain():
    assert mask_email("tsuki@example.org") == "t***@example.org"


def test_the_scripted_assistant_confirms_before_emailing():
    assistant = ScriptedAssistant()
    first = assistant.turn([Message(role="user", text="Can you email me that?")], [])
    (call,) = first.tool_calls
    assert call.name == "email_report"
    assert call.arguments == {"confirmed": False}
    history = [
        Message(role="user", text="Can you email me that?"),
        Message(role="assistant", tool_calls=[ToolCall(id="c1", name="email_report", arguments={"confirmed": False})]),
        Message(role="tool", tool_call_id="c1", name="email_report", content={"needs_confirmation": True}),
        Message(role="assistant", text="Shall I send it?"),
        Message(role="user", text="Yes please"),
    ]
    (confirm,) = assistant.turn(history, []).tool_calls
    assert confirm.name == "email_report"
    assert confirm.arguments == {"confirmed": True}

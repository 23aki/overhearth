"""Delivering things in writing: the town report on request, and thanks for shared know-how.

Every real-world action follows "read back and confirm → do it → confirm in writing". Nothing
is sent unless a mailer is configured (OVERHEARTH_MAILER=ses with OVERHEARTH_MAIL_FROM) and the
home has an email address. Demo homes never send: they show the email that would go out.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta
from typing import Protocol

from overhearth.models import Household, Report, ReportItem

log = logging.getLogger(__name__)

THANKS_EMAIL_INTERVAL = timedelta(hours=20)
"""Thanks emails are batched: at most one in this interval per home."""

EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[A-Za-z]{2,}$")


class Mailer(Protocol):
    sends: bool
    """False for the dry run, which only shows what would be sent."""

    def send(self, to: str, subject: str, body: str) -> None: ...


class DryRunMailer:
    sends = False

    def send(self, to: str, subject: str, body: str) -> None:
        log.info("dry run: would email %s: %s", mask_email(to), subject)


class SesMailer:
    """Amazon SES. The sender must be a verified identity; in the SES sandbox, so must the recipient."""

    sends = True

    def __init__(self, sender: str, *, region: str | None = None) -> None:
        import boto3

        self.sender = sender
        self.client = boto3.client("sesv2", region_name=region)

    def send(self, to: str, subject: str, body: str) -> None:
        self.client.send_email(
            FromEmailAddress=self.sender,
            Destination={"ToAddresses": [to]},
            Content={"Simple": {"Subject": {"Data": subject}, "Body": {"Text": {"Data": body}}}},
        )


def mailer_from_env() -> Mailer:
    if os.environ.get("OVERHEARTH_MAILER") == "ses" and os.environ.get("OVERHEARTH_MAIL_FROM"):
        return SesMailer(os.environ["OVERHEARTH_MAIL_FROM"], region=os.environ.get("AWS_REGION"))
    return DryRunMailer()


def mask_email(email: str) -> str:
    """t***@gmail.com: enough for the person to recognise, without reading it out in full."""
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"


def valid_email(email: str) -> bool:
    return bool(EMAIL.match(email))


def report_email(household: Household, report: Report) -> tuple[str, str]:
    lines = [f"Here's what {household.avatar_name} heard in town."]
    if report.met:
        lines.append(f"Met: {', '.join(report.met)}.")
    lines.append("")
    lines += [f"- {item.text}" for item in report.items]
    lines += ["", "Only what people agreed to share travels between homes, without names or addresses."]
    return f"{household.avatar_name}'s news from the town", "\n".join(lines)


def thanks_email(household: Household, items: list[ReportItem]) -> tuple[str, str]:
    lines = [f"{household.avatar_name} has news: the know-how your home shared helped other homes.", ""]
    lines += [f"- {item.text}" for item in items]
    lines += ["", "Ask Alexa what happened in town to hear the rest."]
    return "Your know-how was thanked in the town", "\n".join(lines)


def notify_thanks(store, mailer: Mailer, household_ids: set[str], at: datetime) -> int:
    """Email linked homes that opted in, when thanks came back to them. Returns how many were sent."""
    if not mailer.sends:
        return 0
    sent = 0
    for household_id in sorted(household_ids):
        settings = store.get_delivery(household_id)
        household = store.get_household(household_id)
        if not settings or not settings.notify_thanks or not settings.email or not household:
            continue
        if household.tier != "real":
            continue
        if settings.last_thanks_email_at and at - settings.last_thanks_email_at < THANKS_EMAIL_INTERVAL:
            continue
        report = store.latest_report(household_id)
        items = [item for item in (report.items if report else []) if item.kind == "thanks_return"]
        if not items:
            continue
        subject, body = thanks_email(household, items)
        try:
            mailer.send(settings.email, subject, body)
        except Exception as error:  # one failed email must not stop the tick
            log.warning("thanks email failed for %s: %s", household_id, type(error).__name__)
            continue
        store.put_delivery(settings.model_copy(update={"last_thanks_email_at": at}))
        sent += 1
    return sent

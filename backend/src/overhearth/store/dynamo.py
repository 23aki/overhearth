"""DynamoDB store for the AWS deployment.

One table with a string partition key `pk` and sort key `sk`. Each record is kept as the
model's JSON in `data`, so DynamoDB never has to understand the models:

| pk                  | sk                         | what                                    |
|---------------------|----------------------------|-----------------------------------------|
| HOUSEHOLD           | household id               | a household                             |
| PACKET              | packet id                  | a packet (attribute `kind` for filters) |
| REPORT              | household id               | the household's pending report          |
| HEARD               | household id               | the report the household heard last     |
| DELIVERY            | household id               | private delivery settings (email)       |
| ACTIVITY            | household id               | when the home last talked with Alexa    |
| TRANSLATION#<key>   | language                   | stored translation of some fields       |
| CARRIED             | household id               | packet ids the avatar carries           |
| EVENT               | tick#seq#event id          | a town event                            |
| CLOCK               | -                          | the town clock                          |
| TOKEN#<sha256>      | -                          | what a bearer token stands for          |
| CODE#<sha256>       | -                          | an authorization code, deleted on use   |

The town is small (dozens of homes, hundreds of packets), so listing a partition and filtering
is cheap and keeps every tool to one or two requests. Tokens, codes and events carry a `ttl`
attribute so DynamoDB removes them once they are useless.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import UTC, datetime
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key

from overhearth.models import (
    AuthGrant,
    DeliverySettings,
    Household,
    IssuedToken,
    KnowledgeEntry,
    Packet,
    Report,
    ReportItem,
    TownEvent,
    utcnow,
)
from overhearth.store.common import (
    TOWN_VIEW_SCAN,
    build_town_state,
    describe_activity,
    merge_report_items,
    rank_knowledge,
    token_hash,
)
from overhearth.store.memory import FIRST_TICK_LOOKBACK, MemoryStore

EVENT_TTL_SECONDS = 14 * 24 * 3600
_NONE = "-"


def _epoch(at: datetime) -> int:
    return int(at.timestamp())


class DynamoStore:
    def __init__(self, table_name: str, *, region: str | None = None, resource: Any = None) -> None:
        resource = resource or boto3.resource("dynamodb", region_name=region)
        self.table = resource.Table(table_name)
        self._last_batch_at = 0
        self._batch_lock = threading.Lock()

    # low-level helpers --------------------------------------------------------

    def _put(self, pk: str, sk: str, data: str, **extra: Any) -> None:
        self.table.put_item(Item={"pk": pk, "sk": sk, "data": data, **extra})

    def _get(self, pk: str, sk: str = _NONE, *, consistent: bool = False) -> str | None:
        item = self.table.get_item(Key={"pk": pk, "sk": sk}, ConsistentRead=consistent).get("Item")
        return item["data"] if item else None

    def _query(self, pk: str, *, newest_first: bool = False, limit: int | None = None, **kwargs: Any) -> list[dict]:
        items: list[dict] = []
        request: dict[str, Any] = {"KeyConditionExpression": Key("pk").eq(pk), "ScanIndexForward": not newest_first}
        request.update(kwargs)
        while True:
            if limit is not None:
                request["Limit"] = limit - len(items)
            page = self.table.query(**request)
            items.extend(page.get("Items", []))
            if "LastEvaluatedKey" not in page or (limit is not None and len(items) >= limit):
                return items
            request["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    # households ---------------------------------------------------------------

    def add_household(self, household: Household, *, token: str | None = None) -> None:
        self._put("HOUSEHOLD", household.id, household.model_dump_json())
        if token:
            self.put_token(
                token, IssuedToken(kind="access", client_id="demo", household_id=household.id, scope="mcp:tools")
            )

    def household_for_token(self, token: str) -> Household | None:
        issued = self.resolve_token(token)
        return self.get_household(issued.household_id) if issued and issued.household_id else None

    def get_household(self, household_id: str) -> Household | None:
        data = self._get("HOUSEHOLD", household_id)
        return Household.model_validate_json(data) if data else None

    def households(self) -> list[Household]:
        return [Household.model_validate_json(item["data"]) for item in self._query("HOUSEHOLD")]

    # tokens and authorization codes -------------------------------------------

    def resolve_token(self, token: str, *, kind: str = "access") -> IssuedToken | None:
        # Consistent, so a token works the moment it is issued.
        data = self._get(f"TOKEN#{token_hash(token)}", consistent=True)
        return self._valid(data, kind)

    @staticmethod
    def _valid(data: str | None, kind: str) -> IssuedToken | None:
        if data is None:
            return None
        issued = IssuedToken.model_validate_json(data)
        if issued.kind != kind or (issued.expires_at is not None and issued.expires_at <= utcnow()):
            return None
        return issued

    def take_token(self, token: str, *, kind: str) -> IssuedToken | None:
        # Delete and read in one request: two concurrent refreshes cannot both succeed.
        old = self.table.delete_item(Key={"pk": f"TOKEN#{token_hash(token)}", "sk": _NONE}, ReturnValues="ALL_OLD")
        item = old.get("Attributes")
        return self._valid(item["data"] if item else None, kind)

    def put_token(self, token: str, issued: IssuedToken) -> None:
        extra = {"ttl": _epoch(issued.expires_at)} if issued.expires_at else {}
        self._put(f"TOKEN#{token_hash(token)}", _NONE, issued.model_dump_json(), **extra)

    def revoke_token(self, token: str) -> None:
        self.table.delete_item(Key={"pk": f"TOKEN#{token_hash(token)}", "sk": _NONE})

    def put_auth_code(self, code: str, grant: AuthGrant) -> None:
        self._put(f"CODE#{token_hash(code)}", _NONE, grant.model_dump_json(), ttl=_epoch(grant.expires_at))

    def take_auth_code(self, code: str) -> AuthGrant | None:
        # Deleting and reading in one request makes a code usable once, even under concurrency.
        old = self.table.delete_item(Key={"pk": f"CODE#{token_hash(code)}", "sk": _NONE}, ReturnValues="ALL_OLD")
        item = old.get("Attributes")
        if not item:
            return None
        grant = AuthGrant.model_validate_json(item["data"])
        return grant if grant.expires_at > utcnow() else None

    # packets ------------------------------------------------------------------

    def add_packet(self, packet: Packet) -> None:
        self._put("PACKET", packet.id, packet.model_dump_json(), kind=packet.kind, origin=packet.origin_household)

    def get_packet(self, packet_id: str) -> Packet | None:
        data = self._get("PACKET", packet_id)
        return Packet.model_validate_json(data) if data else None

    def packets(self, *, kind: str | None = None, origin: str | None = None) -> list[Packet]:
        condition = None
        if kind is not None:
            condition = Attr("kind").eq(kind)
        if origin is not None:
            condition = Attr("origin").eq(origin) if condition is None else condition & Attr("origin").eq(origin)
        extra = {"FilterExpression": condition} if condition is not None else {}
        items = self._query("PACKET", **extra)
        packets = [Packet.model_validate_json(item["data"]) for item in items]
        return sorted(packets, key=lambda p: (p.created_at, p.id))

    def search_knowledge(self, query: str, *, limit: int = 3) -> list[KnowledgeEntry]:
        packets = self.packets()
        return rank_knowledge(
            query,
            [p for p in packets if p.kind == "tip"],
            [p for p in packets if p.kind == "thanks"],
            {h.id: h for h in self.households()},
            limit=limit,
        )

    # reports ------------------------------------------------------------------

    def latest_report(self, household_id: str) -> Report | None:
        data = self._get("REPORT", household_id)
        return Report.model_validate_json(data) if data else None

    def put_report(self, report: Report) -> None:
        self._put("REPORT", report.household_id, report.model_dump_json())

    def append_report(
        self,
        household_id: str,
        items: list[ReportItem],
        *,
        met: list[str],
        at: datetime,
        since: datetime | None = None,
    ) -> None:
        report = self.latest_report(household_id) or Report(
            household_id=household_id, generated_at=at, since=since or at
        )
        merged_met = report.met + [name for name in met if name not in report.met]
        update = {"generated_at": at, "met": merged_met, "items": merge_report_items(report.items, items)}
        self.put_report(report.model_copy(update=update))

    def mark_report_heard(self, household_id: str, at: datetime) -> None:
        heard = self.latest_report(household_id)
        if heard and heard.items:
            self._put("HEARD", household_id, heard.model_dump_json())
        self.put_report(Report(household_id=household_id, generated_at=at, since=at))

    def last_heard_report(self, household_id: str) -> Report | None:
        data = self._get("HEARD", household_id)
        return Report.model_validate_json(data) if data else None

    def get_translation(self, key: str, language: str) -> dict[str, str] | None:
        data = self._get(f"TRANSLATION#{key}", language)
        return json.loads(data) if data else None

    def put_translation(self, key: str, language: str, fields: dict[str, str]) -> None:
        self._put(f"TRANSLATION#{key}", language, json.dumps(fields, ensure_ascii=False))

    def mark_active(self, household_id: str, kind: str, at: datetime) -> None:
        # One update, no read: plain talk only moves the time; a kind of talk also sets the kind.
        values: dict[str, Any] = {":at": at.isoformat(), ":ttl": _epoch(at) + 3600}
        expression = "SET #at = :at, #ttl = :ttl"
        if kind != "talk":
            expression += ", kind = :kind, kind_at = :at"
            values[":kind"] = kind
        self.table.update_item(
            Key={"pk": "ACTIVITY", "sk": household_id},
            UpdateExpression=expression,
            ExpressionAttributeNames={"#at": "at", "#ttl": "ttl"},
            ExpressionAttributeValues=values,
        )

    def activity(self, now: datetime) -> dict[str, dict[str, Any]]:
        records = {}
        for item in self._query("ACTIVITY"):
            record: dict[str, Any] = {"at": datetime.fromisoformat(item["at"])}
            if "kind" in item:
                record.update(kind=item["kind"], kind_at=datetime.fromisoformat(item["kind_at"]))
            records[item["sk"]] = record
        return describe_activity(records, now)

    def get_delivery(self, household_id: str) -> DeliverySettings | None:
        data = self._get("DELIVERY", household_id)
        return DeliverySettings.model_validate_json(data) if data else None

    def put_delivery(self, settings: DeliverySettings) -> None:
        self._put("DELIVERY", settings.household_id, settings.model_dump_json())

    # avatars and the town clock -----------------------------------------------

    def carried(self, household_id: str) -> list[str]:
        data = self._get("CARRIED", household_id)
        return json.loads(data) if data else []

    def add_carried(self, household_id: str, packet_id: str) -> None:
        carried = self.carried(household_id)
        if packet_id not in carried:
            self._put("CARRIED", household_id, json.dumps([*carried, packet_id]))

    def next_tick(self, at: datetime) -> tuple[int, datetime]:
        # One atomic update: concurrent ticks still get distinct numbers.
        result = self.table.update_item(
            Key={"pk": "CLOCK", "sk": _NONE},
            UpdateExpression="ADD tick :one SET last_tick_at = :at",
            ExpressionAttributeValues={":one": 1, ":at": at.isoformat()},
            ReturnValues="ALL_OLD",
        )
        old = result.get("Attributes", {})
        previous = datetime.fromisoformat(old["last_tick_at"]) if "last_tick_at" in old else at - FIRST_TICK_LOOKBACK
        return int(old.get("tick", 0)) + 1, previous

    def town_events(self, *, limit: int = 50) -> list[TownEvent]:
        items = self._query("EVENT", newest_first=True, limit=limit)
        return [TownEvent.model_validate_json(item["data"]) for item in reversed(items)]

    def add_town_events(self, events: list[TownEvent]) -> None:
        expires = int(time.time()) + EVENT_TTL_SECONDS
        with self._batch_lock:
            # Strictly increasing, so events keep the order they were added in, across calls.
            batch_at = self._last_batch_at = max(time.time_ns(), self._last_batch_at + 1)
        with self.table.batch_writer() as batch:
            for seq, event in enumerate(events):
                batch.put_item(
                    Item={
                        "pk": "EVENT",
                        "sk": f"{event.tick:08d}#{batch_at:020d}#{seq:05d}#{event.id}",
                        "data": event.model_dump_json(),
                        "ttl": expires,
                    }
                )

    def town_state(self) -> dict[str, Any]:
        packets = self.packets()
        state = build_town_state(
            self.households(),
            {p.id: p.origin_household for p in packets if p.kind == "tip"},
            [p for p in packets if p.kind == "thanks"],
            self.town_events(limit=TOWN_VIEW_SCAN),
        )
        return {**state, "active": self.activity(utcnow())}

    # seeding ------------------------------------------------------------------

    def is_empty(self) -> bool:
        return not self._query("HOUSEHOLD", limit=1)

    def refresh_from(self, source: MemoryStore) -> int:
        """Update households and tips in place from a seeded town (language, places, original text).

        Thanks, reports and events stay as they are, so a running town keeps its history.
        """
        count = 0
        with self.table.batch_writer() as batch:
            for household in source.households():
                batch.put_item(Item={"pk": "HOUSEHOLD", "sk": household.id, "data": household.model_dump_json()})
                count += 1
            for tip in source.packets(kind="tip"):
                existing = self.get_packet(tip.id)
                kept = tip.model_copy(update={"created_at": existing.created_at}) if existing else tip
                batch.put_item(
                    Item={
                        "pk": "PACKET",
                        "sk": tip.id,
                        "data": kept.model_dump_json(),
                        "kind": tip.kind,
                        "origin": tip.origin_household,
                    }
                )
                count += 1
        return count

    def load_from(self, source: MemoryStore) -> None:
        """Copy a seeded in-memory town (households, tokens, packets, reports, events, clock)."""
        with self.table.batch_writer() as batch:
            for household in source.households():
                batch.put_item(Item={"pk": "HOUSEHOLD", "sk": household.id, "data": household.model_dump_json()})
            for hashed, issued in source._tokens.items():
                item = {"pk": f"TOKEN#{hashed}", "sk": _NONE, "data": issued.model_dump_json()}
                if issued.expires_at:
                    item["ttl"] = _epoch(issued.expires_at)
                batch.put_item(Item=item)
            for packet in source.packets():
                batch.put_item(
                    Item={
                        "pk": "PACKET",
                        "sk": packet.id,
                        "data": packet.model_dump_json(),
                        "kind": packet.kind,
                        "origin": packet.origin_household,
                    }
                )
            for report in source._reports.values():
                batch.put_item(Item={"pk": "REPORT", "sk": report.household_id, "data": report.model_dump_json()})
            for household_id, carried in source._carried.items():
                batch.put_item(Item={"pk": "CARRIED", "sk": household_id, "data": json.dumps(carried)})
            for (key, language), fields in source._translations.items():
                batch.put_item(
                    Item={"pk": f"TRANSLATION#{key}", "sk": language, "data": json.dumps(fields, ensure_ascii=False)}
                )
        self.add_town_events(source.town_events(limit=len(source._events) or 1))
        if source._tick:
            clock: dict[str, Any] = {"pk": "CLOCK", "sk": _NONE, "tick": source._tick}
            if source._last_tick_at:
                clock["last_tick_at"] = source._last_tick_at.astimezone(UTC).isoformat()
            self.table.put_item(Item=clock)


def create_table(resource: Any, table_name: str) -> None:
    """Create the table as the CDK stack does. Used by tests and local experiments."""
    resource.create_table(
        TableName=table_name,
        KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
        AttributeDefinitions=[
            {"AttributeName": "pk", "AttributeType": "S"},
            {"AttributeName": "sk", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )


def main() -> None:
    """Seed a deployed table: `uv run python -m overhearth.store.dynamo --table NAME`."""
    import argparse

    from overhearth.town_seed import seeded_town

    parser = argparse.ArgumentParser(description="Load the demo town into a DynamoDB table.")
    parser.add_argument("--table", required=True)
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--force", action="store_true", help="seed even if the table already has households")
    parser.add_argument(
        "--refresh", action="store_true", help="only update households and tips in place, keeping the town's history"
    )
    args = parser.parse_args()
    store = DynamoStore(args.table, region=args.region)
    if args.refresh:
        print(f"refreshed {store.refresh_from(seeded_town())} households and tips in {args.table}")
        return
    if not store.is_empty() and not args.force:
        raise SystemExit(f"{args.table} already has households; pass --force to seed anyway")
    store.load_from(seeded_town())
    print(f"seeded {args.table}: {len(store.households())} households, {len(store.packets())} packets")


if __name__ == "__main__":
    main()

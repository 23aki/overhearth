from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

import boto3
import pytest
import uvicorn
from moto import mock_aws

from overhearth.asgi import create_app
from overhearth.dev_seed import seeded_store
from overhearth.store import Store
from overhearth.store.dynamo import DynamoStore, create_table


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(params=["memory", "dynamo"])
def store(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> Iterator[Store]:
    """Every test that uses the seeded store runs against both backends."""
    if request.param == "memory":
        yield seeded_store()
        return
    for name, value in {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_DEFAULT_REGION": "us-east-1",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    with mock_aws():
        resource = boto3.resource("dynamodb", region_name="us-east-1")
        create_table(resource, "overhearth-test")
        dynamo = DynamoStore("overhearth-test", resource=resource)
        dynamo.load_from(seeded_store())
        yield dynamo


class FakeMailer:
    """Records emails instead of sending them."""

    sends = True

    def __init__(self) -> None:
        self.outbox: list[tuple[str, str, str]] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.outbox.append((to, subject, body))


@pytest.fixture
def mailer() -> FakeMailer:
    return FakeMailer()


@contextmanager
def serve(app) -> Iterator[str]:
    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        if time.monotonic() > deadline:
            raise RuntimeError("test server did not start")
        time.sleep(0.05)
    try:
        yield f"http://127.0.0.1:{port}/mcp"
    finally:
        server.should_exit = True
        thread.join(timeout=5)


@pytest.fixture
def server_url(store: Store) -> Iterator[str]:
    with serve(create_app(store)) as url:
        yield url


@pytest.fixture
def mail_server_url(store: Store, mailer: FakeMailer) -> Iterator[str]:
    """A server whose emails go to the `mailer` fixture's outbox."""
    with serve(create_app(store, mailer)) as url:
        yield url

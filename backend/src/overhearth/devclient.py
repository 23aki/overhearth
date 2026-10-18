"""A minimal MCP client over raw HTTP, speaking protocol 2025-11-25 like Alexa+ does.

Used by the tests and by `scripts/measure_latency.py`. It deliberately avoids the SDK
client so that what goes over the wire is exactly what an Alexa+-style client sends.
"""

from __future__ import annotations

import itertools
import json
import time
import urllib.error
import urllib.request
from typing import Any

PROTOCOL_VERSION = "2025-11-25"
APPS_EXTENSION = {"io.modelcontextprotocol/ui": {"mimeTypes": ["text/html;profile=mcp-app"]}}


class RpcError(Exception):
    def __init__(self, status: int, body: Any) -> None:
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body


class RawMcpClient:
    def __init__(self, url: str, *, token: str | None = None, timeout: float = 10.0) -> None:
        self.url = url
        self.token = token
        self.timeout = timeout
        self._ids = itertools.count(1)
        self.protocol_version: str | None = None

    def _post(self, message: dict[str, Any]) -> tuple[Any, float]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.protocol_version:
            headers["MCP-Protocol-Version"] = self.protocol_version
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(self.url, data=json.dumps(message).encode(), headers=headers, method="POST")
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            body = error.read().decode(errors="replace")
            raise RpcError(error.code, body) from None
        elapsed_ms = (time.perf_counter() - started) * 1000
        return (json.loads(raw) if raw else None), elapsed_ms

    def request(self, method: str, params: dict[str, Any] | None = None) -> tuple[dict[str, Any], float]:
        body, elapsed_ms = self._post(
            {"jsonrpc": "2.0", "id": next(self._ids), "method": method, "params": params or {}}
        )
        if "error" in body:
            raise RpcError(200, body["error"])
        return body["result"], elapsed_ms

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        self._post({"jsonrpc": "2.0", "method": method, "params": params or {}})

    def initialize(self) -> dict[str, Any]:
        result, _ = self.request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"extensions": APPS_EXTENSION},
                "clientInfo": {"name": "overhearth-devclient", "version": "0.1.0"},
            },
        )
        self.protocol_version = result["protocolVersion"]
        self.notify("notifications/initialized")
        return result

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> tuple[dict[str, Any], float]:
        return self.request("tools/call", {"name": name, "arguments": arguments or {}})

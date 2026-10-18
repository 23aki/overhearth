"""Measure MCP round-trip latency against a running server.

    uv run python scripts/measure_latency.py --url http://127.0.0.1:8000/mcp --token demo-tokyo

Alexa+ expects an add-on to answer in under 500 ms.
"""

from __future__ import annotations

import argparse
import statistics

from overhearth.devclient import RawMcpClient

BUDGET_MS = 500


def _summary(label: str, samples: list[float]) -> str:
    ordered = sorted(samples)
    p95 = ordered[max(0, int(len(ordered) * 0.95) - 1)]
    verdict = "ok" if p95 < BUDGET_MS else "OVER BUDGET"
    p50 = statistics.median(ordered)
    return f"{label:<28} p50 {p50:7.1f} ms   p95 {p95:7.1f} ms   max {ordered[-1]:7.1f} ms  {verdict}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000/mcp")
    parser.add_argument("--token", default="demo-tokyo")
    parser.add_argument("-n", type=int, default=30)
    args = parser.parse_args()

    client = RawMcpClient(args.url, token=args.token)
    first = RawMcpClient(args.url, token=args.token)
    _, first_ms = first.request(
        "initialize",
        {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "probe", "version": "0"}},
    )
    print(f"{'first initialize':<28} {first_ms:7.1f} ms")
    client.initialize()

    calls = {
        "tools/list": lambda: client.request("tools/list"),
        "tools/call town_report": lambda: client.call_tool("town_report"),
        "tools/call ask_town": lambda: client.call_tool("ask_town", {"question": "quick dinner with eggs"}),
        "resources/read ui://town": lambda: client.request("resources/read", {"uri": "ui://overhearth/town.html"}),
    }
    for label, call in calls.items():
        samples = [call()[1] for _ in range(args.n)]
        print(_summary(label, samples))


if __name__ == "__main__":
    main()

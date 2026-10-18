"""Run ticks against the bundled dev town and print what happened.

uv run python -m overhearth.engine --ticks 2               # template dialogue, offline
uv run python -m overhearth.engine --ticks 1 --bedrock     # Strands + Bedrock
"""

from __future__ import annotations

import argparse
import logging
import random

from overhearth.dev_seed import seeded_store
from overhearth.engine import BedrockDialogue, TemplateDialogue, run_tick


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticks", type=int, default=1)
    parser.add_argument("--bedrock", action="store_true")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)

    store = seeded_store()
    dialogue = BedrockDialogue() if args.bedrock else TemplateDialogue()
    rng = random.Random(args.seed)
    for _ in range(args.ticks):
        result = run_tick(store, dialogue, rng=rng, out_ratio=1.0)
        print(f"tick {result.tick}: {result}")
    for event in store.town_events(limit=50):
        print(f"  [{event.type}] {event.summary}")
        for line in event.detail.get("lines", []):
            print(f"      {line['speaker']}: {line['text']}")
    for household in store.households():
        report = store.latest_report(household.id)
        if report and report.items:
            print(f"\n{household.avatar_name} ({household.label}) met {report.met}:")
            for item in report.items:
                print(f"  - [{item.kind}] {item.text}")


if __name__ == "__main__":
    main()

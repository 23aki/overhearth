"""Run ticks against the bundled dev town and print what happened.

uv run python -m overhearth.engine --ticks 2               # template dialogue, offline
uv run python -m overhearth.engine --ticks 1 --bedrock     # Strands + Bedrock
uv run python -m overhearth.engine --ticks 1 --anthropic   # Strands + the Claude API (ANTHROPIC_API_KEY)
"""

from __future__ import annotations

import argparse
import logging
import random

from overhearth.dev_seed import seeded_store
from overhearth.engine import BedrockDialogue, ClaudeDialogue, FeaturedDialogue, TemplateDialogue, run_tick
from overhearth.town_seed import seeded_town


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticks", type=int, default=1)
    parser.add_argument("--bedrock", action="store_true")
    parser.add_argument("--anthropic", action="store_true")
    parser.add_argument(
        "--all-encounters", action="store_true", help="use the model for every encounter, not only demo homes'"
    )
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--small", action="store_true", help="use the tiny dev town instead of the demo town")
    parser.add_argument("--show", type=int, default=12, help="how many recent events to print")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)

    store = seeded_store() if args.small else seeded_town()
    dialogue = ClaudeDialogue() if args.anthropic else BedrockDialogue() if args.bedrock else TemplateDialogue()
    if (args.anthropic or args.bedrock) and not args.all_encounters:
        dialogue = FeaturedDialogue(dialogue)  # as the server does, to keep model calls down
    translator = None
    if args.anthropic:
        from overhearth.translate import ClaudeTranslator

        translator = ClaudeTranslator()
    elif args.bedrock:
        from overhearth.translate import BedrockTranslator

        translator = BedrockTranslator()
    rng = random.Random(args.seed)
    for _ in range(args.ticks):
        result = run_tick(store, dialogue, rng=rng, out_ratio=1.0, translator=translator)
        print(f"tick {result.tick}: {result}")
    for event in store.town_events(limit=args.show):
        print(f"  [{event.type}] {event.summary}")
        for line in event.detail.get("lines", []):
            print(f"      {line['speaker']}: {line['text']}")
    for household in [h for h in store.households() if h.tier != "background"]:
        report = store.latest_report(household.id)
        if report and report.items:
            print(f"\n{household.avatar_name} ({household.label}) met {report.met}:")
            for item in report.items:
                print(f"  - [{item.kind}] {item.text}")


if __name__ == "__main__":
    main()

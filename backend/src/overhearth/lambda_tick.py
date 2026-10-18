"""AWS Lambda entry point for one town tick, run on a schedule."""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from overhearth.engine import dialogue_from_env, run_tick
from overhearth.store.env import store_from_env

logging.getLogger().setLevel(logging.INFO)
log = logging.getLogger(__name__)

_store = None
_dialogue = None


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    global _store, _dialogue
    if _store is None:
        _store = store_from_env()
        _dialogue = dialogue_from_env()
    result = asdict(run_tick(_store, _dialogue))
    log.info("tick %s", result)
    return result

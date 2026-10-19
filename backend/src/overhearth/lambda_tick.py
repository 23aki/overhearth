"""AWS Lambda entry point for one town tick, run on a schedule."""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from overhearth.delivery import mailer_from_env
from overhearth.diary import Diarist
from overhearth.engine import dialogue_from_env, run_tick
from overhearth.images import image_store_from_env, painter_from_env
from overhearth.llm import writer_from_env
from overhearth.models import utcnow
from overhearth.store.env import store_from_env
from overhearth.translate import translator_from_env

logging.getLogger().setLevel(logging.INFO)
log = logging.getLogger(__name__)

_store = None
_dialogue = None
_mailer = None
_translator = None
_diarist = None


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    global _store, _dialogue, _mailer, _translator, _diarist
    if _store is None:
        _store = store_from_env()
        _dialogue = dialogue_from_env()
        _mailer = mailer_from_env()
        _translator = translator_from_env()
        _diarist = Diarist(_store, writer_from_env(), painter_from_env(), image_store_from_env())
    if event.get("diary"):
        # "Draw it now" from the demo controls: write these diaries right away, no tick.
        written = _diarist.write_due(utcnow(), scopes=list(event["diary"]))
        log.info("diaries on request: %s", [d.id for d in written])
        return {"diaries": [d.model_dump(mode="json") for d in written]}
    result = asdict(run_tick(_store, _dialogue, mailer=_mailer, translator=_translator, diarist=_diarist))
    log.info("tick %s", result)
    return result

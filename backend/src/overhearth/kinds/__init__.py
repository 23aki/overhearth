"""Registry of exchange kinds."""

from __future__ import annotations

from overhearth.kinds.base import Carry, Effect, Event, KindHandler, ReportLine, TickContext, scrub
from overhearth.kinds.builtin import Question, Thanks, Tip

_registry: dict[str, KindHandler] = {}


def register(handler: KindHandler) -> None:
    if handler.kind in _registry:
        raise ValueError(f"kind {handler.kind!r} is already registered")
    _registry[handler.kind] = handler


def get(kind: str) -> KindHandler:
    try:
        return _registry[kind]
    except KeyError:
        raise ValueError(f"unknown kind {kind!r}; known kinds: {sorted(_registry)}") from None


def all_kinds() -> list[str]:
    return sorted(_registry)


for _handler in (Thanks(), Tip(), Question()):
    register(_handler)

__all__ = [
    "Carry",
    "Effect",
    "Event",
    "KindHandler",
    "ReportLine",
    "TickContext",
    "all_kinds",
    "get",
    "register",
    "scrub",
]

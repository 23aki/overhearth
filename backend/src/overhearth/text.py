"""Small text helpers shared by the store and the kind handlers."""

from __future__ import annotations

import re

_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an and the of to for in on with my your our is are was it this that what how do does any some "
    "me i you we they at or be can".split()
)


def words(text: str) -> set[str]:
    """Lower-cased content words, used for cheap topic matching."""
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP}


def overlap(a: str, b: str) -> int:
    return len(words(a) & words(b))


MIN_RELEVANCE = 2
"""Below this, a tip is not a good enough match to offer as an answer."""


def relevance(query: str, topic: str, text: str) -> int:
    """How well a tip matches a query. Matching the tip's topic counts double."""
    return 2 * overlap(query, topic) + overlap(query, text)

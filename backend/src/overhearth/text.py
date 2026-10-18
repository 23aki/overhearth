"""Small text helpers shared by the store and the kind handlers."""

from __future__ import annotations

import re

_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an and the of to for in on with my your our is are was it this that what how do does any some "
    "me i you we they at or be can after before when while get getting got make help idea ideas thing "
    "things small little way ways keep good best about from into out up".split()
)


def _stem(word: str) -> str:
    """Fold simple plurals so "dinners" matches "dinner"."""
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def words(text: str) -> set[str]:
    """Lower-cased content words, used for cheap topic matching."""
    return {_stem(w) for w in _WORD.findall(text.lower()) if w not in _STOP}


def overlap(a: str, b: str) -> int:
    return len(words(a) & words(b))


MIN_RELEVANCE = 2
"""Below this, a tip is not a good enough match to offer as an answer."""


def relevance(query: str, topic: str, text: str) -> int:
    """How well a tip matches a query. Matching the tip's topic counts double."""
    return 2 * overlap(query, topic) + overlap(query, text)


MIN_ANSWER_RELEVANCE = 3
"""A tip only answers a question if it shares a topic word and clears this score."""


def answers(question: str, topic: str, text: str) -> bool:
    """Whether a tip is a real answer to a question, not just a word-overlap accident."""
    return overlap(question, topic) > 0 and relevance(question, topic, text) >= MIN_ANSWER_RELEVANCE

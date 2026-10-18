"""Small text helpers shared by the store and the kind handlers."""

from __future__ import annotations

import re

_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    "a an and the of to for in on with my your our is are was it this that what how do does any some "
    "me i you we they at or be can after before when while get getting got make help idea ideas thing "
    "things small little way ways keep good best about from into out up home".split()
)


def _stem(word: str) -> str:
    """Fold simple plurals and -ing forms so "dinners" matches "dinner" and "cooking" matches "cook"."""
    if len(word) > 5 and word.endswith("ing"):
        return word[:-3]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def words(text: str) -> set[str]:
    """Lower-cased content words, used for cheap topic matching."""
    return {_stem(w) for w in _WORD.findall(text.lower()) if w not in _STOP}


def overlap(a: str, b: str) -> int:
    return len(words(a) & words(b))


def relevance(query: str, topic: str, text: str, keywords: list[str] | None = None) -> int:
    """How well a tip matches a query. Matching the tip's topic or keywords counts double."""
    return 2 * overlap(query, " ".join([topic, *(keywords or [])])) + overlap(query, text)


MIN_ANSWER_RELEVANCE = 3
"""Score a tip needs before an avatar hands it over as the answer to a question."""
MIN_SEARCH_RELEVANCE = 2
"""Score a tip needs to appear in ask_town results, which are ranked and read top first."""


def answers(
    question: str,
    topic: str,
    text: str,
    keywords: list[str] | None = None,
    *,
    min_score: int = MIN_ANSWER_RELEVANCE,
) -> bool:
    """Whether a tip is a real answer to a question, not just a word-overlap accident.

    The question has to hit the tip's topic or keywords, and clear a minimum score.
    """
    about = " ".join([topic, *(keywords or [])])
    return overlap(question, about) > 0 and relevance(question, topic, text, keywords) >= min_score

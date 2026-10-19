"""One plain text completion, on whichever provider the town uses (Bedrock or the Claude API)."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Protocol

log = logging.getLogger(__name__)


class Writer(Protocol):
    def complete(self, system: str, user: str, *, max_tokens: int = 1200) -> str | None: ...


class BedrockWriter:
    def __init__(self) -> None:
        import boto3

        from overhearth.engine.dialogue import DEFAULT_MODEL_ID

        self._client = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        self._model_id = os.environ.get("OVERHEARTH_BEDROCK_MODEL", DEFAULT_MODEL_ID)

    def complete(self, system: str, user: str, *, max_tokens: int = 1200) -> str | None:
        try:
            response = self._client.converse(
                modelId=self._model_id,
                system=[{"text": system}],
                messages=[{"role": "user", "content": [{"text": user}]}],
                inferenceConfig={"maxTokens": max_tokens},
                additionalModelRequestFields={"thinking": {"type": "disabled"}},
            )
            return "".join(c.get("text", "") for c in response["output"]["message"]["content"])
        except Exception as error:
            log.warning("completion failed: %s", type(error).__name__)
            return None


class ClaudeWriter:
    def __init__(self) -> None:
        import anthropic

        from overhearth.engine.dialogue import DEFAULT_ANTHROPIC_MODEL_ID

        self._client = anthropic.Anthropic()
        self._model_id = os.environ.get("OVERHEARTH_ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL_ID)

    def complete(self, system: str, user: str, *, max_tokens: int = 1200) -> str | None:
        try:
            response = self._client.messages.create(
                model=self._model_id,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
                thinking={"type": "disabled"},
            )
            return "".join(block.text for block in response.content if block.type == "text")
        except Exception as error:
            log.warning("completion failed: %s", type(error).__name__)
            return None


def writer_from_env() -> Writer | None:
    provider = os.environ.get("OVERHEARTH_DIALOGUE", "template")
    if provider == "bedrock":
        return BedrockWriter()
    if provider == "anthropic":
        return ClaudeWriter()
    return None


def parse_json(reply: str | None) -> dict | None:
    """The first JSON object in a model's reply."""
    if not reply:
        return None
    match = re.search(r"\{.*\}", reply, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None

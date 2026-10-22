"""Alexa's voice: replies spoken by Amazon Polly, one neural voice per home language.

The browser asks the backend for the audio of a reply it has already received, so the text the
person sees is exactly the text that is spoken. A small cache keeps repeated lines (greetings,
"there's more on the town map") from going back to Polly.
"""

from __future__ import annotations

import hashlib
import logging
import os
from collections import OrderedDict
from typing import Protocol

log = logging.getLogger(__name__)

MAX_SPEECH_CHARS = 1500
"""Longer than any spoken report (they are kept under 30 seconds); Polly's own limit is 3000."""

VOICES: dict[str, tuple[str, str]] = {
    "en": ("en-US", "Danielle"),
    "ja": ("ja-JP", "Kazuha"),
    "es": ("es-MX", "Mia"),
    "fr": ("fr-FR", "Lea"),
    "ko": ("ko-KR", "Seoyeon"),
    "pt": ("pt-BR", "Camila"),
    "de": ("de-DE", "Vicki"),
    "zh": ("cmn-CN", "Zhiyu"),
}
"""Language: (Polly language code, neural voice)."""


class Speaker(Protocol):
    def speak(self, text: str, language: str) -> bytes | None:
        """MP3 audio of the text in the language's voice, or None if it could not be made."""
        ...


class PollySpeaker:
    def __init__(self, *, region: str | None = None, cache_size: int = 128) -> None:
        import boto3

        self._client = boto3.client("polly", region_name=region or os.environ.get("AWS_REGION", "us-east-1"))
        self._cache: OrderedDict[str, bytes] = OrderedDict()
        self._cache_size = cache_size

    def speak(self, text: str, language: str) -> bytes | None:
        code, voice = VOICES.get(language, VOICES["en"])
        key = hashlib.sha256(f"{voice}\n{text}".encode()).hexdigest()
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        try:
            response = self._client.synthesize_speech(
                Engine="neural",
                LanguageCode=code,
                VoiceId=voice,
                OutputFormat="mp3",
                SampleRate="24000",
                Text=text[:MAX_SPEECH_CHARS],
            )
            audio = response["AudioStream"].read()
        except Exception as error:
            log.warning("speech failed: %s", type(error).__name__)
            return None
        self._cache[key] = audio
        if len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return audio


def speaker_from_env() -> Speaker | None:
    """OVERHEARTH_TTS=polly; otherwise none, and the browser speaks with its own voices."""
    return PollySpeaker() if os.environ.get("OVERHEARTH_TTS") == "polly" else None

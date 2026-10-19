"""Pictures for the diary: drawing them (OpenAI image generation) and keeping them (files or S3)."""

from __future__ import annotations

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Protocol

log = logging.getLogger(__name__)

DEFAULT_IMAGE_MODEL = "gpt-image-2.5"


class Painter(Protocol):
    def paint(self, prompt: str) -> bytes | None: ...


class OpenAIPainter:
    """OpenAI's image API, called with the standard library (no extra dependency)."""

    def __init__(self, api_key: str, *, model: str | None = None, size: str = "1536x1024") -> None:
        self.api_key = api_key
        self.model = model or os.environ.get("OVERHEARTH_IMAGE_MODEL", DEFAULT_IMAGE_MODEL)
        self.size = size

    def paint(self, prompt: str) -> bytes | None:
        body = json.dumps({"model": self.model, "prompt": prompt, "size": self.size, "n": 1}).encode()
        request = urllib.request.Request(
            "https://api.openai.com/v1/images/generations",
            data=body,
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                data = json.loads(response.read())
        except urllib.error.HTTPError as error:
            log.warning("image generation failed: HTTP %s %s", error.code, error.read()[:300])
            return None
        except Exception as error:
            log.warning("image generation failed: %s", type(error).__name__)
            return None
        item = (data.get("data") or [{}])[0]
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"])
        if item.get("url"):
            with urllib.request.urlopen(item["url"], timeout=60) as response:
                return response.read()
        return None


def painter_from_env() -> Painter | None:
    key = os.environ.get("OPENAI_API_KEY")
    return OpenAIPainter(key) if key else None


class ImageStore(Protocol):
    def save(self, name: str, data: bytes) -> str:
        """Keep a PNG and return the URL people's screens load it from."""
        ...


class LocalImageStore:
    """Files on disk, served by the backend at /diary/<name> (local development)."""

    def __init__(self, folder: Path, base_url: str) -> None:
        self.folder = folder
        self.base_url = base_url.rstrip("/")

    def save(self, name: str, data: bytes) -> str:
        self.folder.mkdir(parents=True, exist_ok=True)
        (self.folder / name).write_bytes(data)
        return f"{self.base_url}/diary/{name}"

    def read(self, name: str) -> bytes | None:
        path = self.folder / name
        return path.read_bytes() if path.is_file() and path.parent == self.folder else None


class S3ImageStore:
    """An S3 bucket served by CloudFront under /diary/ (the deployment)."""

    def __init__(self, bucket: str, base_url: str) -> None:
        import boto3

        self.bucket = bucket
        self.base_url = base_url.rstrip("/")
        self.client = boto3.client("s3")

    def save(self, name: str, data: bytes) -> str:
        self.client.put_object(Bucket=self.bucket, Key=f"diary/{name}", Body=data, ContentType="image/png")
        return f"{self.base_url}/diary/{name}"


def image_store_from_env() -> ImageStore:
    bucket = os.environ.get("OVERHEARTH_DIARY_BUCKET")
    base = os.environ.get("OVERHEARTH_DIARY_BASE_URL", "http://127.0.0.1:8000")
    if bucket:
        return S3ImageStore(bucket, base)
    return LocalImageStore(Path(os.environ.get("OVERHEARTH_DIARY_DIR", ".diary")).resolve(), base)

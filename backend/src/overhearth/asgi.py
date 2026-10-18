"""ASGI entry point, used by uvicorn locally and by the Lambda Web Adapter in AWS."""

from __future__ import annotations

import os

from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

from overhearth.dev_seed import seeded_store
from overhearth.mcp_server import build_server
from overhearth.store import Store


def _store_from_env() -> Store:
    backend = os.environ.get("OVERHEARTH_STORE", "memory")
    if backend == "memory":
        return seeded_store()
    raise ValueError(f"unsupported OVERHEARTH_STORE={backend!r}")


def create_app(store: Store | None = None) -> ASGIApp:
    server = build_server(store or _store_from_env())

    @server.custom_route("/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    app = server.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        host=os.environ.get("OVERHEARTH_HOST", "127.0.0.1"),
    )
    origins = [o.strip() for o in os.environ.get("OVERHEARTH_ALLOWED_ORIGINS", "*").split(",") if o.strip()]
    return CORSMiddleware(
        app,
        allow_origins=origins,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["authorization", "content-type", "mcp-protocol-version", "mcp-session-id"],
        expose_headers=["mcp-session-id"],
    )


app = create_app()

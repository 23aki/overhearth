"""ASGI entry point, used by uvicorn locally and by the Lambda Web Adapter in AWS."""

from __future__ import annotations

import os
from dataclasses import asdict

import anyio
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

from overhearth.dev_seed import seeded_store
from overhearth.engine import dialogue_from_env, run_tick
from overhearth.mcp_server import build_server
from overhearth.store import Store
from overhearth.town_seed import seeded_town


def _store_from_env() -> Store:
    backend = os.environ.get("OVERHEARTH_STORE", "memory")
    if backend != "memory":
        raise ValueError(f"unsupported OVERHEARTH_STORE={backend!r}")
    seed = os.environ.get("OVERHEARTH_SEED", "town")
    if seed == "town":
        return seeded_town()
    if seed == "dev":
        return seeded_store()
    raise ValueError(f"unsupported OVERHEARTH_SEED={seed!r}")


def create_app(store: Store | None = None) -> ASGIApp:
    if store is None:
        store = _store_from_env()
    server = build_server(store)

    @server.custom_route("/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    if os.environ.get("OVERHEARTH_DEV_ENDPOINTS") == "1":
        dialogue = dialogue_from_env()

        @server.custom_route("/dev/tick", methods=["POST"])
        async def dev_tick(_: Request) -> JSONResponse:
            """Advance town time once. Development and demo only, never enabled by default."""
            result = await anyio.to_thread.run_sync(lambda: run_tick(store, dialogue))
            return JSONResponse(asdict(result))

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

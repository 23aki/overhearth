"""ASGI entry point, used by uvicorn locally and by the Lambda Web Adapter in AWS."""

from __future__ import annotations

import logging
import os
from dataclasses import asdict

import anyio
from pydantic import ValidationError
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

from overhearth.assistant import RateLimiter, TurnRequest, assistant_from_env, tool_defs, trim
from overhearth.engine import dialogue_from_env, run_tick
from overhearth.mcp_server import build_server
from overhearth.oauth import BearerGate, install_oauth_routes
from overhearth.store import Store
from overhearth.store.env import store_from_env

log = logging.getLogger(__name__)

DEV_TICK_INTERVAL_SECONDS = float(os.environ.get("OVERHEARTH_DEV_TICK_INTERVAL", "30"))


def create_app(store: Store | None = None) -> ASGIApp:
    if store is None:
        store = store_from_env()
    server = build_server(store)

    @server.custom_route("/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    install_oauth_routes(server, store)

    assistant = assistant_from_env()
    limiter = RateLimiter()

    @server.custom_route("/assistant/turn", methods=["POST"])
    async def assistant_turn(request: Request) -> JSONResponse:
        """One turn of the simulated Alexa+ layer. The browser runs the tool calls over MCP."""
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        if scheme.lower() != "bearer" or store.household_for_token(token) is None:
            return JSONResponse({"error": "This Alexa account is not linked to Overhearth yet."}, status_code=401)
        if not limiter.allow(token):
            return JSONResponse({"error": "Too many requests. Try again later."}, status_code=429)
        try:
            body = TurnRequest.model_validate(await request.json())
        except (ValueError, ValidationError):
            return JSONResponse({"error": "Malformed turn."}, status_code=400)
        tools = tool_defs(await server.list_tools())
        try:
            result = await anyio.to_thread.run_sync(lambda: assistant.turn(trim(body.messages), tools))
        except Exception as error:  # the model call failed; the client shows a polite message
            log.warning("assistant turn failed: %s", type(error).__name__)
            return JSONResponse({"error": "Alexa could not answer just now."}, status_code=502)
        return JSONResponse(result.model_dump())

    if os.environ.get("OVERHEARTH_DEV_ENDPOINTS") == "1":
        dialogue = dialogue_from_env()
        tick_limiter = RateLimiter(limit=1, window_seconds=DEV_TICK_INTERVAL_SECONDS)
        tick_lock = anyio.Lock()

        @server.custom_route("/dev/tick", methods=["POST"])
        async def dev_tick(request: Request) -> JSONResponse:
            """Advance town time once, for demos. Off by default.

            Needs a linked home's token, and runs at most once per interval for the whole town,
            because each tick calls the model for every encounter.
            """
            scheme, _, token = request.headers.get("authorization", "").partition(" ")
            if scheme.lower() != "bearer" or store.household_for_token(token) is None:
                return JSONResponse({"error": "Link a home first."}, status_code=401)
            if tick_lock.locked() or not tick_limiter.allow("town"):
                return JSONResponse({"error": "The town is still busy. Try again in a moment."}, status_code=429)
            async with tick_lock:
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
        BearerGate(app, store),
        allow_origins=origins,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["authorization", "content-type", "mcp-protocol-version", "mcp-session-id"],
        expose_headers=["mcp-session-id"],
    )


app = create_app()

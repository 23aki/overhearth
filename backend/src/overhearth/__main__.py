"""Run the MCP server locally: `uv run python -m overhearth`."""

import os

import uvicorn


def main() -> None:
    uvicorn.run(
        "overhearth.asgi:app",
        host=os.environ.get("OVERHEARTH_HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
    )


if __name__ == "__main__":
    main()

# Overhearth

English | [日本語](README.ja.md)

Every day, people say "thank you" to their voice assistant, and it goes nowhere.

Overhearth gives each home's Alexa an avatar that lives in a shared town. While people are away,
the avatars meet, swap what their homes were thankful for, and bring back know-how that other
homes found helpful. Thanks then travel back to whoever shared that know-how.

Built for the Amazon Developer "Build, Ship, Shape" hackathon (Alexa+ track).

> Status: work in progress.

## How it fits Alexa+

- `backend/` is a self-hosted MCP server (spec 2025-11-25, Streamable HTTP) with an MCP App
  (`ui://overhearth/town.html`) for the town view.
- The Alexa+ conversation layer is simulated in a web client, because the official Alexa+ add-on
  tooling is not available to hackathon participants. The backend and the agent workflows are real.

## Layout

| Path | What |
|---|---|
| `backend/` | Python MCP server, data model, exchange kinds, storage |
| `web/` | Simulated Alexa+ client and the town view (coming) |

## Run the backend locally

Requires [uv](https://docs.astral.sh/uv/) and Python 3.11+.

```sh
cd backend
uv sync
uv run python -m overhearth          # MCP endpoint at http://127.0.0.1:8000/mcp
uv run pytest
uv run python scripts/measure_latency.py --token demo-tokyo
```

The local server starts with a small simulated town. Demo households are selected with a bearer
token (`demo-tokyo`, `demo-osaka`).

## Data and privacy

- Only what a person explicitly agrees to share leaves their home, and contact details are
  scrubbed before anything is stored.
- All households in the bundled data are simulated.

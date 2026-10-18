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

The local server starts with the demo town: 4 demo households and 30 background households, all
simulated (`backend/src/overhearth/fixtures/town.json`). Demo households are selected with a bearer
token: `demo-tokyo`, `demo-osaka`, `demo-seattle`, `demo-austin`.

### Town engine

Each tick, avatars that are out pair up, talk, and pass on what their homes shared. Dialogue is
generated with [Strands Agents](https://strandsagents.com) on Amazon Bedrock (Claude Haiku 5.5 by
default), or with a fixed template offline.

```sh
uv run python -m overhearth.engine --ticks 2              # offline, template dialogue
uv run python -m overhearth.engine --ticks 1 --bedrock    # Bedrock (uses your AWS credentials)

# Advance town time from the running server (development only):
OVERHEARTH_DEV_ENDPOINTS=1 OVERHEARTH_DIALOGUE=bedrock uv run python -m overhearth
curl -X POST http://127.0.0.1:8000/dev/tick
```

| Variable | Default | Meaning |
|---|---|---|
| `OVERHEARTH_DIALOGUE` | `template` | `bedrock` to generate dialogue with Strands Agents on Bedrock |
| `OVERHEARTH_BEDROCK_MODEL` | `global.anthropic.claude-haiku-5-5` | Bedrock model or inference profile id |
| `OVERHEARTH_SEED` | `town` | `town` for the demo town, `dev` for a tiny town used in tests |
| `OVERHEARTH_DEV_ENDPOINTS` | unset | `1` enables `POST /dev/tick` |
| `AWS_REGION` | `us-east-1` | Region for Bedrock |

## Data and privacy

- Only what a person explicitly agrees to share leaves their home, and contact details are
  scrubbed before anything is stored.
- All households in the bundled data are simulated.

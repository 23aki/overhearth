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
| `web/` | Simulated Alexa+ client (TypeScript, Vite): an Echo Show-like page that is a real MCP client |

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

## Run the simulated Alexa+ client

Requires Node 22+.

```sh
# terminal 1: backend with Bedrock for the Alexa layer and the avatars' dialogue
cd backend
OVERHEARTH_ASSISTANT=bedrock OVERHEARTH_DIALOGUE=bedrock OVERHEARTH_DEV_ENDPOINTS=1 uv run python -m overhearth

# terminal 2: web client at http://localhost:5173
cd web
cp .env.example .env.local
npm install
npm run dev
```

How a turn works:

1. The page sends what the person said to `POST /assistant/turn`. The backend plays the Alexa+
   part with Bedrock (Claude Haiku 5.5): it picks Overhearth tools or words the reply. The tool list
   comes from the MCP server itself, not from the browser.
2. The page runs the chosen tools over MCP (Streamable HTTP, protocol 2025-11-25) with the
   household's token, and sends the results back.
3. The reply is spoken with the browser's speech synthesis. Voice input uses the Web Speech API
   where available; typing always works.

### The town view (MCP App)

Say "show me the town". `open_town` points at the `ui://overhearth/town.html` resource, and the page
acts as the MCP Apps host the way Alexa+ would on an Echo Show: it reads the resource, renders it in
a sandboxed iframe, and bridges it to the MCP server with `@modelcontextprotocol/ext-apps`.

- The view loads the town through the host (`tools/call get_town_state`, a tool only the view can
  see) and replays the latest town time: who met whom, and thanks travelling back to the home
  whose know-how helped.
- "Ask Alexa for the news" sends a `ui/message`, so the view can start a turn as the person.
- It can ask the host for full screen.

The view's source is in `web/town/`. It is built into one HTML file that the backend serves, and
the built file is committed:

```sh
cd web
npm run build:town   # writes backend/src/overhearth/ui/town.html
```

| Variable | Default | Meaning |
|---|---|---|
| `OVERHEARTH_ASSISTANT` | follows `OVERHEARTH_DIALOGUE` | `bedrock` for the Alexa layer on Bedrock; otherwise simple keyword rules |
| `VITE_BACKEND_URL` (web) | `http://127.0.0.1:8000` | Backend base URL |
| `VITE_DEV_TICK` (web) | unset | `1` shows the "Advance town time" button |

## Household account linking (OAuth)

Each home is identified by its own bearer token, the way Alexa+ links an account to an MCP server.
The demo households use pre-issued tokens, so nobody has to sign in to try the demo. A real home is
linked with OAuth 2.1:

- `GET /.well-known/oauth-protected-resource` (RFC 9728, also at `.../oauth-protected-resource/mcp`)
  names the MCP endpoint and the authorization server.
- `GET /.well-known/oauth-authorization-server` lists the endpoints and `S256` as the only PKCE method.
- `/authorize` asks the person for an avatar name and a short description of the home, then creates
  the household. `/token` handles the authorization code (PKCE required), refresh tokens (rotated on
  every use) and `client_credentials` for confidential clients.
- `/mcp` without a valid token gets a 401 with no `WWW-Authenticate` header, as the Alexa+ checklist
  asks. Clients find the authorization server through the resource metadata.
- Only hashes of tokens and codes are stored. Access tokens last 1 hour, refresh tokens 30 days.

In the web client, pick "Link your own home…" in the home menu to run the flow.

| Variable | Default | Meaning |
|---|---|---|
| `OVERHEARTH_PUBLIC_URL` | from the request | Public origin used in the metadata (set it behind a proxy or API gateway) |
| `OVERHEARTH_WEB_REDIRECTS` | `http://localhost:5173/,http://127.0.0.1:5173/` | Redirect URIs allowed for the web client |
| `OVERHEARTH_OAUTH_CLIENTS` | unset | JSON list of confidential clients: `client_id`, `client_secret`, `redirect_uris`, `name`. Keep it out of the repository |

## Data and privacy

- Only what a person explicitly agrees to share leaves their home, and contact details are
  scrubbed before anything is stored.
- All households in the bundled data are simulated.

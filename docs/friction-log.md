# Friction log

What got in our way while building Overhearth for the Amazon "Build, Ship, Shape" hackathon
(Alexa+ track), between 2026-10-17 and 2026-10-23. Every entry happened in this project. They are
sorted by severity:

- **High**: blocked a goal.
- **Medium**: cost hours or would have broken the hosted demo.
- **Low**: an annoyance.

## Summary

| # | Area | Severity |
|---|---|---|
| 1 | Alexa+ AI developer tools are not accessible | High |
| 2 | Alexa+ "no `WWW-Authenticate`" rule vs. the MCP spec and AgentCore Runtime | High |
| 3 | Requirements spread over secondary sources; hackathon pages disagree | Medium |
| 4 | `GET /mcp` stream on API Gateway + Lambda hangs and crashes the instance | Medium |
| 5 | Python MCP app cold start vs. the 500 ms voice budget | Medium |
| 6 | MCP Python SDK: DNS-rebinding protection silently on by default | Medium |
| 7 | `strands-agents` pins `mcp<2.2`; resolver picks an empty placeholder | Medium |
| 8 | MCP Python SDK: a tool returning `dict` has no `structuredContent` | Medium |
| 9 | Strands + Bedrock structured output hits MaxTokensReached | Medium |
| 10 | First `cdk deploy` on a fresh account: bootstrap needs admin rights | Medium |
| 11 | Long work (image generation) vs. API Gateway's 29 s timeout | Low |
| 12 | Lambda zip built on Windows loses the executable bit | Low |
| 13 | Image model output too large for an Echo Show-sized view | Low |

---

## 1. Alexa+ AI developer tools are not accessible

- **Task:** Build an Alexa+ add-on (MCP integration) and test it on a real Echo Show.
- **Steps:** Followed the Alexa+ AI developer tools getting-started guide, then tried to install
  the CLI from the package repository.
- **Expected:** Install the tools, deploy the MCP server as an add-on, test it on a device.
- **Actual:** The package repository needs a specific role (`AddOn3PDeveloperToolsRead`). The
  judges confirmed on the forum that there is no hackathon access.
- **Severity:** High.
- **Workaround:** Took the allowed simulated route, keeping the simulation honest: a real MCP
  client and MCP Apps host (`ext-apps` AppBridge) in the browser on an Echo Show-like screen, and an
  "Alexa layer" on Amazon Bedrock that picks tools from the server's own tool list.
- **Suggestion:** Give hackathon participants access to the tools, or publish a public Alexa+
  simulator (tool selection, voice timing, MCP Apps display modes).

## 2. Alexa+ "no `WWW-Authenticate`" rule vs. the MCP spec and AgentCore Runtime

- **Task:** Host the MCP server on Amazon Bedrock AgentCore Runtime with OAuth account linking.
- **Steps:** Read the Alexa+ MCP checklist and the MCP authorization spec, then tried an AgentCore
  Runtime design.
- **Expected:** One auth setup that satisfies both Alexa+ and the MCP spec.
- **Actual:**
  - The Alexa+ checklist says to send no `WWW-Authenticate` on 401. MCP auth discovery and AgentCore
    Runtime both rely on that header.
  - The 500 ms tool budget also leaves no room for AgentCore Runtime's first-request latency on a
    new session.
- **Severity:** High (it ruled AgentCore Runtime out for the tools).
- **Workaround:** API Gateway + Lambda for the MCP server, with Protected Resource Metadata
  (RFC 9728) at the root for discovery. The background engine, which has no latency budget, is the
  part that could move to AgentCore.
- **Suggestion:** Document how Alexa+ discovers OAuth without `WWW-Authenticate`, and give an
  AgentCore Runtime recipe that meets the Alexa+ checklist.

## 3. Requirements spread over secondary sources; hackathon pages disagree

- **Task:** Find out exactly what an Alexa+ submission needs and how long to keep it hosted.
- **Steps:** Read the rules, FAQ, resources page and forum.
- **Expected:** One consistent source.
- **Actual:**
  - Judging dates differ between pages (10/26 vs. 11/9), and so does the reviewer list.
  - The FAQ says hosting is not needed, while a judge on the forum says to keep it running.
  - OAuth / RFC 9728 requirements appear only in secondary sources.
- **Severity:** Medium.
- **Workaround:** Took the safe side: implemented OAuth 2.1 + PKCE fully, and host until the end
  of judging (2026-11-20).
- **Suggestion:** One canonical page for dates, requirements and hosting expectations, linked from
  the others.

## 4. `GET /mcp` stream on API Gateway + Lambda hangs and crashes the instance

- **Task:** Serve the MCP server (Streamable HTTP) from Lambda behind API Gateway.
- **Steps:** Deployed with the Lambda Web Adapter and connected the official TypeScript MCP client.
- **Expected:** The client's optional `GET /mcp` (server-to-client SSE) fails fast or is skipped.
- **Actual:**
  - The request hung for ~29.5 s and returned a 500 without CORS headers, which the browser
    reported as a CORS error.
  - It also crashed the Lambda Web Adapter, so the next call paid a ~4 s cold start.
- **Severity:** Medium (slow, flaky first interactions on the hosted demo).
- **Workaround:** Answer `GET /mcp` with 405, which the spec allows for servers without a GET
  stream.
- **Suggestion:** Note this in the MCP SDKs' deployment docs for serverless hosts, or let the
  server disable the GET stream with one option.

## 5. Python MCP app cold start vs. the 500 ms voice budget

- **Task:** Keep every MCP tool call under Alexa+'s 500 ms budget on Lambda.
- **Steps:** Measured after deploying.
- **Expected:** Warm and cold calls both well under budget.
- **Actual:**
  - A warm call takes ~10 ms in Lambda (median 9 ms, max 227 ms).
  - A cold start of the Python app takes ~3.4–4 s.
- **Severity:** Medium.
- **Workaround:** One provisioned-concurrency instance on a `live` alias, at a steady monthly cost.
- **Suggestion:** Document a low-cost pattern for keeping voice-facing MCP servers warm.

## 6. MCP Python SDK: DNS-rebinding protection silently on by default

- **Task:** Run the same MCP server locally and behind API Gateway.
- **Steps:** Kept the SDK's default `host` (`127.0.0.1`).
- **Expected:** Host checks only when configured.
- **Actual:**
  - With the default host, the SDK turns on DNS-rebinding protection and accepts only localhost
    `Host`/`Origin`.
  - Nothing fails locally, but behind API Gateway every `/mcp` call would get 421/403.
- **Severity:** Medium (caught in code review before deploying).
- **Workaround:** Explicit `TransportSecuritySettings` with the public host and the web origin,
  plus a test with a non-local `Host`.
- **Suggestion:** Log a warning when the protection is enabled implicitly, and mention it in the
  deployment docs.

## 7. `strands-agents` pins `mcp<2.2`; resolver picks an empty placeholder

- **Task:** Use Strands Agents with the latest MCP Python SDK.
- **Steps:** Added `strands-agents` next to `mcp>=2.3` and ran `uv sync`.
- **Expected:** A clear resolution error.
- **Actual:** uv resolved `strands-agents==0.0.1`, an empty placeholder package, without an error.
  The result was import errors that looked unrelated.
- **Severity:** Medium.
- **Workaround:** Pinned `mcp>=2.1,<2.2`.
- **Suggestion:** Widen Strands' `mcp` range, or yank or mark the placeholder so resolvers never
  choose it.

## 8. MCP Python SDK: a tool returning `dict` has no `structuredContent`

- **Task:** Feed an MCP App view from an app-only tool.
- **Steps:** Annotated the tool `-> dict` and returned the town state.
- **Expected:** `structuredContent` with the dict.
- **Actual:** No `structuredContent` and no warning. The view showed "not reachable".
- **Severity:** Medium.
- **Workaround:** Return a Pydantic model.
- **Suggestion:** Treat dicts as structured output, or warn when a tool's return type yields no
  `structuredContent`.

## 9. Strands + Bedrock structured output hits MaxTokensReached

- **Task:** Generate each encounter's dialogue as structured output on Bedrock.
- **Steps:** Used `structured_output_model` with default settings. Later, each line also carried
  an English translation.
- **Expected:** Short outputs fit the defaults.
- **Actual:** MaxTokensReached with thinking on, and again once lines carried translations.
  Dialogue fell back to templates.
- **Severity:** Medium.
- **Workaround:** `max_tokens=2000` and thinking disabled explicitly.
- **Suggestion:** Size defaults for structured output, and an error that names the setting to
  change.

## 10. First `cdk deploy` on a fresh account: bootstrap needs admin rights

- **Task:** Deploy the CDK stack with a narrowly scoped IAM identity.
- **Steps:** `cdk deploy` with an identity limited to the stack's resources.
- **Expected:** A clear message that the account needs bootstrapping, and the least privilege to
  do it.
- **Actual:** It failed on a missing bootstrap bucket. Bootstrapping needed rights the identity did
  not have.
- **Severity:** Medium (deploy blocked until an admin stepped in).
- **Workaround:** Temporarily granted admin to bootstrap, then went back to a narrow policy checked
  with `cdk diff`.
- **Suggestion:** Publish a least-privilege policy for `cdk bootstrap` and `cdk deploy`.

## 11. Long work (image generation) vs. API Gateway's 29 s timeout

- **Task:** A demo button that draws today's picture diary on demand.
- **Steps:** Called the image model from the API Lambda.
- **Expected:** The picture in one request.
- **Actual:** A picture takes longer than API Gateway's 29 s integration timeout.
- **Severity:** Low.
- **Workaround:** The API invokes the tick Lambda asynchronously. The picture lands in S3, and Alexa
  offers it on the next turn.
- **Suggestion:** A documented async pattern (or response streaming) for long work behind HTTP APIs.

## 12. Lambda zip built on Windows loses the executable bit

- **Task:** Package the app with the Lambda Web Adapter's `run.sh` entry script.
- **Steps:** Zipped the build on Windows.
- **Expected:** `run.sh` executable in Lambda.
- **Actual:** The executable bit was dropped, so the function would fail at cold start.
- **Severity:** Low (caught before deploying).
- **Workaround:** Build the zip in Python with explicit file modes.
- **Suggestion:** Have CDK asset bundling set modes, or warn about it on Windows.

## 13. Image model output too large for an Echo Show-sized view

- **Task:** Show the picture diary in an MCP App.
- **Steps:** Saved the image model's default PNG to S3 behind CloudFront.
- **Expected:** A light image for a small screen.
- **Actual:** ~3.5 MB per picture, and a slow diary view.
- **Severity:** Low.
- **Workaround:** Ask for WebP at 80% quality (~250–450 KB), with a PNG fallback.
- **Suggestion:** None for AWS. A note for builders: pick formats for the device.

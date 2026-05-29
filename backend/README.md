# agent-market-place / backend

> **Status (2026-05-29): v1 decided — this folder stays empty on purpose.** The agent loop shipped **server-side inside nemo-backend** (`nemo-router-mono-repo/03-nemo-backend/nemo_backend/mcp_gateway/agent_runtime.py`) — i.e. **Option B below was chosen**, but folded into the existing nemo-backend process rather than a separate Cloud Run service (no new service / no new hostname). The reusable *client* runtime lives in `../frontend/src/core.ts` (`@nemorouter/agent-runtime`). The design notes below are retained as the Phase-2 roadmap (e.g. if a standalone runtime service is ever extracted). SoT: mono-repo skill `nemo-mcp-gateway`.
> **License:** MIT (`LICENSE` at repo root).

## What "backend" means here

This is NOT an API service. It's an **agent runtime** — a library/package that:

- Receives a customer's chat message (from the pluggable widget or playground)
- Calls `POST /v1/agents/sessions/{id}/messages` on the existing `nemo-backend:8090` gateway
- Drives the agent loop (LLM call → tool call → LLM call → ... → final message)
- Streams partial responses back to the widget

It has **zero externally callable endpoints**. Customers never hit this code directly — they hit `api.nemorouter.ai` (which is the existing Nemo Backend, with new routes added per `amp-mcp-gateway`).

## Two deployment shapes (TBD — open question in `docs/design.md` §8)

### Option A — Browser-side runtime (in the widget)

- The widget bundles the runtime. Each chat turn = the customer's browser calls `POST /v1/agents/sessions/{id}/messages` directly.
- Server-side cost: zero. No agent-runtime service to run.
- Trade-off: the agent loop holds the virtual key in the browser. Same security profile as Playground today, but agents make many more calls than a single chat — more exposure window.

### Option B — Server-side runtime (Cloud Run service in `<gcp-project>`)

- A small FastAPI app inside `<gcp-project>` that holds the agent session, drives the loop, and proxies streamed output to the widget via SSE.
- The widget calls `agent-runtime-svc → nemo-backend`. The customer still uses their `sk-nemo-xxx`, but it travels customer → runtime → nemo-backend.
- Trade-off: adds one Cloud Run service to operate. But: zero virtual-key exposure in browser DOM (it sits in the customer's session cookie scoped to `nemorouter.ai` only).

**Decision required before any code lands.** Captured in `amp-agent-runtime/references/agent-loop.md`.

## What this folder does NOT do

- Does not expose new API endpoints to external callers.
- Does not store tool credentials (those live in `super_admin.tool_accounts`).
- Does not bill customers (billing happens server-side in nemo-backend's new MCP routes).
- Does not validate virtual keys (existing nemo-backend middleware does that).

## Stack (likely — TBD)

- Language: Python (matches `nemo-backend`) for option B, OR TypeScript (matches widget) for option A.
- Streaming: SSE for option B, fetch-streams for option A.
- Session state: Redis (existing nemo-backend cache) keyed by `session_id`.

## Open source

MIT-licensed. The runtime drives every agent loop — including the Nemo Support Agent we run on our own site. Fork it if you want a different loop discipline; the gateway will accept your calls the same way it accepts ours. See `../CONTRIBUTING.md` for what kinds of changes belong here vs. in the Nemo Router monorepo.

## Related skills

- `~/nemorouter/agent-market-place/.claude/skills/amp-agent-runtime/SKILL.md` — the loop, session model, streaming
- `~/nemorouter/agent-market-place/.claude/skills/amp-mcp-gateway/SKILL.md` — the routes this runtime calls
- `~/nemorouter/agent-market-place/.claude/skills/amp-billing-observability/SKILL.md` — how cost & traces emit
- `~/nemorouter/agent-market-place/.claude/skills/amp-architecture/references/nemo-support-agent-dogfood.md` — the canonical first deployment of this runtime
- `~/nemorouter/agent-market-place/.claude/skills/amp-architecture/references/open-source-boundary.md` — what changes can land here vs. the Nemo monorepo

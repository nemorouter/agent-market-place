---
name: amp-central-tool-layer
description: Use when positioning the MCP gateway as THE central tool layer for the entire Nemo Router ecosystem — not just the agent-market-place widget. Defines the seven consumers (widget, playground, support agent, Dify plugin, Onyx integration, customer-written agents in any framework, native MCP clients), the dual wire-protocol strategy (REST v1 → MCP-JSON-RPC v2), and the universal auth model (one sk-nemo-xxx works for every consumer). Load before proposing any new tool-orchestration surface that bypasses /v1/mcp/*.
metadata:
  type: positioning-and-strategy
  status: TODO
  owner: surasani.rama@gmail.com
---

# amp-central-tool-layer — One gateway, every agent surface

> **Status:** TODO. No code. Positioning skill — explains *why* every agent in the Nemo ecosystem (ours and the community's) should funnel through `/v1/mcp/tools/*`, and what that buys.

## The thesis

The MCP gateway designed in `amp-mcp-gateway` (`/v1/mcp/tools/*` + the 11-step contract) is not specific to the marketplace widget. It is **the** central tool layer for any agent — anywhere in the Nemo ecosystem — that authenticates with a Nemo Router virtual key.

Build it once, in `nemo-backend/mcp_gateway/`. Consume it from seven different surfaces. Add a new tool once, get it everywhere.

```
                       ┌─────────────────────────────────────────┐
                       │   Nemo MCP Gateway (central)            │
                       │   nemo-backend/mcp_gateway/            │
                       │                                         │
                       │   GET  /v1/mcp/tools                    │
                       │   POST /v1/mcp/tools/{id}/call          │
                       │   POST /v1/mcp/jsonrpc      (v2)        │
                       │                                         │
                       │   ✓ one vault                           │
                       │   ✓ one credit ledger                   │
                       │   ✓ one guardrail engine                │
                       │   ✓ one trace pipeline                  │
                       │   ✓ one audit log                       │
                       │   ✓ one pricing schedule                │
                       └─────────▲───────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
   ┌──────────┴───────┐ ┌────────┴────────┐ ┌───────┴────────┐
   │ Our surfaces     │ │ Sibling repos   │ │ Third-party    │
   │ (this repo)      │ │ (public)        │ │ (community)    │
   │                  │ │                 │ │                │
   │ • widget         │ │ • dify-integ    │ │ • LangChain    │
   │ • playground     │ │ • onyx-integ    │ │ • LlamaIndex   │
   │ • support agent  │ │                 │ │ • AutoGen      │
   │                  │ │                 │ │ • Vercel AI SDK│
   │                  │ │                 │ │ • raw curl     │
   │                  │ │                 │ │ • Claude       │
   │                  │ │                 │ │   Desktop      │
   │                  │ │                 │ │ • Cursor       │
   │                  │ │                 │ │ • any MCP-     │
   │                  │ │                 │ │   compliant    │
   │                  │ │                 │ │   host         │
   └──────────────────┘ └─────────────────┘ └────────────────┘
```

Every arrow goes to the same routes, with the same `sk-nemo-xxx` virtual key.

## What this skill OWNS

- **The positioning** — "central tool layer," not "marketplace-only gateway." Defends against scope drift that would re-fragment tool orchestration.
- **The consumer matrix** — who uses the gateway, how they authenticate, what payload they send, what they get back. Lives in `references/consumer-matrix.md`.
- **The dual wire-protocol strategy** — v1 REST routes for widget/Dify/Onyx/curl/SDK consumers; v2 adds MCP-JSON-RPC native for Claude Desktop / Cursor / any MCP-compliant host. Same backend, two wire formats. Lives in `references/mcp-protocol-native.md`.
- **The universal auth model** — `sk-nemo-xxx` works identically across all consumers. Lives in `references/auth-model.md`.
- **The rollout sequencing** — v1 REST first, v2 MCP-native after stable, v3 ecosystem repo migrations. Lives in `references/rollout-sequencing.md`.

## What this skill does NOT own

- The route implementation, schema, vault — `amp-mcp-gateway`
- The agent loop that calls tools — `amp-agent-runtime`
- The widget UI — `amp-frontend-widget`
- Pricing + ledger integration — `amp-billing-observability`
- Cross-ecosystem repo design (Dify plugin internals, Onyx fork shape) — sibling skills `nemo-dify` and `nemo-onyx`/`nemo-onyx-agents`

This skill is the umbrella that ties them together for one positioning story.

## The seven consumers (quick reference — details in `references/consumer-matrix.md`)

| # | Consumer | Where it lives | How it talks to the gateway | Phase |
|---|---|---|---|---|
| 1 | **agent-market-place widget** | This repo, `frontend/` | Server-side via `/v1/agents/sessions/*` → internal call to `/v1/mcp/tools/*` | v1 launch |
| 2 | **agent-market-place playground** | `01-frontend-end/[organization]/agent-playground/` | Same as widget (shared runtime) | v1 launch |
| 3 | **Nemo Support Agent** | `nemorouter.ai/*` | Same widget runtime, same gateway | v1 launch (dogfood) |
| 4 | **`dify-integration`** plugin | `nemorouter/dify-integration` (public) | Plugin code calls REST routes with customer's `sk-nemo-xxx` | v3a |
| 5 | **`onyx-integration`** agents | `nemorouter/onyx-integration` (public) | Onyx tool-handler calls REST routes | v3b |
| 6 | **Customer-written agents** (LangChain / LlamaIndex / AutoGen / Vercel AI SDK / raw HTTP) | Customer's codebase | Customer's framework code calls REST routes; we publish optional adapter libs | v3c |
| 7 | **Native MCP clients** (Claude Desktop, Cursor, etc.) | Third-party MCP-compliant hosts | JSON-RPC over HTTP to `/v1/mcp/jsonrpc` | v2 |

## Strategic implications

What centralization buys us:

1. **Adding a new tool is one PR, eight surfaces.** Notion-fetch lands once → marketplace widget AND Dify users AND Onyx users AND `curl` hackers AND Claude Desktop users AND LangChain agents all get it overnight.
2. **No framework lock-in for customers.** They pick any agent framework — we don't fight that. Tool layer is the same regardless. Their LangChain agent and our widget call identical routes.
3. **One vault, no key sprawl.** Customers never juggle 20 vendor API keys. We hold them; they call through us with one Nemo key.
4. **Cross-surface analytics.** "How much did this customer spend on tools across all their agent surfaces?" → one ledger, one query.
5. **One safety story.** Guardrails apply to tool I/O regardless of how the tool was called. PII redaction is consistent across the widget, Dify, and Cursor.
6. **One pricing schedule.** Tier-flat-rate ($0.001/$0.01/$0.05) applies to every consumer. Customer can model their bill without knowing which surface called what.
7. **MCP-native = instant ecosystem.** Phase 2 (`/v1/mcp/jsonrpc`) makes Nemo Router "an MCP server" — every existing MCP-aware client can use us with zero adapter work on their side. Marketing reach for ~3 weeks of engineering.

What centralization costs us:

1. **The gateway is a single point of failure.** Already mitigated by Cloud Run autoscale + the `nemo-canary-observer` + nemo-auto-rollback infra. No new failure mode at the architecture level — but it does raise the importance of `nemo-post-deploy-log-check` (Rule #21) for any change to `mcp_gateway/`.
2. **Per-tool rate limits must be globally aware.** One vendor token shared across all consumers → the per-tool semaphore in `amp-mcp-gateway/references/route-spec.md` becomes critical. Already designed in.
3. **Adding a third wire format later (gRPC? WebSocket?) is harder once two are entrenched.** Mitigated by keeping the JSON-RPC + REST dispatchers thin and routing both to the same internal handler functions.

## When this skill loads

Load `amp-central-tool-layer` when:

- Pitching the marketplace strategically (to customers, to investors, to engineering org)
- Designing any agent-tooling surface anywhere in the Nemo ecosystem — confirms whether to build new or extend the central gateway
- Reviewing a PR in `dify-integration` or `onyx-integration` that wants to bypass the gateway and call tools directly — answer is "no, route through `/v1/mcp/*`"
- Deciding whether to ship the MCP-JSON-RPC native protocol (Phase 2 decision)
- Onboarding a new contributor — this is the second skill to read after `amp-architecture`

## References in this skill

- `references/consumer-matrix.md` — every consumer × auth × payload × UX, with concrete code sketches per surface
- `references/mcp-protocol-native.md` — MCP JSON-RPC wire format, the v2 design, mapping REST routes to MCP methods, discovery via `.well-known/mcp-server.json`
- `references/auth-model.md` — `sk-nemo-xxx` universality, rotation, per-key tool RBAC across consumers
- `references/rollout-sequencing.md` — v1 → v2 → v3 phases with go/no-go gates per phase

## Scripts in this skill

- `scripts/publish-mcp-descriptor.sh` — TODO stub. Will publish `.well-known/mcp-server.json` at v2 launch so any MCP-compliant client can discover the server.

## Related skills

- `amp-architecture` — load first; this skill builds on the "no new APIs" decision
- `amp-mcp-gateway` — the implementation that this skill positions
- `amp-agent-runtime` — the agent loop is one of the seven consumers (#1 + #2 + #3)
- `amp-billing-observability` — one pricing schedule across all consumers
- `nemo-dify` — Dify plugin, becomes consumer #4 in Phase 3a
- `nemo-onyx`, `nemo-onyx-agents` — Onyx integration, becomes consumer #5 in Phase 3b
- `nemo-virtual-keys` — the universal `sk-nemo-xxx` auth model
- `nemo-sdk-conformance` — when LangChain/LlamaIndex adapters ship (consumer #6), they go through the SDK spec

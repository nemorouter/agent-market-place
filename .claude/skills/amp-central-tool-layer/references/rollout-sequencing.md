# Rollout sequencing — v1 → v2 → v3 with go/no-go gates

> **Status:** TODO. The phased path from "marketplace launch" to "central tool layer for every Nemo-authed agent."

## Why phased

The marketplace widget + REST routes (v1) is the smallest deliverable that proves the value end-to-end. Layering MCP-protocol native (v2) and ecosystem integrations (v3) on top is incremental — each phase reuses the previous phase's backend with no rewrites. Risk per phase is bounded.

## Phase 1 — v1 REST gateway + marketplace launch

**Engineering: ~6 weeks. Owner: agent-market-place + nemo-backend platform team.**

### What ships

- 4 new REST routes inside `nemo-backend/mcp_gateway/` (per `amp-mcp-gateway/references/route-spec.md`)
- Tool catalog tables in `super_admin.tool_accounts` + `super_admin.tool_pricing`
- First 3 tools live: `nemo-docs-search`, `slack-send`, `github-issue-search`
- Agent runtime library (`@nemorouter/agent-runtime`) — TS + Python bundles
- Pluggable widget bundle on `cdn.nemorouter.ai/agent-widget/v1/widget.js`
- Playground UI in `01-frontend-end/[organization]/agent-playground/`
- Nemo Support Agent live on `nemorouter.ai/support` (dogfood)
- All RLS policies, all guardrails, all reserve+settle hooks, all observability spans
- Public OSS repo `nemorouter/agent-market-place` published with MIT license
- Docs: `nemorouter.ai/docs/agent-marketplace` (overview + tool catalog + widget embed snippet)

### Go/no-go gate to enter Phase 2

- [ ] Marketplace widget served ≥10k tool calls in production without P0 incident
- [ ] All gap-hunter scanners (`leaked_tool_reservations`, `tool_call_unlogged`, `tool_pricing_drift`, `tool_credentials_unhealthy`) green for 7 consecutive days
- [ ] Nemo Support Agent SLOs met (P95 latency < 5s, error rate < 1%, cost-per-conversation under target)
- [ ] At least 3 external customers running production widgets (revenue signal)
- [ ] `nemo-post-deploy-log-check` (Rule #21) clean on every weekly nemo-backend rollout
- [ ] `sa-cost-leaks` audit: tool-margin model unchanged from launch projection

### Risks tracked through Phase 1

| Risk | Mitigation |
|---|---|
| Vendor rate limits underestimated → 429 storms | Per-tool semaphore (per `amp-mcp-gateway/references/route-spec.md`) sized conservatively at launch; tune up after metric review |
| Credit ledger contention on hot orgs | Row-level locking per Rule #7 already designed in; gap-hunter scanner alerts before customer-visible |
| Embed widget conflicts with customer-site CSS | Iframe isolation (per `amp-frontend-widget/references/embed-snippet.md`) prevents this categorically |
| LiteLLM cost-header drift breaks LLM-side cost math (Rule #4) | Existing `litellm-nemo-intg-check` runs after every LiteLLM version bump — no marketplace-specific risk |

## Phase 2 — v2 MCP-JSON-RPC native

**Engineering: ~3 weeks. Owner: nemo-backend platform team.**

### What ships

- `POST /v1/mcp/jsonrpc` route (the JSON-RPC dispatcher) — implementation per `references/mcp-protocol-native.md`
- `GET /.well-known/mcp-server.json` discovery endpoint
- `mcp.nemorouter.ai` DNS CNAME → `api.nemorouter.ai` (no new infra; hostname add only)
- Docs: `nemorouter.ai/docs/integrations/mcp` with config snippets for Claude Desktop, Cursor, generic clients
- Blog + nemo-youtube launch piece: "Nemo Router is now an MCP server"
- Anthropic MCP marketplace listing submitted

### What does NOT ship in v2

- `prompts/*`, `resources/*`, `sampling/*` method families (held; revisit if customer demand emerges)
- stdio transport (HTTP only)
- WebSocket transport (HTTP only)
- Subscription / `listChanged` notifications

### Go/no-go gate to enter Phase 3

- [ ] Claude Desktop + Cursor integration tested end-to-end by ≥5 internal users
- [ ] MCP-spec compliance: pass Anthropic's reference test suite (`mcp-cli test https://mcp.nemorouter.ai/v1/mcp/jsonrpc`)
- [ ] ≥1 month of v2 traffic with no MCP-spec violations reported
- [ ] At least 10 external MCP-client users (logged via `consumer_hint` analytics)
- [ ] Anthropic MCP marketplace listing approved + live

### Risks tracked through Phase 2

| Risk | Mitigation |
|---|---|
| MCP spec evolves; we lag | Pin to `2024-11-05`; bump deliberately; CI runs against reference test suite on every nemo-backend rollout |
| MCP host vendors implement spec inconsistently | Test matrix per `references/mcp-protocol-native.md`; document quirks in `nemorouter.ai/docs/integrations/mcp/troubleshooting` |
| Bearer-auth in MCP client config feels rough for non-technical users | DevRel team produces 90s screencasts per host; nemo-youtube embeds in docs |

## Phase 3 — Ecosystem integrations

**Three parallel work streams. Each ~2 weeks. Independent owners.**

### Phase 3a — `dify-integration` plugin uses central tool layer

**Owner: dify-integration maintainer.**

Extends the existing Nemo plugin (model provider) with a **tools provider** that calls `/v1/mcp/tools/*` REST routes. Customers paste their `sk-nemo-...` in the Dify plugin config; Dify agent canvas surfaces the full Nemo catalog.

Go/no-go to ship:
- [ ] Implementation in `dify-integration` repo per `references/consumer-matrix.md#4`
- [ ] Tested against 3 Dify agent use cases
- [ ] Dify marketplace listing updated with tool-provider capability

### Phase 3b — `onyx-integration` agents use central tool layer

**Owner: onyx-integration maintainer.**

Onyx tool-handler routes through `/v1/mcp/tools/*` instead of per-Onyx-deployment tool credentials. Per `references/consumer-matrix.md#5`.

Go/no-go:
- [ ] Implementation in `onyx-integration` repo
- [ ] Migration doc for existing Onyx deployments: "your `OPENAI_API_KEY` becomes `NEMOROUTER_API_KEY`, and you delete your local Slack/GitHub/Notion creds"
- [ ] At least 2 existing Onyx customers migrated

### Phase 3c — Framework adapter libraries

**Owner: shared (community + Nemo DevRel).**

Three thin adapter packages (~150 lines each):

- `@nemorouter/langchain` (npm) + `nemorouter-langchain` (PyPI) — exposes Nemo tools as `StructuredTool[]`
- `nemorouter-llamaindex` (PyPI) — exposes Nemo tools as `FunctionTool[]`
- `@nemorouter/autogen` (npm) — exposes Nemo tools as AutoGen tool definitions
- `@nemorouter/vercel-ai-sdk` (npm) — exposes Nemo tools as Vercel AI SDK tool shape

Each package ships as MIT, lives in its own sub-repo or in a `packages/` subdir, and is independent of `agent-market-place`'s core. Maintenance burden: low (the API contract is stable).

Go/no-go per package:
- [ ] Published to package registry
- [ ] Listed in `nemorouter.ai/docs/integrations/{langchain|llamaindex|autogen|vercel-ai-sdk}`
- [ ] At least one external user ships a production agent with each adapter

### Phase 3d — Anthropic + Cursor + other native MCP host outreach

**Owner: GTM (cloudact-nemo-growth-engine).**

Once v2 is live and v3c gives reach, GTM follows up:

- Pitch Nemo as the "managed tool MCP server" to Anthropic for marketplace promotion
- Same pitch to Cursor, Continue.dev, Cline maintainers
- Get listed in 3+ MCP-host marketplaces

No engineering work — purely positioning + relationships. Tracked in `cloudact-nemo-growth-engine` plans.

## Total sequencing chart

```
Now ─────────► v1 launch (6 wks) ─────► v2 launch (3 wks after v1 stable) ─────► v3 (parallel after v2)
                  │                          │                                       │
                  │                          │                                       ├─ 3a Dify (2 wks)
                  │                          │                                       ├─ 3b Onyx (2 wks)
                  │                          │                                       ├─ 3c Adapters (1 wk each)
                  │                          │                                       └─ 3d GTM outreach (ongoing)
                  │                          │
                  │                          └─ ~10 wks from now
                  └─ ~6 wks from now
```

Total elapsed to "everything live across all consumers": ~14 weeks (3.5 months). Pessimistic case with v2 slip + parallel v3 stretching: ~20 weeks (5 months).

## What can ship faster — explicit punts

If pressure to compress the timeline emerges, here's what stays + what cuts:

| Component | Can compress? | How |
|---|---|---|
| v1 widget + REST gateway | NO — already minimum viable | — |
| v1 first-3-tools | YES — could ship with 1 (docs-search) only | But then Support Agent loses escalation; less compelling dogfood |
| v1 dogfood support agent | NO — proves the integration story; non-negotiable | — |
| v1 OSS repo publish | YES — could delay 4 weeks (private at launch, public 2026Q4) | Loses trust + adoption story; recommend keeping at launch |
| v2 MCP-native | YES — could push to 2026Q4 | Loses Claude Desktop reach during 2026Q3 — but doesn't kill v1 success |
| v3a Dify | YES — community can drive | Maintainer time uncertain; we should be ready to do it |
| v3b Onyx | YES — same | Same |
| v3c adapter libs | YES — community-led; LangChain community is large | Could ship within 2 weeks of v1 if a contributor picks it up |
| v3d GTM outreach | YES — ongoing anyway | Doesn't block engineering |

The hard floor: **v1 with at least 1 tool + dogfood support agent + OSS repo public**. Everything else is sequenced for compounding leverage, not for blocking.

## Cross-team dependencies

| Phase | Needs from | What |
|---|---|---|
| v1 | nemo-backend platform | New routes in `mcp_gateway/` module |
| v1 | sa-* (super-admin team) | `super_admin.tool_accounts` admin UI (mirrors `sa-provider-accounts`) |
| v1 | 00-nemo-db | New nemo + super_admin schema migrations |
| v1 | DevRel | Docs at `nemorouter.ai/docs/agent-marketplace` |
| v1 | sa-nemo-business | Pricing audit approval before launch |
| v2 | nemo-backend platform | JSON-RPC dispatcher (~1 week eng) |
| v2 | DNS / infra | `mcp.nemorouter.ai` CNAME (~1 hour) |
| v2 | DevRel | Integration docs for Claude Desktop / Cursor / generic |
| v3a-c | sibling repo maintainers | Per-consumer integration work |
| v3d | GTM | Marketplace listings, host vendor relationships |

## Where to track this

Phase 1 progress: standard `nemo-fleet` posture, weekly status in `cloudact-nemo-growth-engine/plans/agent-marketplace-v1.md` (private — but each completed milestone replicates as a public changelog entry on `nemorouter.ai/changelog`).

Phase 2 + 3: open issues on `nemorouter/agent-market-place` with labels `phase-2-mcp-native`, `phase-3a-dify`, `phase-3b-onyx`, `phase-3c-adapters`. Public so community contributors can volunteer.

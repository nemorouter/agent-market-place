---
name: amp-architecture
description: Use when starting any agent-market-place work — defines the "no new APIs" constraint, the integration contract with the existing Nemo gateway, and which existing skills/rules are inherited. Read this FIRST before touching amp-mcp-gateway, amp-agent-runtime, amp-frontend-widget, or amp-billing-observability.
metadata:
  type: architecture
  status: partially-shipped
  owner: surasani.rama@gmail.com
---

> **Status (2026-06-02) — customer-service-agent surfaces SHIPPED + LIVE on prod (`guru-cs-agent`).**
> Built, tested, and deployed: the **config dashboard** (`/admin`), the **config-driven widget**,
> the **MCP tool consumer** (bounded client-side tool-use loop), the **agent-infra credential
> vault** (agent owns the key; AES-256-GCM), and **self-contained email-OTP admin login**
> (SendGrid + signed cookie — no Supabase Auth, isolated from Nemo + super-admin logins). All
> in `agents/customer-service-agent/`, reusing ONE `sk-nemo` key (no new API). The ONLY piece
> on `main` but not yet on prod is the **nemo-backend gateway credential change** (PR #197) —
> it needs a core-backend rollout to light up credentialed tool *execution* in production.
>
> **Production-hardened for scale (2026-06-01).** Horizontally scalable + enterprise-secure:
> distributed rate limit (Upstash REST, in-memory fallback that never breaks chat), inbound
> payload caps (DoS/cost protection), upstream timeouts, `GET /api/health[?ready=1]` liveness +
> readiness probes, and security-header middleware (`/admin` frame-lockdown). Tenancy is
> **isolation-by-deployment** — one fork per customer (own Supabase + own budgeted `sk-nemo`
> key + own `TOOL_VAULT_KEY`); "thousands of customers" = thousands of isolated forks, not one
> process host-routing many tenants. Authoritative posture doc:
> `agents/customer-service-agent/PRODUCTION.md`.

# amp-architecture — Top-level integration contract

> **Status (2026-05-30):** PARTIALLY IMPLEMENTED. The standalone-app model below is built
> under `agents/`. See `docs/superpowers/specs/2026-05-30-standalone-agent-marketplace-design.md`.
> The placeholders / Phase-2 (MCP tools, playground) notes in this skill still stand.

## Implemented model (2026-05-30) — read this first

The shipped shape is **standalone, forkable agent apps** under `agents/`, not an in-process
runtime inside nemo-backend:

- **Nemo Router provides only the LLM (chat + vision + embeddings) + the MCP tool gateway.**
  It enforces guardrails, routing/fallback, credits, and rate limits server-side. The agent
  app never reimplements them — see `agents/customer-service-agent/lib/nemo.ts`.
- **The customer owns the frontend, backend, and vector DB** (their own Supabase, pgvector),
  using ONE `sk-nemo` virtual key (a named key with a per-day budget = the hard spend cap).
- **`agents/customer-service-agent/`** is the runnable runtime (Acme Inc is the example):
  multi-env (`.env.local/.stage/.prod`), multi-cloud deploy (local + GCP today, Azure/AWS
  tomorrow), embeddable widget, tests + CI.
- **`agents/guru-cs-agent/`** is the **dogfood instance** (the support agent on
  `nemorouter.ai`) — an INSTANCE of the same runtime, not a duplicate. It uses the
  **existing Nemo Supabase** isolated in a dedicated **`nemo_amp_db`** schema (Rule #12:
  never the `public` schema). `SUPABASE_SCHEMA` selects it; no code change.
- A pure-RAG agent needs **zero new nemo-backend routes** (strictest reading of "no new APIs").
  Credentialed tools (Phase 2) still use the central MCP gateway documented in the rest of
  this skill.

The interpretation-4.A discussion below remains the reference for the MCP/tool side.

> **Legacy status (superseded by the line above):** TODO. Documentation-only.

## The shape

`agent-market-place` is a sibling repo under `~/nemorouter/` that ships **two surfaces**:

1. A **pluggable web chat agent** (embeddable widget for customer sites)
2. A **playground** for testing agents before they go live (admin surface inside the existing dashboard)

Both surfaces drive an **agent loop** (LLM call → tool call → LLM call → ... → final message). The loop runs against the **existing** Nemo API gateway (`api.nemorouter.ai`, which today resolves to the `nemo-backend` Cloud Run service on port `:8090`). New routes are added to that existing gateway to handle agent sessions + MCP tool calls — but no new API service, no new hostname, no new auth surface.

The customer uses the **same `sk-nemo-xxx` virtual key** for both LLM calls and tool calls. One bill, one credit ledger, one trace.

## The hard constraint — "no new APIs"

The user's exact words: *"I don't want to build any new apis it must be inline with nemo api gateway only."*

Interpretation chosen (see `references/constraint-checklist.md` for the full trade-off):

> **No new external API services.** A new FastAPI app, a new Cloud Run service, a new hostname → REJECTED.
> **New routes on the existing `nemo-backend:8090` gateway, under `api.nemorouter.ai`** → ALLOWED, because:
> - Same hostname (no new product surface customers must learn)
> - Same auth middleware (virtual key validation already exists)
> - Same credit ledger (`nemo-credits` `reserve_credits` / `settle_credits`)
> - Same observability pipeline (logs, callbacks, request IDs)
> - Same deployment unit (ships with the next `nemo-backend` rollout)

If the user prefers the strictest reading (no new routes at all — agent + tools must ride entirely on `/v1/chat/completions` + OpenAI function-calling), see `references/constraint-checklist.md` §3. That reading kills the four ecosystem benefits (vault, ledger, guardrails, trace) and is not what these skills assume.

## Inherited from the Nemo ecosystem (do NOT reinvent)

| Concern | Inherited from | What this means for amp-* |
|---|---|---|
| Auth | `nemo-virtual-keys` + `nemo-auth` | `sk-nemo-xxx` for every agent + tool call. NEVER master key (Rule #15). |
| Credits | `nemo-credits` (reserve+settle) | Tool calls call `reserve_credits(service='tool')` → execute → `settle_credits(actual_cost)`. Every failure path calls `release_reservation` (Rule #7). |
| LLM cost | `nemo-cost-tracking` (Rule #4) | LiteLLM still owns LLM cost. The `x-litellm-response-cost` header still passes through. Tool cost is OUR computation (see `amp-billing-observability`). |
| Tenancy | `nemo-org-lifecycle` (Rule #26) | Tools scope at org → team → key, mirroring guardrails (Rule #8 same-UUID). |
| RLS | `nemo-rls-enforcer` (Rule #13) | Every new `nemo.*` table for agents/sessions ships with RLS policies. No `USING (true)`. |
| Guardrails | `nemo-guardrails` | Same scope hierarchy (key > team > org); extended to tool args + responses. See `amp-billing-observability/references/guardrails-tool-io.md`. |
| Observability | `nemo-observability` | Existing log/callback infra; new trace shape adds an `agent_step` span type. |
| Tool vault | Pattern from `sa-provider-accounts` | New table `super_admin.tool_accounts` (same shape: typed creds, rotation, dual-write to nemo-backend env). |
| Pricing | Pattern from `sa-litellm-pricing` | New tiered flat-rate table for tools (see `amp-billing-observability`). |
| Deploy | `infra-gcp-deploy` (Cloud Run) | New routes ship inside `nemo-backend` rollouts. **No new Cloud Run service** under interpretation 4.A. |

## Open-source posture

This repo is **public on GitHub, MIT-licensed** — sibling tier to `nemorouter/dify-integration` and `nemorouter/onyx-integration`. Tight integration with Nemo Router (gateway routes, credit ledger, guardrails, observability) is the value-add; the runtime + widget themselves are open for community audit, fork, and contribution.

The implementation of the gateway routes (`/v1/agents/*`, `/v1/mcp/*`) lives in `nemo-router-mono-repo` (public selected dirs). The tool credential vault and pricing tables live in `super-admin-dashboard` (private). The boundary is documented in `references/open-source-boundary.md` — read it before opening a PR that crosses repos.

**First customer of the marketplace is us** — the Ask Guru Agent on `nemorouter.ai/support`, `/docs/*`, `/pricing`, and inside the dashboard. Built from this repo, against the live Nemo Router gateway, with no special-case code. Spelled out in `references/guru-cs-agent-dogfood.md`. If it breaks for us, we hear about it before any customer does.

## What lives where

```
~/nemorouter/agent-market-place/        ← this repo (TODO; future independent PUBLIC git repo, MIT)
├── .claude/skills/                     ← 6 skills, prefix amp-*
│   ├── amp-architecture/    ← you are here
│   ├── amp-mcp-gateway/     ← the NEW routes that get added to nemo-backend
│   ├── amp-central-tool-layer/  ← positioning: same gateway, every Nemo-authed agent (widget, Dify, Onyx, MCP clients)
│   ├── amp-agent-runtime/   ← the agent loop, runs in widget OR in a sibling Cloud Run service
│   ├── amp-frontend-widget/ ← pluggable embeddable chat + admin playground
│   └── amp-billing-observability/ ← pricing model, credit ledger, trace shape, tool I/O guardrails
├── frontend/                ← pluggable widget bundle + (admin lives in 01-frontend-end)
├── backend/                 ← agent-runtime package (NOT an API service)
├── docs/design.md           ← full design doc + decision log
└── scripts/                 ← TODO stubs

~/nemorouter/nemo-router-mono-repo/     ← unchanged — receives the new routes
└── 03-nemo-backend/nemo_backend/mcp_gateway/  ← TODO: isolated module for /v1/agents/* + /v1/mcp/*

~/nemorouter/super-admin-dashboard/     ← unchanged — receives the tool catalog admin UI
└── (TODO route group for tool catalog CRUD, mirrors sa-provider-accounts pattern)
```

## Integration points — the only places amp-* code touches existing repos

| Existing repo | New surface (TODO) | Owned by |
|---|---|---|
| `03-nemo-backend/nemo_backend/mcp_gateway/routes.py` | `POST /v1/agents/sessions`, `POST /v1/agents/sessions/{id}/messages`, `GET /v1/mcp/tools`, `POST /v1/mcp/tools/{id}/call` | `amp-mcp-gateway` |
| `00-nemo-db/migrations/alembic/versions/aXXX_mcp_gateway.py` | `nemo.agent_sessions`, `nemo.agent_messages`, `nemo.tool_call_log` | `amp-mcp-gateway` |
| `super-admin-dashboard/db/migrations/00X_tool_accounts.py` | `super_admin.tool_accounts`, `super_admin.tool_pricing` | `amp-mcp-gateway` |
| `super-admin-dashboard/app/tools/` | Admin UI for tool catalog CRUD | `amp-mcp-gateway` (UI), `amp-billing-observability` (pricing rows) |
| `01-frontend-end/src/app/[organization]/agent-playground/` | Customer-facing admin playground | `amp-frontend-widget` |
| `01-frontend-end/src/app/[organization]/teams/[teamId]/tools/` | Per-team tool enable/disable + per-key tool RBAC | `amp-mcp-gateway` |

Everything outside the table is OFF-LIMITS for `amp-*` skills.

## When this skill loads

Load `amp-architecture` BEFORE any other `amp-*` skill, when:

- Starting any agent-market-place work
- Debating whether a proposed change is "in scope"
- Asked "does this need a new API service?" — answer is almost always no; check the constraint here first
- Onboarding a new contributor to the marketplace product

## References in this skill

- `references/nemo-integration-points.md` — the exact files in existing repos that need edits, with line-of-sight to which skill owns each
- `references/constraint-checklist.md` — the three interpretations of "no new APIs," what each one buys/loses, and the chosen reading
- `references/data-flow-diagram.md` — request-path diagram for one chat turn end-to-end (widget → gateway → vault → tool → ledger → trace → response)
- `references/open-source-boundary.md` — public/private map across the Nemo ecosystem; what changes can land here vs. require a PR in a private repo
- `references/guru-cs-agent-dogfood.md` — the first deployment: Ask Guru Agent on nemorouter.ai, built end-to-end from this repo

## Scripts in this skill

- `scripts/validate-no-new-services.sh` — TODO stub. Will grep proposed PRs for new FastAPI apps, new Cloud Run services, new hostnames. Fails if any appear outside the allowed list.

## Open questions (resolve before BUILD phase)

1. Confirm interpretation 4.A with the user. (Default in these docs.)
2. Decide: agent runtime in browser (Option A) or as a sibling Cloud Run service (Option B)? See `amp-agent-runtime`.
3. First 3 tools to launch with — drives `amp-mcp-gateway/references/tool-catalog-schema.md` shape.
4. Pricing model commit — tiered flat rate ($0.001 / $0.01 / $0.05) is the working assumption; needs `sa-nemo-business` audit before launch.

## Related skills

- All five sibling `amp-*` skills (this one is the entry point):
  - `amp-mcp-gateway` — implementation of the gateway routes
  - `amp-central-tool-layer` — positioning: same gateway, every Nemo-authed agent (widget, Dify, Onyx, native MCP clients)
  - `amp-agent-runtime` — the loop driving the widget + playground + support agent
  - `amp-frontend-widget` — pluggable widget + admin playground
  - `amp-billing-observability` — pricing + ledger + trace + guardrails
- `nemo-virtual-keys`, `nemo-credits`, `nemo-guardrails`, `nemo-observability`, `nemo-org-lifecycle` — inherited contracts
- `sa-provider-accounts` — vault pattern to copy
- `sa-litellm-pricing` — pricing-row pattern to copy
- `infra-gcp-deploy` — deploy path (no new service, just rolls inside nemo-backend)
- `nemo-dify`, `nemo-onyx`, `nemo-onyx-agents` — Phase 3 ecosystem consumers of the central tool layer

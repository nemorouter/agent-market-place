# agent-market-place — Design Doc

> **Status:** TODO. Design only. Last updated: 2026-05-28. Owner: surasani.rama@gmail.com.
> **Visibility:** Public on GitHub, MIT-licensed (sibling to `nemorouter/dify-integration`, `nemorouter/onyx-integration`).
> **First deployment:** Nemo Support Agent on `nemorouter.ai` — see `.claude/skills/amp-architecture/references/nemo-support-agent-dogfood.md`.

## 0. TL;DR

Build a Nemo-ecosystem agent marketplace where customers run **pluggable web chat agents** (and a sibling **playground** for testing) that share one `sk-nemo-xxx` virtual key for **both LLM calls and tool calls**. Everything routes through the existing `api.nemorouter.ai` gateway. Tool spend lands in the same credit ledger as LLM spend. No new product surface, no new bill, no new key.

**Open source + tightly integrated.** This repo (MIT) holds the agent runtime, pluggable widget, tool integration descriptors, design docs. The Nemo Router gateway routes that those components call live in the Nemo monorepo. Contributors can audit, fork, and extend the runtime; the integration value (credit ledger, guardrails, observability) comes for free when the widget talks to `api.nemorouter.ai`. Anyone running their own hosted Nemo Router (open-source path) gets the marketplace too.

**Dogfood first.** The first agent built on this stack is the Nemo Support Agent on our own website. Proves the integration end-to-end before any customer adopts it.

## 1. Problem

At 1000+ customers running agents, the LLM-only Nemo Router experience has gaps:

| Gap | Today | With the marketplace |
|---|---|---|
| Tool credentials | Customer manages N OAuth flows per tool, per integration | One vault, one key, curated catalog |
| Tool spend | Paid to each vendor separately | One line item in the same credit ledger |
| Guardrails on tool I/O | Nothing inspects what the agent sends to Slack/Notion/etc. | Same Nemo guardrails extended to tool args + responses |
| Agent-step observability | LLM calls visible; tool calls invisible | One trace per agent step |
| Volume pricing on tools | Each customer pays vendor list price | Nemo negotiates volume rates, passes margin or savings |

## 2. Non-negotiable constraints (from the user)

1. **Inline with Nemo ecosystem.** Lives at `~/nr/enterprise-ai-hub/agent-market-place/`, sibling to the other 7 repos. Skills follow the Claude `SKILL.md + references/ + scripts/` shape.
2. **No new APIs.** No second API service, no second hostname. See §4 for the chosen interpretation.
3. **Customer-facing product = pluggable web chat agent.** Embeddable on the customer's own site / app.
4. **Internal product = same pluggable widget configured as a playground.** Lets the customer (or our team) test agents before they go live, same way `01-frontend-end` Playground tests raw LLM calls today.
5. **Document first.** No code in this pass. All five `SKILL.md` files in `.claude/skills/` are aspirational design docs.
6. **Public + open source.** MIT-licensed, public on GitHub. No confidential strings, no production credentials, no per-tool cents in this repo. The public/private boundary is documented in `.claude/skills/amp-architecture/references/open-source-boundary.md`.
7. **Tightly integrated with Nemo Router gateway + guardrails.** The agent runtime calls the existing Nemo gateway; tool calls hit Nemo guardrails; spend hits the Nemo credit ledger. The integration is the value-add — not the orchestration code itself.
8. **First deployment is our own.** Nemo Support Agent ships before we onboard any external customer agent. If the marketplace breaks, we feel it first.

## 3. Constraints inherited from the Nemo monorepo

All 26 Permanent Rules in `~/nr/nemo-router-mono-repo/.claude/rules/00-permanent-rules.md` still apply. Most load-bearing for this project:

- **Rule #2 — No BYOK.** Tool credentials in Nemo's vault, never customer-managed at the surface.
- **Rule #4 — LiteLLM owns LLM cost.** Tool cost is OUR responsibility. New code path; cannot piggyback on `x-litellm-response-cost`.
- **Rule #7 — Credits sacred; reserve+settle.** Every tool call MUST `reserve_credits → execute → settle_credits`, with `release_reservation` on every failure path. No exceptions for tools.
- **Rule #8 — Same UUID everywhere.** Agents and tool catalogs scope at `organization_id` + `team_id`; same UUID flows from Nemo → tool vault → trace.
- **Rule #9 — Nemo Backend always in path.** The agent runtime calls Nemo Backend; never calls a provider or tool vendor directly.
- **Rule #13 — RLS on every Nemo Supabase table.** Any new `nemo.*` table for agent sessions / tool catalog must ship with RLS policies day one.
- **Rule #15 — All LLM calls use virtual keys.** Agent runtime authenticates with `sk-nemo-xxx`, never the master key. Pluggable widget pastes/stores key the same way the Playground does today.
- **Rule #26 — org → team → member.** Tool catalogs scope at three levels (org default, team-scoped, key-scoped) — same hierarchy as guardrails.

## 4. The "no new APIs" interpretation — choose one

The phrase is ambiguous. Three readings, ranked from loosest to strictest:

### 4.A. New routes on the existing gateway are fine (RECOMMENDED — what these docs assume)

- Add `/v1/mcp/tools/list`, `/v1/mcp/tools/call`, `/v1/agents/sessions/*` to the existing `nemo-backend:8090` FastAPI app.
- Same hostname (`api.nemorouter.ai`), same auth middleware, same credit ledger, same observability pipeline.
- "No new APIs" is read as "no new API SERVICES." Adding routes to the existing gateway is housekeeping, not a new product surface.
- **Pro:** Clean integration, all Nemo invariants enforced by existing middleware automatically.
- **Con:** Nemo Backend grows. Mitigated by isolating new code under `03-nemo-backend/nemo_backend/mcp_gateway/`.

### 4.B. Reuse `/v1/chat/completions` only — agent loop is a client convention

- No new routes. The marketplace runtime drives the agent loop entirely client-side:
  - Sends tool definitions as OpenAI function-calling `tools` in `/v1/chat/completions`
  - Model returns `tool_calls`; runtime executes them using tool credentials pulled from a vault accessed via... hmm, no Nemo route to call. Vault has to be in the runtime itself.
- **Pro:** Truly zero new Nemo endpoints.
- **Con:** Loses the entire ecosystem upside — no credit-ledger integration for tools, no tool I/O guardrails, no agent-step trace. The runtime now holds tool credentials, which violates the "one vault" promise and is a security regression vs. status quo.
- **Verdict:** Defeats the purpose. Only chosen if user enforces the strictest reading.

### 4.C. Brand-new service inside the marketplace repo

- `agent-market-place/backend/` is its own FastAPI app, deployed as `agent-api.nemorouter.ai`.
- **Pro:** Clean blast radius; doesn't grow Nemo Backend.
- **Con:** Directly violates the user's constraint. Two API services, two deployment units, two surfaces to secure, separate credit-ledger integration path. Rejected.

**These docs proceed with 4.A.** If the user wants 4.B, every SKILL.md needs a rewrite — flag it explicitly before any implementation starts.

## 5. High-level architecture (under 4.A)

```
                    ┌─────────────────────────────────────────┐
                    │ Customer's website / app                │
                    │  <script src=".../widget.js"></script>  │
                    │  (pluggable web chat agent — embeddable)│
                    └────────────────┬────────────────────────┘
                                     │
                                     │  Bearer sk-nemo-xxx
                                     ▼
   ┌────────────────────────────────────────────────────────────┐
   │ api.nemorouter.ai  ←── existing gateway, no new hostname   │
   │ (= nemo-backend Cloud Run service, port :8090)             │
   │                                                            │
   │  Existing routes (unchanged):                              │
   │    POST /v1/chat/completions    → mounted LiteLLM          │
   │                                                            │
   │  NEW routes (added in same FastAPI app, isolated module):  │
   │    POST /v1/agents/sessions     → start agent session      │
   │    POST /v1/agents/sessions/{id}/messages                  │
   │                                  → run one agent turn      │
   │    GET  /v1/mcp/tools           → list tools available to  │
   │                                    this key (RLS-scoped)   │
   │    POST /v1/mcp/tools/{id}/call → execute tool             │
   │      ├─ auth: existing virtual-key middleware              │
   │      ├─ guardrail: nemo-guardrails on args + response      │
   │      ├─ reserve: nemo-credits.reserve_credits(             │
   │      │             service='tool', estimated_cost=X)       │
   │      ├─ vault: pull tool creds from super_admin.tool_      │
   │      │         accounts (same shape as provider_accounts)  │
   │      ├─ exec: call upstream MCP server / REST API          │
   │      ├─ settle: nemo-credits.settle_credits(actual_cost)   │
   │      └─ trace: emit one span on the agent trace            │
   └────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                    ┌────────────────────────────────┐
                    │ Upstream tools                 │
                    │  - MCP servers (stdio / HTTP)  │
                    │  - REST APIs                   │
                    │  - GraphQL endpoints           │
                    └────────────────────────────────┘
```

The "backend" inside `agent-market-place/` is small: just the agent-loop orchestrator that calls Nemo's new `/v1/agents/sessions/*` routes. It has zero externally callable endpoints — it's a runtime, not an API.

## 6. Decision log (will grow as decisions are made)

| Date | Decision | Why |
|---|---|---|
| 2026-05-28 | Use interpretation 4.A (new routes on existing gateway, no new service) | Only interpretation that preserves all four ecosystem benefits (vault, ledger, guardrails, trace) without violating "no new API services." |
| 2026-05-28 | Skill prefix `amp-*` (Agent Market Place) | Globally unique, doesn't collide with `nemo-*`, `sa-*`, `infra-*`. Short and memorable. |
| 2026-05-28 | Live under `~/nr/enterprise-ai-hub/agent-market-place/` (workspace root sibling) | Matches existing pattern (`super-admin-dashboard`, `dify-integration`, etc.). Auto-ignored by workspace allowlist `.gitignore`. |
| 2026-05-28 | Skills NOT yet wired into `~/.claude/skills/` global discovery | TODO project; wire up via `bootstrap.sh` extension when implementation starts. |
| 2026-05-28 | **Public repo, MIT-licensed** | Open source for trust + adoption; differentiation is the Nemo integration, not the runtime. |
| 2026-05-28 | **First deployment = Nemo Support Agent on `nemorouter.ai`** | Dogfood — proves the integration before any external customer adopts it; also the canonical reference deployment. |
| TBD | Pricing model | Leaning tiered-flat-rate (`amp-billing-observability`): Basic $0.001, Premium $0.01, Compute $0.05 — predictable but covers cost variance. |
| TBD | Where agent runtime runs | Three options: (a) browser-side in the widget, (b) Cloud Run service in `<gcp-project>`, (c) edge (Cloud Run gen2 + regional). Trade-off in `amp-agent-runtime/references/agent-loop.md`. |
| TBD | First 3 tools to launch with | Likely GitHub-read, Slack-send, web-search (Exa or Tavily). Tracked in `amp-mcp-gateway/references/tool-catalog-schema.md`. |

## 7. Out of scope for now

- Third-party developer publishing (Phase 2 — needs sandboxing).
- Hosted execution of customer-supplied agent code (different product; consider after marketplace v1).
- Multi-agent orchestration / agent-to-agent protocol (start with single-agent loops).
- Voice/audio modality (LLM and tool layer first; multimodal later).
- Replacing Onyx — Onyx remains its own product for full RAG + agent stacks.

## 7.5. Open-source posture (why this is here)

Why public + MIT, not private + commercial:

1. **Trust.** The widget executes on customers' websites, holding their `sk-nemo-xxx` virtual key in browser sessionStorage. Customers should be able to audit every line of code that touches that key. Open source is the only way to credibly say "this widget does exactly what we say it does."
2. **Adoption.** Open-source agent runtimes (LangChain, AutoGPT, Vercel AI SDK) drive far more adoption than closed equivalents. Our differentiation is the *integration with Nemo Router*, not the runtime — so open-sourcing the runtime gives away nothing valuable and gains us reach.
3. **Self-hosted Nemo Router users.** The Nemo Router gateway itself has public selected directories. Customers running their own Nemo Router gateway can also run their own marketplace by forking this repo + the gateway routes. Same code, same patterns, no commercial gate.
4. **Contribution flywheel.** Tool integrations (Slack, GitHub, Notion, Linear, …) scale better when the community can submit descriptors than when a small Nemo team is the bottleneck.

What stays private (and why) — full map in `.claude/skills/amp-architecture/references/open-source-boundary.md`:

- **Tool credentials** — Secret Manager. Never any git repo, public or private.
- **Per-tool pricing cents** — commercial decisions, owned by `sa-litellm-pricing` / `sa-nemo-business`. The *tier shape* ($0.001/$0.01/$0.05) is public; the specific Slack-vs-GitHub-vs-Exa cents are not.
- **Master key + production hostnames + Cloud Run revision URLs** — security through reduced enumeration.
- **Customer agent configs + tool grants + RBAC** — customer-owned data; RLS-enforced.

## 7.6. The dogfood — Nemo Support Agent on `nemorouter.ai`

First customer of the marketplace is us. The Nemo Support Agent runs on `nemorouter.ai/support` (full-page) and as an embedded widget on `/docs/*`, `/pricing`, `/changelog`, and the logged-in dashboard.

Three capability tiers (full breakdown in `.claude/skills/amp-architecture/references/nemo-support-agent-dogfood.md`):

- **Tier 1 (launch):** RAG over public docs + escalate-to-human via `slack-send` + GitHub issue search
- **Tier 2 (Phase 2):** logged-in customer help — billing lookup, recent request logs (RLS-scoped, PII-masked)
- **Tier 3 (Phase 3):** account self-service (out of scope for v1 — too much agent liability)

Why this matters for the architecture:

- Every tool the support agent uses is a normal `super_admin.tool_accounts` row — no special-case code path. Tests against the support agent test the marketplace contract.
- The support agent's system prompt + tool list live in PUBLIC config in `01-frontend-end/src/data/agent-configs/nemo-support.md` — anyone can audit "what's the support agent allowed to do?"
- The support agent's cost flows through the same `nemo.credit_ledger` any customer's would, including the Nemo platform fee on our own infrastructure (we eat our own tax).
- If we make changes that benefit the support agent, they ship upstream to this repo immediately. No private fork.

## 8. Open questions

1. Does the agent runtime live in `agent-market-place/backend/` or inside `01-frontend-end/`? Trade-off is "more code in marketplace repo" vs. "everything customer-facing stays in the existing dashboard image."
2. Does the playground UI live in `01-frontend-end/src/app/[organization]/agent-playground/` or inside `agent-market-place/frontend/`? Probably the former — it's an admin surface for an existing logged-in user.
3. How do tools that themselves cost LLM tokens (e.g., a "summarize this URL" tool that internally calls Claude) bill? Compose the LLM cost into the tool's settle? Or surface as two ledger entries? Answer drives `amp-billing-observability`.
4. Per-tool RBAC — does it live in `super_admin.tool_accounts` (centralized) or in `nemo.team_tool_permissions` (per-team)? Likely both: catalog availability at super-admin level, enable/disable at team level.

## 9. References

- The 5 skills under `.claude/skills/` — start with `amp-architecture/SKILL.md`.
- Workspace cockpit: `~/nr/nemo-brain/sdlc/references/workspace-cockpit.md`.
- Nemo Router 26 rules: `~/nr/nemo-router-mono-repo/.claude/rules/00-permanent-rules.md`.
- Tenancy rules (org → team → member, same-UUID, RLS): `~/nr/nemo-router-mono-repo/.claude/rules/02-multi-tenancy.md`.
- Existing pattern this borrows from heavily: `sa-provider-accounts` (vault shape), `nemo-credits` (reserve+settle), `nemo-guardrails` (scope hierarchy), `nemo-observability` (trace shape).

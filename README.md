# agent-market-place

> **Status:** v1 SHIPPED 2026-05-29. The MCP gateway is **built, central, in-process inside nemo-backend** (`nemo-router-mono-repo/03-nemo-backend/nemo_backend/mcp_gateway/`) and the **pluggable embeddable widget is built + separately deployable** here in `frontend/` (`@nemorouter/agent-widget`). Authoritative SoT: mono-repo skill `nemo-mcp-gateway` + `nemo-router-mono-repo/docs/superpowers/specs/2026-05-29-mcp-gateway-agent-marketplace-design.md`. The skill docs below are the design + Phase-2 roadmap.
> **License:** MIT (`LICENSE`) — public on GitHub when the repo is created (`nemorouter/agent-market-place`).
> **Sibling repo under** `~/nemorouter/`, alongside `nemo-router-mono-repo`, `super-admin-dashboard`, `nemo-infra-cicd`, `dify-integration`, `onyx-integration`. Will become its own independent **public** git repo when work begins.
> **First customer:** us — the Nemo Support Agent on `nemorouter.ai`. See `.claude/skills/amp-architecture/references/nemo-support-agent-dogfood.md`.

## ✅ Live: Ask AI Guru (2026-05-30)

The flagship agent — **Ask AI Guru** — is **live on prod** (Cloud Run, `nemo-prod-deploy`):
**https://guru-cs-agent-suz5ioxcsq-uc.a.run.app** (demo page opens the widget by default;
docs at `/docs.html`). It's a 1:1 of the Nemo "Ask AI" widget, grounded on the **full Nemo
docs** (90 chunks, prod Supabase `nemo.kb_chunks`), answering on the **Guru Kallam** virtual key.

**Embed it anywhere — one line:**
```html
<script src="https://guru-cs-agent-suz5ioxcsq-uc.a.run.app/widget.js"></script>
```

| Topic | Doc |
|---|---|
| Embed + run your own agent | served `/docs.html` (per agent) |
| **Cost tracking (chat + embeddings)** | [`docs/track-amp-nemo-costs.md`](docs/track-amp-nemo-costs.md) |
| Architecture + decisions | [`docs/superpowers/specs/2026-05-30-standalone-agent-marketplace-design.md`](docs/superpowers/specs/2026-05-30-standalone-agent-marketplace-design.md) |
| The runnable app | [`agents/customer-service-agent/`](agents/customer-service-agent/) · instances `agents/guru-cs-agent`, `agents/restaurant-agent` |

**Costs are fully captured** — every chat *and embedding* call is metered on the key
(`x-nemo-request-cost` header → `LiteLLM_SpendLogs` → key `spend`/budget). See the cost doc.

## What this is

A planned Nemo Router ecosystem product: a **pluggable agent marketplace** where customers run agents (chat widgets, automations) that authenticate with the *same* `sk-nemo-xxx` virtual key they already use for LLM calls. Tool calls, LLM calls, guardrails, observability, and billing flow through the **existing Nemo API gateway** (`api.nemorouter.ai`) — no second product surface to learn, one bill, one credit ledger.

**Open source, tightly integrated** — the runtime + widget are MIT-licensed and live here, fully auditable by anyone embedding them on their site. The integrations into Nemo Router (gateway routes, credit reserve+settle, guardrail invocation, agent-step traces) are documented openly but implemented in the Nemo monorepo, so the value-add is the *integration*, not the orchestration code itself.

Sibling open-source integrations: `nemorouter/dify-integration` (Dify plugin), `nemorouter/onyx-integration` (Onyx agents on a Nemo fork). This is the third public integration repo.

## Knowledge base (manual scraper)

`scripts/build-knowledge-base.py` (Python stdlib only — no install) scrapes a local docs dir AND/OR a website URL into a single knowledge-base JSON that the gateway's `nemo_docs_search` tool loads via `NEMO_DOCS_KB_PATH`:

```bash
# scrape local docs (MDX/MD)
python3 scripts/build-knowledge-base.py \
  --docs ../nemo-router-mono-repo/01-frontend-end/05-resources \
  --base-url https://nemorouter.ai --out knowledge-base.json

# one-shot, same-origin website crawl (bounded)
python3 scripts/build-knowledge-base.py --url https://nemorouter.ai --max-pages 40 --out knowledge-base.json

# then point the gateway at it
export NEMO_DOCS_KB_PATH=$PWD/knowledge-base.json   # restart nemo-backend
```

Run it manually whenever the docs change. If `NEMO_DOCS_KB_PATH` is unset/invalid, the tool falls back to the curated in-code KB (always works offline). The pgvector upgrade (Phase 2) keeps the same tool contract.

## Configurable agents (yaml / json) — "docs link + website link → your own agent"

An agent is **declared in one config file** — `examples/agent.config.yaml` (readable) or `.json` (machine), validated by `examples/agent.config.schema.json`. It says who the agent is (id, name, model, `system_prompt`, `tools`, `visibility`) **and what it knows** (`knowledge.sources`: local `docs` dirs + `website` URLs). Build the agent's knowledge base straight from the config:

```bash
# scrapes every knowledge.source in the config → <agent-id>-knowledge-base.json
python3 scripts/build-knowledge-base.py --config agent.config.yaml
```

**Storage = per-customer (the `knowledge.store` field):**
- `store: json` *(available now)* — emits a KB JSON loaded via `NEMO_DOCS_KB_PATH` (single corpus).
- `store: vector` *(Phase 2)* — ingests into the **per-org pgvector table `nemo.docs_chunks`, RLS-scoped to your `organization_id`** — a **user-specific vector DB**. The `nemo_docs_search` tool then retrieves only *your* corpus, never another tenant's. Same tool contract; the storage swaps underneath.

So yes: a customer points the config at their docs + website, the MCP scrapes them, and the agent answers from their own tenant-scoped knowledge — under their own key, credits, and guardrails. v1 ships the config + scraper + JSON store; per-org agent registration + the vector store land in Phase 2 (`amp-mcp-gateway`). Today agents are registered in `nemo-router-mono-repo/03-nemo-backend/nemo_backend/mcp_gateway/agents.py`; the config file is the forward-compatible authoring format.

## What this is NOT (yet)

- Not a separate API service. No new `agent-api.*` hostname. All routes ship under `api.nemorouter.ai`.
- Not a separate billing system. Tool spend lands in the same `nemo.credit_ledger` and reserve+settle path as LLM spend (Rule #7).
- Not a separate auth system. The agent runtime + widget authenticate using the customer's existing virtual key (Rule #15).
- ~~Not built.~~ **v1 is built** (2026-05-29): gateway routes + agent loop + `nemo_docs_search` tool live in nemo-backend; the embeddable widget lives in `frontend/`. The remaining `amp-*` skill sections describe the Phase-2 roadmap (vault, sessions, per-org agents, playground).

## The hard constraint

**"Must be inline with the Nemo API gateway only — no new APIs."**

Interpretation chosen for these docs (debate in `amp-architecture` if you disagree):

- **No new external API services.** No second FastAPI app, no second hostname, no second deployment unit.
- **New routes on the existing `nemo-backend:8090` gateway ARE allowed**, because they ship through the same `https://api.nemorouter.ai` surface with same auth, same key, same credit ledger, same observability pipeline.
- **The marketplace's own "backend" is a runtime / orchestrator**, not an API. It reads the customer's session, drives the agent loop, and calls Nemo Backend on the customer's behalf. It has no externally callable endpoints.

If you want the stricter interpretation (no new routes at all, agent + tools must ride entirely on `/v1/chat/completions` + OpenAI function-calling), see `docs/design.md` §4.

## Layout

```
agent-market-place/
├── README.md                           ← you are here
├── LICENSE                             ← MIT
├── CONTRIBUTING.md                     ← PR guidelines, security disclosure, rule inheritance from Nemo
├── docs/
│   └── design.md                       ← top-level design doc (constraints, options, decision log, OSS posture)
├── frontend/                           ← TODO: pluggable web chat widget + admin/test playground
│   └── README.md
├── backend/                            ← TODO: agent runtime (no external API surface)
│   └── README.md
├── scripts/
│   └── check-no-new-services.sh        ← stub — will grep for new FastAPI apps / new hostnames
└── .claude/
    └── skills/
        ├── amp-architecture/           ← overall design, the "no new APIs" constraint, OSS posture, dogfood reference
        ├── amp-mcp-gateway/            ← MCP gateway design — new routes added to existing nemo-backend
        ├── amp-central-tool-layer/     ← positioning: same gateway serves widget + Dify + Onyx + customer agents + native MCP clients (7 consumers)
        ├── amp-agent-runtime/          ← agent loop, session state, tool-use convention
        ├── amp-frontend-widget/        ← pluggable embeddable chat widget + playground
        └── amp-billing-observability/  ← tiered flat-rate pricing, credit ledger, trace shape, tool I/O guardrails
```

## Open source — what's public here vs. what stays in private repos

| Lives in this repo (public, MIT) | Lives elsewhere |
|---|---|
| Agent runtime library (`@nemorouter/agent-runtime` npm package) | Gateway routes — `nemo-router-mono-repo/03-nemo-backend/` (public) |
| Pluggable widget bundle (CDN-hosted, source here) | Tool credentials — Google Secret Manager (private) |
| Tool integration descriptors (JSON schemas) | Pricing tables (per-tool cents) — `super-admin-dashboard` (private) |
| All `amp-*` skills + design references | Per-customer agent configs — customer's RLS-scoped Supabase data |
| Example agents (Phase 2 — reference deployments) | Master key — `nemo-router-mono-repo/.env` (private) |
| Tests, fixtures, dev scripts | Deployment Terraform — `nemo-infra-cicd` (private) |

Full boundary map: `.claude/skills/amp-architecture/references/open-source-boundary.md`.

## How this plugs into the existing Nemo ecosystem

| Concern | Reuses (existing) | Extends (new design — TODO) |
|---|---|---|
| Auth | `nemo-virtual-keys` (sk-nemo-xxx) | none — same key, same flow |
| Credits | `nemo-credits` (reserve+settle) | tool calls call `reserve_credits` / `settle_credits` with `service='tool'` |
| Cost | `nemo-cost-tracking` (Rule #4 — LiteLLM owns LLM cost) | tool cost: tiered flat rate (see `amp-billing-observability`) |
| Guardrails | `nemo-guardrails` (PII, injection, content) | tool I/O guardrails — re-run on tool args + responses |
| Observability | `nemo-observability` (request logs, callbacks) | agent-step trace shape (LLM + tool calls in one trace) |
| Tool credentials | (pattern: `sa-provider-accounts`) | `super_admin.tool_accounts` — same vault shape, different table |
| Pricing | `sa-litellm-pricing` (per-model cost calc) | per-tool flat rate + Nemo overhead fee |
| Tenancy | `nemo-org-lifecycle` (org → team → member, Rule #26) | tool catalog scoped at org → team → key (same hierarchy as guardrails) |
| Deploy | `infra-gcp-deploy` (Cloud Run) | no new service to deploy — new routes ship inside nemo-backend rollouts |

## When work starts

Pre-flight checklist (NOT done yet):

- [ ] Create independent **public** git repo `nemorouter/agent-market-place` on GitHub, push, add `MIT` license badge to README
- [ ] Add `agent-market-place` as 5th source in `~/nemorouter/bootstrap.sh` so skills aggregate into `~/.claude/skills/`
- [ ] Get explicit go/no-go on the "new routes on existing gateway" interpretation in `amp-architecture`
- [ ] Pick first 3 tools to launch with — likely the ones the Nemo Support Agent needs first: `nemo-docs-search`, `slack-send`, `github-issue-search` (see dogfood reference)
- [ ] Decide where the agent runtime runs (Cloud Run service inside `<gcp-project>`? Edge function? Browser-side? — see `amp-agent-runtime/references/agent-loop.md`)
- [ ] Confirm pricing tiers with `sa-nemo-business` audit (margin model still healthy at flat rates?)
- [ ] Author the Nemo Support Agent system prompt + tool list (Tier 1 — public docs RAG only) for the dogfood launch

## Not in scope (explicit non-goals)

- Hosting third-party agents written by external developers (Phase 2 conversation — needs sandboxing story).
- Replacing Onyx (`onyx-integration` sibling repo). That product runs full RAG + agent stack as a separate offering. This marketplace is lighter: pluggable widget on top of the existing Nemo key.
- A separate dashboard. The marketplace's admin/playground lives inside the existing `01-frontend-end` dashboard (new route group) — see `amp-frontend-widget`.
- Self-serve developer tool publishing. Initial catalog is curated by Cloudact (same governance as `sa-provider-accounts`).

## See also

- `LICENSE` — MIT
- `CONTRIBUTING.md` — how to contribute (and what kinds of changes belong here vs. in the Nemo monorepo)
- `docs/design.md` — full design doc with constraint analysis + decision log + OSS posture
- `.claude/skills/amp-architecture/SKILL.md` — start here when reading the skill tree
- `.claude/skills/amp-central-tool-layer/SKILL.md` — the centralization story: same gateway, every consumer
- `.claude/skills/amp-architecture/references/open-source-boundary.md` — what's public, what's not, why
- `.claude/skills/amp-architecture/references/nemo-support-agent-dogfood.md` — the canonical first deployment
- `~/nemorouter/CLAUDE.md` — workspace-cockpit conventions
- `~/nemorouter/nemo-router-mono-repo/CLAUDE.md` — the 26 permanent rules this marketplace must respect

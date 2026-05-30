# Standalone Agent Marketplace — Design Doc

> **Status:** APPROVED 2026-05-30 (brainstorming complete). Ready for implementation plan.
> **Owner:** surasani.rama@gmail.com
> **Repo:** `nemorouter/agent-market-place` (public, MIT) — sibling under `~/nemorouter/`.
> **Supersedes the centralized assumption in** `docs/design.md` / `.claude/skills/amp-architecture/` — see §11.

## 0. TL;DR

A customer (e.g. **Acme Inc**) forks **one open-source full-stack Next.js repo**, points it at **their own Supabase project** (which they pay for), sets **their own `sk-nemo` virtual key**, and deploys it (Vercel / their infra). The app is a themable, embeddable support-agent that answers from the customer's own docs + website via RAG.

**Nemo Router provides only two things: (1) LLM capability** (chat + vision + embeddings) **and (2) the MCP gateway** (credentialed tools, Phase 2). Everything else — frontend, backend, vector DB, image storage, hosting — is the customer's own and fully under their control to extend.

Each customer is an independent deploy with its own Supabase + key. Nemo scales because it only ever serves `/v1/*` model calls (already scales). The "marketplace" is a **gallery of forkable agent templates** (support / sales / docs, → 20+).

## 1. Division of responsibility

```
        WHAT NEMO ROUTER OWNS                 WHAT THE CUSTOMER OWNS (open-source fork)
 ┌─────────────────────────────────┐        ┌────────────────────────────────────────┐
 │ /v1/chat/completions  (LLM)     │        │ Frontend  — themable chat widget + admin │
 │   └ text + VISION (images)      │◄───────│ Backend   — /api/chat, /api/ingest, RAG  │
 │ /v1/embeddings        (vectors) │  sk-   │ Supabase  — pgvector KB + chat history +  │
 │ /v1/mcp/tools         (tools)   │  nemo  │             image storage  (THEY pay)    │
 │ guardrails · credits · logs     │───────►│ Deploy    — Vercel / their own infra     │
 └─────────────────────────────────┘        └────────────────────────────────────────┘
        Nemo bills the sk-nemo key                  Supabase + hosting bill is theirs
```

- **Nemo does all GPU/model work** (chat, vision, embeddings) + the tool layer. **Customer does all storage + UI + hosting.** Clean line.
- This keeps the strictest reading of "no new Nemo APIs" — the customer backend is a **Nemo API client**, not a new Nemo service. A pure-RAG agent needs **zero new routes** on nemo-backend.

## 2. Topology & flows

### Flow A — each customer = own deploy + own Supabase, shared Nemo brain

```
   ACME INC                                  BETA CORP
 ┌──────────────────────────┐            ┌──────────────────────────┐
 │ fork of                  │            │ fork of                  │
 │ nemorouter/support-agent │            │ nemorouter/support-agent │
 │  Next.js  FE + API(BE)   │            │  Next.js  FE + API(BE)   │
 │  theme + system_prompt   │            │  theme + system_prompt   │
 │            │             │            │            │             │
 │            ▼             │            │            ▼             │
 │  ACME Supabase (pgvector)│            │  BETA Supabase (pgvector)│
 └──────────┬───────────────┘            └──────────┬───────────────┘
            │  Bearer sk-nemo-ACME                  │  Bearer sk-nemo-BETA
            └────────────────────┬──────────────────┘
                                 ▼
                 ┌───────────────────────────────┐
                 │   api.nemorouter.ai           │ ← shared brain · NO new APIs
                 │   /v1/chat/completions (LLM+vision)
                 │   /v1/embeddings (ingestion)  │
                 │   [/v1/mcp/tools] (Phase 2)   │
                 │   guardrails · credits · logs │
                 └───────────────────────────────┘
```

### Flow B — one chat turn

```
visitor: "how do I reset my API key?"
   │
   ▼
Acme widget (browser) ──POST /api/chat──► Acme backend (Next API route)
                                              │
                              1. embed query ───► Nemo /v1/embeddings  (sk-nemo-ACME)
                              2. search top-k ──► Acme Supabase (pgvector)
                              3. prompt = system_prompt + chunks + question
                              4. ───────────────► Nemo /v1/chat/completions (stream)
                                              │     ← answer · cost header · credits settled
                                              ▼
visitor ◄──────────── streamed answer ◄────── Acme backend
```

The `sk-nemo` key lives **server-side only** (the customer backend env). The browser talks only to the customer's `/api/chat`, never to Nemo directly — strictly more secure than the key-in-sessionStorage pattern.

### Flow C — ingestion (Option 3: standalone backend → customer's own Supabase)

```
"Re-index" admin action / cron
   │
   ▼
/api/ingest  ──► crawl WEBSITE_URL (same-origin, bounded) + read ./docs (MD/MDX)
             ──► chunk
             ──► Nemo /v1/embeddings  (sk-nemo)
             ──► upsert into Acme Supabase pgvector (RLS-scoped)
```

## 3. Agent identity = a virtual key (the "registration" question, resolved)

An agent does **not** need a new registration entity in Nemo. The only mandatory Nemo-side step is **create a virtual key** — a primitive that already exists (`nemo-virtual-keys`).

```
 MANDATORY (Nemo dashboard) : create ONE virtual key per agent
   └ name it "Acme Support Agent"
   └ BUDGET ($5/day)    ← the HARD spend cap, enforced SERVER-SIDE by Nemo (Layer 4)
   └ RATE LIMIT (RPM/TPM)← server-side backstop to the customer's own limiter
 OPTIONAL (Nemo dashboard) : tag the key as "agent" → shows in dashboard "Agents" view
 NEVER (Nemo)              : prompt / sources / theme / origins → live in the customer's
                            OWN repo + Supabase. Nemo never sees the agent definition.
```

> **Agent identity = a named virtual key with a budget. Agent definition = the customer's own repo + Supabase.**

The per-key budget is the unbreakable safety net: even if every protection in the forked backend is bypassed, **Nemo refuses to spend past the cap.**

## 4. Repo shape — one full-stack Next.js app

```
support-agent/                      ← the template customers fork (one deploy, one .env)
├── app/
│   ├── page.tsx                    ← full-page chat (optional hosted page)
│   ├── admin/                      ← tiny admin: prompt, theme, sources, security, re-index
│   └── api/
│       ├── chat/route.ts           ← retrieve → Nemo chat (stream); applies security layers
│       └── ingest/route.ts         ← crawl + read docs → embed → pgvector
├── widget/
│   └── embed.ts                    ← <script src=".../widget.js"> build output (themable)
├── lib/
│   ├── nemo.ts                     ← Nemo client (chat, vision, embeddings); NEMO_BASE_URL
│   ├── retrieval.ts                ← pgvector query (extensible)
│   ├── ingest/                     ← source adapters (docs, website; +Notion/PDF via interface)
│   ├── security/                   ← origin allow-list, rate limit, captcha, daily cap
│   └── hooks.ts                    ← beforeRetrieve/afterRetrieve/beforeLLM/afterLLM seams
├── supabase/
│   └── migration.sql               ← pgvector KB + chat history + image refs + agent_config, RLS
├── agents/                         ← starter agent configs (see §8)
├── .env.example
└── README.md                       ← fork → Supabase → env → ingest → deploy
```

## 5. Knowledge ingestion (Option 3 · pgvector in the customer's Supabase)

- **Sources:** local `./docs` (MD/MDX) + a bounded same-origin website crawl. Extensible via a source-adapter interface (Notion, sitemap, PDF, DB = later).
- **Store:** `pgvector` in the **customer's own** Supabase, RLS-scoped. They own and pay for it.
- **Embeddings:** Nemo `/v1/embeddings` (v1 default — it's "LLM capability"). A local-embedding fallback is a documented Phase-2 option for fully-offline self-host.
- **Refresh:** manual "Re-index" admin action (v1) + optional cron (Phase 2).

## 6. Security & Limits (layered, configurable)

Origin-check alone is spoofable, so defense is layered. **Layers 1–3 live in the customer backend; Layer 4 lives on the Nemo virtual key (server-enforced) — the real safety net.**

```
Layer 1  Origin allow-list      → blocks other sites embedding the widget
Layer 2  Rate limit (IP+session)→ blocks volume abuse
Layer 3  Captcha (Turnstile…)   → blocks bots
Layer 4  Per-day BUDGET on the  → hard spend ceiling, enforced by NEMO even if 1–3 fail
         virtual key
```

Config (env defaults → admin-overridable, stored in the customer's Supabase):

```yaml
ALLOWED_ORIGINS:  ["https://acme.com", "https://*.acme.com", "http://localhost:3000"]  # list + wildcard, NOT a single origin
RATE_LIMIT:       { per_ip: "20/min", per_session: "10/min", per_ip_per_day: 500 }
CAPTCHA:          { enabled: true, provider: "turnstile", trigger: "after_3_messages" }
REQUIRE_EMAIL:    false
BLOCKLIST:        { ips: [], countries: [] }
NEMO_BASE_URL:    "https://api.nemorouter.ai"   # repoint for self-hosted Nemo
# Hard per-day spend cap is set as the virtual-key BUDGET in the Nemo dashboard (Layer 4).
```

## 7. Extensibility — "frontend control AND backend control to extend further"

Because the customer owns the fork, extension is unlimited; clean seams keep common extensions out of core so the fork stays upgradeable (`git pull` upstream).

```
FRONTEND (their app — full control)
  Config-only : theme tokens (color/font/radius/logo/position), launcher, welcome, quick-replies
  Slots       : swap <Header/> <MessageBubble/> <Launcher/> <Composer/>
  Events      : onOpen / onMessage / onCitation / onEscalate
  Full edit   : it's their Next.js app

BACKEND (their API routes — full control)
  Config-only : prompt, model, sources, security/limits, NEMO_BASE_URL
  Loop hooks  : beforeRetrieve / afterRetrieve / beforeLLM / afterLLM (rerank, redact, CRM log)
  Sources     : add an ingestion adapter (Notion, sitemap, PDF, DB) — one interface
  Retrieval   : extend the pgvector query (filters, hybrid search)
  Tools — two paths:
     · LOCAL tool → a function in THEIR backend (call Acme's order API) — full freedom, no Nemo
     · NEMO tool  → register a credentialed tool in the MCP gateway (vault+billing+guardrails) [Phase 2]

UPGRADE-SAFE : core in a package; extensions in config + /custom adapters + hooks
```

## 8. Agents / templates (the marketplace content)

"We need agents as well." The marketplace ships starter templates, all the same framework, differing by config (prompt + sources + theme + suggested tools):

| Agent | v1 capability | Phase 2 tools |
|---|---|---|
| **support-agent** (flagship, dogfood) | RAG over docs + website, escalate-to-email | Slack escalate, GitHub issue search |
| **docs-agent** | RAG over a docs site, citation-first answers | — |
| **sales-agent** | RAG over product/pricing pages + lead capture | CRM upsert, calendar booking |
| _…path to 20+_ | each = one `agents/<name>.config.(yaml\|json)` + a theme preset | — |

Each template is a thin config over the shared runtime — adding an agent = adding a config + preset, not a new codebase. The flagship **support-agent** is our own dogfood (Nemo Support Agent on `nemorouter.ai`).

## 9. What Nemo provides (and only this)

- `/v1/chat/completions` — text + **vision** (image attachments flow: widget → customer Supabase Storage → vision model).
- `/v1/embeddings` — ingestion + query embeddings.
- `/v1/mcp/tools` — credentialed tool gateway (vault + billing + guardrails) — **Phase 2** power-up.
- Inherited free on every call: guardrails, credit reserve+settle, observability/logs.
- Virtual keys with budget + rate limit (Layer-4 safety + agent identity).

## 10. Marketplace surface

- **v1:** a **template gallery** (GitHub) + **"Deploy to Vercel"** (env prefill) + a Nemo dashboard "Agents" page that shows the repo link, required env, and an example agent.
- **Phase 2:** hosted one-click (Nemo provisions the Supabase + deploy for the customer).

## 11. Relationship to the existing `amp-*` v1 / divergence

The shipped v1 + `amp-architecture` assumed a **centralized** model (agent loop in-process inside nemo-backend, shared Nemo Supabase). This design **inverts** that for the customer-owned case:

- **Centralized model (existing):** good for the hosted/managed path + the MCP tool gateway. Kept for tools.
- **Standalone model (this doc):** the customer owns FE+BE+Supabase and ships outside Nemo; Nemo is just the brain. This is the strict "no new Nemo APIs" reading and the primary v1 path.

Both coexist: **pure-RAG agents run standalone; credentialed-tool agents use the central MCP gateway.** The `amp-*` skill docs should be updated to record this hybrid (follow-up).

## 12. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-05-30 | Flow A — per-customer fork + own Supabase + own key | "Ship outside Nemo Router"; customer owns + pays for storage. |
| 2026-05-30 | Option 3 — standalone backend ingests into customer Supabase (pgvector) | Live, per-customer, RLS, real retrieval; customer owns the vector DB. |
| 2026-05-30 | Nemo provides only LLM (chat+vision+embeddings) + MCP gateway | Clean GPU-vs-storage split; strict "no new APIs." |
| 2026-05-30 | Agent identity = named virtual key with budget; definition in customer Supabase | No new registration entity; budget = server-side hard spend cap. |
| 2026-05-30 | One full-stack Next.js repo as the template | Lightest "FE+BE+own-Supabase" that still has a real backend. |
| 2026-05-30 | Layered security; ALLOWED_ORIGINS is a list + wildcard, not single origin | Real customers have apex+www+subdomains+staging+localhost. |
| 2026-05-30 | Embeddings = Nemo `/v1/embeddings` only for v1 (local fallback = Phase 2) | Simplest; vision/chat/embeddings all one provider. |
| 2026-05-30 | Marketplace v1 = template gallery + Deploy-to-Vercel + dashboard env/example | Scales to millions of independent deploys; hosted one-click later. |
| 2026-05-30 | Pure-RAG v1; credentialed tools via MCP gateway = Phase 2 | Lightest launch; no vault/new routes needed for v1. |
| 2026-05-30 | Repo layout = `agents/<name>/` (production apps), not `templates/` | Each agent is a self-contained, forkable, deployable app (FE+BE+infra). |
| 2026-05-30 | Multi-env (`.env.local/.stage/.prod`) + `CLOUD`-dispatched deploy | One file per env, one command per env. `local` + `gcp` (Cloud Run) today; `azure`/`aws` stubbed (same Dockerfile, `$PORT`-driven). Mirrors Nemo `active-cloud`. |
| 2026-05-30 | Next.js `output: 'standalone'` + Dockerfile | One image runs on Cloud Run today, Azure Container Apps / any host tomorrow. |

## 13. Implementation phases (drives the plan)

- **Phase 1 — runtime skeleton:** Next.js app, `lib/nemo.ts`, `/api/chat` (stream), Supabase migration (pgvector + RLS), `/api/ingest` (docs + website), retrieval.
- **Phase 2 — security & limits:** origin allow-list, rate limiter, captcha, config surface (env + Supabase `agent_config`), wire Layer-4 to virtual-key budget docs.
- **Phase 3 — widget + theming:** embeddable `<script>` build, theme tokens, slots, events; image-attach (Supabase Storage → vision).
- **Phase 4 — agents/templates:** `agents/` configs + theme presets for support/docs/sales; dogfood the support-agent.
- **Phase 5 — marketplace surface:** template gallery + Deploy-to-Vercel + dashboard "Agents" page (repo + env + example).
- **Phase 6 (later):** MCP/credentialed tools, hosted one-click, local-embedding fallback, scheduled re-index, conversation memory.

## 14. Out of scope (v1)

- Credentialed tools / MCP gateway integration (Phase 2 — the central gateway already exists).
- Hosted one-click provisioning.
- Multi-agent orchestration; voice/audio.
- Vision-on-ingest (reading images inside docs).

## 15. References

- `docs/design.md` — the prior centralized design (this doc supersedes its customer-facing assumption; see §11).
- `.claude/skills/amp-*` — the central-gateway side (kept for tools).
- `~/nemorouter/nemo-router-mono-repo/.claude/rules/00-permanent-rules.md` — inherited rules (#2 no BYOK, #7 credits, #13 RLS, #15 virtual keys).
- `examples/agent.config.yaml` + `examples/agent.config.schema.json` — the agent config schema the `agents/` templates and the admin form share.

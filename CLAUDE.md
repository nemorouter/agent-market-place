# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This repo is a **sibling under `~/nemorouter/`**, so sessions here also auto-discover the
> workspace `~/nemorouter/CLAUDE.md` and the mono-repo's `.claude/rules/` (the 28 Nemo Rules).
> This file covers only what is **specific to agent-market-place**; the inherited rules below
> (virtual-key auth, credit reserve+settle, LiteLLM-owns-cost, no-BYOK) still apply here.

## What this repo is

A **public, MIT, pluggable agent marketplace** for Nemo Router. It ships two independently
deployable things, plus design skills:

1. **`agents/customer-service-agent/`** — the **runnable** Next.js app (this is ~all the code).
   A standalone, forkable support agent: it owns its **own frontend + backend + vector DB**
   (its own Supabase) and authenticates with **one `sk-nemo-xxx` virtual key**. `agents/guru-cs-agent/`
   and `agents/restaurant-agent/` are **config-only instances** of this same runtime (no
   `package.json`) — they ship a config + docs, not code.
2. **`frontend/`** — `@nemorouter/agent-widget`: a zero-dependency, framework-agnostic,
   Shadow-DOM embeddable chat widget (`pnpm`, separate from the app). `src/core.ts` is the
   streaming client; `src/embed.ts` is the `<script>` widget.

**The MCP tool gateway is NOT in this repo.** It lives in nemo-backend at
`~/nemorouter/nemo-router-mono-repo/03-nemo-backend/nemo_backend/mcp_gateway/` (routes
`/v1/mcp/tools`, `/v1/mcp/tools/{id}/call`, `/v1/agents/{id}/respond`). When a change needs
the gateway (new tool, credential passthrough), edit there — this repo only **consumes** it.

### The hard constraint — "no new APIs"
Everything rides the **existing** `api.nemorouter.ai` gateway with the customer's one
`sk-nemo` key. No new API service, no new hostname. The agent app's `/api/*` routes are its
own Next.js routes (config/auth/ingest), not new Nemo gateway endpoints. `scripts/check-no-new-services.sh`
guards this.

## Working in `agents/customer-service-agent/` (the app)

All commands run from that directory (`npm`, Next.js 14):

```bash
npm run dev                       # http://localhost:3000 (reads .env.local)
npm test                          # vitest run — all __tests__/*.test.ts
npx vitest run __tests__/vault.test.ts   # a SINGLE test file
npm run typecheck                 # tsc --noEmit
npm run build                     # prebuild bundles the widget (esbuild widget/embed.ts → public/widget.js), then next build
npm run ingest                    # POST /api/ingest → scrape ./docs + WEBSITE_URL → embed → Supabase
npm run deploy:{local,stage,prod} # see "Deploy" — but deploy.sh is currently unusable (below)
```

CI (`.github/workflows/ci.yml`) runs `typecheck → test → build` for this app on push to `main` + PRs.

### Request flows (read these together to understand the app)
- **Chat** (`app/api/chat/route.ts`): origin allow-list → rate limit → captcha (`lib/security.ts`)
  → resolve visitor server-side (`lib/identity.ts`) → overlay operator settings (`lib/settings.ts`)
  → RAG retrieve from the agent's own pgvector (`lib/retrieval.ts`) → **optional bounded tool-use
  loop** against the gateway (`lib/tools.ts runToolLoop`, gated on `settings.enabledTools`) →
  stream from Nemo (`lib/nemo.ts`). Tool steps are surfaced as `nemo_event: tool_call` SSE.
- **`lib/nemo.ts` is the ONLY model client** — every chat/embedding call goes through it with
  the `sk-nemo` key (server-side only, never the browser; Rule #15). It never reimplements
  guardrails/credits/cost — Nemo does that. Cost rides back as `x-nemo-response-cost`.
- **Ingest** (`app/api/ingest/route.ts` + `lib/ingest.ts`): docs dir + bounded website crawl →
  Nemo embeddings → `kb_chunks`.

### Config model — env defaults, Supabase overlay (no redeploy)
`lib/config.ts` reads everything from env (12-factor). On top of that, `lib/settings.ts` overlays
an **`agent_config` row in the agent's own Supabase**, editable live from **`/admin`** (name,
system prompt, model, suggestions, quick links, contact methods, enabled tools). Resolution:
built-in defaults → env → Supabase row. Any overlay failure degrades to env defaults — the
chat path must never break. The public projection (`GET /api/config`) never leaks
`systemPrompt`/`model`/`enabledTools`.

### Auth model (two surfaces, do not conflate)
- **Customer LLM/tool traffic** → the `sk-nemo` virtual key, server-side only.
- **`/admin` operator access** → **email-OTP** (humans) **or** `ADMIN_TOKEN` bearer (machines/
  scripts). `lib/admin-auth.ts isAuthorized()` accepts a signed session cookie **or** the token.
  OTP is **self-contained**: code emailed via **SendGrid** (`lib/email.ts`), verified against an
  HMAC-signed challenge cookie, then a local signed session. **No Supabase Auth, no `auth.users`** —
  deliberately isolated from Nemo user logins. Allowlisted by `ADMIN_EMAILS`; secret = `ADMIN_SESSION_SECRET`.

### Credential vault (agent-infra-only)
Tool secrets are sealed AES-256-GCM by `lib/vault.ts` with `TOOL_VAULT_KEY` — a key that lives
**only in this agent's env**. Only ciphertext is stored (`tool_credentials`); the platform never
holds the key. At tool-call time the agent decrypts and passes the secret to the gateway for one
transient call (the gateway reads `body.credential` → `ToolContext.credential`).

### Supabase
The agent's own project, selected by `SUPABASE_SCHEMA` (prod uses a dedicated **`nemo`** schema;
separate-project forks use `public` — **never `public` of the shared Nemo DB**, Rule #12). Tables:
`kb_chunks`, `chat_messages`, `agent_config`, `tool_credentials` — DDL in `supabase/migration.sql`
(additive + idempotent; run per-schema). Writes use the service-role key; the public anon key gets
no direct table access (reads go through `match_chunks` RPC).

### Production, scale & multi-tenancy
**`PRODUCTION.md` is the authoritative posture doc** (isolation model, scale, security layers,
deploy checklist). Tenancy is **isolation-by-deployment**: one fork per customer, each with its
own Supabase + its own `sk-nemo` key (per-day budget = hard spend cap) + its own `TOOL_VAULT_KEY`
— "thousands of customers" = thousands of isolated forks against the one gateway, not one process
host-routing many tenants. Horizontal scale is real: the rate limiter is **distributed**
(`UPSTASH_REDIS_REST_*` → shared window across instances; in-memory fallback never breaks chat),
every Nemo call is **timeout-bounded** (`NEMO_TIMEOUT_MS` / `NEMO_STREAM_TIMEOUT_MS`), inbound
payloads are **capped** before any spend (`validateChatPayload`, `MAX_MESSAGES/_CHARS`), and
**`GET /api/health[?ready=1]`** drives LB / Cloud Run probes (503 until Supabase + key are ready).
Security headers + `/admin` frame-lockdown live in `middleware.ts`.

## Deploy (manual — the script is broken)

The app deploys as its **own Cloud Run service `guru-cs-agent`** (`nemo-prod-deploy` / `us-central1`),
**not** via the bundled `scripts/deploy.sh` (its `source .env.<env>` chokes on spaced values, and
`gcloud run deploy --source` needs Cloud Build, which is disabled for the deploy SA). There is **no
CI/CD pipeline** — deploys are manual, matching the existing `em-<sha>` image-tag convention:

```bash
cd agents/customer-service-agent
SHA=$(git rev-parse --short HEAD); IMG=us-central1-docker.pkg.dev/nemo-prod-deploy/nemo-router/guru-cs-agent:em-$SHA
docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_AGENT_NAME="Ask AI Guru" -t "$IMG" .   # amd64 is required
docker push "$IMG"
TMP=$(mktemp).yaml; python3 scripts/env-to-yaml.py .env.prod yaml > "$TMP"   # proper env parser (NOT source)
gcloud run deploy guru-cs-agent --image "$IMG" --project nemo-prod-deploy --region us-central1 \
  --platform managed --allow-unauthenticated --port 8080 --env-vars-file "$TMP"
```
After every deploy, run a revision-scoped error-log scan (Rule #21) before declaring success.

Per-env config lives in `.env.{local,stage,prod}` — **symlinks** into
`~/.nemo_admin_keys/env-creds/amp-customer-service-agent/` (real secrets, never committed; document
field names in `.env.local.example`). Schema-affecting changes need the `migration.sql` block applied
to the target Supabase schema first.

## Knowledge base + configurable agents

`scripts/build-knowledge-base.py` (Python stdlib only) scrapes a local docs dir and/or a website
into one KB JSON the gateway's `nemo_docs_search` tool loads via `NEMO_DOCS_KB_PATH`. An agent is
declared in `examples/agent.config.yaml` (schema: `examples/agent.config.schema.json`):
`--config agent.config.yaml` scrapes every `knowledge.source`. `store: json` ships now; `store:
vector` (per-org RLS-scoped pgvector) is Phase 2.

## Skills (`.claude/skills/amp-*`)

Six design skills (`amp-architecture` first; then `-mcp-gateway`, `-agent-runtime`,
`-frontend-widget`, `-central-tool-layer`, `-billing-observability`). They are the **design +
Phase-2 roadmap**; each carries a top status block noting what is actually shipped/live vs.
roadmap — trust that block over the body when they differ. Validate after edits:
`bash ~/nemorouter/scripts/validate-skills.sh`. The slash command `/restart-amp-cs-local` restarts
the local app on **:3003**.

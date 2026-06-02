# customer-service-agent

An open-source, themable **support agent** — one full-stack Next.js app you fork and
deploy. It answers from **your own docs + website** (RAG), and uses **Nemo Router**
as the brain for every model call.

> **The split:** Nemo Router provides the **LLM (chat + vision + embeddings)** and the
> **tool gateway**. *You* own the **frontend, backend, and vector DB** (your own
> Supabase project, which you pay for). One `sk-nemo` key, one bill, one credit ledger.

This same template powers other agent types — see [`../restaurant-agent`](../restaurant-agent)
for the same skeleton with a different prompt + knowledge. A new agent = new config + docs,
not a new codebase.

---

## What Nemo enforces for you (you don't reimplement this)

Every model call goes through the Nemo gateway, so Nemo applies, server-side:

| Concern | How | Where you see it |
|---|---|---|
| **Guardrails** (content safety, PII, prompt-injection) | on the chat request + response | a `guardrail_blocked` error surfaces in the widget |
| **Routing / fallback** | set `MODEL` to a model **or a Nemo `model_group` alias** | Nemo picks/fails-over; you just name it |
| **Credits** (reserve + settle, platform fee) | metered on your `sk-nemo` key | `x-nemo-response-cost` header on each reply |
| **Rate limits** (RPM/TPM) | on the virtual key | a `rate_limited` (429) surfaces cleanly |
| **Spend ceiling** (the hard cap) | the **per-day BUDGET** on the key | Nemo refuses to spend past it — your safety net |

Your app's job is the rest: retrieval from your KB, the four abuse-protection layers,
the UI. See [`lib/nemo.ts`](lib/nemo.ts) — the only file that talks to a model.

## Abuse protection — four layers

```
Layer 1  origin allow-list   (lib/security.ts)  → blocks other sites embedding the widget
Layer 2  rate limit IP+session                  → blocks volume abuse
Layer 3  captcha (Turnstile)                     → blocks bots
Layer 4  per-day BUDGET on the Nemo key          → hard spend cap, enforced by NEMO even if 1-3 fail
```

`ALLOWED_ORIGINS` is a **list with wildcard support** (`https://acme.com,https://*.acme.com,http://localhost:3000`),
never a single origin.

---

## Walk-through — stand up the Acme support agent

### 1. Fork + install
```bash
git clone <your-fork> acme-support && cd acme-support
npm install
```

### 2. Create Acme's OWN Supabase project (separate, Acme pays for it)
- Create a new project at https://supabase.com/dashboard.
- Open **SQL Editor**, paste [`supabase/migration.sql`](supabase/migration.sql), **Run**.
  (This enables `pgvector` and creates `kb_chunks` + `match_chunks()` with RLS on.)
- Copy the **Project URL**, **anon key**, and **service-role key** from
  **Settings → API**.

> Vector dimension must match your embedding model. Nemo Router serves **Vertex AI
> embeddings** — `text-embedding-005` = **768** (the migration default). Change the
> model → change `vector(N)` in `supabase/migration.sql` (two places).

### 3. Create the Nemo virtual key (the agent's identity + safety net)
- In the **Nemo dashboard**, create a virtual key named **"Acme Support Agent"**.
- Set a **per-day budget** (e.g. `$5`) → this is your Layer-4 hard cap.
- Set an **RPM/TPM rate limit** → server-side backstop.
- Confirm Nemo serves your `MODEL` and `EMBEDDING_MODEL` (dashboard → Models / `GET /v1/models`).

### 4. Configure env — one file per environment
There are three env files; copy the example you need and fill the ★ values:
```bash
cp .env.local.example .env.local     # local dev   (CLOUD=local)
cp .env.stage.example .env.stage     # staging     (CLOUD=gcp)
cp .env.prod.example  .env.prod      # production  (CLOUD=gcp ; tomorrow: azure/aws)
```
For local you only need 4 values: `NEMOROUTER_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_TOKEN`. The real `.env.*` files are gitignored.

### 5. Run Acme locally + index its knowledge
```bash
npm run dev            # http://localhost:3000  (reads .env.local)
npm run ingest         # reads ./docs (+ WEBSITE_URL) → embeds → Acme's Supabase
# → { "ok": true, "sources": N, "chunks": M }
```
Open http://localhost:3000 and ask "how do I reset my password?" — Acme answers
from its own KB. **That's the local "boom, it works" loop.**

### 6. Embed the widget
One tag on Acme's site (the widget talks only to your `/api/chat`, so the
`sk-nemo` key never reaches the browser):
```html
<script src="https://YOUR-DEPLOY/widget.js"
        data-endpoint="https://YOUR-DEPLOY/api/chat"
        data-accent="#4f46e5" data-title="Acme Support"></script>
```

### 7. Deploy — one command per environment
The cloud is chosen by `CLOUD` inside each env file (mirrors Nemo's `active-cloud`).
```bash
npm run deploy:local   # build + run locally
npm run deploy:stage   # → Google Cloud Run  (CLOUD=gcp)
npm run deploy:prod    # → Google Cloud Run  (CLOUD=gcp)
```
**Today:** `CLOUD=gcp` deploys to Google Cloud Run (`gcloud run deploy --source .`,
builds the included `Dockerfile`, passes env via `--env-vars-file`).
**Tomorrow:** set `CLOUD=azure` (Container Apps) or `CLOUD=aws` — same files, same
command; the dispatch stub already lives in `scripts/deploy.sh`. The image is
`$PORT`-driven so it runs unchanged on any container host. After deploy, index prod:
```bash
./scripts/ingest.sh prod https://acme-support-xxxx.run.app
```

---

## How another customer (Beta Corp) uses this
Same fork, **their own** Supabase project, **their own** `sk-nemo` key, their own
`ALLOWED_ORIGINS`. Nothing is shared except Nemo Router. To run fully outside Nemo,
point `NEMO_BASE_URL` at a self-hosted Nemo gateway.

## Configure from the dashboard — `/admin` (no redeploy)
Open **`/admin`** and sign in. **Humans** log in with **email OTP** — only addresses on
`ADMIN_EMAILS` can request a 6-digit code (sent via Supabase Auth); a valid code mints an
HttpOnly session cookie. **Machines/scripts** (e.g. `scripts/ingest.sh`) keep using the
`ADMIN_TOKEN` bearer. Both are accepted by every admin route (`lib/admin-auth.ts`); set
`ADMIN_SESSION_SECRET` to enable OTP. Once in, edit the agent's **name, system prompt, model, suggestion chips, quick links, and
contact methods (phone / email / support)** in a UI. Save writes a single
`agent_config` row to **your own Supabase**; the widget reads it from
`GET /api/config` on open. The token lives in `sessionStorage` only (cleared on tab
close — mirrors the playground-key model), and is never read during render.

Resolution order is **built-in defaults → env vars → your Supabase row** (last wins).
Anything you leave blank falls back to the env/`agent.config.yaml` defaults, so an
un-configured fork looks exactly like before. Dangerous hrefs (`javascript:`,
`data:`) are dropped server-side; phone numbers become `tel:`, emails `mailto:`.
The system prompt + model edits flow straight into `/api/chat`. All in
[`lib/settings.ts`](lib/settings.ts) + [`app/admin/page.tsx`](app/admin/page.tsx);
the table ships in [`supabase/migration.sql`](supabase/migration.sql).

## Tools — the Nemo MCP gateway (Phase 2)
The agent can call **gateway tools** on top of its own RAG. Tools are **off by default**
(pure RAG); enable them per agent in **`/admin` → Tools**, which lists the tools your
`sk-nemo` key can see (`GET /v1/mcp/tools`). When the chat route sees enabled tools, it
runs a **bounded tool-decision loop** ([`lib/tools.ts`](lib/tools.ts) `runToolLoop`):
the model picks a tool → the gateway executes it (guardrail → reserve credits → run →
settle → audit, all server-side) → the result is folded into the answer's context, then
the final answer streams. Tool steps surface live in the widget ("Using …").

Everything is **graceful**: an unreachable gateway, an unsupported model, or a tool
error → the agent simply answers without tools. The agent reuses its **one `sk-nemo`
key** for tools too — one bill, one ledger, per-key limits (no new auth, no new API).
The gateway itself lives in nemo-backend; this app is only a **consumer**. Seed defaults
with `TOOLS_ENABLED=nemo_docs_search`; `/admin` overrides at runtime.

**Credential vault (agent-infra-only).** For tools that need a secret (an API token),
the operator pastes it in **`/admin` → Tools**; it's sealed with **AES-256-GCM** by
[`lib/vault.ts`](lib/vault.ts) using `TOOL_VAULT_KEY` — a key that lives **only in this
agent's env**. Only the **ciphertext** is stored (in the agent's own Supabase,
`tool_credentials`); nemo-backend never holds the key or the secret. At tool time the
agent **decrypts** and passes the secret to the gateway for **one transient call** — the
gateway uses it and never stores or logs it. A DB dump alone is useless without the env
key, and no other agent (or the platform) can decrypt it.

## Personalization — "Hello Guru" for signed-in visitors
Off by default (anonymous). Turn it on with **env vars, not code** — so 1000 forks
each enable it the same way. The widget calls a same-origin `GET /api/session`,
which resolves the visitor **server-side** (the browser can never spoof who it is)
and returns only `{ authenticated, displayName, links }`. When signed in, the hero
greets by name, the rail shows the visitor's own account links, and `/api/chat`
injects a persona block (greeting + account links + plan steer) and scopes docs to
their entitlements. All in [`lib/identity.ts`](lib/identity.ts).

Pick **one** `IDENTITY_MODE` — no code change for the first four:

| Mode | When to use | Set |
|---|---|---|
| `none` | anonymous (default) | — |
| `jwt` | you set a signed JWT cookie | `IDENTITY_JWT_SECRET`, `IDENTITY_COOKIE`, `IDENTITY_CLAIM_*` |
| `header` | an auth proxy fronts you (oauth2-proxy, ALB OIDC, Cloudflare Access) | `IDENTITY_HEADER`, `IDENTITY_HEADER_ATTRIBUTES` |
| `introspect` | you already have a "who am I" endpoint — works with **any** auth stack | `IDENTITY_INTROSPECT_URL` |
| `custom` | exotic auth | write `lib/identity.custom.ts` exporting `resolve(req, cfg)` |

```bash
# Example: JWT cookie, greet by name, show their dashboard, scope docs by plan
IDENTITY_MODE=jwt
IDENTITY_JWT_SECRET=your-hs256-secret
IDENTITY_CLAIM_ATTRIBUTES=org,plan
IDENTITY_LINKS=[{"label":"Your dashboard","url":"https://acme.com/app/{org}"}]
IDENTITY_DOC_AUDIENCE_ATTR=plan          # needs the audiences column (supabase/migration.sql)
```

**Where login comes from — not Nemo.** Nemo Router only ever sees the server-side
`sk-nemo` key; it has **no idea** whether a visitor is logged in, and it shouldn't.
"Logged in" is *your* app's signal, read from *your* cookie / header / session
endpoint. That's why this layer is vendor-neutral — nothing here is Nemo-specific.

**Embedding the widget on your site:**
- **Same-site** (deploy at `support.acme.com`, cookie scoped to `.acme.com`) → the
  widget reads your login cookie server-side. **Nothing to wire** — pure cookie.
- **Cross-origin** (agent on a different domain) → browsers block third-party
  cookies, so hand the widget a signed token (a JWT your app mints for the user,
  `IDENTITY_MODE=jwt`). Dependency-free, two ways:
  ```html
  <script src=".../widget.js" data-identity-token="<jwt>"></script>
  ```
  ```js
  window.AskGuru.identify('<jwt>')   // SPAs: call after login; '' to sign out
  ```
  The token is forwarded into the iframe and verified **server-side** — same as the
  Intercom/Zendesk identity-verification pattern. It never touches Nemo.

**Tagging docs by tier:** re-run `supabase/migration.sql` for the additive
`audiences` column (existing rows default to `{public}` — prior behavior unchanged),
then add frontmatter to the docs you want gated:
```md
---
audiences: [pro, enterprise]
---
# Advanced SSO setup
```
Untagged docs stay public. A `pro` user sees `{public}` + `{pro}` chunks; anonymous
visitors see only `{public}`.

## Develop & verify
```bash
npm run build:widget   # bundle widget/embed.ts → public/widget.js (also runs on build)
npm run typecheck      # tsc --noEmit
npm test               # vitest (origin allow-list, rate limit, chunking)
npm run build          # production build (Next standalone)
```
CI runs typecheck + tests + build on every push/PR (`.github/workflows/ci.yml`).

## Extending it
- **Frontend:** edit [`app/page.tsx`](app/page.tsx) / [`widget/embed.ts`](widget/embed.ts) — theme via CSS vars / `data-*`, add slots, wire events.
- **Backend:** add loop hooks, new ingestion adapters (Notion/PDF/sitemap) in [`lib/ingest.ts`](lib/ingest.ts), or extend retrieval filters in [`lib/retrieval.ts`](lib/retrieval.ts).
- **Tools (Phase 2):** add a **local** function tool in your backend, or a **credentialed** tool via the Nemo MCP gateway (vault + billing + guardrails).

## File map
```
app/page.tsx          themable chat tester (frontend extension point)
app/admin/page.tsx    operator config dashboard (token-gated; edits all settings)
app/api/chat/route.ts public chat: Layers 1-3 → identity → settings → retrieve → stream from Nemo
app/api/session/route.ts who-is-the-visitor (browser-safe identity for the greeting)
app/api/config/route.ts read (public projection) / write (admin) the editable settings
app/api/tools/route.ts  admin-gated MCP gateway tool catalog (for the /admin Tools UI)
app/api/tool-credentials/route.ts admin-gated set/clear/status of sealed tool secrets
app/api/ingest/route.ts admin-gated re-index
Dockerfile            Next standalone image (Cloud Run / ACA / any container host)
scripts/deploy.sh     one-command deploy: local | gcp (today) | azure/aws (tomorrow)
scripts/ingest.sh     re-index against local or a deployed URL
scripts/env-to-yaml.py  .env.<env> → Cloud Run --env-vars-file (comma-safe)
.env.local/stage/prod.example  per-environment config (copy → fill ★ → deploy)
lib/nemo.ts           the ONLY model client — guardrails/routing/credits live here
lib/retrieval.ts      pgvector search (audience-scoped when signed in; extend: filters/hybrid)
lib/identity.ts       pluggable login layer (none|jwt|header|introspect|custom)
lib/tools.ts          MCP gateway client + bounded tool-use loop (Phase 2 consumer)
lib/admin-auth.ts     /admin auth — email-OTP session (cookie) OR ADMIN_TOKEN bearer
lib/vault.ts          agent-infra-only credential vault (AES-256-GCM, TOOL_VAULT_KEY)
lib/credentials.ts    seal/store/open tool secrets (ciphertext-only at rest)
lib/settings.ts       operator-editable settings (env defaults ← Supabase overlay)
lib/ingest.ts         docs + website → chunks → embeddings → Supabase
lib/security.ts       Layers 1-3
lib/config.ts         typed config from env
supabase/migration.sql  pgvector KB + agent_config + RLS (run in YOUR Supabase)
widget/embed.ts       one-tag embeddable widget
agent.config.yaml     human-readable manifest (maps to env)
```

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

> Vector dimension must match your embedding model. `text-embedding-3-small` = `1536`
> (the migration default). Change the model → change `vector(N)` in two places.

### 3. Create the Nemo virtual key (the agent's identity + safety net)
- In the **Nemo dashboard**, create a virtual key named **"Acme Support Agent"**.
- Set a **per-day budget** (e.g. `$5`) → this is your Layer-4 hard cap.
- Set an **RPM/TPM rate limit** → server-side backstop.
- Confirm Nemo serves your `MODEL` and `EMBEDDING_MODEL` (dashboard → Models / `GET /v1/models`).

### 4. Configure env
```bash
cp .env.example .env.local
# fill in NEMOROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# ALLOWED_ORIGINS, and a long random ADMIN_TOKEN.
```

### 5. Add knowledge + index it
- Drop your Markdown into `./docs` (sample Acme docs are included), and/or set `WEBSITE_URL`.
- Index into Acme's Supabase:
```bash
npm run dev   # starts on http://localhost:3000
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → { "ok": true, "sources": N, "chunks": M }
```

### 6. Test + embed
- Open http://localhost:3000 and ask a question.
- Embed on Acme's site with one tag (the widget talks only to your `/api/chat`,
  so the key never reaches the browser):
```html
<script src="https://YOUR-DEPLOY/widget.js"
        data-endpoint="https://YOUR-DEPLOY/api/chat"
        data-accent="#4f46e5" data-title="Acme Support"></script>
```

### 7. Deploy
Deploy to Vercel (or your own infra). Set the same env vars in the host. Re-run
`/api/ingest` whenever Acme's docs change.

---

## How another customer (Beta Corp) uses this
Same fork, **their own** Supabase project, **their own** `sk-nemo` key, their own
`ALLOWED_ORIGINS`. Nothing is shared except Nemo Router. To run fully outside Nemo,
point `NEMO_BASE_URL` at a self-hosted Nemo gateway.

## Extending it
- **Frontend:** edit [`app/page.tsx`](app/page.tsx) / [`widget/embed.ts`](widget/embed.ts) — theme via CSS vars / `data-*`, add slots, wire events.
- **Backend:** add loop hooks, new ingestion adapters (Notion/PDF/sitemap) in [`lib/ingest.ts`](lib/ingest.ts), or extend retrieval filters in [`lib/retrieval.ts`](lib/retrieval.ts).
- **Tools (Phase 2):** add a **local** function tool in your backend, or a **credentialed** tool via the Nemo MCP gateway (vault + billing + guardrails).

## File map
```
app/page.tsx          themable chat tester (frontend extension point)
app/api/chat/route.ts public chat: Layers 1-3 → retrieve → stream from Nemo
app/api/ingest/route.ts admin-gated re-index
lib/nemo.ts           the ONLY model client — guardrails/routing/credits live here
lib/retrieval.ts      pgvector search (extend: filters/hybrid)
lib/ingest.ts         docs + website → chunks → embeddings → Supabase
lib/security.ts       Layers 1-3
lib/config.ts         typed config from env
supabase/migration.sql  pgvector KB + RLS (run in YOUR Supabase)
widget/embed.ts       one-tag embeddable widget
agent.config.yaml     human-readable manifest (maps to env)
```

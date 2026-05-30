# nemo-support-agent — the Nemo Support agent (our dogfood)

This is the **first customer of the marketplace: us.** The support agent on
`nemorouter.ai`, built from the *same* runtime as every customer agent — no
special-case code. If it breaks for us, we hear about it before any customer does.

> **This folder is an INSTANCE, not a codebase.** It is config + docs + a schema
> migration only. It reuses the [`../customer-service-agent`](../customer-service-agent)
> Next.js app. We do **not** duplicate the runtime.

## What's different from a normal customer agent

| | Normal customer (e.g. Acme) | Nemo Support agent |
|---|---|---|
| Supabase | a **separate** project they own + pay for | the **existing Nemo Supabase** project |
| DB isolation | `public` schema of their project | a **dedicated schema `nemo_amp_db`** (Rule #12 — never `public`) |
| `visibility` | `org` | `public` (platform agent) |
| Knowledge | their docs/site | `nemorouter.ai/docs` |

Everything else — the agent loop, RAG, guardrails/routing/credits via Nemo, the
four security layers, the widget — is identical.

## Run / deploy it

Use the `customer-service-agent` app with this folder's env + docs:

```bash
cd ../customer-service-agent
cp ../nemo-support-agent/.env.local.example .env.local      # fill ★ values
cp -r ../nemo-support-agent/docs/* ./docs/                   # nemo support docs

# 1) Apply the schema migration in the EXISTING Nemo Supabase (creates nemo_amp_db):
#    psql "$DATABASE_URL" -f ../nemo-support-agent/supabase/migration.sql
#    then expose nemo_amp_db to PostgREST (Settings → API → Exposed schemas) and
#    NOTIFY pgrst, 'reload schema';

# 2) Run + index locally:
npm run dev && npm run ingest

# 3) Deploy to Cloud Run (replaces the legacy support agent):
cp ../nemo-support-agent/.env.prod.example .env.prod         # fill ★ values
npm run deploy:prod
```

## Why a schema, not a new project

The customer model gives each tenant their **own** Supabase. For *our own* support
agent we already have the Nemo Supabase — so we reuse it, but isolate the agent's
knowledge base in the `nemo_amp_db` schema. **Never** the `public` schema: Prisma
manages `public` for LiteLLM and drops non-Prisma tables there (Rule #12). The
runtime reaches the schema via `SUPABASE_SCHEMA=nemo_amp_db` — no code change.

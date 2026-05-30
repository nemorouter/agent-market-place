# agents/ — production-ready agent apps

Each folder here is a **self-contained, forkable agent** (frontend + backend +
infrastructure) that uses **Nemo Router** as the brain. You configure one env file
per environment and deploy with one command.

| Agent | What it is | Status |
|---|---|---|
| [`customer-service-agent`](./customer-service-agent) | Themable support agent — RAG over your docs + website. The flagship, fully runnable. **Acme Inc** is the worked example. | ✅ runnable local + Cloud Run |
| [`guru-cs-agent`](./guru-cs-agent) | **Our dogfood** — the support agent on `nemorouter.ai`. Instance of the customer-service-agent runtime, but uses the **existing Nemo Supabase** in a dedicated **`nemo_amp_db`** schema (Rule #12 — never `public`). Replaces the legacy support agent. | 🧩 instance (config + docs + schema) |
| [`restaurant-agent`](./restaurant-agent) | Same runtime, restaurant domain (menu, hours, reservations). Config + docs only — copy the customer-service-agent app and swap them. | 🧩 config example |

## The model (every agent here)

```
Nemo Router        = the brain   → LLM (chat + vision + embeddings) + tool gateway.
                                    Enforces guardrails, routing/fallback, credits,
                                    rate limits SERVER-SIDE. You never reimplement them.
This agent app     = the body    → frontend, backend, and YOUR OWN Supabase (pgvector).
                                    You own + pay for the Supabase + hosting.
One sk-nemo key    = identity     → a named virtual key with a per-day BUDGET (hard cap).
```

## Environments + deploy (one command)

Each agent ships `.env.local`, `.env.stage`, `.env.prod` (copy the `.example`s).
`CLOUD` inside the file picks the target — `local` today, `gcp` today, `azure`/`aws`
tomorrow (same files, same command):

```bash
npm run dev            # local, reads .env.local
npm run deploy:prod    # → Google Cloud Run (CLOUD=gcp)
```

A new agent = copy `customer-service-agent`, swap `agent.config.yaml` + `./docs`.
Path to 20+ agents without a new codebase.

See [`customer-service-agent/README.md`](./customer-service-agent/README.md) for the
full Acme walk-through.

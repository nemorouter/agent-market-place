---
name: restart-amp-cs-local
description: "Use when the local agent-market-place customer-service-agent (\"Ask AI Guru\", Next.js) is wedged, stuck on port 3003, or after pulling new agent config/env. Loads credentials and confirms the LOCAL env variant (Supabase points at local/stage, NEMO_BASE_URL at localhost:8090), then kills the agent on 3003 and restarts `next dev -p 3003`. Per-service AMP-owned restart (lives in agent-market-place repo, invokes scripts/restart.sh cs in INFRA)."
user-invocable: true
---

# /restart-amp-cs-local — Local Customer-Service-Agent Restart

Kill and restart **only** the agent-market-place **customer-service-agent** (the runnable Next.js
support-agent app — instance "Ask AI Guru") on this machine. It is a marketplace agent that
authenticates with a `sk-nemo-xxx` virtual key and calls the **existing Nemo gateway** — it adds
no new API service (see `amp-architecture`). Lives in the AMP repo; invokes the shared restart
script in INFRA via absolute path so killing/health-gating logic stays in one place.

| Where | Path |
|---|---|
| Slash command | `agent-market-place/.claude/commands/restart-amp-cs-local.md` |
| Backing script | `nemo-infra-cicd/scripts/restart.sh cs` |
| App dir | `agent-market-place/agents/customer-service-agent` (Next.js, **npm**) |
| Port | **3003** (`next dev -p 3003`; `ALLOWED_ORIGINS` includes `http://localhost:3003`) |
| Targets | LOCAL customer-service-agent only — no Cloud Run / GCP resources touched |
| Cred source | in-repo `.env.local` symlink → `~/.nemo_admin_keys/env-creds/amp-customer-service-agent/.env.local` |

The other two agents under `agents/` — `guru-cs-agent` and `restaurant-agent` — are **config-only
instances** (no `package.json`); they are not separate runnable services and have nothing to restart.

## Step 0 — Load active cloud, credentials, and confirm LOCAL env (MANDATORY)

Before killing anything:
1. `Skill(active-cloud)` — source `~/.nemo_admin_keys/env-creds/active-cloud.env`. Local restarts
   don't push to a registry, but downstream tooling reads `NEMO_ACTIVE_CLOUD`.
2. `Skill(admin-keys)` — verify vendor creds exist (the agent's `NEMOROUTER_API_KEY` virtual key,
   Supabase local/stage).
3. `Skill(dot-env)` — confirm the in-repo `.env.local` resolves to the central
   `env-creds/amp-customer-service-agent/.env.local` symlink and that it targets:
   - **`SUPABASE_URL`** = local/stage (`qpfzvaakwzxffkjhkurz`), **never** prod (`hoidcodaajrilbsjcdlh`).
   - **`NEMO_BASE_URL`** = `http://localhost:8090` (the local nemo-backend gateway — start it first
     with `/restart-nemo-backend-local` or `/restart-nemo-sa-local`).
   - **`NEMOROUTER_API_KEY`** = a **LOCAL** `sk-nemo-xxx` virtual key. A prod key will NOT authenticate
     against `localhost:8090` (different LiteLLM DB). Swap in the local demo account's key if unset.

   To swap variants: `nemo-infra-env-status` to inspect; central variants live at
   `~/.nemo_admin_keys/env-creds/amp-customer-service-agent/.env.{local,stage,prod}`.

If any skill reports an issue, **abort** — fix and re-run.

## Prereq — local nemo-backend must be up

The agent calls the Nemo gateway for every LLM + tool call. Before restarting it, confirm:

```bash
curl -sf http://localhost:8090/health/readiness >/dev/null && echo "backend up" || echo "START BACKEND FIRST"
```

If the backend is down, run `/restart-nemo-backend-local` (or the umbrella `/restart-nemo-sa-local`) first.

## Usage

```
/restart-amp-cs-local
```

This delegates to:

```bash
bash ~/nemorouter/nemo-infra-cicd/scripts/restart.sh cs
```

The `cs` target: kills anything on :3003, clears `agents/customer-service-agent/.next`, runs
`npm run dev -- -p 3003`, then waits up to 40s for the port to listen and scans `logs/cs-agent.log`
for errors.

## Manual fallback (if the script isn't reachable)

```bash
CSA=~/nemorouter/agent-market-place/agents/customer-service-agent
lsof -ti:3003 | xargs kill -9 2>/dev/null || true
rm -rf "$CSA/.next"
cd "$CSA" && nohup npm run dev -- -p 3003 > ~/nemorouter/nemo-router-mono-repo/logs/cs-agent.log 2>&1 &
for i in $(seq 1 40); do lsof -i:3003 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN && break; sleep 1; done
curl -s -o /dev/null -w "CSA HTTP %{http_code}\n" http://localhost:3003/
```

## Health check after restart

```bash
curl -s -o /dev/null -w "CSA HTTP %{http_code}\n" http://localhost:3003/         # 200 = page renders
grep -iE "error|exception|failed" ~/nemorouter/nemo-router-mono-repo/logs/cs-agent.log | tail -10 || echo "no errors"
```

Then open http://localhost:3003 and ask a question — it answers from the local/stage Supabase KB
(empty until you run `npm run ingest` against local/stage), routing the LLM call through the local
nemo-backend on the agent's virtual key.

## Family

This is the AMP per-service entry in the local restart family. See also:
`/restart-nemo-sa-local` (umbrella — also best-effort starts this agent on `all`),
`/restart-nemo-backend-local`, `/restart-nemo-frontend-local`, `/restart-sa-local`.
Naming follows the lifecycle exception: per-service restart commands live in their **owning repo**
and the name says **what runs** (`amp-cs`), not where it lives.

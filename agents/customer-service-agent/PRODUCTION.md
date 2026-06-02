# Production & Enterprise Readiness

How this agent runs at scale, stays secure, isolates tenants, and deploys per‑customer.
Companion to `README.md` (getting started) and the repo `CLAUDE.md` (architecture).

## 1. Multi‑tenancy model — isolation by deployment

This agent is **standalone and forkable**. The unit of tenancy is **one deployment per
customer**, and isolation is structural, not a runtime filter that can be bypassed:

| Boundary | Per‑tenant resource | Guarantee |
|---|---|---|
| **Data** | The customer's **own Supabase** (separate project, or a dedicated schema — never the shared `public`, Rule #12). `kb_chunks`, `chat_messages`, `agent_config`, `tool_credentials`. | RLS **on** every table; the anon key gets no direct table access — all reads go through `match_chunks` / `/api/*`. A dump of one tenant's DB reveals nothing about another. |
| **Spend** | One **`sk-nemo` virtual key** with a per‑day **budget** (the hard spend cap) + RPM/TPM, enforced server‑side by Nemo. | A runaway or abused fork can only ever spend its own budget. No shared key, no master key (Rule #15). |
| **Secrets** | A **vault key** (`TOOL_VAULT_KEY`) that exists **only in that fork's env**. Tool secrets are sealed AES‑256‑GCM; only ciphertext is stored. | Only that agent can decrypt its tool credentials. Nemo‑backend never holds the key; a DB dump alone is useless. |
| **Config** | An `agent_config` row keyed by `AGENT_ID`, editable live from `/admin`. | Overlays env defaults; a bad overlay degrades to env defaults — never breaks chat. |
| **Identity** | A pluggable, **server‑side** identity resolver (`lib/identity.ts`). The browser can never assert who it is. | Personalization + doc scoping derive from a verified cookie/proxy header/introspection, mirroring Rule #26. |

**"Thousands of customers"** = thousands of these isolated forks against the one Nemo gateway.
The platform scales by adding tenants horizontally; no tenant shares state with another. A
single fork serving one customer's site scales independently (see §2).

> One deployment serving **many** agent configs from one process (host‑routed multi‑tenant
> SaaS) is intentionally **not** the default — it would trade the structural isolation above
> for a runtime filter. The table‑level keying (`agent_id`) leaves the door open if a future
> deployment wants it, but the shipped, recommended posture is isolation‑by‑deployment.

## 2. Scale — one fork, thousands of visitors

The app is **stateless** (Next.js standalone server) and autoscales on Cloud Run / Container
Apps. The pieces that make horizontal scale correct:

- **Distributed rate limit.** Set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` and
  the `RATE_LIMIT_*` windows become a **shared** fixed window across every instance (one
  `INCR`+`EXPIRE` round‑trip). Unset → in‑memory per‑instance fallback (fine for a single
  instance/preview). A Redis outage falls back to in‑memory, so the limiter can never take
  chat down. (`lib/security.ts` → `rateLimitAsync`.)
- **Upstream timeouts.** Every Nemo call is wrapped in `AbortSignal.timeout` so a hung gateway
  can't pin an instance and exhaust the pool. `NEMO_TIMEOUT_MS` (embeddings + tool rounds),
  `NEMO_STREAM_TIMEOUT_MS` (streamed answer). (`lib/nemo.ts`.)
- **Payload caps.** `validateChatPayload` bounds message count + size **before** any
  model/embedding spend → DoS + cost‑blowup protection. `MAX_MESSAGES`, `MAX_MESSAGE_CHARS`,
  `MAX_TOTAL_CHARS`.
- **Health probes.** `GET /api/health` = liveness (always 200). `GET /api/health?ready=1` =
  readiness: probes Supabase (cheap, no LLM spend) + reports `nemoKey` / `vault` /
  `rateLimiter` backend; **503** when a hard dependency is down. Wire it to the load balancer
  / Cloud Run startup+liveness probes.
- **Credits & guardrails are Nemo's job.** The agent never reimplements them; it streams
  through one key and surfaces Nemo's `402` / `429` / guardrail blocks untouched.

### Recommended Cloud Run settings

```
--min-instances 1            # avoid cold starts for support traffic
--max-instances 50           # cap blast radius / cost; raise per load test
--concurrency 80             # Node streams comfortably; tune per model latency
--cpu 1 --memory 512Mi
--set-env-vars UPSTASH_REDIS_REST_URL=...,UPSTASH_REDIS_REST_TOKEN=...   # shared rate limit
# Startup probe:   GET /api/health?ready=1   (503 until Supabase + key are ready)
# Liveness probe:  GET /api/health
```

## 3. Secure chat — defense in depth

| Layer | Where | What it blocks |
|---|---|---|
| 1. Origin allow‑list | `originAllowed` | Other sites embedding the widget (exact host + `*.` wildcard). |
| 2. Rate limit (per‑IP + per‑session, distributed) | `rateLimitAsync` | Volume abuse, scrapers, across all instances. |
| 3. CAPTCHA (configurable trigger) | `verifyCaptcha` | Bots (Turnstile by default). |
| 4. Payload caps | `validateChatPayload` | Oversized requests → token/cost DoS. |
| 5. Key budget (server‑side) | Nemo | The hard daily spend ceiling. |
| 6. Guardrails (server‑side) | Nemo | PII / prompt‑injection / content safety on request + response. |
| 7. Security headers | `middleware.ts` | nosniff + referrer policy + HSTS everywhere; `/admin` + operator APIs `DENY` framing (clickjacking). |

The `sk-nemo` key and `TOOL_VAULT_KEY` are **server‑side only** — never sent to the browser,
never logged. `/admin` auth is self‑contained email‑OTP (SendGrid + signed cookie) **or** an
`ADMIN_TOKEN` bearer — no Supabase Auth, isolated from Nemo user logins.

## 4. Configurable admin — no redeploy

`/admin` (email‑OTP or token) edits agent name, system prompt, model, suggestion chips, quick
links, contact methods, and enabled MCP tools + their sealed credentials. Writes to the
tenant's own `agent_config` / `tool_credentials`; the public `GET /api/config` projection never
leaks `systemPrompt` / `model` / `enabledTools`. Resolution: built‑in defaults → env → Supabase
row; any overlay failure degrades to env defaults.

## 5. Deploy individually

Each tenant deploys its own service. See `CLAUDE.md` → **Deploy** for the manual Cloud Run path
(`docker build --platform linux/amd64` → push `em-<sha>` → `gcloud run deploy`). After every
deploy run a revision‑scoped error‑log scan (Rule #21) and confirm `GET /api/health?ready=1`
returns 200 before declaring success.

## 6. Pre‑launch checklist (per fork)

- [ ] `supabase/migration.sql` applied to the tenant's schema; RLS confirmed on all tables.
- [ ] `NEMOROUTER_API_KEY` is a key with a **per‑day budget** + RPM/TPM set in Nemo.
- [ ] `ALLOWED_ORIGINS` lists only the customer's real hosts.
- [ ] `UPSTASH_REDIS_REST_*` set if `--max-instances > 1`.
- [ ] `ADMIN_SESSION_SECRET` (32+ random) + `ADMIN_EMAILS` set; `ADMIN_TOKEN` rotated off the example default.
- [ ] `TOOL_VAULT_KEY` set if any tool needs a credential.
- [ ] `CAPTCHA_ENABLED=true` for public, unauthenticated widgets.
- [ ] Startup + liveness probes point at `/api/health`.
- [ ] `npm run typecheck && npm test && npm run build` green in CI.

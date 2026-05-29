# Constraint checklist — the "no new APIs" debate

> **Status:** TODO. Decision documented but not yet ratified with the user.

The user's exact constraint, captured in conversation 2026-05-28:

> *"I don't want to build any new apis it must be inline with nemo api gateway only."*

Three readings, ranked from loosest to strictest. The deeper you go, the more ecosystem benefit you lose.

## 1. Interpretation A — "no new API SERVICES" (CHOSEN)

New routes on the existing `nemo-backend:8090` gateway are fine, because:

- Same hostname (`api.nemorouter.ai`) — no new product surface for customers
- Same auth middleware — virtual-key validation already exists
- Same credit ledger — `reserve_credits` / `settle_credits` already exist
- Same observability pipeline — request IDs, logs, callbacks already flow
- Same deployment unit — ships in the next `nemo-backend` rollout

Scope of what gets added under this reading:

```
POST /v1/agents/sessions
POST /v1/agents/sessions/{session_id}/messages
GET  /v1/mcp/tools
POST /v1/mcp/tools/{tool_id}/call
```

All four routes live in `03-nemo-backend/nemo_backend/mcp_gateway/routes.py`. No new FastAPI app, no new Cloud Run service, no new hostname, no new auth surface.

| Ecosystem benefit | Preserved? |
|---|---|
| One vault | ✅ tool_accounts in super_admin schema, accessed by nemo-backend |
| Tool spend in credit ledger | ✅ reserve_credits(service='tool') from inside nemo-backend |
| Guardrails on tool I/O | ✅ existing guardrail middleware extends to new routes |
| Single agent trace | ✅ existing trace middleware emits spans for new routes |

## 2. Interpretation B — "no new ROUTES either; reuse `/v1/chat/completions`"

Agents ride on OpenAI function-calling via the existing `/v1/chat/completions` route:

- Customer sends tool definitions in `tools` parameter
- Model returns `tool_calls`
- Customer's runtime executes the tools using their own credentials
- Customer sends `role: 'tool'` messages back

What this means in practice:

- The marketplace's "backend" must hold tool credentials itself (regression vs. one-vault promise)
- OR the customer holds tool credentials (defeats the marketplace value entirely)
- Tool cost cannot land in Nemo's credit ledger (LLM-only path)
- Tool I/O cannot be inspected by Nemo guardrails (it never crosses Nemo's wire)
- Tool calls don't appear in Nemo's observability trace

| Ecosystem benefit | Preserved? |
|---|---|
| One vault | ❌ either marketplace runtime holds creds (security regression) or customer does (no marketplace value) |
| Tool spend in credit ledger | ❌ tools bypass nemo-backend entirely |
| Guardrails on tool I/O | ❌ same — tool calls don't traverse Nemo |
| Single agent trace | ❌ only the LLM half is visible to Nemo |

**Verdict:** Defeats the marketplace's reason for existing. Only chosen if the user enforces the strictest reading and accepts the loss.

## 3. Interpretation C — "new service in agent-market-place repo"

`agent-market-place/backend/` is its own FastAPI app deployed as `agent-api.nemorouter.ai`. Separate service, separate hostname, separate deployment.

| Ecosystem benefit | Preserved? |
|---|---|
| One vault | ⚠ requires cross-service auth from agent-api to nemo-backend; more attack surface |
| Tool spend in credit ledger | ⚠ requires cross-service call from agent-api to nemo-backend; latency penalty |
| Guardrails on tool I/O | ⚠ duplicated or cross-service |
| Single agent trace | ⚠ traces span two services; more correlation work |
| **The customer-stated constraint** | ❌ **directly violated** — two API services, two hostnames |

**Verdict:** Rejected. Conflicts with the user's words.

## Decision

**Interpretation A** is the working assumption for all `amp-*` skills.

If the user, on reading these docs, prefers B → every SKILL.md needs rewriting and the project loses most of its differentiation. Surface this to the user explicitly at the BUILD-phase kickoff. Do not silently revert to B.

If the user prefers C → either the constraint was misread, or the user has changed their mind. Confirm before proceeding.

## Sanity check — checklist before any PR lands

Run `scripts/validate-no-new-services.sh` on the proposed change. PR must satisfy:

- [ ] No new `FastAPI()` constructor anywhere under `agent-market-place/backend/`
- [ ] No new Cloud Run service definition in `nemo-infra-cicd/terraform/`
- [ ] No new hostname in DNS / Cloud Run domain mapping
- [ ] New routes (if any) live under `03-nemo-backend/nemo_backend/mcp_gateway/`
- [ ] New routes ship through the existing `nemo-backend` rollout, not a separate deploy
- [ ] Auth: every new route is covered by the existing virtual-key middleware (no `@app.post` that bypasses auth)
- [ ] Credits: every new "side-effect" route (tool exec, agent message) calls `reserve_credits` → action → `settle_credits` with `release_reservation` on every error path
- [ ] RLS: every new `nemo.*` table has RLS enabled before the migration merges (per Rule #13)

If any box is unchecked, the change violates the constraint and must be reworked or escalated.

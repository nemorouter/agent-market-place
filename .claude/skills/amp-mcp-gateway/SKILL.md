---
name: amp-mcp-gateway
description: Use when designing or implementing the MCP gateway routes added to the existing nemo-backend gateway. Covers the 4 new routes (/v1/agents/sessions, /v1/mcp/tools), the tool catalog schema in super_admin.tool_accounts, the tool credential vault pattern (mirrors sa-provider-accounts), and the dispatcher that routes a tool call through guardrails → credit reserve → vault → upstream call → settle → trace.
metadata:
  type: backend-design
  status: shipped-v1
  owner: surasani.rama@gmail.com
---

# amp-mcp-gateway — Backend routes + tool catalog + vault

> **Status: SHIPPED v1 (2026-05-29).** Built central, in-process inside nemo-backend per interpretation 4.A. Authoritative SoT is now the mono-repo skill **`nemo-mcp-gateway`** + `docs/superpowers/specs/2026-05-29-mcp-gateway-agent-marketplace-design.md`. Real code: `03-nemo-backend/nemo_backend/mcp_gateway/`. Live routes: `GET /v1/mcp/tools`, `POST /v1/mcp/tools/{id}/call`, `GET /v1/agents`, `POST /v1/agents/{id}/respond`. v1 tool: `nemo_docs_search` (curated, no vault). Phase 2 (not yet built): `super_admin.tool_accounts` vault for credentialed tools, `nemo.agent_tool_invocations` audit table, per-org agent/grant tables. The design below is retained as the Phase-2 roadmap.

## What this skill owns

Four new routes added to the existing `nemo-backend` FastAPI app (NOT a new service):

| Route | Purpose |
|---|---|
| `POST /v1/agents/sessions` | Create an agent session (returns `session_id`) |
| `POST /v1/agents/sessions/{id}/messages` | Run one agent turn — drives the loop server-side |
| `GET  /v1/mcp/tools` | List tools visible to the calling virtual key (RLS-scoped) |
| `POST /v1/mcp/tools/{tool_id}/call` | Execute one tool — guardrail → reserve → vault → call → settle |

Two new schemas:

- `nemo.agent_sessions`, `nemo.agent_messages`, `nemo.tool_call_log` (Nemo data-plane)
- `super_admin.tool_accounts`, `super_admin.tool_pricing` (Cloudact-parent — vault + pricing)

And one new admin UI:

- `super-admin-dashboard/app/(authenticated)/tools/*` — CRUD for the tool catalog (mirrors `app/(authenticated)/providers/` from `sa-provider-accounts`)

## The contract — what every tool call does, in order

This is the safety-critical sequence. Any deviation is a Rule #7 / Rule #13 / Rule #4 violation.

```
POST /v1/mcp/tools/{tool_id}/call
Authorization: Bearer sk-nemo-xxx
Content-Type: application/json
{ "args": { ... } }

   │
   ▼
1. AUTH         existing virtual-key middleware → AuthContext(org_id, team_id, key_id)
   │            no new auth surface; if this returns 401, return 401
   ▼
2. RBAC         is this tool enabled for (org, team, key)?
   │            check super_admin.tool_accounts.enabled AND
   │                  nemo.team_tool_grants (team_id, tool_id) AND
   │                  nemo.key_tool_grants  (key_id,  tool_id) -- if scope=key
   │            scope hierarchy: key > team > org (mirrors nemo-guardrails)
   │            if denied: 403, no credit reservation
   ▼
3. GUARDRAIL    run nemo-guardrails on `args` payload
   │            PII detection, prompt injection (if tool sends text to an LLM),
   │            content safety, keyword blocklists
   │            if denied: 403 with guardrail reason, no credit reservation
   ▼
4. PRICE        look up super_admin.tool_pricing(tool_id)
   │            estimated_cost = flat_rate_credits + (upstream_cost_credits or 0)
   │            + Nemo fee (tier-dependent per nemo-credits)
   ▼
5. RESERVE      reserve_credits(org_id, key_id,
   │                            service='tool', tool_id=tool_id,
   │                            estimated_credits=estimated_cost)
   │            if insufficient: return 402 (mirrors LLM 402 path)
   ▼
6. VAULT        creds = fetch super_admin.tool_accounts(tool_id).credentials_ref
   │            credentials_ref → Secret Manager → decrypted at use
   │            never logged, never returned in response
   ▼
7. EXECUTE      tool_executor.dispatch(protocol, endpoint, creds, args)
   │            protocols: mcp-stdio | mcp-http | rest | graphql
   │            hard timeout: 30s (configurable per tool)
   │            on exception: jump to ERROR path below
   ▼
8. GUARDRAIL    run nemo-guardrails on response payload
   │            PII detection (REDACT, don't reject — response already happened)
   │            content safety
   ▼
9. SETTLE       settle_credits(reservation_id, actual_credits=...)
   │            actual_credits = flat_rate + upstream_actual (if vendor returned cost)
   │                           + Nemo fee
   ▼
10. LOG         INSERT INTO nemo.tool_call_log (session_id, tool_id, args, response,
    │                                            cost_credits, status, latency_ms)
    │           emit trace span via nemo-observability
    ▼
11. RETURN      { "result": <tool response>, "cost_credits": X, "latency_ms": Y }
                response headers:
                  x-nemo-tool-id: <tool_id>
                  x-nemo-tool-cost-credits: <actual cost in credits>
                  x-nemo-trace-id: <trace_id>

ERROR path (any step 4–8 fails):
  - if step ≥ 5 (reservation made): release_reservation(reservation_id)
  - INSERT INTO nemo.tool_call_log with status='failed'
  - emit error trace span
  - return appropriate 4xx/5xx
```

## RLS scope (Rule #13 — non-negotiable)

| Table | Read | Write |
|---|---|---|
| `nemo.agent_sessions` | `is_org_member(organization_id) AND (key_id = current_key OR get_org_role(organization_id) IN ('owner','admin'))` | same |
| `nemo.agent_messages` | `is_org_member` via session join | same |
| `nemo.tool_call_log` | `is_org_member` via session join | INSERT-only by service role |
| `super_admin.tool_accounts` | super-admin only | super-admin only |
| `super_admin.tool_pricing` | super-admin only (also via sync to `nemo.tool_cache` for fast read) | super-admin only |
| `nemo.team_tool_grants` | `is_team_member(team_id) OR is_org_admin` | `is_team_admin OR is_org_admin` |
| `nemo.key_tool_grants` | key owner OR org-admin | key owner OR org-admin |

No `USING (true)`. No service-role bypass except for `tool_call_log` writes (server-side only).

## Tool catalog admin UI (in `super-admin-dashboard`)

Mirrors the `sa-provider-accounts` pattern almost exactly:

| `sa-provider-accounts` analog | `amp-mcp-gateway` |
|---|---|
| `super_admin.provider_accounts` | `super_admin.tool_accounts` |
| `/providers/page.tsx` | `/tools/page.tsx` |
| `/providers/[id]/edit/page.tsx` | `/tools/[id]/edit/page.tsx` |
| rotate-key dispatcher | rotate-credential dispatcher (same shape) |
| dual-write to nemo-backend env on provider add | dual-write to nemo-backend tool_cache on tool add |
| `POST /super-admin/model-cache/replace` (full catalog push) | `POST /super-admin/tool-cache/replace` |

Read the `sa-provider-accounts` SKILL.md before designing the admin UI — copy the patterns, don't reinvent.

## Tool catalog sync to nemo-backend

Nemo-backend reads the tool catalog from a fast cache, not from the super_admin DB per-request:

- Super-admin holds the SoT in `super_admin.tool_accounts`.
- Super-admin pushes the full catalog to nemo-backend via `POST /super-admin/tool-cache/replace` on every admin change.
- Nemo-backend persists to `nemo.tool_cache` (read-only mirror, refreshed atomically).
- Hot reads (per-request) hit `nemo.tool_cache`, cached 30s in process (matches `nemo-models` pattern).

Why two layers: super-admin is the governance surface (who can add tools); nemo-backend is the runtime surface (which tools are callable right now). Same split as model catalog (`nemo-models` ↔ `sa-models-provision`).

## What this skill does NOT own

- The agent loop itself — that's `amp-agent-runtime`. This skill exposes the routes the loop CALLS.
- Pricing model decision — that's `amp-billing-observability`. This skill consumes prices from `super_admin.tool_pricing`.
- Widget UI — that's `amp-frontend-widget`.
- Tool guardrail tuning — that's `amp-billing-observability/references/guardrails-tool-io.md`.
- **Positioning** as "the central tool layer for every Nemo-authed agent" — that's `amp-central-tool-layer`. This skill is the implementation; that one is the strategic frame (consumer matrix, dual wire protocol REST + MCP-JSON-RPC, universal `sk-nemo-xxx` auth, v1 → v2 → v3 rollout).

## When this skill loads

Load `amp-mcp-gateway` when:

- Designing or implementing the four new routes
- Designing the tool catalog schema or vault
- Reviewing PRs that touch `03-nemo-backend/nemo_backend/mcp_gateway/` or `super-admin-dashboard/app/(authenticated)/tools/`
- Debugging a tool execution failure
- Onboarding a new tool to the catalog

## References

- `references/route-spec.md` — OpenAPI-ish spec for all 4 routes, request/response shapes, error codes
- `references/tool-catalog-schema.md` — full DDL for the 5 new tables (incl. RLS policies), seed data for first 3 tools
- `references/tool-vault-design.md` — credentials storage, rotation, the `sa-provider-accounts` parallels

## Scripts

- `scripts/seed-tool-catalog.sh` — TODO stub. Will seed the first 3 tools (GitHub-read, Slack-send, Exa-search) into `super_admin.tool_accounts` for local dev.

## Related skills

- `amp-architecture` — load this first
- `amp-central-tool-layer` — the positioning skill: why these routes serve every Nemo-authed agent (widget, Dify, Onyx, native MCP clients), not just the marketplace widget
- `amp-agent-runtime` — the FIRST consumer of these routes (one of seven)
- `amp-billing-observability` — sibling skill that owns pricing + trace
- `nemo-credits` — `reserve_credits` / `settle_credits` / `release_reservation` (Rule #7)
- `nemo-guardrails` — guardrail middleware extended to tool I/O
- `nemo-rls-enforcer` — RLS policy patterns (Rule #13)
- `sa-provider-accounts` — vault + admin-UI pattern to copy
- `sa-dashboard-alembic` — migration pattern for `super_admin.*` schema
- `nemo-models` — two-layer catalog sync pattern (super-admin → nemo-backend cache)

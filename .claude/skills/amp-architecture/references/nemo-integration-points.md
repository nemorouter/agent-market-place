# Nemo integration points

> **Status:** TODO. Every entry below is a planned edit, not a completed one.

The exhaustive list of files in the *existing* repos that `agent-market-place` will touch when work begins. **Nothing else** is in scope.

## 1. `nemo-router-mono-repo`

### 1a. Backend routes (owner: `amp-mcp-gateway`)

| File | Change |
|---|---|
| `03-nemo-backend/nemo_backend/mcp_gateway/__init__.py` | NEW — module init |
| `03-nemo-backend/nemo_backend/mcp_gateway/routes.py` | NEW — FastAPI router with the 4 new endpoints |
| `03-nemo-backend/nemo_backend/mcp_gateway/tool_executor.py` | NEW — credential lookup + MCP/REST call |
| `03-nemo-backend/nemo_backend/mcp_gateway/pricing.py` | NEW — tiered-flat-rate cost calc (see `amp-billing-observability`) |
| `03-nemo-backend/nemo_backend/mcp_gateway/session_store.py` | NEW — Redis-backed session state |
| `03-nemo-backend/nemo_backend/main.py` | EDIT — `app.include_router(mcp_gateway.router)` |
| `03-nemo-backend/nemo_backend/middleware/auth.py` | NO CHANGE — existing virtual-key middleware handles the new routes for free |
| `03-nemo-backend/nemo_backend/credits/reserve.py` | EDIT — accept `service: Literal['llm', 'tool']` discriminator |

### 1b. Database migrations (owner: `amp-mcp-gateway`)

| File | Change |
|---|---|
| `00-nemo-db/alembic/versions/aXXX_mcp_gateway_tables.py` | NEW — creates `nemo.agent_sessions`, `nemo.agent_messages`, `nemo.tool_call_log` |
| `00-nemo-db/alembic/versions/aXXX_mcp_gateway_rls.py` | NEW — RLS policies for the 3 new tables (per Rule #13) |

Tables (sketch — finalized in `amp-mcp-gateway/references/tool-catalog-schema.md`):

```sql
nemo.agent_sessions (
  id UUID PK,
  organization_id UUID NOT NULL,
  team_id UUID NOT NULL,
  key_id UUID NOT NULL,         -- which virtual key drove the session
  agent_id TEXT NOT NULL,       -- customer-configured agent name
  created_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ NULL
)

nemo.agent_messages (
  id UUID PK,
  session_id UUID NOT NULL REFERENCES nemo.agent_sessions,
  role TEXT NOT NULL,           -- 'user' | 'assistant' | 'tool'
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ
)

nemo.tool_call_log (
  id UUID PK,
  session_id UUID NOT NULL,
  tool_id TEXT NOT NULL,        -- FK to super_admin.tool_accounts.id
  args JSONB NOT NULL,
  response JSONB NULL,
  cost_credits DECIMAL(20,10),
  status TEXT NOT NULL,         -- 'pending' | 'succeeded' | 'failed'
  latency_ms INT,
  created_at TIMESTAMPTZ
)
```

### 1c. Frontend — playground (owner: `amp-frontend-widget`)

| File | Change |
|---|---|
| `01-frontend-end/src/app/[organization]/agent-playground/page.tsx` | NEW |
| `01-frontend-end/src/app/[organization]/agent-playground/AgentPlaygroundClient.tsx` | NEW |
| `01-frontend-end/src/components/agent-playground/AgentChatPane.tsx` | NEW — reuses widget runtime |
| `01-frontend-end/src/components/agent-playground/ToolPickerSidebar.tsx` | NEW |
| `01-frontend-end/src/components/agent-playground/AgentTraceView.tsx` | NEW |
| `01-frontend-end/src/components/sidebar/secondary-panel/AgentPlaygroundPanel.tsx` | NEW — new entry in secondary panel (per `nemo-secondary-panel`) |
| `01-frontend-end/src/lib/agent-runtime/` | NEW — runtime package (shared with embed widget) |

### 1d. Frontend — per-team / per-key tool RBAC (owner: `amp-mcp-gateway`)

| File | Change |
|---|---|
| `01-frontend-end/src/app/[organization]/teams/[teamId]/tools/page.tsx` | NEW — enable/disable tools per team |
| `01-frontend-end/src/app/[organization]/keys/[keyId]/tools/page.tsx` | NEW — restrict tools per virtual key |

## 2. `super-admin-dashboard`

### 2a. Database — tool catalog (owner: `amp-mcp-gateway`)

| File | Change |
|---|---|
| `db/alembic/versions/0XX_tool_accounts.py` | NEW — creates `super_admin.tool_accounts`, `super_admin.tool_pricing` |
| `db/alembic/versions/0XX_expose_tool_schema.py` | NEW — PostgREST schema expose (per `sa-dashboard-alembic` pattern) |

Tables:

```sql
super_admin.tool_accounts (
  id TEXT PK,                       -- e.g., 'github-read', 'slack-send'
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,           -- 'basic' | 'premium' | 'compute' (drives pricing tier)
  protocol TEXT NOT NULL,           -- 'mcp-stdio' | 'mcp-http' | 'rest' | 'graphql'
  endpoint TEXT,                    -- for http variants
  auth_type TEXT NOT NULL,          -- 'oauth' | 'api-key' | 'bearer' | 'none'
  credentials_ref TEXT NOT NULL,    -- reference into secret vault (Secret Manager)
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

super_admin.tool_pricing (
  tool_id TEXT PK REFERENCES super_admin.tool_accounts.id,
  flat_rate_credits DECIMAL(20,10) NOT NULL,
  upstream_cost_credits DECIMAL(20,10) NULL,  -- known vendor cost (nullable for free APIs)
  nemo_fee_pct DECIMAL(6,4) NOT NULL,         -- e.g., 0.04 = 4%
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL
)
```

### 2b. Admin UI — tool catalog CRUD (owner: `amp-mcp-gateway`)

| File | Change |
|---|---|
| `app/(authenticated)/tools/page.tsx` | NEW — list view, mirrors `app/(authenticated)/providers/page.tsx` |
| `app/(authenticated)/tools/[id]/edit/page.tsx` | NEW |
| `app/api/admin/tools/route.ts` | NEW — CRUD endpoints |
| `app/api/admin/tools/sync/route.ts` | NEW — push catalog to nemo-backend cache (mirrors `/super-admin/model-cache/replace`) |

## 3. `nemo-infra-cicd`

| File | Change |
|---|---|
| (none under interpretation 4.A) | New routes ship in the existing `nemo-backend` Cloud Run service. No new Terraform module. |
| (Option B only) `terraform/agent-runtime/main.tf` | NEW IF agent runtime ships as a sibling Cloud Run service. Held until that decision is made. |

## 4. Workspace cockpit (`~/nemorouter/`)

| File | Change |
|---|---|
| `bootstrap.sh` | EDIT — add `agent-market-place` as 5th source in `SOURCES_OF_TRUTH` array so amp-* skills aggregate into `~/.claude/skills/` |
| `SKILL_INDEX.md` | REGEN — `bootstrap.sh` writes this; will pick up amp-* skills after the source is added |
| `CLAUDE.md` | EDIT — add `agent-market-place` row to the Source-of-truth locations table |

## What is explicitly NOT touched

- `nemo-vendor-refs` (read-only LiteLLM mirror)
- `dify-integration`, `onyx-integration` (separate products)
- `cloudact-nemo-growth-engine` (GTM umbrella)
- `04-nemoroutersdk` (Phase 2 — adding agent endpoints to the SDK happens AFTER the gateway routes are live)
- Anything under `01-frontend-end/src/app/(landingPages)/` — landing is locked by Rule #17

## Sequencing (when work begins)

1. Wire `agent-market-place` into `bootstrap.sh` so skills become globally discoverable.
2. Land `amp-mcp-gateway` route stubs first (auth + reserve+settle + empty tool list), deployed inside `nemo-backend`.
3. Land tool catalog tables in `super_admin` schema + admin UI.
4. Land first 3 tools end-to-end (proof of vault → exec → settle → trace).
5. Land widget runtime + playground.
6. Land pluggable widget bundle.
7. Public launch — gated by `sa-nemo-business` pricing audit + `nemo-post-deploy-log-check` clean.

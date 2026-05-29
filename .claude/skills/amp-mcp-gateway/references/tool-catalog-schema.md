# Tool catalog schema

> **Status:** TODO. DDL is a sketch; finalize in the Alembic migration when work begins.

Two schemas span this design:

- `super_admin.*` — owned by `super-admin-dashboard` (Cloudact-parent project `<cloudact-parent-ref>`)
- `nemo.*` — owned by `00-nemo-db/` (Nemo data-plane project — `<supabase-data-plane-ref>` local/stage, `<supabase-prod-ref>` prod)

Two-layer split (matches `nemo-models` ↔ `sa-models-provision`):

| Layer | Schema | Owns |
|---|---|---|
| Governance (SoT) | `super_admin.tool_accounts`, `super_admin.tool_pricing` | Who can add/remove tools; pricing rows |
| Runtime (mirror) | `nemo.tool_cache` | What tools nemo-backend can serve right now (per-request hot read) |

Sync: super-admin POSTs `/super-admin/tool-cache/replace` to nemo-backend on every catalog mutation.

## `super_admin.tool_accounts` — the catalog

```sql
CREATE TABLE super_admin.tool_accounts (
  id              TEXT PRIMARY KEY,              -- 'github-read', 'slack-send'
  display_name    TEXT NOT NULL,
  description     TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('basic', 'premium', 'compute')),
  protocol        TEXT NOT NULL CHECK (protocol IN ('mcp-stdio', 'mcp-http', 'rest', 'graphql')),
  endpoint        TEXT,                          -- for http variants
  auth_type       TEXT NOT NULL CHECK (auth_type IN ('oauth', 'api-key', 'bearer', 'none')),
  credentials_ref TEXT NOT NULL,                 -- Secret Manager resource path
  args_schema     JSONB NOT NULL,                -- OpenAI-function-calling JSON Schema
  enabled         BOOLEAN NOT NULL DEFAULT true,
  upstream_owner  TEXT,                          -- vendor name for support routing
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tool_accounts_enabled ON super_admin.tool_accounts(enabled) WHERE enabled;
```

## `super_admin.tool_pricing` — pricing rows

```sql
CREATE TABLE super_admin.tool_pricing (
  tool_id              TEXT NOT NULL REFERENCES super_admin.tool_accounts(id) ON DELETE CASCADE,
  flat_rate_credits    DECIMAL(20,10) NOT NULL,   -- Nemo's flat overhead per call
  upstream_cost_credits DECIMAL(20,10),           -- known vendor cost (NULL for free APIs)
  nemo_fee_pct         DECIMAL(6,4) NOT NULL,     -- e.g., 0.04 (4%) on Tier 1
  effective_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to         TIMESTAMPTZ,
  PRIMARY KEY (tool_id, effective_from)
);
```

History-preserved (mirrors `sa-litellm-pricing`). For "current price," `WHERE effective_to IS NULL OR effective_to > now()`.

## `nemo.tool_cache` — runtime mirror

```sql
CREATE TABLE nemo.tool_cache (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  category        TEXT NOT NULL,
  protocol        TEXT NOT NULL,
  endpoint        TEXT,
  args_schema     JSONB NOT NULL,
  flat_rate_credits DECIMAL(20,10) NOT NULL,
  nemo_fee_pct    DECIMAL(6,4) NOT NULL,
  enabled         BOOLEAN NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

No RLS — this is read-only nemo-backend state. Writes only via service role from `/super-admin/tool-cache/replace`.

## `nemo.agent_sessions` — agent session state

```sql
CREATE TABLE nemo.agent_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  team_id         UUID NOT NULL,
  key_id          UUID NOT NULL,
  agent_id        TEXT NOT NULL,
  model           TEXT NOT NULL,
  system_prompt   TEXT,
  tool_ids        TEXT[] NOT NULL DEFAULT '{}',
  max_iterations  INT NOT NULL DEFAULT 10,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

CREATE INDEX idx_agent_sessions_org ON nemo.agent_sessions(organization_id);
CREATE INDEX idx_agent_sessions_team ON nemo.agent_sessions(team_id);
CREATE INDEX idx_agent_sessions_key ON nemo.agent_sessions(key_id);

ALTER TABLE nemo.agent_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_sessions_select_member
  ON nemo.agent_sessions FOR SELECT
  USING (is_org_member(organization_id));

CREATE POLICY agent_sessions_insert_self
  ON nemo.agent_sessions FOR INSERT
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY agent_sessions_update_admin
  ON nemo.agent_sessions FOR UPDATE
  USING (get_org_role(organization_id) IN ('owner', 'admin'));
```

## `nemo.agent_messages` — message log

```sql
CREATE TABLE nemo.agent_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES nemo.agent_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content     JSONB NOT NULL,
  iteration   INT NOT NULL,
  total_cost_credits DECIMAL(20,10) NOT NULL DEFAULT 0,
  trace_id    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_messages_session ON nemo.agent_messages(session_id, created_at);

ALTER TABLE nemo.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_messages_select_via_session
  ON nemo.agent_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM nemo.agent_sessions s
    WHERE s.id = nemo.agent_messages.session_id
      AND is_org_member(s.organization_id)
  ));
```

## `nemo.tool_call_log` — per-tool-call audit

```sql
CREATE TABLE nemo.tool_call_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID REFERENCES nemo.agent_sessions(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL,
  team_id       UUID NOT NULL,
  key_id        UUID NOT NULL,
  tool_id       TEXT NOT NULL,
  args          JSONB NOT NULL,
  response      JSONB,
  cost_credits  DECIMAL(20,10),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  error_code    TEXT,
  latency_ms    INT,
  trace_id      TEXT,
  reservation_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tool_call_log_org_time ON nemo.tool_call_log(organization_id, created_at DESC);
CREATE INDEX idx_tool_call_log_tool ON nemo.tool_call_log(tool_id, created_at DESC);
CREATE INDEX idx_tool_call_log_session ON nemo.tool_call_log(session_id);

ALTER TABLE nemo.tool_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tool_call_log_select_member
  ON nemo.tool_call_log FOR SELECT
  USING (is_org_member(organization_id));

-- Writes only via service role from nemo-backend.
```

## `nemo.team_tool_grants` — which tools a team can use

```sql
CREATE TABLE nemo.team_tool_grants (
  team_id     UUID NOT NULL,
  tool_id     TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID NOT NULL,
  PRIMARY KEY (team_id, tool_id)
);

ALTER TABLE nemo.team_tool_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_tool_grants_select_team
  ON nemo.team_tool_grants FOR SELECT
  USING (is_team_member(team_id) OR get_org_role((
    SELECT organization_id FROM "LiteLLM_TeamTable" WHERE team_id = nemo.team_tool_grants.team_id
  )) IN ('owner','admin'));

CREATE POLICY team_tool_grants_write_admin
  ON nemo.team_tool_grants FOR INSERT
  WITH CHECK (get_team_role(team_id) IN ('owner','admin') OR
              get_org_role((SELECT organization_id FROM "LiteLLM_TeamTable" WHERE team_id = nemo.team_tool_grants.team_id))
                IN ('owner','admin'));
```

## `nemo.key_tool_grants` — per-key tool restrictions (optional, narrower than team)

```sql
CREATE TABLE nemo.key_tool_grants (
  key_id      UUID NOT NULL,
  tool_id     TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, tool_id)
);

ALTER TABLE nemo.key_tool_grants ENABLE ROW LEVEL SECURITY;
-- RLS: only key owner or org-admin can read/write.
```

If no row exists in `nemo.key_tool_grants` for a key, the key inherits the team's grants. If at least one row exists, only those tools are usable by that key (allowlist mode). This mirrors `nemo-guardrails` scope hierarchy.

## Seed data — first 3 tools (when work begins)

```sql
-- Tool 1: GitHub (read) — Basic tier
INSERT INTO super_admin.tool_accounts VALUES (
  'github-read', 'GitHub (read)',
  'Read repos, issues, PRs, code via GitHub REST API.',
  'basic', 'rest', 'https://api.github.com',
  'bearer', 'projects/<gcp-project>/secrets/tool-github-read-token/versions/latest',
  '{ ... JSON Schema for {operation, owner, repo, ...} ... }',
  true, 'GitHub', now(), now()
);
INSERT INTO super_admin.tool_pricing VALUES (
  'github-read', 0.001, 0, 0.04, now(), NULL
);

-- Tool 2: Slack (send message) — Basic tier
INSERT INTO super_admin.tool_accounts VALUES (
  'slack-send', 'Slack (send message)',
  'Send a message to a Slack channel via chat.postMessage.',
  'basic', 'rest', 'https://slack.com/api',
  'bearer', 'projects/<gcp-project>/secrets/tool-slack-bot-token/versions/latest',
  '{ ... JSON Schema for {channel, text, ...} ... }',
  true, 'Slack', now(), now()
);
INSERT INTO super_admin.tool_pricing VALUES (
  'slack-send', 0.001, 0, 0.04, now(), NULL
);

-- Tool 3: Exa (web search) — Premium tier (vendor cost ~$0.005/call)
INSERT INTO super_admin.tool_accounts VALUES (
  'exa-search', 'Exa (web search)',
  'Semantic web search via Exa API.',
  'premium', 'rest', 'https://api.exa.ai/search',
  'api-key', 'projects/<gcp-project>/secrets/tool-exa-api-key/versions/latest',
  '{ ... JSON Schema for {query, num_results, ...} ... }',
  true, 'Exa', now(), now()
);
INSERT INTO super_admin.tool_pricing VALUES (
  'exa-search', 0.01, 0.005, 0.04, now(), NULL
);
```

Push to `nemo.tool_cache` via `POST /super-admin/tool-cache/replace` immediately after seed.

## Migration sequencing

1. `super-admin-dashboard/db/alembic/versions/0XX_tool_accounts.py` — creates `super_admin.tool_accounts` + `super_admin.tool_pricing`
2. Expose `super_admin` schema to PostgREST (per `sa-dashboard-alembic` pattern; PGRST106 fix)
3. `00-nemo-db/alembic/versions/aXXX_mcp_gateway_tables.py` — creates `nemo.agent_sessions`, `nemo.agent_messages`, `nemo.tool_call_log`, `nemo.tool_cache`, `nemo.team_tool_grants`, `nemo.key_tool_grants`
4. Apply RLS policies in a separate migration (per repo convention)
5. `NOTIFY pgrst, 'reload schema';` (per Rule #19)
6. Seed first 3 tools via `seed-tool-catalog.sh`
7. Verify with `gap-hunter` scanner: every catalog entry resolves in `nemo.tool_cache` AND has a valid Secret Manager ref

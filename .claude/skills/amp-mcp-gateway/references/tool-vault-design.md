# Tool credential vault design

> **Status:** TODO. Mirrors `sa-provider-accounts` almost exactly. Read that skill first.

## Why a vault matters

The marketplace's #1 customer-facing benefit at scale is "one vault instead of 1000 × N OAuth flows" (`amp-architecture/references/data-flow-diagram.md`). To deliver that, tool credentials MUST live in a centrally managed, rotatable, audit-logged secret store — NEVER in customer config, NEVER in nemo-backend source, NEVER in browser DOM.

## Storage — Google Secret Manager

Same backing store as provider credentials (`sa-provider-accounts`). Naming convention:

```
projects/<gcp-project>/secrets/tool-{tool-id}-{credential-name}/versions/latest
```

Examples:

- `tool-github-read-token` → GitHub PAT with read scopes
- `tool-slack-bot-token` → Slack bot user OAuth token (xoxb-...)
- `tool-exa-api-key` → Exa API key
- `tool-notion-integration-token` → Notion integration secret

For OAuth-based tools (Notion, Google Workspace, etc.), the **provider's bot/integration token** is the credential — NOT a customer-specific OAuth refresh token. The marketplace runs as a single tenant from the upstream's perspective (one Slack app, one Notion integration), and per-customer authorization is handled by the upstream's permission model (e.g., the Slack app is installed only into channels the customer adds it to).

Per-customer OAuth (e.g., "let each customer connect their own GitHub") is Phase 2 — `super_admin.tool_oauth_grants(org_id, tool_id, refresh_token_ref)` with the same Secret Manager backing. Initial launch uses single-tenant integrations.

## Access pattern

Only nemo-backend reads tool secrets, only at execution time, only via the workload identity bound to the Cloud Run service account `<backend-service-account>`.

```python
# 03-nemo-backend/nemo_backend/mcp_gateway/tool_executor.py — sketch
from google.cloud import secretmanager

_client = secretmanager.SecretManagerServiceClient()
_cache = {}  # process-local, 60s TTL

async def resolve_credential(tool_id: str, credentials_ref: str) -> str:
    if credentials_ref in _cache:
        return _cache[credentials_ref]
    resp = _client.access_secret_version(name=credentials_ref)
    secret = resp.payload.data.decode()
    _cache[credentials_ref] = secret  # mind TTL
    return secret
```

Hard rules:

- **Never log the secret.** Not even at DEBUG. Tool-call logs (`nemo.tool_call_log`) store `args` and `response`, never the credential used.
- **Never return the secret in any API response.** Including admin-UI responses — those return `credentials_ref` only, not the resolved secret. Admin UI cannot read the secret value (use-it-or-rotate-it).
- **Never inject the secret into `args`.** Tool executor builds the upstream request with the secret in a header (e.g., `Authorization: Bearer <secret>`); the secret never lands in the JSONB `args` column.
- **Mask in error responses.** If the upstream returns 401, the error surfaced to the agent says "tool authentication failed" — not "401 Unauthorized: Bearer xoxb-12345...".

## Rotation — mirrors `sa-provider-accounts`

Quarterly rotation (same as provider credentials). Process:

1. Super-admin clicks "Rotate credential" in `app/(authenticated)/tools/{id}/edit/page.tsx`
2. UI calls `POST /super-admin/tools/{id}/rotate-credential` with the new credential value
3. Super-admin writes new version to Secret Manager (`tool-{id}-{name}/versions/{N+1}`)
4. Super-admin updates `super_admin.tool_accounts.credentials_ref` to `.../versions/latest` (always — never pin to N)
5. Super-admin POSTs `/super-admin/tool-cache/replace` to nemo-backend — forces in-process cache flush
6. `nemo.audit_log` writes a `tool_credential_rotated` entry (per `sa-audit-trail`)

Old versions stay in Secret Manager for 90 days (rollback window), then auto-pruned.

## What lives where — quick map

| Thing | Where | Why |
|---|---|---|
| Plaintext secret | Google Secret Manager only | At-rest encryption + audit log on every access |
| Reference (`credentials_ref`) | `super_admin.tool_accounts.credentials_ref` | Resource path only; useless without IAM access |
| Mirror reference | `nemo.tool_cache.credentials_ref` | Same string, replicated for runtime hot read |
| Resolved secret at runtime | nemo-backend process memory, 60s TTL | Cheap re-fetch; bounded blast radius |
| Audit of access | Cloud Audit Logs (Secret Manager) | Every `accessSecretVersion` call logged |
| Audit of rotation | `super_admin.audit_log` | Who rotated what when |

## Comparison with provider credentials

| Property | `sa-provider-accounts` (LLM provider keys) | `amp-mcp-gateway` (tool credentials) |
|---|---|---|
| Secret store | Secret Manager | Secret Manager |
| Naming | `provider-{provider}-{name}` | `tool-{tool-id}-{name}` |
| Catalog table | `super_admin.provider_accounts` | `super_admin.tool_accounts` |
| Pricing table | (in LiteLLM config) | `super_admin.tool_pricing` |
| Read by | nemo-backend (mounted LiteLLM) | nemo-backend (tool_executor) |
| Rotation cadence | Quarterly | Quarterly |
| Audit log | `super_admin.audit_log` | `super_admin.audit_log` |
| Caller | LiteLLM model_list | tool_executor.dispatch |

Diff: tool credentials have a separate pricing table because flat-rate-per-call is the new pricing axis (LLM is per-token via LiteLLM).

## What this does NOT cover

- Customer-specific OAuth (Phase 2). When that lands, the vault grows a new table `super_admin.tool_oauth_grants(org_id, tool_id, refresh_token_ref)` and the executor resolves the per-org token instead of the shared bot token.
- BYOK for tools (out of scope — Rule #2 says no BYOK for the entire Nemo product).
- Federated identity (SAML to upstream tools — much later; current customers aren't asking).

## Verification

- `gap-hunter` check (new scanner): every row in `super_admin.tool_accounts` has a resolvable `credentials_ref` in Secret Manager. Failures alert oncall.
- `nemo-key-display-audit` extension: grep nemo-backend logs for raw tokens (`xoxb-`, `ghp_`, `sk_`) — any match is a P0.
- Quarterly: `sa-cost-leaks` audit checks that no tool credential is older than 90 days without rotation evidence in audit log.

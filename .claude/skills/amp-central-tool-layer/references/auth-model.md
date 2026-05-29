# Auth model — one `sk-nemo-xxx`, every consumer

> **Status:** TODO. The auth story across all seven consumers — what's the same, what's different, what we explicitly don't add.

## The invariant

**The same `sk-nemo-xxx` virtual key works identically across every consumer.** No per-consumer key type, no per-consumer auth flow, no per-consumer credential renaming.

This matters because:

- Customers don't manage N keys for N agent surfaces
- Rotation is one flow regardless of which consumers use the key
- Per-key tool grants (`nemo.key_tool_grants`) apply consistently — a key restricted to `github-read` is restricted to `github-read` whether called from the widget, Dify, Onyx, curl, or Claude Desktop
- One audit trail per key — `nemo.tool_call_log` shows all calls regardless of consumer

The existing `nemo-virtual-keys` skill already governs this. The central tool layer adds nothing new to the auth model — it just consumes it consistently.

## How each consumer presents the key

| Consumer | Where key lives | Wire format |
|---|---|---|
| 1. Widget | Browser sessionStorage (cleared on tab close) | `Authorization: Bearer sk-nemo-...` header on every REST call |
| 2. Playground | Existing dashboard session cookie + sessionStorage (per `nemo-playground`) | Same |
| 3. Support agent | Server-side anonymous-key issued at request start, scoped to docs-search + escalation tools only | Same |
| 4. Dify plugin | Stored in Dify's encrypted plugin credential store (Dify's responsibility) | Same |
| 5. Onyx | Environment variable on the Onyx host | Same |
| 6. Customer agents | Customer's choice — `.env`, secret manager, etc. | Same |
| 7. Native MCP clients | MCP host's config (`Authorization` header in `~/.claude/mcp_settings.json` etc.) | Same |

Every row uses the same `Authorization: Bearer sk-nemo-...` HTTP header. Existing `nemo-backend` middleware handles it transparently — no special case per consumer.

## What the gateway sees per call

Every inbound request, regardless of consumer:

```
Authorization: Bearer sk-nemo-...
```

→ `virtual_key_auth` middleware resolves to `AuthContext(org_id, team_id, key_id, role)`.

→ All downstream code (RBAC check, credit reservation, RLS, audit log) uses that `AuthContext`. The middleware doesn't know — and doesn't care — whether the request came from the widget, Dify, or `curl`.

This is the design that makes the centralization story actually centralized. If we had per-consumer auth middleware, drift would creep in within a quarter.

## Per-key tool RBAC — consistent across consumers

The customer admin (via `01-frontend-end/[organization]/keys/[keyId]/tools/`) configures which tools a key can call. That configuration applies regardless of which consumer makes the call.

Example: customer creates `sk-nemo-support-agent` and grants it `nemo-docs-search` + `slack-send` only.

- Widget call to `github-read` with that key → 403
- Dify plugin call to `github-read` with that key → 403
- Onyx call to `github-read` with that key → 403
- curl call to `github-read` with that key → 403
- Claude Desktop `tools/call` to `github-read` with that key → -32002 (JSON-RPC equivalent of 403)

Same RLS check, same `nemo.key_tool_grants` table, every time. No way to bypass by switching consumers.

## Rotation — one flow

If `sk-nemo-...` is compromised:

1. Customer revokes via dashboard (`nemo-virtual-keys` flow — `DELETE /api/keys/{id}`)
2. New `sk-nemo-...` issued
3. Customer updates the key wherever it's configured (widget data-attribute, Dify plugin config, Onyx env, MCP host config)
4. Old key returns 401 on every subsequent call regardless of consumer

The customer's rotation runbook is one document, not seven.

## Anonymous-key pattern (for the Nemo Support Agent)

The support agent on `nemorouter.ai` serves anonymous visitors. They can't bring their own `sk-nemo-...`. We provision a special **anonymous key** scoped to a Nemo-internal "public-support" org, with tool grants limited to non-side-effect tools:

- `nemo-docs-search` (RAG over public docs)
- `nemo-changelog-search`
- `github-issue-search`
- `escalate-to-human` (the only side-effect tool — posts to OUR `#support` Slack)

This key is heavily rate-limited per-IP (existing `nemo-rate-limiting`) and its budget cap is set such that the support agent's total monthly cost stays under a $-cap (existing `nemo-credits`). If someone tries to abuse it, the rate limiter and budget cap absorb the cost; nothing else is at risk.

Logged-in customers on `nemorouter.ai` (e.g., browsing docs while signed into their dashboard) get upgraded to their OWN `sk-nemo-...` so support questions can reference their actual data via Tier-2 tools (`nemo-billing-lookup`, `nemo-recent-logs`).

This pattern is reusable for any public-facing agent on a customer site: they can either require visitors to sign in OR provision an anonymous key with strict tool scope + rate limit. We document both patterns in `nemorouter.ai/docs/agent-marketplace/public-agents`.

## What we DON'T add

Conscious non-additions to keep auth simple:

- **No OAuth flow for per-end-user tool credentials.** Phase 2 / Phase 3 consideration. Initial launch: tools are single-tenant (one Slack bot, one GitHub PAT, etc.) — the marketplace serves OUR upstream integration, not per-customer OAuth chains.
- **No "consumer-specific keys"** (`sk-nemo-widget-...`, `sk-nemo-mcp-...`). Same key type for every consumer. Per-consumer scoping happens at the tool-grant layer, not the key-type layer.
- **No API key in URLs** for any consumer. Header-only. Even MCP clients that support `?api_key=...` query string get the deprecation warning per `references/mcp-protocol-native.md`.
- **No "session token" intermediate** between `sk-nemo-...` and the gateway for v1. The widget DOES use sessionStorage for browser scope, but that's storage location, not a different token type — the actual API call still carries the raw `sk-nemo-...`. (Option B for the agent runtime — see `amp-agent-runtime/references/agent-loop.md` — would introduce session cookies; held until needed.)
- **No federated auth** (SAML to upstream tools) for v1.
- **No per-tool sub-keys** (e.g., "this key works only for Slack tools"). Per-tool grants on the SAME key already cover this need.

Each of these is a deliberate "say no" to keep the auth surface small. Adding any of them is a Phase 2+ decision, not a v1 negotiation.

## Per-tool credential scope — clarity on what the gateway shows

When the gateway calls Slack on behalf of customer A's agent, it uses **Nemo's** Slack bot token (single-tenant integration). The Slack API sees a request from "Nemo Router" — not from "Customer A."

Implication: tools that require per-customer identity (e.g., "post as the customer's user, not as Nemo") are NOT supported in v1. Customer needs to install the upstream's per-customer OAuth flow themselves and then use a generic `http-request` tool — same as everyone else does today.

When per-customer OAuth lands (Phase 2), the auth model gains one new layer:

- `super_admin.tool_oauth_grants(org_id, tool_id, refresh_token_ref)` — per-customer OAuth tokens
- Tool executor checks for a per-org grant first; falls back to the Nemo-managed integration token
- Documented in `amp-mcp-gateway/references/tool-vault-design.md` when work begins

Until then, single-tenant integrations only. Document the limitation in the customer-facing docs (don't hide it).

## Failure modes — what each consumer experiences

| Failure | What the gateway returns | What the consumer should do |
|---|---|---|
| Missing `Authorization` header | 401, error: `missing_credentials` | Reauthenticate (UX choice per consumer) |
| Invalid / expired `sk-nemo-...` | 401, error: `invalid_credentials` | Tell user to update their key |
| Valid key, no grants for the requested tool | 403, error: `tool_not_granted` | Show "this tool isn't enabled for your key — ask an admin" |
| Valid key, insufficient credits | 402, error: `insufficient_credits` | Prompt user to top up |
| Valid key, rate-limited | 429, error: `rate_limited` | Backoff per `Retry-After` header |
| Valid key, guardrail rejected args | 403, error: `guardrail_rejected` | Surface the rejected rule + payload to the user |

JSON-RPC consumers (#7) get the same semantics with JSON-RPC error codes per `references/mcp-protocol-native.md`. Same error messages, different envelope.

## Telemetry

Every auth event lands in standard nemo-observability:

- Successful resolution → request span with `nemo.org_id`, `nemo.key_id`, `nemo.consumer_hint` (derived from User-Agent + path)
- Failed auth → `auth_failed` event with reason; absorbed into per-key rate limiter for repeat-abuse detection (per existing `nemo-rate-limiting`)
- Tool-grant denial → `rbac_denied` event with `tool_id` and `consumer_hint`

`nemo.consumer_hint` is the only new dimension — lets us answer "which surface is the most active for this customer?" in Phase 2 analytics. Computed from User-Agent strings:

- `User-Agent: Mozilla/...` + `Sec-Fetch-Site` headers → likely widget or playground (browser)
- `User-Agent: nemorouter-dify-plugin/X.Y.Z` → Dify
- `User-Agent: onyx-nemo-handler/X.Y.Z` → Onyx
- `User-Agent: curl/X.Y` or `python-httpx/...` → custom agent
- `User-Agent: claude-desktop/...` or MCP-spec User-Agent → native MCP client

This is a hint, not authority. Useful for analytics; not used for any security decision.

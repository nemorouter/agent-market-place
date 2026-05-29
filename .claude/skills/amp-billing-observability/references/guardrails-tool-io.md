# Guardrails on tool I/O

> **Status:** TODO. Extends `nemo-guardrails` to inspect tool args (BEFORE upstream) and tool responses (AFTER upstream).

## Why this matters

Today (LLM-only Nemo Router), guardrails fire on the *prompt* before LLM call and on the *completion* after. An agent extends the attack surface: a successful prompt-injection in the LLM output could get the agent to call `slack-send` with leaked secrets, or `database-query` with `DROP TABLE`. The LLM-prompt guardrails don't see that.

Tool I/O guardrails close the gap. Same guardrail engine, same scope hierarchy, two new invocation points.

## Two new invocation points

```
┌─────────────────────────────────────────────────────────────┐
│ POST /v1/mcp/tools/{tool_id}/call (the 11-step contract)   │
│                                                             │
│   1. AUTH                                                   │
│   2. RBAC                                                   │
│   3. ★ GUARDRAIL ON ARGS  ← NEW invocation                 │
│   4. PRICE LOOKUP                                           │
│   5. RESERVE CREDITS                                        │
│   6. VAULT LOOKUP                                           │
│   7. UPSTREAM CALL                                          │
│   8. ★ GUARDRAIL ON RESPONSE  ← NEW invocation             │
│   9. SETTLE CREDITS                                         │
│  10. LOG                                                    │
│  11. RETURN                                                 │
└─────────────────────────────────────────────────────────────┘
```

Both invocations go through the EXISTING `nemo-guardrails` engine — no new guardrail provider, no new policy DSL.

## Scope hierarchy (inherited from `nemo-guardrails`)

```
key-level guardrails    (most specific — applies to one virtual key)
   ↓ if none set, fall through to
team-level guardrails   (applies to all keys in a team)
   ↓ if none set, fall through to
org-level guardrails    (applies to all teams in the org)
```

Plus opt-in **mandatory per-tool guardrails** declared in `super_admin.tool_accounts.required_guardrails: TEXT[]`. These ALWAYS run, regardless of customer config. Use cases:

- A `slack-send` tool that touches customer-visible channels — always run content-safety
- A `database-query` tool — always run sql-injection detection
- An `email-send` tool — always run PII detection on recipient list

The org/team/key guardrails compose with the mandatory list (union, not override).

## Guardrails available for tool args (step 3)

| Guardrail | Behavior on detect | When to use |
|---|---|---|
| `pii_detect` | block / redact / log (configurable) | Args may contain PII the user didn't intend to send to upstream |
| `pii_redact_args` | redact in-place, allow call | Args definitely contain PII but we want to strip before sending upstream |
| `injection_detect` | block | Args contain text that will be passed to another LLM or search engine |
| `keyword_blocklist` | block | Per-org list (e.g., "internal-only", "do-not-send") |
| `content_safety` | block | Args contain text that will be published (Slack, email, social) |
| `sql_injection_detect` | block | Args are SQL-ish (database-query tools) |
| `prompt_injection_detect` | block | Args contain text that becomes part of a prompt downstream |

Failure (block) → return 403 with `error.code = 'guardrail_args_rejected'`, the guardrail rule that fired, and the matched span. **No reservation made.**

## Guardrails available for tool responses (step 8)

| Guardrail | Behavior on detect | When to use |
|---|---|---|
| `pii_redact_response` | redact in-place, return | Upstream returned PII (database results, scraped pages) |
| `content_safety_response` | redact / block (configurable) | Upstream returned unsafe content (scrapers, search) |
| `output_size_cap` | truncate at N bytes (default 1MB) | Avoid blowing up the model context window or DB row size |
| `secret_leak_detect` | redact | Upstream may have leaked credentials (rare but possible from misconfigured APIs) |

Failure on response → tool already executed; we paid the cost; we MUST settle. Customer gets the redacted/truncated response with a warning header:

```
x-nemo-tool-guardrail-action: pii_redacted
x-nemo-tool-guardrail-rules: pii_redact_response
```

## Per-tool registration

The tool catalog declares which guardrails are mandatory:

```sql
ALTER TABLE super_admin.tool_accounts
  ADD COLUMN required_guardrails_args     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN required_guardrails_response TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN guardrail_exempt             BOOLEAN NOT NULL DEFAULT false;
```

Seed examples:

```sql
UPDATE super_admin.tool_accounts SET
  required_guardrails_args = ARRAY['content_safety', 'pii_detect']
  WHERE id = 'slack-send';

UPDATE super_admin.tool_accounts SET
  required_guardrails_args = ARRAY['sql_injection_detect']
  WHERE id = 'database-query';

UPDATE super_admin.tool_accounts SET
  required_guardrails_response = ARRAY['pii_redact_response', 'output_size_cap']
  WHERE id = 'github-read';
```

`guardrail_exempt = true` is for healthcheck-style tools only (no args, no PII risk). Requires super-admin approval to set.

## Fail-open vs fail-closed

Inherited from `nemo-guardrails`:

- Guardrail subsystem available + rule fires → **fail-closed** (block / redact)
- Guardrail subsystem available + rule passes → allow
- Guardrail subsystem **unavailable** (e.g., the PII detection service is down) → **fail-open** with alert

Fail-open is the existing `nemo-guardrails` posture; alerts go to `sa-audit-trail` so we know when guardrails were bypassed. The marketplace inherits this; do NOT introduce a stricter posture without consulting `nemo-guardrails` first.

## Customer-facing guardrail config

In the playground (`amp-frontend-widget/references/playground-spec.md`), guardrail config lives on a per-key basis:

```
┌─ Guardrails for key sk-nemo-xxx ──────────────────────────────┐
│                                                                │
│ Args guardrails (before tool execution):                       │
│   ☑ PII detection            [Block ▼]                         │
│   ☑ Injection detection      [Block ▼]                         │
│   ☐ Custom keyword blocklist  Configure...                     │
│                                                                │
│ Response guardrails (after tool execution):                    │
│   ☑ PII redaction            [Redact ▼]                        │
│   ☑ Output size cap          [Truncate at 1MB ▼]              │
│   ☐ Content safety            [Off ▼]                          │
│                                                                │
│ Note: Some tools have MANDATORY guardrails that always run    │
│ regardless of these settings (e.g., slack-send always content │
│ safety checks). See the tool catalog for details.             │
└────────────────────────────────────────────────────────────────┘
```

Stored in existing `nemo.guardrail_configs(key_id, scope, rules)` — no new table.

## Composition with LLM-side guardrails

A typical agent turn fires guardrails at multiple points:

1. LLM-call request guardrails (existing — `nemo-guardrails`): check the prompt before LLM call
2. LLM-call response guardrails (existing): check the assistant text before passing back / continuing loop
3. Tool-call args guardrails (NEW): check tool args before upstream call
4. Tool-call response guardrails (NEW): check tool response before passing back to model

Each fires independently. Customer config controls #1, #2, #3, #4 separately (though typically the same rule set is applied to all four).

## Observability — every guardrail invocation is a span event

(See `references/trace-shape.md` for the exact event format.) Every guardrail decision lands as a span event on the parent `tool_call` or `llm_call` span. Customers can see "guardrail X fired on call Y" without leaving the trace view.

## Open questions

1. Should the playground let customers WRITE their own guardrail rules (custom regex / blocklist)? Probably yes, but needs UI design — punt to v2.
2. Should we let customers turn OFF mandatory guardrails on tools they fully trust? Probably no — defeats the safety promise. Re-evaluate if customer complaints arise.
3. Per-team guardrail-config UI — does it live in the existing guardrails page or get its own? Decision tied to `nemo-secondary-panel`.

## Related skills

- `nemo-guardrails` — the engine, the scope hierarchy, the fail-open policy
- `nemo-observability` — emits guardrail decision events on spans
- `amp-mcp-gateway` — the 11-step contract that calls into this
- `nemo-rls-enforcer` — RLS on `nemo.guardrail_configs` (existing; unchanged)
- `sa-audit-trail` — guardrail bypasses & subsystem unavailability alerts

# Credit ledger integration — tool spend lands in `nemo-credits`

> **Status:** TODO. Extends the existing reserve+settle path (Rule #7) with a new `service='tool'` discriminator. NO parallel ledger.

## The contract — Rule #7 is non-negotiable

Every tool call MUST follow:

```
reserve_credits(...)   →   execute   →   settle_credits(actual)
                                                OR
                                          release_reservation
```

No exceptions. Skipping the reservation = potential negative balance + Rule #7 violation. Skipping the release on failure = orphan reservation + customer-facing "phantom spend."

## Ledger row shape (extending existing `nemo.credit_ledger`)

```sql
ALTER TABLE nemo.credit_ledger
  ADD COLUMN tool_id TEXT,  -- nullable; populated when service='tool'
  ADD COLUMN session_id UUID;  -- nullable; populated when called from inside an agent session
```

The `service` column already exists with `'llm'`. Add `'tool'` and (reserved) `'agent_overhead'`:

```sql
ALTER TABLE nemo.credit_ledger
  DROP CONSTRAINT credit_ledger_service_check,
  ADD CONSTRAINT credit_ledger_service_check
    CHECK (service IN ('llm', 'tool', 'agent_overhead', 'subscription', 'grant', 'topup'));
```

Existing reservation indices remain unchanged. New index for fast tool-usage queries:

```sql
CREATE INDEX idx_credit_ledger_tool_time
  ON nemo.credit_ledger(organization_id, tool_id, created_at DESC)
  WHERE service = 'tool';
```

## API contract (extends `nemo-credits`)

```python
# Existing signature (do NOT break)
async def reserve_credits(
    organization_id: UUID,
    key_id: UUID,
    estimated_credits: Decimal,
    service: Literal['llm'] = 'llm',
    reference_id: str | None = None,
) -> ReservationId: ...

# NEW signature — additive
async def reserve_credits(
    organization_id: UUID,
    key_id: UUID,
    estimated_credits: Decimal,
    service: Literal['llm', 'tool', 'agent_overhead'] = 'llm',
    reference_id: str | None = None,
    tool_id: str | None = None,         # NEW — required when service='tool'
    session_id: UUID | None = None,     # NEW — populated by agent runtime
) -> ReservationId: ...
```

Backwards-compatible — all existing LLM call sites unchanged.

## Failure-path matrix (mandatory)

The 11-step contract from `amp-mcp-gateway/SKILL.md`, paired with the credit action for each failure point:

| Step | Failure | Credit action | Customer-facing |
|---|---|---|---|
| 1. Auth | invalid key | none (no reservation yet) | 401 |
| 2. RBAC | tool denied for key/team/org | none | 403 |
| 3. Guardrail (args) | PII / injection / blocked | none | 403 |
| 4. Price lookup | tool not in pricing table | none | 500 (config bug) |
| 5. Reserve | insufficient credits | none | 402 |
| 5. Reserve | DB error | none | 500 |
| 6. Vault | secret not found / IAM denied | **release_reservation** | 500 |
| 7. Execute | upstream timeout (30s) | **release_reservation** | 504 |
| 7. Execute | upstream 4xx (4xx from vendor) | **release_reservation** | 502 |
| 7. Execute | upstream 5xx | **release_reservation** | 502 |
| 7. Execute | upstream connection refused | **release_reservation** | 502 |
| 8. Guardrail (response) | PII detected → redact | **settle_credits(actual)** (cost already incurred; response returned redacted) | 200 with redacted payload + warning header |
| 8. Guardrail (response) | content unsafe → block | **settle_credits(actual)** (same — we paid the upstream) | 200 with `[blocked by guardrail]` payload |
| 9. Settle | DB error | DO NOT release (cost incurred). Log to gap-hunter scanner `leaked_tool_reservations`. Manual sweep. | 200 still returned (response was fine) |
| 10. Log | DB error | swallow; emit metric (log table being down shouldn't fail the request) | 200 |

## Atomic settlement

`settle_credits` and `nemo.tool_call_log` INSERT must happen in the same transaction (or use SAGA pattern with idempotency). Failure modes:

- Both succeed → row visible, customer charged. Happy path.
- Settle succeeds, log INSERT fails → customer charged, no audit row. Gap-hunter scanner `tool_call_unlogged` catches.
- Settle fails, log succeeds → customer NOT charged, audit row says `status='succeeded'`. Worse — looks like free service. Mitigated by transaction.

Use a single `BEGIN; settle_credits(...); INSERT INTO tool_call_log(...); COMMIT;` block. asyncpg supports this trivially.

## Gap-hunter scanners (new)

| Scanner | What it catches | Action |
|---|---|---|
| `leaked_tool_reservations` | `nemo.credit_ledger` rows with `service='tool', status='reserved'` older than 60s | Auto-release after 5 min + alert oncall |
| `tool_call_unlogged` | `nemo.credit_ledger` `service='tool', status='settled'` rows older than 60s with no matching `nemo.tool_call_log` row | Alert oncall — settlement happened without audit |
| `tool_pricing_drift` | Tool calls where settled amount > 2× estimated amount | Alert oncall — pricing-table bug or vendor cost spike |
| `tool_credentials_unhealthy` | Tools returning 401 from vendor in last hour | Auto-mark tool unhealthy in catalog, rotate via `sa-provider-accounts`-style flow |

Each scanner extends `nemo-cost-tracking` gap-hunter framework. No new infra.

## What customers see on their bill

Existing billing page (`/[organization]/billing/usage`) gets a new "Tool calls" tab:

```
┌─ Period: 2026-05-01 — 2026-05-31 ─────────────────────────────┐
│                                                                │
│ LLM calls         12,432 calls    1,250.4 credits   $12.50    │
│ Tool calls         3,891 calls      109.3 credits    $1.09    │
│   ├─ Basic tier      2,400         2.40 credits      $0.024   │
│   ├─ Premium tier    1,200        12.00 credits      $0.12    │
│   └─ Compute tier      291        94.90 credits      $0.949   │
│ Platform fee (4%)                  54.39 credits     $0.544   │
│                                  ─────────────       ──────   │
│ Total                          1,414.09 credits    $14.14     │
└────────────────────────────────────────────────────────────────┘
```

Per-tool drilldown (Phase 2) — click a tier → see "exa-search: 891 calls, $0.089."

## What does NOT change

- Existing `nemo.credit_ledger` semantics for `service='llm'` — unchanged.
- LiteLLM cost path (Rule #4) — unchanged. `x-litellm-response-cost` still owns LLM cost.
- `nemo-credits.release_reservation` API — unchanged.
- Stripe sync (`nemo-stripe-sync`) — unchanged. Settled tool credits feed into the same Stripe subscription / top-up flow as LLM credits.
- Customer-tier fee schedule (4%/2%/0%) — unchanged. Same percentages on tool spend as LLM spend.

## Why this matters for the marketplace promise

"One bill, one ledger" is the #2 customer-facing benefit in `amp-architecture`. If tool spend doesn't land in `nemo.credit_ledger`, that promise is hollow — customers would see "$X for LLMs on Nemo, plus $Y you paid each tool vendor separately." The whole orchestration value collapses.

This skill exists to make sure that doesn't happen.

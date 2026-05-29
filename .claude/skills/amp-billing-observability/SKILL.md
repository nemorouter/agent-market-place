---
name: amp-billing-observability
description: Use when designing tool pricing, integrating tool spend into the existing nemo-credits reserve+settle ledger, defining the agent-step trace shape, or extending nemo-guardrails to tool I/O. Owns the tiered flat-rate pricing model ($0.001/$0.01/$0.05 — Basic/Premium/Compute), the credit-ledger row shape for tools, the cost headers on tool responses, and the guardrail invocation points on tool args + response.
metadata:
  type: billing-observability-design
  status: TODO
  owner: surasani.rama@gmail.com
---

# amp-billing-observability — Pricing + ledger + trace + tool guardrails

> **Status:** TODO. No code. Pricing model is the working assumption — must pass `sa-nemo-business` audit before any rates go live.

## What this skill owns

Four concerns that all touch each tool call:

1. **Pricing model** — how a tool call's cost is computed
2. **Credit ledger integration** — how that cost lands in the existing `nemo-credits` reserve+settle path (Rule #7)
3. **Trace shape** — how LLM calls + tool calls appear as one trace in `nemo-observability`
4. **Tool I/O guardrails** — extending `nemo-guardrails` to inspect tool args + responses

Why grouped: all four execute inside the 11-step contract in `amp-mcp-gateway/SKILL.md`. Splitting them into separate skills would force readers to cross-reference too often. Cohesion wins.

## 1. Pricing model — tiered flat rate

Three tiers, set by `super_admin.tool_accounts.category`:

| Tier | Flat rate per call | Examples | Margin model |
|---|---|---|---|
| `basic` | $0.001 | GitHub-read, Slack-send, Notion-fetch, DB-query | Pure margin — upstream is free/cheap |
| `premium` | $0.01 | Exa-search, Tavily, Firecrawl, paid REST APIs | Cost pass-through + ~50-100% margin |
| `compute` | $0.05 | Browserbase, code-execution sandboxes, image gen | Cost pass-through + lower-pct margin (vendor cost dominates) |

Plus the existing Nemo platform fee (4% / 2% / 0% by customer tier) applied on top, same as LLM spend.

Full cost calculation per tool call:

```
flat_rate = super_admin.tool_pricing.flat_rate_credits
upstream_actual = response.headers.get('x-upstream-cost') OR super_admin.tool_pricing.upstream_cost_credits OR 0
nemo_fee = (flat_rate + upstream_actual) * customer_platform_fee_pct
total_credits = flat_rate + upstream_actual + nemo_fee
```

Three honest line items the customer can inspect.

## Why tiered flat rate vs. pure pass-through

Considered alternatives (full debate in `references/tiered-flat-rate.md`):

- **Pure flat ($0.001 all tools)** — bleeds margin on Premium/Compute tools the day Firecrawl is added at scale.
- **Pure pass-through + Nemo fee** — honest, but exposes vendor pricing changes directly to customers (noisy bills).
- **Tier-bundled quota** (Tier 1: 1k tool calls/mo included, then metered) — best customer experience, but pushes the launch (needs quota-tracking infra).

**Recommendation:** ship tiered flat rate v1. Layer tier-bundled quota as v2 on top (the tiered-flat-rate accounting is what powers the quota math, so v1 work is reusable).

## 2. Credit ledger integration — Rule #7 reserve+settle

Tool calls call the existing `nemo-credits` API with a new `service` discriminator:

```python
# Existing API (from nemo-credits skill):
reserve_credits(org_id, key_id, estimated_credits, service='llm') -> reservation_id
settle_credits(reservation_id, actual_credits)
release_reservation(reservation_id)

# NEW: tools pass service='tool' + tool_id
reserve_credits(
    org_id=auth.org_id,
    key_id=auth.key_id,
    estimated_credits=flat_rate + estimated_upstream,
    service='tool',
    tool_id=tool_id,                     # NEW
    metadata={'session_id': session_id}  # NEW
) -> reservation_id
```

Ledger row shape:

```sql
nemo.credit_ledger (
  id UUID PK,
  organization_id UUID,
  key_id UUID,
  service TEXT,            -- 'llm' (existing) | 'tool' (new) | 'agent_overhead' (new — see below)
  reference_id TEXT,       -- LLM: completion_id; tool: tool_call_id
  tool_id TEXT,            -- NEW; nullable; populated when service='tool'
  amount_credits DECIMAL(20,10),  -- positive = debit, negative = grant/refund
  reservation_id UUID,
  status TEXT,             -- 'reserved' | 'settled' | 'released'
  created_at TIMESTAMPTZ
)
```

`service='agent_overhead'` is a small reserved row type for cases where the agent loop incurred cost beyond the LLM + tool calls (e.g., session persistence overhead). Currently unused — flagged for future use.

Failure paths (mandatory per Rule #7):

| Failure | Action |
|---|---|
| RBAC denied (step 2 in contract) | No reservation made. 403 to caller. |
| Guardrail on args denied (step 3) | No reservation made. 403 to caller. |
| `reserve_credits` returns 402 (step 5) | No further action. 402 to caller. |
| Vault lookup fails (step 6) | **`release_reservation` MUST fire.** 500 to caller. |
| Upstream tool fails (step 7) | **`release_reservation` MUST fire.** Map upstream error to 502/504. |
| Guardrail on response denied (step 8) | Tool already executed — we paid the cost. **`settle_credits` with actual cost.** Return redacted response. |
| Settle itself fails (step 9) | Log to `gap-hunter` queue (orphan reservation), do NOT release (cost was incurred). Manual sweep. |

The `release_reservation`-on-failure invariant is checked by an existing gap-hunter scanner (`gap_leaked_credit_reservations`). New scanner: `gap_leaked_tool_reservations` — same pattern, scoped to `service='tool'`.

## 3. Trace shape — agent-step traces

New trace structure that composes LLM and tool spans into one parent agent_turn span. Emits through existing `nemo-observability` callback infra (Langfuse / Datadog / S3 / Slack).

```
trace_id: trc_xyz                                    [parent]
  └─ span: agent_turn                                duration=3.4s
        attributes:
          session_id: sess_abc123
          iterations: 2
          total_cost_credits: 0.005408
        ├─ span: llm_call                            duration=1.1s
        │     attributes:
        │       iteration: 1
        │       model: claude-sonnet-4-6
        │       prompt_tokens: 850
        │       completion_tokens: 120
        │       cost_credits: 0.0019
        │       litellm_response_cost: 0.0019    ← from x-litellm-response-cost (Rule #4)
        ├─ span: tool_call                           duration=1.2s
        │     attributes:
        │       iteration: 1
        │       tool_id: slack-get-order-status
        │       tier: basic
        │       cost_credits: 0.00104
        │       upstream_status: 200
        │       upstream_latency_ms: 850
        │     events:
        │       - guardrail_args_passed (rules=['pii_redact','injection_detect'])
        │       - credits_reserved (estimated=0.001)
        │       - vault_lookup (ref='tool-slack-bot-token')
        │       - upstream_call (host='slack.com', status=200)
        │       - guardrail_response_passed (rules=['pii_redact'])
        │       - credits_settled (actual=0.00104)
        └─ span: llm_call                            duration=1.1s
              iteration: 2
              model: claude-sonnet-4-6
              cost_credits: 0.0023
```

### New trace fields (additive to `nemo-observability`)

| Field | Type | Where |
|---|---|---|
| `agent_session_id` | UUID | Top-level + all child spans |
| `agent_iteration` | int | All child spans |
| `tool_id` | string | tool_call spans |
| `tool_tier` | string | tool_call spans |
| `tool_call_id` | UUID | tool_call spans |
| `upstream_host` | string | tool_call events |
| `upstream_latency_ms` | int | tool_call events |
| `guardrail_decision` | enum | guardrail events on tool_call spans |
| `loop_cap_reached` | bool | agent_turn span (when relevant) |

These fields propagate through to Langfuse / Datadog with the existing callback infra — no new observability backend.

## 4. Tool I/O guardrails

Extends `nemo-guardrails` to inspect tool args (BEFORE execution) and tool responses (AFTER execution).

### Guardrail scope hierarchy (same as `nemo-guardrails`)

```
key-level guardrails (most specific)
   ↓ if none set
team-level guardrails
   ↓ if none set
org-level guardrails
```

Plus opt-in per-tool guardrails — a tool can declare `super_admin.tool_accounts.required_guardrails = ['pii_detect']` and that guardrail runs regardless of customer config (mandatory for, e.g., a tool that emails customers).

### Args guardrails (BEFORE execution, in step 3)

- **PII detection** — block tool call if args contain PII (configurable: block / redact / log-only).
- **Injection detection** — for tools that pass text to upstream LLMs or search engines, scan for prompt injection.
- **Keyword blocklist** — per-org configured (e.g., never call `slack-send` with text containing "internal-only").
- **Content safety** — for tools that emit content (Slack-send, email-send), enforce content policy.

Failure → 403 with the guardrail reason. No reservation made.

### Response guardrails (AFTER execution, in step 8)

- **PII redaction** — for tools that pull data (DB-query, GitHub-read), scrub PII before returning to the agent.
- **Output size cap** — truncate at 1MB; oversize gets marker `[truncated, N bytes]`.
- **Content safety** — for tools that scrape (Firecrawl, web fetch), block / redact unsafe content.

Failure → response IS returned but redacted; cost still settles (the upstream work happened).

### Tool calls bypass guardrails ONLY if

- Tool is `super_admin.tool_accounts.guardrail_exempt = true` (rare; e.g., a healthcheck tool that takes no args and returns no content)
- Guardrail subsystem is unavailable (fail-open per `nemo-guardrails` policy; logged as alert)

## What this skill does NOT own

- The routes themselves — `amp-mcp-gateway`
- The agent loop — `amp-agent-runtime`
- The UI for cost surfacing — `amp-frontend-widget` (consumes the headers + trace from here)
- The customer-facing pricing page — `01-frontend-end/(landingPages)/pricing` (separate; should reflect this skill's tiers once finalized — touches `nemo-landing-purity`)

## When this skill loads

Load `amp-billing-observability` when:

- Designing the tool pricing model
- Implementing reserve+settle for tool calls
- Designing the trace shape that combines LLM + tool spans
- Extending guardrails to cover tool I/O
- Auditing margin / cost leaks on tools (sibling check to `sa-cost-leaks`)
- Building any cost-surfacing UI in the playground or widget

## References

- `references/tiered-flat-rate.md` — full pricing model with margin math + competitor parity
- `references/credit-ledger-integration.md` — `service='tool'` ledger row shape, failure-path matrix, gap-hunter scanners
- `references/trace-shape.md` — full span/event shape, attribute glossary, callback emission notes
- `references/guardrails-tool-io.md` — per-tool guardrail registration, scope hierarchy, fail-open policy

## Scripts

- `scripts/pricing-calculator.sh` — TODO stub. Will compute total credits for a hypothetical agent turn (N tools × tier × customer-fee-tier) for quick sanity checks.

## Related skills

- `amp-architecture` — load first
- `amp-mcp-gateway` — the 11-step contract these 4 concerns plug into
- `amp-agent-runtime` — emits the spans
- `nemo-credits` — reserve+settle path (Rule #7)
- `nemo-cost-tracking` — passes through `x-litellm-response-cost` (Rule #4); tool cost is sibling concern
- `nemo-guardrails` — scope hierarchy + fail-open policy inherited
- `nemo-observability` — callback infra emits the new trace shape; 90-day retention
- `sa-litellm-pricing` — sibling pattern for pricing rows (model pricing ↔ tool pricing)
- `sa-cost-leaks` — sibling audit (LLM margin ↔ tool margin)
- `sa-nemo-business` — pricing rates MUST pass this audit before launch

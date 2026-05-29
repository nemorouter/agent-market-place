# Data flow — one chat turn end-to-end

> **Status:** TODO. Diagram represents the *intended* flow under interpretation 4.A.

## Scenario

A customer-support agent is embedded on `acme.example.com`. A site visitor types: *"What's the status of order #1234?"* The agent must call an internal Slack channel for status and respond.

## Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Visitor's browser on acme.example.com                                    │
│                                                                          │
│   widget.js (UMD bundle from cdn.nemorouter.ai/agent-widget/v1/)         │
│      └─ holds sk-nemo-acmeXX in sessionStorage                           │
│      └─ POST /v1/agents/sessions/sess_abc/messages                       │
│         { content: "What's the status of order #1234?" }                 │
└──────────────────────────────────────────────────────┬───────────────────┘
                                                       │
                                                       │ HTTPS, Bearer sk-nemo-acmeXX
                                                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ api.nemorouter.ai = nemo-backend Cloud Run, port :8090                   │
│                                                                          │
│ EXISTING middleware (unchanged):                                         │
│   1. virtual-key auth → resolves AuthContext(org_id, team_id, key_id)    │
│   2. RPM/TPM rate limit                                                  │
│                                                                          │
│ NEW route: POST /v1/agents/sessions/{id}/messages                        │
│   3. Persist user message → nemo.agent_messages                          │
│   4. Load tool catalog visible to (org, team, key) → GET /v1/mcp/tools   │
│                                                                          │
│   5. Agent loop, iteration 1:                                            │
│      a. Call mounted LiteLLM /v1/chat/completions                        │
│         with tools = [slack_get_order_status, ...]                       │
│      b. LiteLLM reserves credits, calls Claude, settles credits          │
│         (existing path — Rule #4 owns LLM cost)                          │
│      c. Model returns tool_calls = [{ name: 'slack_get_order_status',    │
│                                       args: { order_id: 1234 } }]       │
│                                                                          │
│   6. Agent loop, iteration 1 — tool execution:                           │
│      a. POST /v1/mcp/tools/slack-get-order-status/call (in-process)      │
│         { args: { order_id: 1234 } }                                     │
│      b. Guardrail middleware: run nemo-guardrails on args                │
│         (PII check, injection check, content safety)                     │
│      c. reserve_credits(org_id, key_id, service='tool',                  │
│                          tool_id='slack-get-order-status',               │
│                          estimated_cost=0.001)                           │
│      d. Pull tool creds from super_admin.tool_accounts                   │
│         (vault ref → Secret Manager)                                     │
│      e. Call Slack API: GET https://slack.com/api/conversations.history  │
│      f. Response: "Order #1234 shipped 2026-05-26"                       │
│      g. Guardrail middleware: run nemo-guardrails on response            │
│         (PII redact if needed)                                           │
│      h. settle_credits(actual_cost=0.001 + nemo_fee)                     │
│      i. INSERT INTO nemo.tool_call_log                                   │
│      j. Emit trace span: tool_call(slack-get-order-status, 1.2s)         │
│                                                                          │
│   7. Agent loop, iteration 2:                                            │
│      a. Call LiteLLM again with tool_result appended                     │
│      b. Model returns final text: "Your order #1234 shipped on May 26."  │
│      c. Persist assistant message → nemo.agent_messages                  │
│      d. Return to widget                                                 │
└──────────────────────────────────────────────────────┬───────────────────┘
                                                       │
                                                       │ SSE stream
                                                       ▼
                                  ┌─────────────────────────────────┐
                                  │ Widget renders final reply      │
                                  └─────────────────────────────────┘
```

## What the customer's bill looks like for this one turn

| Line item | Cost | Source |
|---|---|---|
| LLM tokens (2× Claude calls) | $0.0042 | LiteLLM `x-litellm-response-cost` header (Rule #4) |
| Tool call: `slack-get-order-status` (Basic tier flat rate) | $0.001 | `super_admin.tool_pricing.flat_rate_credits` |
| Nemo platform fee (4% on Tier 1) | $0.000208 | `nemo-credits` settle path, computed inline |
| **Total** | **$0.005408** | Single entry in `nemo.credit_ledger` |

One key, one bill, one trace. Three reserve+settle cycles all hit the same ledger.

## Trace shape (under `amp-billing-observability/references/trace-shape.md`)

```
trace_id: trc_xyz
  ├─ span: agent_turn (3.4s)
  │    ├─ span: llm_call_1 (1.1s) — model=claude-sonnet-4-6, cost=$0.0019
  │    ├─ span: tool_call (1.2s) — tool=slack-get-order-status, cost=$0.001
  │    │    ├─ event: guardrail_args_passed
  │    │    ├─ event: credits_reserved (0.001)
  │    │    ├─ event: vault_lookup (slack-bot-token)
  │    │    ├─ event: upstream_call (slack.com 200, 0.8s)
  │    │    ├─ event: guardrail_response_passed
  │    │    └─ event: credits_settled (0.00104)
  │    └─ span: llm_call_2 (1.1s) — model=claude-sonnet-4-6, cost=$0.0023
```

All spans emit through the existing `nemo-observability` callback infrastructure (Langfuse / Datadog / S3 / Slack) — no new observability backend.

## What does NOT happen in this flow

- ❌ Widget does NOT call Slack directly. The customer never holds Slack credentials.
- ❌ Customer does NOT pay Slack separately. Slack is a free API; tool cost is just the Nemo platform fee for the orchestration.
- ❌ Agent runtime does NOT hit `agent-api.nemorouter.ai`. There is no such hostname. Every call is to `api.nemorouter.ai`.
- ❌ No new auth flow. The same virtual-key middleware that protects `/v1/chat/completions` protects `/v1/agents/*` and `/v1/mcp/*`.

## What COULD go wrong (and what catches it)

| Failure | Caught by | Action |
|---|---|---|
| Visitor floods agent (DoS) | Existing RPM/TPM middleware on the virtual key | 429 — `nemo-rate-limiting` |
| Tool returns PII in response | Guardrail middleware on tool response | Redact + log — `nemo-guardrails` |
| Tool credentials revoked | `tool_executor` catches 401 from upstream | `release_reservation`, surface as 502 to caller, mark tool unhealthy in catalog |
| Customer out of credits | `reserve_credits` returns 402 | Abort agent turn, surface 402 to widget — `nemo-credits` |
| Tool times out | `tool_executor` enforces 30s deadline | `release_reservation`, return partial result + error span |
| Tool cost exceeds estimate by >2× | Compared at settle time | Log alert (`nemo-cost-tracking` gap-hunter check), still settle |
| Agent loops infinitely | Hard cap on iterations (e.g., 10) in `/v1/agents/sessions/{id}/messages` | Return final partial answer, log loop-cap-hit event |

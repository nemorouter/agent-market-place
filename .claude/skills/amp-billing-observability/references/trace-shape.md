# Trace shape — agent_turn composes llm_call + tool_call spans

> **Status:** TODO. Extends `nemo-observability` callback emission with new span types. No new observability backend.

## Goal

Make one agent turn (user message → final assistant message, with N tool calls in between) appear as ONE parent trace in Langfuse / Datadog / S3 / Slack — not N+1 disconnected traces.

## Span hierarchy

```
trace_id: trc_<uuid>
  └─ span: agent_turn                                  [root]
        ├─ span: llm_call                              [iteration 1]
        ├─ span: tool_call                             [iteration 1]
        ├─ span: tool_call                             [iteration 1, parallel — Phase 2]
        ├─ span: llm_call                              [iteration 2]
        └─ span: tool_call                             [iteration 2]
```

For single-turn agents without tool calls, the trace collapses to:

```
trace_id: trc_<uuid>
  └─ span: agent_turn
        └─ span: llm_call
```

## Span attributes — agent_turn (root)

| Key | Type | Notes |
|---|---|---|
| `service.name` | string | `nemo-backend` |
| `nemo.org_id` | UUID | from AuthContext |
| `nemo.team_id` | UUID | from AuthContext |
| `nemo.key_id` | UUID | from AuthContext |
| `nemo.agent_session_id` | UUID | links to `nemo.agent_sessions.id` |
| `nemo.agent_id` | string | customer-supplied agent name |
| `nemo.agent_iterations` | int | total iterations the loop ran |
| `nemo.agent_max_iterations` | int | the cap (from session config) |
| `nemo.agent_loop_cap_reached` | bool | true if iterations == max |
| `nemo.agent_cancelled` | bool | true if customer cancelled |
| `nemo.total_cost_credits` | decimal | sum across all child spans |
| `nemo.llm_cost_credits` | decimal | LLM-only subtotal |
| `nemo.tool_cost_credits` | decimal | tool-only subtotal |
| `nemo.fee_credits` | decimal | Nemo platform fee subtotal |
| `start_time` / `end_time` | timestamp | span duration |

## Span attributes — llm_call

| Key | Type | Notes |
|---|---|---|
| `nemo.agent_iteration` | int | which iteration |
| `nemo.model` | string | e.g. `claude-sonnet-4-6` |
| `nemo.model_group` | string | LiteLLM `model_group` (Rule #3) |
| `nemo.custom_llm_provider` | string | LiteLLM `custom_llm_provider` (Rule #3) |
| `nemo.prompt_tokens` | int | LiteLLM `prompt_tokens` (Rule #3) |
| `nemo.completion_tokens` | int | LiteLLM `completion_tokens` (Rule #3) |
| `nemo.cost_credits` | decimal | from `x-litellm-response-cost` (Rule #4) |
| `nemo.tools_offered` | int | number of tools in the LLM request `tools` array |
| `nemo.tools_called` | int | number of tool calls in the response (0 → final text) |

These match Rule #3 sacred field names exactly — never alias them.

## Span attributes — tool_call

| Key | Type | Notes |
|---|---|---|
| `nemo.agent_iteration` | int | which iteration |
| `nemo.tool_call_id` | UUID | links to `nemo.tool_call_log.id` |
| `nemo.tool_id` | string | e.g. `slack-send` |
| `nemo.tool_tier` | string | `basic` / `premium` / `compute` |
| `nemo.tool_protocol` | string | `mcp-stdio` / `mcp-http` / `rest` / `graphql` |
| `nemo.cost_credits` | decimal | total credits charged (flat + upstream + fee) |
| `nemo.cost_breakdown.flat_rate` | decimal | from `super_admin.tool_pricing.flat_rate_credits` |
| `nemo.cost_breakdown.upstream_actual` | decimal | from upstream response header or estimate |
| `nemo.cost_breakdown.fee` | decimal | Nemo platform fee component |
| `nemo.upstream_host` | string | e.g. `slack.com` (no path; for privacy) |
| `nemo.upstream_status` | int | e.g. 200, 401, 504 |
| `nemo.upstream_latency_ms` | int | time spent on the upstream call only |
| `nemo.tool_status` | string | `succeeded` / `failed` / `timeout` / `auth_failed` / `redacted` |

## Span events — fine-grained inside tool_call

| Event name | Attributes | When |
|---|---|---|
| `guardrail_args_evaluated` | `rules`, `decision`, `latency_ms` | After step 3 |
| `credits_reserved` | `reservation_id`, `estimated_credits` | After step 5 |
| `vault_lookup` | `credentials_ref` (NOT the secret!), `cache_hit` | After step 6 |
| `upstream_call_started` | `host` | Beginning of step 7 |
| `upstream_call_completed` | `status`, `latency_ms`, `response_size_bytes` | End of step 7 |
| `guardrail_response_evaluated` | `rules`, `decision`, `latency_ms`, `redactions_applied` | After step 8 |
| `credits_settled` | `actual_credits`, `delta_vs_estimate` | After step 9 |
| `tool_call_logged` | (none) | After step 10 |
| `reservation_released` | `reason` | On any failure path |

Events emit through the same callback infra as the parent span — Langfuse picks them up as event annotations, Datadog as span events, S3 dumps them in the JSON payload.

## Emission — through existing `nemo-observability`

The existing `nemo-observability` skill defines logging callbacks (Langfuse, Datadog, S3, Slack). All three new span types (`agent_turn`, `llm_call`, `tool_call`) emit through the same callback path. New code adds the emission points; the transport is unchanged.

```python
# 03-nemo-backend/nemo_backend/mcp_gateway/routes.py — sketch
from nemo_backend.observability import emit_span, EmitOptions

async def handle_message(session_id: str, user_msg: str):
    async with emit_span("agent_turn", session_id=session_id) as turn_span:
        for iteration in range(1, max_iter + 1):
            async with emit_span("llm_call", parent=turn_span,
                                  iteration=iteration) as llm_span:
                resp = await call_llm(...)
                llm_span.set_attributes({
                    "nemo.cost_credits": resp.cost,
                    "nemo.model": resp.model,
                    ...
                })
            for tc in resp.tool_calls:
                async with emit_span("tool_call", parent=turn_span,
                                     iteration=iteration,
                                     tool_id=tc.tool_id) as tool_span:
                    tool_result = await execute_tool(tc, span=tool_span)
                    tool_span.set_attributes({
                        "nemo.cost_credits": tool_result.cost,
                        "nemo.tool_status": tool_result.status,
                        ...
                    })
        turn_span.set_attributes({
            "nemo.total_cost_credits": sum_costs(...),
            ...
        })
```

## PII masking — `nemo-observability` data policy applies

Tool args and tool responses can contain PII. The data-policy mode (set per-org in `nemo-observability`) controls what lands in trace storage:

- `mode: 'no_logging'` → no args, no responses; only metadata (cost, latency, status)
- `mode: 'metadata_only'` → arg keys logged, values redacted
- `mode: 'full_with_pii_mask'` → values logged, PII auto-redacted by `nemo-guardrails`
- `mode: 'full'` → values logged as-is (requires HIPAA-style customer attestation)

Default is `metadata_only` for tool args (more conservative than LLM logging because args go to third-party APIs).

## Trace ID propagation

- `trace_id` set at the start of `POST /v1/agents/sessions/{id}/messages` if not provided by client
- Propagated to every LLM call via `request_metadata['trace_id']`
- Propagated to every tool call via internal call to `/v1/mcp/tools/{id}/call`
- Returned in response header `x-nemo-trace-id` (consistent with existing pattern)
- Surfaced in the playground trace pane (click → opens full trace in Langfuse / Datadog if customer has it wired)

## What this trace shape enables for customers

- "Why did my agent take 8 seconds?" → see the per-call latency breakdown
- "What's costing me money?" → see the per-tool-tier cost distribution
- "Is the model self-correcting too often?" → look at iteration count + tool error rate
- "Why did Slack-send fail?" → upstream_status + tool_status spans
- "Is my prompt prone to injection?" → guardrail event annotations

All without leaving the existing observability stack.

## Out of scope for v1

- Distributed trace continuation across multiple agent turns (each turn = one trace; sessions linked via session_id only)
- Custom dimensions in customer-side Datadog (Phase 2 — needs config UI)
- Live trace tailing in the playground (v1 reads completed spans; v2 streams in-progress)

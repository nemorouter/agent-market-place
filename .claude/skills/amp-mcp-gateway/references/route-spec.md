# Route spec — `/v1/agents/*` and `/v1/mcp/*`

> **Status:** TODO. OpenAPI-ish spec for the 4 new routes added to the existing `nemo-backend:8090` gateway under interpretation 4.A.

All routes inherit the existing virtual-key auth middleware. All cost flows through the existing `nemo-credits` reserve+settle path. All responses include the standard `x-nemo-trace-id` header from `nemo-observability`.

## Common error responses

| Code | Meaning | When |
|---|---|---|
| 400 | Invalid request body / args schema | Tool args fail Pydantic validation |
| 401 | Missing/invalid `sk-nemo-xxx` | Existing virtual-key middleware |
| 402 | Insufficient credits | `reserve_credits` returns 402 (mirrors LLM path) |
| 403 | Tool not enabled for this key/team/org, or guardrail rejected args | RBAC or `nemo-guardrails` denied |
| 404 | Unknown `session_id` or `tool_id` | |
| 429 | Rate limited | Existing RPM/TPM middleware |
| 502 | Upstream tool returned error | Vendor API returned ≥500 |
| 504 | Upstream tool timeout (30s default) | Tool executor deadline exceeded |
| 500 | Internal server error | Anything else |

All error responses include:

```json
{
  "error": {
    "code": "tool_credit_insufficient",
    "message": "Insufficient credits — need 0.05, have 0.02",
    "type": "billing_error",
    "tool_id": "exa-search"
  }
}
```

Headers on every response (success or error):

```
x-nemo-trace-id: trc_<uuid>
x-nemo-request-id: req_<uuid>
```

## 1. `POST /v1/agents/sessions`

Create a new agent session. Idempotent per `client_request_id`.

**Request:**
```json
{
  "agent_id": "customer-support-v1",
  "client_request_id": "uuid-v4",
  "model": "claude-sonnet-4-6",
  "system_prompt": "You are Acme's customer support agent...",
  "tool_ids": ["github-read", "slack-send"],
  "max_iterations": 10,
  "metadata": { "page_url": "https://acme.example.com/help" }
}
```

**Response 201:**
```json
{
  "session_id": "sess_abc123",
  "agent_id": "customer-support-v1",
  "created_at": "2026-05-28T12:00:00Z",
  "tools_available": [
    { "id": "github-read", "display_name": "GitHub (read)", "category": "basic" },
    { "id": "slack-send", "display_name": "Slack (send message)", "category": "basic" }
  ],
  "model": "claude-sonnet-4-6"
}
```

**Notes:**
- `tool_ids` is intersected with the catalog visible to the calling key (RLS-scoped). Tools the key isn't granted are silently dropped — never error.
- Session lives in `nemo.agent_sessions`; messages append to `nemo.agent_messages`.
- Sessions auto-close after 1h of inactivity. Closing is a soft state — replays still work via `/messages/replay` (Phase 2).

## 2. `POST /v1/agents/sessions/{session_id}/messages`

Send one user message to the session; runs the full agent loop server-side; streams responses back via SSE.

**Request:**
```json
{
  "content": "What's the status of order #1234?",
  "stream": true
}
```

**Response 200 (SSE):**
```
event: message_start
data: {"message_id": "msg_xyz", "session_id": "sess_abc123"}

event: llm_text_delta
data: {"delta": "Let me check"}

event: llm_text_delta
data: {"delta": " that for you."}

event: tool_call_start
data: {"call_id": "tc_1", "tool_id": "slack-get-order-status", "args": {"order_id": 1234}}

event: tool_call_complete
data: {"call_id": "tc_1", "result_summary": "Order shipped 2026-05-26", "cost_credits": 0.001, "latency_ms": 1200}

event: llm_text_delta
data: {"delta": "Your order #1234 shipped on May 26."}

event: message_complete
data: {
  "message_id": "msg_xyz",
  "final_text": "Your order #1234 shipped on May 26.",
  "total_cost_credits": 0.005408,
  "iterations": 2,
  "trace_id": "trc_xyz"
}

event: done
data: {}
```

**Non-streaming response 200:**
```json
{
  "message_id": "msg_xyz",
  "session_id": "sess_abc123",
  "role": "assistant",
  "content": "Your order #1234 shipped on May 26.",
  "tool_calls": [
    {
      "call_id": "tc_1",
      "tool_id": "slack-get-order-status",
      "args": {"order_id": 1234},
      "result": {"status": "shipped", "shipped_at": "2026-05-26"},
      "cost_credits": 0.001,
      "latency_ms": 1200
    }
  ],
  "total_cost_credits": 0.005408,
  "iterations": 2,
  "trace_id": "trc_xyz"
}
```

**Notes:**
- Loop hard cap: `max_iterations` from session create (default 10). Loop-cap-hit returns the partial answer + a `loop_cap_reached` event.
- Each LLM call goes through the existing `/v1/chat/completions` path (mounted LiteLLM) — Rule #4 cost path unchanged.
- Each tool call goes through `POST /v1/mcp/tools/{tool_id}/call` (next route) — in-process.
- If the customer cancels (closes the SSE), the loop aborts AFTER the current iteration. Already-reserved credits settle (the LLM/tool call already happened); no new iteration starts.

## 3. `GET /v1/mcp/tools`

List tools the calling virtual key can use. RLS-scoped.

**Request:**
```
GET /v1/mcp/tools?category=basic
Authorization: Bearer sk-nemo-xxx
```

**Response 200:**
```json
{
  "tools": [
    {
      "id": "github-read",
      "display_name": "GitHub (read)",
      "description": "Read repos, issues, PRs, code via GitHub API.",
      "category": "basic",
      "pricing": { "flat_rate_credits": 0.001, "tier": "basic" },
      "schema": {
        "name": "github_read",
        "description": "Read GitHub resources",
        "parameters": {
          "type": "object",
          "properties": {
            "operation": { "type": "string", "enum": ["get_repo", "get_issue", "list_issues"] },
            "owner": { "type": "string" },
            "repo": { "type": "string" },
            "number": { "type": "integer" }
          },
          "required": ["operation", "owner", "repo"]
        }
      }
    }
  ],
  "total": 1
}
```

**Notes:**
- The `schema` field is OpenAI-function-calling compatible — the agent runtime passes it straight to `/v1/chat/completions` as the `tools` parameter.
- RLS: a tool appears only if `super_admin.tool_accounts.enabled = true` AND there's a row in `nemo.team_tool_grants` for the calling team AND (if scope=key) in `nemo.key_tool_grants` for the calling key.

## 4. `POST /v1/mcp/tools/{tool_id}/call`

Execute one tool. The 11-step contract in `amp-mcp-gateway/SKILL.md` is normative.

**Request:**
```json
{
  "args": {"operation": "get_repo", "owner": "anthropic", "repo": "anthropic-sdk"},
  "session_id": "sess_abc123"
}
```

**Response 200:**
```json
{
  "tool_id": "github-read",
  "call_id": "tc_xyz",
  "result": {
    "name": "anthropic-sdk",
    "owner": "anthropic",
    "stars": 12345,
    "description": "..."
  },
  "cost_credits": 0.001,
  "latency_ms": 850,
  "trace_id": "trc_xyz"
}
```

**Notes:**
- `session_id` is optional — tool calls outside an agent session (e.g., from the playground "test tool" button) are valid. Logged with `session_id = NULL`.
- The route is usable directly via the API for advanced customers who want to invoke tools without the agent loop — same auth, same key, same billing.

## Headers added to every successful tool-call response

```
x-nemo-trace-id: trc_<uuid>
x-nemo-tool-id: github-read
x-nemo-tool-cost-credits: 0.001
x-nemo-tool-tier: basic
x-nemo-tool-latency-ms: 850
```

Mirrors the `x-litellm-response-cost` pattern from Rule #4, but for tool spend instead of LLM spend. The agent runtime and the dashboard pick these up and surface them in the trace UI.

## What this spec deliberately does NOT include

- Streaming tool responses (Phase 2 — only `tool_call_complete` events for now)
- Parallel tool calls (Phase 2 — sequential within an iteration in v1)
- Tool result caching at the gateway (covered by `nemo-cost-tracking` Redis cache pattern; deferred)
- Subscriber model (e.g., webhook tools that fire over time — Phase 3)

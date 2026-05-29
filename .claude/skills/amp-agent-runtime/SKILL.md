---
name: amp-agent-runtime
description: Use when designing or implementing the agent loop, session state, and streaming for agent-market-place. Covers the loop iteration model, how the runtime consumes /v1/agents/sessions/* routes, session persistence in Redis, and the Browser-vs-Cloud-Run deployment choice. NOT an API service — this is a runtime/library that calls the existing Nemo gateway.
metadata:
  type: runtime-design
  status: shipped-v1
  owner: surasani.rama@gmail.com
---

# amp-agent-runtime — Agent loop + session + streaming

> **Status: SHIPPED v1 (2026-05-29).** The loop runs **server-side** inside nemo-backend (`03-nemo-backend/nemo_backend/mcp_gateway/agent_runtime.py:stream_agent_turn`) — stateless (full history per turn), streamed as SSE. A framework-agnostic **client** runtime ships in `agent-market-place/frontend/src/core.ts` (`@nemorouter/agent-runtime`). SoT: mono-repo skill `nemo-mcp-gateway`. v1 chose stateless-respond over Redis sessions (horizontal scale, zero session storage); sessions/threads are Phase 2. The design below is the Phase-2 roadmap.

## What this skill owns

The **agent loop** — the iteration logic that drives one chat turn from "user message" to "final assistant message," with zero or more intermediate tool calls.

Key property: this is a **runtime / library**, not an API service. It calls Nemo's existing gateway. It exposes no externally callable endpoints.

The actual loop logic runs server-side in nemo-backend (the `POST /v1/agents/sessions/{id}/messages` route from `amp-mcp-gateway/SKILL.md`). What lives in `agent-market-place/backend/` is the orchestration around that — session creation, message streaming, retry on transient errors, cancellation.

## The loop — iteration model

```
def run_turn(session_id, user_message):
    persist_message(role='user', content=user_message)
    iteration = 0
    while iteration < session.max_iterations:
        iteration += 1
        history = load_messages(session_id)
        tools_schema = load_tools_for_session(session_id)
        
        # LLM call — through existing /v1/chat/completions, mounted LiteLLM
        llm_response = call_llm(
            model=session.model,
            messages=history,
            tools=tools_schema,
            stream=True
        )
        
        if llm_response.tool_calls:
            # Tool calls — through new /v1/mcp/tools/{id}/call
            for tc in llm_response.tool_calls:
                stream_event('tool_call_start', tc)
                result = call_tool(tc.tool_id, tc.args, session_id=session_id)
                stream_event('tool_call_complete', result)
                persist_message(role='tool', content={'call_id': tc.id, 'result': result})
            # Loop continues — model gets to see tool results
            continue
        else:
            # Final text response
            persist_message(role='assistant', content=llm_response.text)
            stream_event('message_complete', llm_response)
            return
    
    # Loop cap hit
    persist_message(role='assistant', content='[loop cap reached]')
    stream_event('loop_cap_reached', {'iterations': iteration})
```

Key invariants:

- Every LLM call goes through `/v1/chat/completions` → mounted LiteLLM. Rule #4 (LiteLLM owns LLM cost) unchanged.
- Every tool call goes through `/v1/mcp/tools/{id}/call`. The 11-step contract in `amp-mcp-gateway/SKILL.md` is enforced server-side; the runtime just dispatches.
- `max_iterations` cap is HARD. Default 10. Set at session create. The loop never silently exceeds it.
- All messages persist to `nemo.agent_messages` for replay + observability.
- Streaming: every iteration emits SSE events. Customer-facing UX should NEVER block on a multi-iteration loop without intermediate progress.

## Cancellation

Customer closes the SSE → cancellation token fires. The loop:

1. Finishes the **current** LLM or tool call (no half-call abandonment — reservations must settle).
2. Persists the partial messages.
3. Emits `cancelled` event.
4. Does NOT start a new iteration.

Reservations made for the current call MUST still settle. Releasing mid-call would corrupt the credit ledger.

## Session state

Where session state lives:

| Data | Storage | TTL |
|---|---|---|
| Session metadata (model, system prompt, tool_ids) | `nemo.agent_sessions` | Persistent until org deletion |
| Message history | `nemo.agent_messages` | Persistent (90-day log retention per `nemo-observability`) |
| In-flight loop state (current iteration, reservation IDs, partial output) | Redis (existing nemo-backend cache) keyed by `session_id` | 5 min after last activity, then GC |
| Streaming connection | SSE over the same HTTP connection | Until done or cancel |

Why Redis for in-flight state: the loop can be in the middle of an iteration when the request times out (e.g., a slow tool call). On reconnect, the runtime needs to know "we were waiting on call X." Redis is the existing nemo-backend cache (no new infra).

## Deployment choice — the open question

The runtime can live in two places. Decision pending; trade-off captured in `references/agent-loop.md`.

### Option A — Browser-side (in the widget bundle)

- Widget code drives the loop directly. Each turn: widget calls `POST /v1/agents/sessions/{id}/messages` on `api.nemorouter.ai`.
- Server-side cost: zero. No agent-runtime service to operate.
- Limitation: the virtual key sits in browser sessionStorage AND drives many calls per turn (same security profile as Playground today, but ×N calls).

### Option B — Server-side (Cloud Run service in `<gcp-project>`)

- A small FastAPI app (`agent-runtime` service) holds the session and proxies streaming output to the widget via SSE.
- Widget calls `agent-runtime → nemo-backend`. The customer's `sk-nemo-xxx` lives in a session cookie scoped to `*.nemorouter.ai`, not in browser DOM.
- Adds one Cloud Run service to operate. But: zero virtual-key exposure in browser.
- Requires adding `agent-runtime` to the `validate-no-new-services.sh` allowlist (currently only nemo-backend / nemo-frontend / cloudact-super-admin).

**These docs default to Option A** for simplicity. If the user picks Option B, update `amp-architecture/scripts/validate-no-new-services.sh` allowlist and add an `infra-gcp-deploy` companion for the new service.

## What this skill does NOT own

- The four backend routes themselves — `amp-mcp-gateway`.
- The widget UI / playground UI — `amp-frontend-widget`.
- The pricing model / trace shape — `amp-billing-observability`.
- Tool credential management — `amp-mcp-gateway/references/tool-vault-design.md`.

## When this skill loads

Load `amp-agent-runtime` when:

- Designing the agent loop iteration model
- Choosing the deployment shape (browser vs. Cloud Run service)
- Implementing session persistence / cancellation / streaming
- Debugging a stuck loop, runaway iteration, or replay issue

## References

- `references/agent-loop.md` — full loop pseudocode, edge cases, browser-vs-service trade-off in depth
- `references/session-state.md` — Redis schema, replay semantics, GC, cancellation handling

## Scripts

- `scripts/run-agent-local.sh` — TODO stub. Will spin up a local test agent against `localhost:8090` for dev.

## Related skills

- `amp-architecture` — load first
- `amp-mcp-gateway` — the routes this runtime calls
- `amp-frontend-widget` — the UI surfaces that embed this runtime
- `amp-billing-observability` — how cost & traces emit
- `nemo-virtual-keys` — auth at every call
- `nemo-playground` — reference for "virtual key in sessionStorage" pattern (Rule #15)

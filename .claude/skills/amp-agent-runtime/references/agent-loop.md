# Agent loop — full design

> **Status:** TODO. Pseudocode + edge cases + the deployment-shape trade-off.

## Pseudocode (canonical — this is what `/v1/agents/sessions/{id}/messages` does server-side)

```python
async def run_agent_turn(
    session_id: str,
    user_message: str,
    auth: AuthContext,    # from existing virtual-key middleware
    stream_writer: SSEWriter | None = None,
) -> AgentTurnResult:
    session = await load_session(session_id, auth)
    if session.organization_id != auth.org_id:
        raise PermissionError("RLS: session not owned by caller")
    if session.closed_at:
        raise InvalidStateError("session closed")

    # Persist user message first (durable before any work)
    await persist_message(session_id, role="user", content=user_message, iteration=0)
    await update_last_activity(session_id)

    tools_schema = await load_tools_for_session(session_id, auth)

    iteration = 0
    while iteration < session.max_iterations:
        iteration += 1

        history = await load_messages(session_id)

        # ---- LLM call via existing /v1/chat/completions path ----
        # (mounted LiteLLM — Rule #4 owns cost via x-litellm-response-cost)
        llm_response = await call_chat_completions(
            model=session.model,
            messages=history,
            tools=tools_schema,
            stream=stream_writer is not None,
            request_metadata={
                "agent_session_id": session_id,
                "iteration": iteration,
            },
        )

        if stream_writer:
            async for delta in llm_response.text_deltas:
                await stream_writer.write("llm_text_delta", {"delta": delta})

        # ---- Tool calls (sequential in v1) ----
        if llm_response.tool_calls:
            tool_results = []
            for tc in llm_response.tool_calls:
                if stream_writer:
                    await stream_writer.write("tool_call_start", {
                        "call_id": tc.id,
                        "tool_id": tc.tool_id,
                        "args_preview": redact_for_preview(tc.args),
                    })

                # ---- Tool execution via new /v1/mcp/tools/{id}/call ----
                # 11-step contract enforced server-side in amp-mcp-gateway
                tool_result = await call_tool(
                    tool_id=tc.tool_id,
                    args=tc.args,
                    session_id=session_id,
                    auth=auth,
                )

                tool_results.append({"call_id": tc.id, "result": tool_result})

                if stream_writer:
                    await stream_writer.write("tool_call_complete", {
                        "call_id": tc.id,
                        "result_summary": summarize_for_stream(tool_result),
                        "cost_credits": tool_result.cost_credits,
                        "latency_ms": tool_result.latency_ms,
                    })

            # Persist tool messages, then loop continues — model sees results next iteration
            for tr in tool_results:
                await persist_message(
                    session_id,
                    role="tool",
                    content=tr,
                    iteration=iteration,
                )
            continue  # → next LLM call with tool results in history

        # ---- No tool calls → final assistant message ----
        await persist_message(
            session_id,
            role="assistant",
            content=llm_response.text,
            iteration=iteration,
            total_cost_credits=llm_response.cost_credits,
        )
        if stream_writer:
            await stream_writer.write("message_complete", {
                "final_text": llm_response.text,
                "iterations": iteration,
                "total_cost_credits": await compute_turn_cost(session_id, iteration_start=0),
            })
        return AgentTurnResult(final_text=llm_response.text, iterations=iteration)

    # ---- Loop cap hit ----
    final_text = "[Agent reached max iterations without completing — partial answer above]"
    await persist_message(session_id, role="assistant", content=final_text, iteration=iteration)
    if stream_writer:
        await stream_writer.write("loop_cap_reached", {"iterations": iteration})
    return AgentTurnResult(final_text=final_text, iterations=iteration, loop_cap_hit=True)
```

## Edge cases — non-exhaustive

| Case | Handling |
|---|---|
| LLM returns malformed tool_call (missing args, wrong shape) | Catch in tool dispatcher, persist as `role=tool, status=invalid_args`, give model the error back in next iteration (it'll often self-correct) |
| Tool times out (30s default) | `release_reservation`, persist tool message with `status=timeout`, give model the timeout back, continue loop |
| Tool returns 401 (creds revoked / expired) | `release_reservation`, persist `status=tool_auth_failed`, surface to model as tool error, log `tool_credential_unhealthy` event for oncall |
| Customer out of credits mid-loop | LLM call returns 402 OR tool call returns 402. Persist `status=insufficient_credits`, emit `error` event to stream, halt loop, return partial |
| Customer cancels mid-tool-call | Cancellation token fires AFTER current tool completes (must settle reservation). Persist tool message. Emit `cancelled` event. Loop stops. |
| Customer cancels between iterations | Easier — just halt at the start of next iteration. No in-flight reservation. |
| Network blip on SSE | Reconnection NOT supported in v1. Customer reloads, picks up via replay (`GET /v1/agents/sessions/{id}/messages?since={msg_id}`). |
| Model loops forever (infinite tool calls) | `max_iterations` cap catches it. Default 10. |
| Parallel tool calls in one LLM response | Sequential in v1 (simpler). Phase 2: bounded concurrency (≤5) with a separate `reserve_credits_batch` call. |
| Tool result too large (>1MB) | Tool executor truncates with `[truncated, N more bytes]` and emits a `tool_result_truncated` event. Model sees the truncation marker. |
| LLM returns BOTH text AND tool_calls | Persist text as `role=assistant` partial, then execute tools, then continue. Model output is just history. |

## Browser-vs-Cloud-Run trade-off in depth

The loop itself runs server-side in nemo-backend regardless. The question is: where does the **orchestrator that drives the SSE connection to the customer's browser** live?

### Option A — Browser-side orchestrator (default)

```
[Customer browser]
   ↓ Bearer sk-nemo-xxx (sessionStorage)
[api.nemorouter.ai = nemo-backend]
   ↓ runs the loop server-side, streams back via SSE
[Customer browser]
```

**Pros:**
- Zero new infra.
- One network hop.
- Trivially scales — Cloud Run autoscales nemo-backend.
- Mirrors `nemo-playground` security model (Rule #15).

**Cons:**
- Virtual key sits in browser sessionStorage for the full agent session — longer exposure window than a single Playground chat.
- A compromised customer host page (XSS) can steal the key.
- Mitigated by: sessionStorage cleared on tab close, key only sent over HTTPS, CSP on the widget iframe.

### Option B — Server-side orchestrator (`agent-runtime` Cloud Run service)

```
[Customer browser]
   ↓ session cookie (HttpOnly, SameSite=None, Secure) scoped to *.nemorouter.ai
[agent-runtime.nemorouter.ai] - new Cloud Run service
   ↓ resolves session cookie → looks up sk-nemo-xxx from server-side vault
   ↓ Bearer sk-nemo-xxx
[api.nemorouter.ai = nemo-backend]
   ↓ runs loop, streams back
[agent-runtime] - forwards SSE
[Customer browser]
```

**Pros:**
- Virtual key never leaves Nemo infrastructure.
- Customer browser holds only a session cookie (revocable, short-lived).
- CSRF/XSS on the host page can't exfiltrate the LLM key.

**Cons:**
- One more Cloud Run service to operate (the user said NO new services — but this is an internal infra service, not a customer-facing API, so the constraint debate is open).
- Two network hops.
- Adds a new vault (session-cookie → sk-nemo-xxx map) — extra failure surface.
- Adds a new failure mode (agent-runtime down → no agents work even if nemo-backend is healthy).

### Decision matrix

| Factor | Weight | Option A | Option B |
|---|---|---|---|
| User-stated "no new APIs" constraint | High | ✅ no new service | ⚠ adds `agent-runtime` service (debatable) |
| Time to launch | High | ✅ faster | ❌ +2-4 weeks for new service + infra |
| Key exposure window | Medium | ⚠ session-long | ✅ never in browser |
| Operational cost | Medium | ✅ ~$0 | ⚠ extra Cloud Run bill |
| Scales to 1000+ customers | High | ✅ trivially | ✅ trivially |
| Mitigation if A is breached | — | sessionStorage limits + CSP + key rotation | Rotate session cookie, key untouched |

**Recommendation:** Launch with Option A. Move to Option B if a security incident or customer-enterprise audit requirement demands it. Mark Option B as a known migration path in `amp-architecture/references/constraint-checklist.md`.

## How the runtime package (`agent-market-place/backend/`) fits

Even under Option A (loop is server-side), there's still client-side runtime code:

- **Tool schema fetcher** — calls `GET /v1/mcp/tools`, caches the result per session.
- **SSE consumer** — opens the connection, parses events, dispatches to widget UI handlers.
- **Replay helper** — `GET /v1/agents/sessions/{id}/messages` for history rehydration on reload.
- **Cancellation helper** — wraps AbortController for clean teardown.

This client-side runtime ships as `@nemorouter/agent-runtime` (UMD bundle for the embed widget, ESM for the playground). It's a thin library — no API logic, no business rules.

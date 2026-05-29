# Session state — Redis schema + replay + GC

> **Status:** TODO. Defines where in-flight agent state lives between iterations.

## Two-tier storage

| Tier | Storage | TTL | What it holds |
|---|---|---|---|
| Persistent | `nemo.agent_sessions`, `nemo.agent_messages` | Org lifetime / 90d log retention | Session config, full message history |
| In-flight (cache) | Redis (existing nemo-backend cache) | 5 min from last activity | Current iteration #, pending reservation IDs, stream cursor |

The persistent tier is the SoT for replay. The in-flight tier is the SoT for "is this session currently mid-turn?"

## Redis schema

```
agent:session:{session_id}:state          HASH   {iteration, started_at, last_call_id, reservation_ids[]}
agent:session:{session_id}:lock           STRING (NX, EX=30s)  — held during a single iteration
agent:session:{session_id}:cancel         STRING (NX)  — sentinel for cancellation
agent:session:{session_id}:tool_cache     HASH   {tool_id: schema_json}   — cached for the session lifetime
```

Why a lock: prevents two concurrent `POST .../messages` calls from racing on the same session. If a customer double-clicks, the second request waits or 409s.

Why the cancel sentinel: cancellation needs to be readable from inside the loop without polling Redis on every step. The loop checks the sentinel between iterations and between LLM/tool boundary points.

## Replay semantics

`GET /v1/agents/sessions/{session_id}/messages?since={msg_id}` returns all messages after `msg_id`, in iteration order. Used for:

- Widget reload mid-session (network blip, tab refocus)
- Playground "view history" when reopening a closed session
- Debugging — copy a session ID, hit replay, see exactly what happened

Replay is read-only against `nemo.agent_messages`. Does not touch Redis.

## GC

- Redis state auto-expires after 5 min of no activity. No explicit GC needed.
- `nemo.agent_sessions.closed_at` is set when the session explicitly ends (customer calls `POST /v1/agents/sessions/{id}/close`) OR when a daily cron sweeps sessions with `last_activity_at > 7 days` and no `closed_at`.
- `nemo.agent_messages` follows the existing `nemo-observability` 90-day retention. After 90 days, partition is dropped.

## Cancellation handling

1. Customer closes SSE / fetch stream OR explicitly calls `POST /v1/agents/sessions/{id}/cancel`
2. Backend sets `agent:session:{session_id}:cancel = 1` in Redis (`EX=60`)
3. The currently-running iteration:
   - Finishes the in-flight LLM or tool call (cannot abandon — reservation must settle)
   - Checks the cancel sentinel before starting the next iteration
   - If set, emits `cancelled` event, persists state, returns
4. Backend deletes the cancel sentinel + lock
5. Next message request on the same session can proceed normally

## Idempotency

`POST /v1/agents/sessions/{id}/messages` with the same `Idempotency-Key` header returns the same result (replays the original message + completion). Implementation:

- Store `agent:session:{session_id}:idem:{key}` → `{response_hash, completed_at}` for 24h.
- On repeated request with the same key, return the cached result with `x-nemo-replayed: true` header.

Critical for the embed widget where users can double-click "Send."

## Why not just rely on the database

Two reasons Redis matters:

1. **Lock granularity** — DB row-level locking with `SELECT FOR UPDATE` would block reads. Redis `SET NX` is cheaper.
2. **In-flight visibility** — knowing "this session is iteration 3 of 10 right now, with reservation IDs X,Y" without polling the DB. Lets oncall debug a stuck session without scanning logs.

If Redis is unavailable, the loop degrades to "no concurrency protection, no cancellation mid-iteration" — both LLM and tool calls still complete, ledger still consistent, just no fast cancel. Acceptable degradation.

## Sanity checks (gap-hunter scanners — Phase 2)

- `agent_session_orphaned_reservations` — every `nemo.credit_ledger.reservation` for `service='tool'` or `service='agent'` should have a matching `nemo.tool_call_log` row within 60s. Older = leaked reservation.
- `agent_session_stuck` — sessions with `last_activity_at > 1h` but no `closed_at` and a Redis lock present. Likely zombie.
- `agent_messages_balance` — every session should have `count(messages where role='user') >= 1` and `count(messages where role='assistant') >= 0`. Inverted = corruption.

# Playground UI spec

> **Status:** TODO. The admin/test surface that lives inside `01-frontend-end`.

## Where it lives

```
01-frontend-end/src/app/[organization]/agent-playground/
```

New route group alongside the existing `/playground` (raw LLM tester from `nemo-playground`). Same dashboard layout, same auth, same RLS scoping.

## Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Dashboard shell (sidebar + topbar)                                      │
│  ├─ Primary sidebar (existing)                                          │
│  ├─ Secondary panel (Agent Playground entry — auto-collapse per         │
│  │  nemo-secondary-panel)                                               │
│  │                                                                       │
│  └─ Main content area:                                                  │
│     ┌─────────────────┬─────────────────────┬───────────────────────┐  │
│     │ Tool Picker     │ Chat Pane           │ Trace View            │  │
│     │ (left, 280px)   │ (center, flex)      │ (right, 360px)        │  │
│     │                 │                     │                       │  │
│     │ • Model picker  │ system: "You are..."│ ┌─ trc_xyz (3.4s) ──┐ │  │
│     │ • System prompt │ user:   "What's..." │ │ llm_1   $0.0019  │ │  │
│     │ • Tool checks   │ tool:   slack...    │ │ tool_1  $0.001   │ │  │
│     │   ☑ github-read │ tool:   {result}    │ │ llm_2   $0.0023  │ │  │
│     │   ☑ slack-send  │ assistant: "Your... │ └────────────────────┘ │  │
│     │   ☐ exa-search  │                     │                       │  │
│     │                 │ [input bar........] │ Cost total: $0.005   │  │
│     │ [Export embed]  │                     │ Iterations: 2        │  │
│     └─────────────────┴─────────────────────┴───────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### `<AgentChatPane>` — shared with widget

Renders the message list, handles streaming, dispatches new messages. Same component used inside the iframe of the embed widget (via the shared `@nemorouter/agent-runtime` package). Differences in playground mode:

- Allow inline "regenerate" on the last assistant message
- Show "iteration N of M" badge per message
- Allow inline "edit and resend" on any user message (rewinds session to that point)

### `<ToolPickerSidebar>`

Lists tools available to the calling key (via `GET /v1/mcp/tools`). Each row:

- Checkbox: enable/disable for THIS playground session (does NOT mutate `nemo.key_tool_grants` — that's a separate action)
- "Manage tool access" link → opens the per-key grant editor (writes to `nemo.key_tool_grants`)
- Tool category badge (Basic / Premium / Compute) + pricing tooltip

### `<AgentTraceView>`

Live trace pane. Listens to the same SSE stream as the chat. For each event:

- `llm_text_delta` → no trace entry (text deltas don't show in trace)
- `tool_call_start` → new "tool call" row, status spinner
- `tool_call_complete` → row updates with cost + latency
- `message_complete` → adds summary row at top: total cost, iteration count, trace ID (linkable to full observability)

Click any row → opens detail drawer with full args / response JSON (with PII masked per `nemo-observability` data policy).

### `<EmbedSnippetModal>`

Exports the current configuration as a `<script>` tag. Pre-fills the CSP snippet the customer needs to add. Provides a "copy to clipboard" button + a "test this snippet in a fresh browser tab" button.

### `<ModelPicker>` and `<SystemPromptEditor>`

Reuses the existing components from `/playground` route. Same model catalog, same system prompt UX. No duplication.

## Session lifecycle in the playground

| Action | What happens |
|---|---|
| Open `/agent-playground` | `POST /v1/agents/sessions` with `agent_id='playground-{userId}-{timestamp}'`. Returns `sessionId`. |
| Type message, hit send | `POST /v1/agents/sessions/{id}/messages` with `stream=true`. Render SSE in chat pane + trace pane. |
| Click "regenerate" | Soft-delete the last assistant message in `nemo.agent_messages`, re-send the prior user message. (Or use `idempotency-key` for replay determinism.) |
| Click "clear chat" | `POST /v1/agents/sessions/{id}/close`, then `POST /v1/agents/sessions` for a new session. Old messages stay in DB (auditable). |
| Change model / system prompt mid-session | New session (old config baked into session_id row). Confirm before nuking history. |
| Toggle a tool checkbox | Updates `session.tool_ids` via `PATCH /v1/agents/sessions/{id}` (Phase 2; for now, requires new session). |
| Click "Export embed" | Modal renders the `<script>` tag with current config. Does NOT call any new endpoint — config is client-side. |

## RLS

The playground is a dashboard route. Standard `nemo-auth` flow:

- Customer logs in (Supabase Auth)
- Middleware resolves `AuthContext(org_id, team_id, key_id)`
- All API calls from playground use the *user's* virtual key — same as `/playground` today

Customers cannot test "agents for org B" while logged into org A. RLS on `nemo.agent_sessions` enforces this (per `amp-mcp-gateway/references/tool-catalog-schema.md`).

## Secondary panel entry (per `nemo-secondary-panel`)

Add to `01-frontend-end/src/components/sidebar/secondary-panel/`:

- New entry `AgentPlaygroundPanel.tsx`
- Auto-collapse contract: expand on route change to `/agent-playground`, collapse to 56px rail once the tool catalog has loaded.
- Icon: a stylized chat-bubble-with-bolt (mirrors the existing playground bolt icon, with a chat overlay).

## Density (per `nemo-router-mono-repo/CLAUDE.md`)

- Outer container: `py-6`
- Section spacing: `space-y-6`
- Cards: `p-5`
- Numbers (cost, latency, iteration count): Geist Mono, `font-semibold` (never `font-bold`)
- Body text: Geist (sans), `font-normal`

## Out of scope for v1

- Multi-agent orchestration (one agent per session)
- A/B test of two agent configs side-by-side
- Saved agent presets shared across teams (Phase 2 — needs a `nemo.agent_presets` table)
- Voice / audio modality
- File upload to agents (Phase 2 — needs a file vault)

---
name: amp-frontend-widget
description: Use when designing or implementing the pluggable embeddable chat widget OR the admin playground that configures it. Both surfaces share the @nemorouter/agent-runtime package and call the same agent loop endpoints. The widget is framework-agnostic (UMD bundle, iframe-isolated); the playground lives inside 01-frontend-end as a new dashboard route.
metadata:
  type: frontend-design
  status: shipped-v1
  owner: surasani.rama@gmail.com
---

> **Implemented in `agents/customer-service-agent/` + LIVE on prod (`guru-cs-agent`, 2026-06-02).**
> The runnable agent ships a real **operator dashboard at `/admin`** — the standalone agent's
> own dashboard, distinct from the planned 01-frontend-end playground described below:
> - **Config dashboard** — edit agent name, system prompt, model, suggestion chips, quick
>   links, contact methods, enabled tools; persisted to the agent's OWN Supabase
>   (`agent_config`, overlaying env defaults). Widget reads `GET /api/config`; the public
>   projection never leaks `systemPrompt`/`model`/`enabledTools`.
> - **Auth** — self-contained **email-OTP login** (SendGrid + an HMAC-signed challenge cookie
>   → local signed session; `lib/admin-auth.ts`). **No Supabase Auth / no `auth.users`** —
>   isolated from Nemo user logins. Allowlisted by `ADMIN_EMAILS`; `ADMIN_TOKEN` bearer kept
>   for scripts/machines (`isAuthorized` = session cookie OR token).
> - **Tools + vault** — `/admin` lists MCP-gateway tools + stores per-tool credentials sealed
>   by the agent-infra vault (`lib/vault.ts`, AES-256-GCM, `TOOL_VAULT_KEY`).
> - **Widget** — config-driven (header name, suggestions, quick links, Contact section, live
>   tool-call steps). Files: `app/admin/page.tsx`, `app/api/{config,tools,tool-credentials,
>   admin/*}`, `lib/{settings,vault,credentials,admin-auth,email}.ts`.

# amp-frontend-widget — Pluggable widget + playground

> **Status: SHIPPED v1 (2026-05-29).** The pluggable widget is built and **separately deployable**: `agent-market-place/frontend/` — `src/core.ts` (framework-agnostic stream client) + `src/embed.ts` (zero-dependency Shadow-DOM `<script>` widget, `NemoAgentWidget.mount(...)`), bundling to a single ~12 kb file (`@nemorouter/agent-widget`). It mounts on any site with the customer's own key OR a same-origin `proxyPath`. Our first-party copy is `01-frontend-end/src/components/landing/AskNemoWidget.tsx` (React), which dogfoods it via `/api/public/ask` → `/v1/agents/nemo-support/respond`. The admin **playground** surface remains Phase 2. SoT: mono-repo skill `nemo-mcp-gateway`.

## Two surfaces, one runtime

| Surface | Where | Audience | Status |
|---|---|---|---|
| **Pluggable web chat widget** | UMD bundle on `cdn.nemorouter.ai/agent-widget/v1/widget.js` | Embedded on the customer's own site/app | TODO |
| **Playground** (admin/test surface) | `01-frontend-end/src/app/[organization]/agent-playground/` — new route group in existing dashboard | Customer admin testing their own agent before deploying | TODO |

Both surfaces use the same `@nemorouter/agent-runtime` package (designed in `amp-agent-runtime`). The widget is the customer-facing chat UI; the playground wraps that UI in admin controls (model picker, tool picker, trace viewer, embed-snippet exporter).

## Surface 1 — Pluggable widget

### Embed snippet

```html
<!-- Customer drops this anywhere on their site -->
<script
  src="https://cdn.nemorouter.ai/agent-widget/v1/widget.js"
  data-nemo-key="sk-nemo-acme..."
  data-agent-id="customer-support-v1"
  data-theme="auto"
  data-position="bottom-right"
  async
></script>
```

That's it. No npm install, no build step.

### What renders

1. Floating chat button (bottom-right by default; positionable)
2. Click → opens a chat panel (modal or sheet)
3. Visitor types → SSE stream from `/v1/agents/sessions/{id}/messages`
4. Renders streaming text + intermediate "Calling Slack..." chips for tool calls
5. Final assistant message + (optional) cost-credits indicator if `data-show-cost="true"`

### Hard requirements

- **Iframe isolation.** The widget renders inside a `<iframe>` it injects into the host page. Prevents host page CSS / scripts from corrupting the widget AND prevents widget scripts from touching the host page DOM. Standard pluggable-widget hygiene.
- **Key in sessionStorage only.** The `sk-nemo-xxx` virtual key passes from `data-nemo-key` → widget bootstrap → `sessionStorage.setItem('_nemo_amp_key', key)` inside the iframe origin. Never persisted, cleared on tab close. Mirrors `nemo-playground` per Rule #15.
- **CSP-safe.** The widget loader script is the only thing that runs in the host page context. All UI lives inside the iframe with its own CSP (per `nemo-csp-validation`).
- **No console leaks.** Never `console.log` the key, never put it in DOM attributes after bootstrap, never include it in error messages sent to a third-party logger.
- **No new origin from the host page's perspective beyond `nemorouter.ai`.** Widget bundle from `cdn.nemorouter.ai`, API from `api.nemorouter.ai`, iframe src from `agent-widget.nemorouter.ai` (or same `cdn.` origin). Same hostname constraint as the rest of the marketplace.

### Theming

Three modes via `data-theme`:
- `light` — light background, dark text
- `dark` — dark background, light text
- `auto` — follows `prefers-color-scheme`

Plus per-customer brand color via `data-brand-color="#ff6600"`. Single token; doesn't try to mimic a full design system in the host page (that's overreach — customers who need that get the playground export with custom CSS).

### Versioning

The widget URL is versioned: `/agent-widget/v1/widget.js`, `/agent-widget/v2/widget.js`. Breaking changes get a new version. Customers pin a version; v1 is supported for 18 months after v2 ships.

## Surface 2 — Playground (inside existing dashboard)

Lives at `01-frontend-end/src/app/[organization]/agent-playground/`. New route group in the existing Next.js 16 dashboard. Sibling to `/[organization]/playground/` (the raw LLM tester from `nemo-playground`).

### What it does

1. Customer picks a model + writes a system prompt.
2. Tool picker (sidebar) — checkboxes for each tool available to the org (from `GET /v1/mcp/tools`). Customer can scope to "all tools the org has," "tools enabled for team X," or "tools allowlisted to key Y."
3. Chat pane — same UI as the embed widget. Test conversation, see streaming, see tool calls.
4. Trace pane (right side) — live view of the agent trace. LLM call latency, tool call latency, cost breakdown. Powered by `amp-billing-observability/references/trace-shape.md`.
5. "Export embed snippet" button — generates the `<script>` tag with the agent config baked in. Customer pastes onto their site.

### File layout

```
01-frontend-end/src/
├── app/[organization]/agent-playground/
│   ├── page.tsx                       — server component, loads agent presets
│   ├── AgentPlaygroundClient.tsx      — client wrapper, holds session state
│   └── layout.tsx                     — dashboard layout (shares with /playground)
├── components/agent-playground/
│   ├── AgentChatPane.tsx              — shared with widget runtime
│   ├── ToolPickerSidebar.tsx          — sidebar w/ tool catalog (RLS-scoped)
│   ├── AgentTraceView.tsx             — right pane, live trace
│   ├── EmbedSnippetModal.tsx          — "Export" → copy <script> tag
│   ├── ModelPicker.tsx                — reuses existing playground model picker
│   └── SystemPromptEditor.tsx         — multi-line text + presets
├── components/sidebar/secondary-panel/
│   └── AgentPlaygroundPanel.tsx       — secondary nav entry (per nemo-secondary-panel)
└── lib/agent-runtime/                 — shared with widget; @nemorouter/agent-runtime
    ├── index.ts                       — entry
    ├── client.ts                      — fetch wrapper
    ├── stream.ts                      — SSE parser
    └── types.ts                       — shared types
```

### Hard requirements (playground)

- **Same `sk-nemo-xxx` model as widget.** Customer is already logged into the dashboard; the playground reads the key the same way `/playground` does (per `nemo-playground`).
- **No new API endpoint.** Playground hits the existing routes from `amp-mcp-gateway/references/route-spec.md`.
- **Per-key tool RBAC editable here too.** Customer admin can flip a tool from "allowed on this key" to "denied" inline. Persists to `nemo.key_tool_grants`.
- **Secondary panel integration.** Auto-collapses per `nemo-secondary-panel` contract (expand on route change, collapse to 56px rail after data loads).
- **Follows existing dashboard density.** `py-6`, `space-y-6`, Geist Mono for numbers (per dashboard standards in `nemo-router-mono-repo/CLAUDE.md`).

## Shared runtime package — `@nemorouter/agent-runtime`

Same package, different bundle targets:

- **Widget bundle** — UMD, IIFE-wrapped, bundled with React-as-Preact (≤30KB gzipped target). Drop-in via `<script>`.
- **Playground bundle** — ESM, imports from React 19 (host app's), tree-shakable.

Both bundles wrap the same core:

```ts
// @nemorouter/agent-runtime — public API sketch
export class AgentSession {
  constructor(opts: { apiKey: string; agentId: string; baseUrl?: string });
  async start(config: AgentConfig): Promise<{ sessionId: string }>;
  async sendMessage(content: string, opts?: { stream?: boolean }): AsyncIterable<AgentEvent>;
  async cancel(): Promise<void>;
  async replay(sinceMessageId?: string): Promise<AgentMessage[]>;
  async close(): Promise<void>;
}

export type AgentEvent =
  | { type: 'llm_text_delta'; delta: string }
  | { type: 'tool_call_start'; callId: string; toolId: string; argsPreview: unknown }
  | { type: 'tool_call_complete'; callId: string; resultSummary: string; costCredits: number; latencyMs: number }
  | { type: 'message_complete'; finalText: string; totalCostCredits: number; iterations: number; traceId: string }
  | { type: 'cancelled' }
  | { type: 'loop_cap_reached'; iterations: number }
  | { type: 'error'; code: string; message: string };
```

## What this skill does NOT own

- The agent loop itself — `amp-agent-runtime` (server-side loop) and the runtime package (client-side wrapper)
- The backend routes — `amp-mcp-gateway`
- The pricing / trace shape — `amp-billing-observability`
- The CDN setup for widget hosting — TODO infra task; mention in `references/embed-snippet.md`

## When this skill loads

Load `amp-frontend-widget` when:

- Designing or implementing the pluggable widget bundle
- Designing or implementing the admin playground inside `01-frontend-end`
- Working on CDN / versioning for the widget
- Working on the secondary panel entry for the playground
- Debugging an embed issue, CSP failure, or styling collision

## References

- `references/embed-snippet.md` — full embed snippet spec, all `data-*` attributes, CDN hosting plan
- `references/playground-spec.md` — full UI spec for the admin playground (layouts, components, RBAC flow)
- `references/theming.md` — theme tokens, brand color application, dark/light/auto

## Scripts

- `scripts/dev-widget.sh` — TODO stub. Will spin up the widget locally (file serve + connect to `localhost:8090`).

## Related skills

- `amp-architecture` — load first
- `amp-agent-runtime` — runtime contract this surface wraps
- `amp-mcp-gateway` — backend routes this surface calls
- `amp-billing-observability` — trace shape rendered in the trace pane
- `nemo-playground` — pattern for "sk-nemo-xxx in sessionStorage" (Rule #15)
- `nemo-secondary-panel` — secondary panel auto-collapse contract
- `nemo-csp-validation` — CSP rules for the iframe + widget bundle
- `nemo-landing-purity` — Rule #17 (landing page is locked; the widget is NOT a landing concern)

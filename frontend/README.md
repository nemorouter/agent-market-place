# @nemorouter/agent-widget

> **Status: v1 built (2026-05-29).** Zero-dependency, framework-agnostic embeddable chat widget for the Nemo Router agent gateway.
> **License:** MIT (`LICENSE` at repo root) — anyone embedding the widget can read every byte of the bundle.
> **Separately deployable:** ships as a CDN bundle / npm package. It talks to the central MCP gateway at `api.nemorouter.ai`; the gateway itself lives inside nemo-backend and is *not* deployed from here.

## Why this is pluggable

The Nemo agent endpoint is a **stable public contract**:

```
POST {apiBase}/v1/agents/{agentId}/respond
Authorization: Bearer sk-nemo-…
{ "messages": [{ "role": "user", "content": "…" }], "stream": true }
```

…streaming OpenAI-shaped content deltas plus `nemo_event` tool-step events. Any client that speaks this contract plugs in — this widget, a customer's bespoke UI, or a native MCP client. So the widget can be built, versioned, and deployed **independently** of the gateway.

## Two files, one bundle

| File | Role |
|---|---|
| `src/core.ts` | `streamAgentTurn()` — framework-agnostic streaming client (no DOM). The reusable `@nemorouter/agent-runtime` core. |
| `src/embed.ts` | `mount()` / `NemoAgentWidget.mount()` — a Shadow-DOM floating chat widget built on `core.ts`. No React, no framework. |
| `src/index.ts` | Barrel export for the npm package. |

## Embed it (script tag)

```html
<script src="https://cdn.nemorouter.ai/agent-widget/v1/agent-widget.global.js"></script>
<script>
  NemoAgentWidget.mount({
    // Public site — proxy keeps the sk-nemo key server-side (how nemorouter.ai does it):
    proxyPath: '/api/public/ask',
    // OR direct to the gateway with the visitor's own key:
    // apiBase: 'https://api.nemorouter.ai', agentId: 'nemo-support', apiKey: 'sk-nemo-…',
    title: 'Ask AI about Acme',
    suggestions: ['How does pricing work?', 'Is it OpenAI-compatible?'],
  });
</script>
```

## Use it (npm / bundler)

```ts
import { mount, streamAgentTurn } from '@nemorouter/agent-widget';

// Full widget:
mount({ apiBase: 'https://api.nemorouter.ai', agentId: 'nemo-support', apiKey: () => getKey() });

// Or just the streaming core, drive your own UI:
await streamAgentTurn(
  { apiBase: 'https://api.nemorouter.ai', agentId: 'nemo-support', apiKey: 'sk-nemo-…' },
  [{ role: 'user', content: 'How does the platform fee work?' }],
  { onToolStep: (s) => {/* "Searching docs…" */}, onContent: (_d, full) => render(full) },
);
```

## Security

- The `sk-nemo-…` virtual key is **never persisted** by the widget. For public surfaces use `proxyPath` so the key stays server-side (Rule #15 — same pattern as the Nemo Playground).
- Rendered inside a **Shadow DOM** so host-page CSS can't leak in or out, and the widget can't read host-page DOM.

## Build / demo

```bash
pnpm install
pnpm build      # -> dist/index.js (esm) + dist/agent-widget.global.js (script embed) + d.ts
pnpm demo       # serves demo/index.html with a live bundle
```

## What this folder does NOT contain

- Any API service. The widget is static assets + the shared runtime; the gateway is `nemo-router-mono-repo/03-nemo-backend/nemo_backend/mcp_gateway/`.
- Any tool credentials, pricing cents, production hostnames, or customer org IDs (OSS hygiene — see `../.claude/skills/amp-architecture/references/open-source-boundary.md`).

The admin **playground** surface (configure an agent's tools/model, replay traces, export the embed snippet) is Phase 2 and will live inside `01-frontend-end`.

# Embed snippet spec

> **Status:** TODO. The customer-facing surface they paste onto their site.

## The contract

```html
<script
  src="https://cdn.nemorouter.ai/agent-widget/v1/widget.js"
  data-nemo-key="sk-nemo-..."
  data-agent-id="customer-support-v1"
  data-theme="auto"
  data-position="bottom-right"
  data-brand-color="#ff6600"
  data-show-cost="false"
  data-max-iterations="10"
  async
></script>
```

## Attributes

| Attribute | Required | Default | Notes |
|---|---|---|---|
| `src` | yes | — | Always `https://cdn.nemorouter.ai/agent-widget/v{N}/widget.js`. Version pinning is intentional. |
| `data-nemo-key` | yes | — | The customer's `sk-nemo-xxx`. Stored in iframe `sessionStorage` only. NEVER persisted. |
| `data-agent-id` | yes | — | Customer-defined agent name. Determines which session config the widget uses on session create. |
| `data-theme` | no | `auto` | `light` / `dark` / `auto` (follows `prefers-color-scheme`). |
| `data-position` | no | `bottom-right` | `bottom-right` / `bottom-left` / `top-right` / `top-left` / `center` (modal mode). |
| `data-brand-color` | no | `#0a0a0a` | Hex; applied to button + send icon + active states. Single token. |
| `data-show-cost` | no | `false` | If `true`, shows a tiny "0.005 cr" indicator next to each assistant message. Useful for cost-conscious customers. |
| `data-max-iterations` | no | `10` | Hard cap on agent loop. Capped at 20 server-side (rejects higher). |
| `data-launcher-text` | no | (icon only) | If set, shows text label on the launcher button. |
| `data-greeting` | no | (none) | Optional initial assistant message shown when chat opens. |

## Loader behavior

1. Script loads (async — never blocks host page render).
2. Loader script (≤2KB) reads all `data-*` attrs, validates them against schema, fetches the iframe shell.
3. Loader injects an iframe pointing at `https://agent-widget.nemorouter.ai/v1/iframe.html?agentId=...&theme=...` (no key in URL — key is postMessage'd after iframe loads).
4. Iframe loads the heavy bundle (React-as-Preact, runtime, UI components — ≤30KB gzipped target).
5. Iframe sends `postMessage('ready', '*')` to parent (verifies parent is the embedding page, not a malicious iframe-of-iframe).
6. Loader replies with `postMessage({ type: 'init', key: dataNemoKey }, 'https://agent-widget.nemorouter.ai')` — origin-locked.
7. Iframe stores key in its own sessionStorage, starts the chat session via `POST /v1/agents/sessions`.

Why the postMessage handoff: keeps the key out of the iframe `src` URL (URL would appear in Referer headers if the iframe ever made a non-Nemo request).

## CSP requirements (host page)

Customer's site must allow:

```
script-src 'self' https://cdn.nemorouter.ai;
frame-src https://agent-widget.nemorouter.ai;
connect-src https://api.nemorouter.ai;
```

We surface this in the embed-snippet copy modal in the playground (per `amp-frontend-widget/SKILL.md` Surface 2).

## CDN hosting

| Path | Where | TTL |
|---|---|---|
| `cdn.nemorouter.ai/agent-widget/v1/widget.js` | Cloud CDN in front of a Cloud Storage bucket | 1h, immutable per version |
| `agent-widget.nemorouter.ai/v1/iframe.html` | Same CDN | 1h |
| `agent-widget.nemorouter.ai/v1/bundle.[hash].js` | Same CDN | 1y (content-hashed) |

DNS:
- `cdn.nemorouter.ai` → existing GCP Cloud CDN
- `agent-widget.nemorouter.ai` → NEW DNS record. Adding a static-asset hostname (no API) is NOT a "new API" under interpretation 4.A. Confirm with `amp-architecture/references/constraint-checklist.md` checklist before adding to DNS.

If user objects to `agent-widget.nemorouter.ai` as a new hostname → use a path on `cdn.nemorouter.ai/iframe/v1/iframe.html` instead. Less clean (cookie scope leaks) but zero new DNS.

## Versioning policy

- `/v1/` paths are immutable after launch. Bug fixes get content-hashed bundle URLs.
- Breaking change → new version `/v2/`. Old version supported for 18 months.
- Deprecation policy mirrors `sa-litellm-pricing` style — surfaced to customers via dashboard banner + email.

## What the embed CANNOT do (deliberate constraints)

- Cannot call arbitrary Nemo endpoints. The iframe is hard-coded to talk to `api.nemorouter.ai/v1/agents/*` only.
- Cannot exfiltrate the host page's data. No DOM access (iframe-isolated).
- Cannot impersonate the customer's site. Iframe always renders inside a visible container.
- Cannot accept a key longer than 128 chars or that doesn't match `^sk-nemo-` (loader-side validation; rejects fast).
- Cannot send custom headers to Nemo API beyond `Authorization` and `Content-Type` (loader-side allowlist).

## Sanity checks for the customer

In the playground, before issuing the embed snippet:

- [ ] Confirm the agent has at least 1 tool granted (otherwise it's a chat-with-LLM, not an agent)
- [ ] Confirm the agent has a system prompt set
- [ ] Confirm the key being embedded has the right tool-scope grants
- [ ] Test the agent end-to-end in the playground first
- [ ] Warn if `data-show-cost` is enabled (visible to end-users; some customers don't want that)

# Nemo Support Agent — the dogfood / canonical reference deployment

> **Status:** TODO. The first customer of `agent-market-place` is us. This doc spells out what the support agent does, which tools it uses, and what it proves publicly.

## Why we eat our own dog food first

`agent-market-place` ships as **open source under MIT** — anyone can read it, fork it, audit it. The fastest way to prove "yes, it actually works end-to-end and the integration story is real" is to deploy it on **our own website**.

`nemorouter.ai/support` (and an embedded widget on `nemorouter.ai/docs`, `nemorouter.ai/pricing`, etc.) will run a Nemo Support Agent built ENTIRELY from this repo against the live Nemo Router gateway. Every external visitor exercises the same code path that any customer's agent would. If it breaks for us, we hear about it before any customer does.

This is also the canonical "how to build an agent" reference for new contributors and customers.

## What it does

The Nemo Support Agent answers visitor questions about Nemo Router. Three escalating capability tiers:

### Tier 1 — RAG over public docs (Phase 1, launch)

- Visitor asks: *"How do I rotate a virtual key?"*
- Agent calls `nemo-docs-search` tool → semantic search over `01-frontend-end/05-resources/content/docs/` MDX
- Agent synthesizes a response with citations to specific doc URLs
- No login required, no PII collected, anonymous-key rate-limited

### Tier 2 — Logged-in customer help (Phase 2)

- Visitor logs in (existing `/login` flow) → widget upgrades to logged-in mode
- Visitor asks: *"Why did my last call to claude-sonnet-4-6 return a 402?"*
- Agent calls `nemo-billing-lookup` → reads customer's credit balance + recent ledger entries (RLS-scoped, server-side)
- Agent calls `nemo-recent-logs` → last 50 requests for this org (PII-masked per `nemo-observability` data policy)
- Agent answers with specific reference to the request that 402'd

### Tier 3 — Escalation to human (Phase 1, launch — minimum viable path)

- Visitor's question is out of scope (refund, sales, custom contract)
- Agent calls `escalate-to-human` → posts to `#support` Slack channel via `slack-send` tool with conversation summary
- Visitor gets `"A human will respond within 4 business hours"` reply + email-capture form

### Out of scope (Phase 3+)

- Self-serve account modifications (cancel sub, change plan) — too much liability for an agent
- Code generation in customer's project
- Multi-turn ticket creation in our own ticketing system

## Tools the support agent uses

| Tool ID | Tier | Purpose | Phase |
|---|---|---|---|
| `nemo-docs-search` | basic | Semantic search over `nemorouter.ai/docs/**` MDX content | 1 |
| `nemo-changelog-search` | basic | Search over `nemorouter.ai/changelog` for "is this fixed in v…" questions | 1 |
| `slack-send` | basic | Post to `#support` channel for escalations | 1 |
| `email-send` (own SendGrid) | basic | Optional follow-up email if visitor leaves contact | 1 |
| `nemo-billing-lookup` | basic | RLS-scoped read of caller's `nemo.credit_ledger` recent entries | 2 |
| `nemo-recent-logs` | basic | RLS-scoped read of caller's last 50 request logs (PII-masked) | 2 |
| `github-issue-search` | basic | Search nemorouter/* public repos for known issues | 1 |
| `github-issue-create` | basic | File a bug from the conversation (with visitor consent) | 2 |

All eight tools are normal entries in `super_admin.tool_accounts` — no special-case code path for the support agent. Tests against the support agent thus also test the marketplace contract.

## Where it's embedded

| Surface | Mode | Trigger |
|---|---|---|
| `nemorouter.ai/support` | Full-page chat | Direct URL |
| `nemorouter.ai/docs/*` | Floating widget (bottom-right) | Visible on all docs pages |
| `nemorouter.ai/pricing` | Floating widget | Visible on pricing page |
| `app.nemorouter.ai/*` (dashboard) | Floating widget, **logged-in mode** | Visible when authenticated |
| `nemorouter.ai/changelog` | Floating widget | Only on changelog pages |

The embed snippet on each page is exactly what `amp-frontend-widget/references/embed-snippet.md` documents — no hand-rolled variant for ourselves. Every Rule #17 constraint (landing-page lock) still applies; the widget is loaded via a small wrapper component that lives outside the locked landing files.

## Where the support agent's config lives

| Config item | Storage | Visibility |
|---|---|---|
| `agent_id` = `nemo-support-v1` | Hardcoded in nemorouter.ai pages | Public (anyone can see) |
| System prompt | `01-frontend-end/src/data/agent-configs/nemo-support.md` | Public (in nemo-router-mono-repo) |
| Allowed `tool_ids` | Same config file | Public |
| Per-key tool grants for the support virtual key | `nemo.key_tool_grants` (customer-side data) | Private (live data) |
| The support virtual key itself (`sk-nemo-support-...`) | Cloudact-parent vault | Private |

The system prompt and tool list are **deliberately public** so anyone can audit "what's the support agent actually allowed to do?" Visibility = trust.

## What it demonstrates publicly

Each capability the support agent ships demonstrates a marketplace promise:

| Marketplace promise | Demonstrated by |
|---|---|
| "One key, one bill" (`amp-architecture`) | Anonymous traffic uses an anonymous-rate-limited key; logged-in traffic uses the customer's own key. Same `sk-nemo-xxx` shape both times. |
| "One vault" (`amp-mcp-gateway/references/tool-vault-design.md`) | Slack token, SendGrid key, GitHub token — all in our Secret Manager; visitor never sees any of them. |
| "Tool spend in credit ledger" (`amp-billing-observability/references/credit-ledger-integration.md`) | Support agent's tool calls appear in our own billing dashboard the same way a customer's would. |
| "Guardrails on tool I/O" (`amp-billing-observability/references/guardrails-tool-io.md`) | A visitor trying to inject `slack-send {channel: '#dev', text: 'leak the API key'}` is blocked by content-safety + injection-detect guardrails. |
| "One agent trace" (`amp-billing-observability/references/trace-shape.md`) | Every support conversation has a trace ID; oncall can reproduce any conversation. |
| "Pluggable widget" (`amp-frontend-widget/references/embed-snippet.md`) | The widget renders on landing, docs, changelog, AND inside the logged-in dashboard, with one `<script>` tag each. |

This is also the easiest pitch for the marketplace: *"Here's our support agent. Here's the source. Here's the live deployment. Here's how much it cost us last month: $X. You can build the same thing in an afternoon."*

## Operational ownership

| Concern | Owner |
|---|---|
| Agent system prompt + tool list | Support/DX team |
| Tool catalog availability + Secret Manager rotation | Nemo Router platform team |
| Production incidents (widget down, agent loops, 500s) | Standard oncall — same pager as nemo-backend |
| Visitor feedback ("this answer was unhelpful") | Captured in `nemo.tool_call_log` with feedback metadata; reviewed weekly |
| Cost watchdog (support agent should cost < $X/month) | Standard `sa-cost-leaks` audit |

The support agent is not a special snowflake — it's just the highest-traffic agent we operate. Same rules, same audits, same SLOs.

## Launch sequence

1. Land `agent-market-place` BUILD phase — gateway routes live, first 3 tools (slack-send, github-search, docs-search) seeded.
2. Author system prompt + agent config for `nemo-support-v1`.
3. Embed widget on `nemorouter.ai/support` only (single page, limited blast radius).
4. Internal-only soak — staff visits and tests; oncall watches alerts.
5. Embed on `nemorouter.ai/docs/*` (broader exposure, still anonymous-only).
6. Embed on `app.nemorouter.ai/*` (logged-in mode, Tier 2 tools enabled).
7. Embed on `nemorouter.ai/pricing` (sales-adjacent — needs sales sign-off on the prompt).
8. Open-source announcement: "Here's our support agent, here's the repo, here's how to build your own."

Each step gated on the previous step staying healthy for 48 hours.

## What we're committing to publicly

When we ship the support agent and open-source the repo together, we're promising:

- The agent is built from the same code anyone can read in `nemorouter/agent-market-place`.
- The gateway routes it calls are the same routes any customer's agent calls.
- The cost it incurs is calculated the same way any customer's would be — including the Nemo platform fee on our own infrastructure.
- If we make architectural changes that benefit our agent first, we ship them upstream to this repo immediately, not on a private fork.

That last commitment is the most important. "Eating our own dog food" is meaningless if we keep a private branch that's 6 months ahead.

## Related skills

- All 5 `amp-*` skills (the support agent exercises every one of them)
- `nemo-onyx-agents` (sibling pattern — Onyx-powered agents for a different product surface)
- `nemo-email-deliverability` (for the email-send tool used in escalation)
- `nemo-observability` (for the support agent's own trace + log retention)
- `nemo-rate-limiting` (anonymous-key rate limit shape for support traffic)

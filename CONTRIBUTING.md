# Contributing to agent-market-place

> **Status:** TODO. Documentation-only repo until BUILD phase begins.

Thanks for thinking about contributing. This repo is **MIT-licensed** and public — anyone can fork, build, and run. The runtime is open. The integrations into Nemo Router (gateway routes, credit ledger, guardrails, observability) live in [the Nemo monorepo](https://github.com/nemorouter/nemo-router-mono-repo) and are documented from this repo's perspective; the *implementation* of those routes is owned by Nemo Router maintainers.

## What this repo accepts (open contributions welcome)

- **Agent runtime improvements** — loop logic, streaming, cancellation, replay (`backend/`, `amp-agent-runtime`)
- **Widget UX** — embed bundle, theming, accessibility, framework-agnostic improvements (`frontend/`, `amp-frontend-widget`)
- **Tool integrations** — MCP server adapters, REST/GraphQL tool descriptors, schema definitions (when tool catalog ships)
- **Examples** — reference agents that exercise different patterns (RAG, multi-step planning, human-in-loop)
- **Docs** — clarity, fixed typos, better diagrams, missing edge cases
- **Tests** — golden-path coverage, edge cases, integration tests against a local Nemo Router

## What this repo does NOT accept (lives elsewhere)

- **Changes to Nemo Router gateway routes** — file PRs on the Nemo monorepo, not here
- **Changes to credit ledger / billing logic** — Nemo monorepo (`nemo-credits` skill)
- **Tool credentials** — those live in Google Secret Manager, never in this repo
- **Pricing tables** — owned by Nemo Router super-admin (private)
- **Tool catalog GA decisions** — Nemo Router maintainers decide which tools ship globally

See `.claude/skills/amp-architecture/references/open-source-boundary.md` for the full public/private boundary map.

## Hard rules (inherited from Nemo Router, must respect)

This widget runs against the production Nemo Router gateway. Code here must respect the 26 Permanent Rules at <https://github.com/nemorouter/nemo-router-mono-repo/blob/main/.claude/rules/00-permanent-rules.md>. The most load-bearing for marketplace contributions:

- **Rule #2 — No BYOK.** Don't add UX that lets users paste in raw provider keys (OpenAI, Anthropic, etc.). Tools = single managed catalog.
- **Rule #5 — Display keys safely.** `sk-nemo-xxx` shows full only at creation; everywhere else show `sk-nemo-...last4`. Widget code must respect this.
- **Rule #7 — Credits sacred.** Every tool call MUST go through `reserve_credits` → execute → `settle_credits`. Don't add client-side credit calculation; trust the headers from the gateway.
- **Rule #15 — All LLM calls use virtual keys.** Widget never holds the master key. `sk-nemo-xxx` in browser sessionStorage only, cleared on tab close.
- **Rule #17 — Landing page is locked.** This repo's widget can be embedded on landing pages, but landing-page changes themselves are out of scope.

If your contribution would violate any of these, it'll be rejected on review — even if the code is great. The rules exist because past incidents made them necessary.

## Local development

> **TODO** — when the BUILD phase starts:
>
> ```bash
> git clone https://github.com/nemorouter/agent-market-place
> cd agent-market-place
> # frontend (widget bundle)
> cd frontend && pnpm install && pnpm dev
> # backend (agent runtime)
> cd backend && poetry install && poetry run dev
> ```
>
> You'll need a local Nemo Router gateway running on `localhost:8090`. See [Nemo Router quickstart](https://nemorouter.ai/docs/quickstart-local) or use the hosted API at `api.nemorouter.ai` with an `sk-nemo-xxx` from your account.

## PR guidelines

1. **One concern per PR.** A typo fix + a new feature in one PR = harder to review.
2. **Tests required for behavior changes.** Use the existing test patterns; no mocks for the credit ledger (use a test virtual key + test org).
3. **Docs updates in lockstep.** If the change is user-visible, update the relevant `.claude/skills/amp-*/SKILL.md` or `references/`.
4. **No commented-out code.** Delete it. Git remembers.
5. **No emoji in code or commit messages.** (Repo style.)
6. **Squash on merge.** Maintainers will squash; please title your PR for the squashed commit message.

## Security

Found a vulnerability? **Do not file a public issue.** Email `security@nemorouter.ai` with details. Coordinated disclosure timeline: typically 30 days.

## Code of Conduct

Standard. Be kind, assume good faith, focus on the code not the contributor. Maintainers reserve the right to remove abusive participants.

## License

By contributing, you agree your contributions will be licensed under the MIT License (see `LICENSE`).

## Who maintains this

Nemo Router team — primary contact `surasani.rama@gmail.com`. Issues + PRs reviewed within 5 business days during BUILD phase; longer during TODO phase (this is currently TODO — no code yet).

# Open-source boundary — what's public, what stays private

> **Status:** TODO. Defines the public/private line for this MIT-licensed repo.

`agent-market-place` is **public on GitHub** under MIT. The integrations into Nemo Router (gateway routes, credit ledger, guardrails, observability) are tightly coupled by design — but the *implementation* of those services lives in repos with different visibility. This doc draws the line so contributors know what they can change here vs. what requires a PR against a different repo.

## Visibility map of the Nemo ecosystem

| Repo | Visibility | Owns |
|---|---|---|
| `nemorouter/agent-market-place` *(this repo)* | **Public, MIT** | Agent runtime, pluggable widget, tool integration descriptors, design docs |
| `nemorouter/dify-integration` | Public, MIT | NemoRouter plugin for Dify marketplace |
| `nemorouter/onyx-integration` | Public, MIT | NemoRouter Agents on an Onyx fork |
| `nemorouter/nemo-router-mono-repo` | Public (selected directories) | Nemo Router monorepo — frontend dashboard, backend gateway, public SDK |
| `nemorouter/super-admin-dashboard` | **Private** | Cloudact super-admin console (provider account vault, pricing tables, capacity provisioning) |
| `nemorouter/nemo-infra-cicd` | **Private** | Terraform + CI/CD + deploy scripts |
| `nemorouter/cloudact-nemo-growth-engine` | **Private** | GTM + sales tooling |

`agent-market-place` sits in the first tier alongside the Dify and Onyx integrations — public, MIT, contributor-friendly, dogfood-able.

## What this repo IS (public)

| Component | Why public |
|---|---|
| Agent runtime library (`backend/`, npm-publishable as `@nemorouter/agent-runtime`) | Drives wider adoption of the Nemo API; customers can audit the loop logic before embedding the widget |
| Pluggable widget bundle (`frontend/`, CDN-hosted at `cdn.nemorouter.ai`) | Trust — customers embedding on their site can inspect the source |
| Tool integration descriptors (JSON Schema definitions, OpenAPI-style specs) | Lets the community submit new tool definitions; tool plumbing isn't proprietary |
| 5 `amp-*` skills + references | Anyone forking the repo can read the design rationale and contribute meaningfully |
| Example agents (Phase 2 — reference implementations) | Adoption fuel; show "how to build a great Nemo agent" |
| Tests, fixtures, dev scripts | Standard OSS hygiene |
| LICENSE, CONTRIBUTING, code of conduct | OSS table stakes |

## What this repo is NOT (lives elsewhere)

| Concern | Where it lives | Why not here |
|---|---|---|
| **Gateway routes** (`/v1/agents/*`, `/v1/mcp/*`) | `nemo-router-mono-repo/03-nemo-backend/nemo_backend/mcp_gateway/` | Implementation needs access to nemo-backend internals (credit ledger, guardrail engine, virtual-key middleware). Public design lives here; code lives in the gateway. |
| **Tool credentials** (Slack bot tokens, GitHub PATs, vendor API keys) | Google Secret Manager (`projects/<gcp-project>/secrets/tool-*`) | Never in any git repo — public or private. |
| **`super_admin.tool_accounts` schema rows** | Cloudact-parent Supabase project (`<cloudact-parent-ref>`) | Schema shape is public (in `amp-mcp-gateway/references/tool-catalog-schema.md`); the *data* is not — it includes credential references that point at Secret Manager. |
| **Pricing tables** (`super_admin.tool_pricing`) | Same — Cloudact-parent project | Tier shape is public ($0.001/$0.01/$0.05); exact per-tool rows + margin math are commercial decisions. |
| **Customer-specific agent configs, tool grants, RBAC** | Customer's own `nemo.*` rows in their Supabase data plane | Data, not code. RLS enforces per-customer isolation. |
| **Master key (`LITELLM_MASTER_KEY`)** | `01-frontend-end/.env` + `03-nemo-backend/.env` (per Rule #16) | Customer LLM traffic never sees the master key. Widget never sees it. |
| **Deployment scripts** (Terraform, CI/CD) | `nemo-infra-cicd` (private) | Production infra config is sensitive. |
| **Internal pricing audit, margin analysis** | `cloudact-nemo-growth-engine` (private) | Business strategy, not OSS material. |

## Why this split is OK (and even good)

A community contributor can:

- Audit the **full agent loop logic** that runs in production (their data flows through this code).
- Audit the **full widget bundle** that loads in their customers' browsers.
- Audit the **tool integration patterns** to confirm there's no per-customer special-casing.
- Audit the **constraint enforcement** (CSP, sessionStorage, virtual-key handling per Rule #15).
- File issues + PRs on real bugs and watch them ship.
- Fork and run their own variant if they don't trust the upstream.

A community contributor **does not need**:

- Production tool credentials (no agent should be calling production Slack via a fork).
- The exact pricing rows (the tier shape is public; the specific cents are commercial).
- Access to other customers' agent sessions or tool grants (RLS enforced; data plane private).
- The master key (no LLM call needs it; only management calls do, and those are server-side).

## Operational rules for keeping this boundary clean

When contributing to or reviewing this repo:

- [ ] **No real credentials in tests, fixtures, or examples.** Use `sk-nemo-EXAMPLE-...` placeholders. CI grep enforces this.
- [ ] **No production hostnames in default config.** Default to `localhost:8090`; document how to override for hosted Nemo Router.
- [ ] **No specific cent amounts in pricing examples** beyond the tier shape ($0.001/$0.01/$0.05) — those rates are public; per-tool deltas are not.
- [ ] **No customer names** in examples beyond `acme-inc` (the existing demo org name in Nemo Router's public docs).
- [ ] **No `super_admin.*` data in this repo** — only the schema shapes, which are already in `amp-mcp-gateway/references/`.
- [ ] **No tool catalog SEED DATA with real Secret Manager refs.** The seed scripts in `amp-mcp-gateway/scripts/seed-tool-catalog.sh` reference Secret Manager paths by *name only*; the values stay in Secret Manager.
- [ ] **No screenshots of the super-admin dashboard.** Screenshots of the customer-facing playground are fine.

## When a contribution crosses the boundary

If a PR to this repo NEEDS a change in a private repo to land (e.g., a new tool integration that requires a Secret Manager secret + a pricing row), the maintainer flow is:

1. Land the public-side PR here (descriptor, schema, tests, docs)
2. Open a tracking issue here labeled `requires-internal-change`
3. Maintainer files an internal PR in the appropriate private repo
4. Once internal merges and Secret Manager / pricing rows ship, close the tracking issue
5. Tag a release here that turns the contribution "live"

This sequence is sometimes slow — flag it in the PR description so contributors aren't surprised.

## What we DO publish from the private side (for transparency)

- **The 26 Permanent Rules** — visible in `nemo-router-mono-repo/.claude/rules/00-permanent-rules.md`
- **The tenancy / RLS model** — `nemo-router-mono-repo/.claude/rules/02-multi-tenancy.md`
- **The credit safety model** — `nemo-router-mono-repo/.claude/rules/03-credit-safety.md`
- **The LiteLLM integration contract** — `nemo-router-mono-repo/.claude/rules/06-litellm-integration.md`
- **The DB schema for the public-facing `nemo.*` tables** — `nemo-router-mono-repo/.claude/rules/08-database.md`
- **The post-deploy log-check + deploy patterns** — `nemo-router-mono-repo/.claude/rules/20-tdd-and-fleet.md`

All of those are linked from this repo's docs. A contributor here can read the full safety/integration model before writing a single line.

## What we DON'T publish (deliberate, for security)

- Specific Cloud Run revision URLs (rotate over time; not load-bearing for OSS contributors)
- Internal Slack channel names where alerts route (security through reduced enumeration)
- Internal Datadog dashboard URLs
- Per-org pricing overrides
- Customer escalation playbooks

## How to add a new public surface

If you want to publish something that currently lives in a private repo (e.g., open-source the model catalog schema, or publish a public version of the cost-tracking module), the request goes through:

1. File an issue in `nemorouter/agent-market-place` with the `cross-repo-publish` label
2. Describe what you want public + why
3. Maintainer reviews against the boundary policy in this doc
4. Approved → maintainer extracts the piece to a sibling public package (`@nemorouter/<package>`) under a permissive license
5. Rejected → maintainer explains the reason (usually: contains customer data, contains pricing math, contains commercial strategy)

Most reasonable requests get approved. The default lean is "publish more, not less" — the value of openness compounds.

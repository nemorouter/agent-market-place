# Tiered flat-rate pricing — full model

> **Status:** TODO. Working assumption. Must pass `sa-nemo-business` audit before launch.

## The three tiers

| Tier | Flat rate per call (credits) | Examples (initial catalog) | Why this tier |
|---|---|---|---|
| `basic` | 0.001 | github-read, slack-send, notion-fetch, mongo-query, postgres-query | Upstream is free or near-free. Flat rate is pure orchestration margin. |
| `premium` | 0.01 | exa-search, tavily-search, firecrawl-scrape, paid-news-api | Upstream costs ~$0.005–0.01/call. Flat rate covers vendor + Nemo margin. |
| `compute` | 0.05 | browserbase-headless, code-execution-sandbox, image-generation, video-frame-extract | Upstream is compute-heavy ($0.02–0.04/call). Flat rate covers vendor + thin Nemo margin. |

Plus the existing Nemo platform fee (4% / 2% / 0% by customer tier) applied on top, same as LLM spend (per `sa-business-model`).

## Cost formula

```
flat_rate         = super_admin.tool_pricing.flat_rate_credits
upstream_actual   = response.x-upstream-cost  (when vendor returns it)
                  OR super_admin.tool_pricing.upstream_cost_credits  (estimated)
                  OR 0
nemo_fee_pct      = customer's tier — 4% / 2% / 0%
nemo_fee_credits  = (flat_rate + upstream_actual) * nemo_fee_pct
total_credits     = flat_rate + upstream_actual + nemo_fee_credits
```

Three honest line items. The customer can audit each.

## Margin math (assuming 4% customer-tier fee)

| Tool | Vendor cost | Flat rate | Nemo fee (4%) | Total to customer | Nemo gross margin |
|---|---|---|---|---|---|
| github-read (basic, free vendor) | $0.000 | $0.001 | $0.00004 | $0.00104 | $0.00104 |
| slack-send (basic, free vendor) | $0.000 | $0.001 | $0.00004 | $0.00104 | $0.00104 |
| exa-search (premium, paid vendor) | $0.005 | $0.010 | $0.0006 | $0.0156 | $0.0106 |
| firecrawl-scrape (premium, paid vendor) | $0.007 | $0.010 | $0.00068 | $0.01768 | $0.01068 |
| browserbase (compute, paid vendor) | $0.030 | $0.050 | $0.0032 | $0.0832 | $0.0532 |
| code-exec (compute, paid vendor) | $0.020 | $0.050 | $0.0028 | $0.0728 | $0.0528 |

## Considered alternatives — why this won

### Alt 1 — Pure flat rate ($0.001 all tools)

| Tool | Vendor cost | Flat rate | Margin |
|---|---|---|---|
| github-read | $0.000 | $0.001 | $0.001 ✅ |
| exa-search | $0.005 | $0.001 | **-$0.004 ❌** |
| browserbase | $0.030 | $0.001 | **-$0.029 ❌** |

Bleeds margin instantly when the catalog adds anything beyond free APIs.

### Alt 2 — Pure pass-through + flat Nemo fee

`total = upstream_cost * (1 + nemo_fee_pct)`

- Honest, never bleeds margin
- BUT: vendor price changes propagate directly to the customer's bill. Noisy. Hard to predict.
- BUT: zero margin on free APIs (github-read = $0.000 + fee on 0 = $0.000). The product gives away ALL orchestration value for free.

### Alt 3 — Tier-bundled quota (Tier 1: 1k tool calls/mo included, then metered)

- BEST customer experience — "agents are included in your plan"
- Requires quota-tracking infra (`nemo.tool_quota_usage` table, monthly reset cron, overage policy)
- 4-6 weeks more work before launch
- **Recommended as v2** — sits on top of v1's tiered-flat-rate accounting (the per-call cost is what the quota counts)

### Alt 4 — Per-tool individual pricing (every tool has its own price)

- Most flexible
- Operational nightmare — every new tool requires a separate sa-nemo-business pricing review
- Customers can't predict their bill (catalog grows; prices vary)
- Use this for outlier tools only (e.g., if Anthropic launches a $1/call tool, it gets its own row outside the tier system)

### Alt 5 — Per-token billing for tools (mimic LLM model)

- Doesn't map — tools aren't token-based. Apples-to-oranges.

## Customer-facing presentation

The pricing page (in `01-frontend-end/(landingPages)/pricing`) should show:

```
Tool calls (flat per-call rate, on top of platform fee)
  Basic tools (GitHub, Slack, Notion, DB queries, ...)   $0.001 / call
  Premium tools (web search, scraping, paid APIs)        $0.01  / call
  Compute tools (browsers, code execution, image gen)    $0.05  / call

  See the full catalog: /docs/tools

  Platform fee:
    Free / Pro / Growth / Scale — 0% / 2% / 4% / 0% on cost
    (Same as LLM calls — one fee schedule, no surprises)
```

Each tool's catalog page (Phase 2 docs site) shows:
- Display name + description + tier
- `super_admin.tool_pricing.flat_rate_credits`
- Known upstream cost (when applicable)
- Example: "an Exa search at our flat $0.01 + ~$0.005 typical Exa vendor cost + your 4% platform fee = ~$0.0156 per call"

## Tier reassignment policy

Tools can move tiers (e.g., a paid API becomes free). When that happens:

1. Update `super_admin.tool_pricing` with a NEW row, `effective_from = now()` and old row's `effective_to = now()`. History preserved.
2. Sync to `nemo.tool_cache` via `/super-admin/tool-cache/replace`.
3. Notify affected customers via email if the change is a price *increase* (mirror `sa-business-model` policy).
4. Log to `super_admin.audit_log`.

No mid-flight changes — a tool call in progress uses the rate that was effective when `reserve_credits` fired.

## Competitive parity check (informational — not authoritative)

| Competitor | Tool/agent pricing model | Comparison |
|---|---|---|
| OpenRouter | No tool layer | We're greenfield here — they have to rebuild for it |
| Helicone | No tool layer (observability only) | Out of their scope |
| Portkey | Has gateway; tool pricing tied to vendor APIs (pass-through) | Less margin upside than ours; we can be cheaper on basic tools |
| LangChain Cloud / LangSmith | Per-trace pricing; no tool gateway | Different model — they sell observability, not orchestration |
| LiteLLM Enterprise | Tools = customer's problem (BYOK to vendor) | Defeats the marketplace value entirely |

Our position: **the only player charging an honest flat per-call rate for managed tool orchestration**, while bundling vault + guardrails + observability + ledger.

## Open questions for `sa-nemo-business` audit

1. Is the 4% / 2% / 0% platform fee enough margin on Basic tools where vendor cost = $0? (Margin = pure flat rate.)
2. Are Compute-tier customers (heavy Browserbase usage) sensitive to a higher Nemo fee tier? (Should we cap fee on Compute calls?)
3. How do we handle a tool that becomes free overnight (vendor price drops to $0)? Tier reassignment or per-tool override?
4. Quota model (v2) — bundled quota or pure metered? `sa-business-model` audit needs to weigh in.

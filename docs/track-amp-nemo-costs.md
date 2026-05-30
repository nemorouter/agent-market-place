# track-amp-nemo-costs — tracking agent costs on the Nemo gateway

> Every cost an agent-market-place agent incurs — **LLM chat, embeddings, and (Phase 2)
> tools** — flows through the Nemo Router gateway on the agent's **`sk-nemo` virtual key**.
> That means all of it is **metered, headered, logged, and budget-capped** in one place.
> Nothing is free or hidden — including embeddings.

## The three layers (verified, with real numbers)

| Layer | Source | What it gives you |
|---|---|---|
| **1. Per-response header** | `x-nemo-request-cost` on every `/v1/*` response | live cost of that single call (chat or embedding) |
| **2. Per-request ledger** | `LiteLLM_SpendLogs` (Supabase) | one row per request: `call_type`, `model`, `spend`, `startTime` |
| **3. Aggregate + budget** | `LiteLLM_VerificationToken.spend` + `max_budget` | total spend on the key; the gateway refuses calls past the cap |

## What counts as an embedding cost

Two places your agent calls `/v1/embeddings` — **both billed on the key**:

1. **Ingestion (one-time / on re-index)** — one embedding per knowledge chunk. Seeding the
   Nemo docs was **99 chunks → $0.00064** on `text-embedding-005`.
2. **Every question (ongoing)** — one embedding per user query to find the relevant chunks.

Embeddings are cheap (Vertex `text-embedding-005` ≈ a few **micro-cents** per call) but they are
**real line items** that draw down the same budget as chat.

## Example 1 — see a single call's cost (header)

```bash
curl -s -D - -o /dev/null -X POST "$NEMO_BASE_URL/v1/embeddings" \
  -H "Authorization: Bearer $NEMOROUTER_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"text-embedding-005","input":["how do I set a budget?"]}' | grep x-nemo-request-cost
# x-nemo-request-cost: 4.5e-07          ← $0.00000045 for this embedding
```
The agent already forwards this through as `x-nemo-response-cost` on `/api/chat` replies.

## Example 2 — cost split by model (chat vs embeddings)

```sql
-- in the Supabase SQL editor (the project holding LiteLLM tables)
select model,
       count(*)                          as calls,
       round(sum(spend)::numeric, 6)     as usd
from "LiteLLM_SpendLogs"
where "startTime" > now() - interval '24 hours'
group by model
order by usd desc;
```
Real output for the Ask AI Guru key:
```
 vertex_ai/gemini-2.5-flash-lite | 8  | 0.001271     -- chat
 vertex_ai/text-embedding-005    | 99 | 0.000637     -- embeddings  ✅ captured
```
`call_type` distinguishes `acompletion` (chat) from `aembedding` (embeddings) if you need it.

## Example 3 — cost per agent (per key)

```sql
select key_alias,
       round(spend::numeric, 6)          as spend_usd,
       max_budget,
       budget_reset_at
from "LiteLLM_VerificationToken"
where key_alias is not null
order by spend desc;
```
`spend` is the running total across **chat + embeddings** for that agent. When it hits
`max_budget`, the gateway returns **402** until reset — your hard cap.

## Example 4 — set / check the budget (the safety net)

Create the key with a per-day budget (chat **and** embeddings count against it):
```bash
curl -X POST "$NEMO_BACKEND_URL/mgmt/key/generate" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "x-nemo-internal: true" -H "x-nemo-internal-secret: $NEMO_INTERNAL_AUTH_SECRET" \
  -H "x-nemo-organization-id: $ORG_ID" -H "Content-Type: application/json" \
  -d '{"key_alias":"my-agent","max_budget":10,"models":["text-embedding-005","gemini-2.5-flash-lite"]}'
```

## Notes / gotchas

- **Async flush.** The key's aggregate `spend` updates a few seconds after a call (batched). A
  single call's cost shows instantly in the **header** and in **`LiteLLM_SpendLogs`**; the rolled-up
  `spend` catches up shortly after — that's expected, not a missed cost.
- **`model_spend` JSON** on the token may show `{}` (a per-model breakdown that isn't always
  populated). The **aggregate `spend`** is the source of truth and includes embeddings — verify with
  Example 2, not the JSON.
- **Budget covers everything.** One `max_budget` caps the whole agent (chat + embeddings + tools).
  Size it to your traffic; embeddings are tiny but a runaway re-index loop still draws on it.
- **Rule #4** still holds: LiteLLM/Nemo owns cost — read `x-*-response-cost`, never compute it yourself.

## Related
- `docs/superpowers/specs/2026-05-30-standalone-agent-marketplace-design.md` — the architecture.
- `.claude/skills/amp-billing-observability` — pricing model + ledger shape (tools, Phase 2).
- `docs.html` (served by each agent) — the customer-facing cost section.

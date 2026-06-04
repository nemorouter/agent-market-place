# Ask AI Guru — Evals & Benchmarking

A zero-dependency harness that drives **real `/api/chat` requests** (the exact path the
widget uses), parses the SSE stream, scores assertions, and benchmarks latency + cost.
Use it to gate deploys and to measure regressions in answer quality, confidence
calibration, the web-search fallback, the email allowlist, and guardrails.

## Run

```bash
# all cases against prod (default target)
npm run eval

# point at local / stage
EVAL_TARGET_URL=http://localhost:3000 npm run eval
EVAL_TARGET_URL=https://<stage-agent-url> npm run eval

# one category: kb | offtopic | email | pii | injection | websearch
node evals/run.mjs --category kb

# add LLM-as-judge quality scoring (1–5 vs each case's `ideal`); needs a key
NEMOROUTER_API_KEY=sk-nemo-… npm run eval:judge

# tune
node evals/run.mjs --concurrency 6 --json /tmp/report.json
```

Exit code is **0** when pass-rate ≥ `EVAL_MIN_PASS_RATE` (default `0.9`), else **1** —
so `npm run eval` works as a CI gate.

## What it measures

| Signal | How |
|---|---|
| **Answer correctness** | `contains` / `containsAny` / `notContains` substring assertions (+ optional LLM judge) |
| **Confidence calibration** | `confidenceIn` — KB questions should be `high`/`medium`, off-topic `low` |
| **Web-search fallback** | `webSearched` + `toolUsed: web_search` (site-scoped to `nemorouter.ai`) |
| **Email allowlist** | `support@nemorouter.ai` passes; a visitor's personal email is redacted |
| **Guardrails** | SSN / personal-email redaction; prompt-injection resistance |
| **Latency** | p50 / p95 total + time-to-first-token |
| **Cost** | total + per-query (from `x-nemo-response-cost` / cost SSE) |

## Adding cases

Edit `dataset.json`. Each case:

```jsonc
{
  "id": "kb-platform-fee",
  "category": "kb",
  "question": "How does the platform fee work?",
  "mode": "websearch",          // optional — force the web-search path
  "expect": {
    "confidenceIn": ["high", "medium"],
    "webSearched": false,
    "toolUsed": "web_search",
    "contains": ["fee"],          // all present
    "containsAny": ["fee", "%"],  // at least one
    "notContains": ["[EMAIL_REDACTED]", "internal_error"]
  },
  "ideal": "Short description used by --judge."
}
```

Reports are written to `evals/report.json` (machine-readable) for trend tracking.

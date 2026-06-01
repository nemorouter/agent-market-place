#!/usr/bin/env bash
# Stop-hook gate for the customer-service-agent.
#
# Fires when Claude finishes a turn in agent-market-place. If the customer-service-agent
# has UNCOMMITTED .ts/.tsx changes, it runs the same gate CI runs (typecheck → tests)
# and BLOCKS the stop on failure (exit 2 → stderr is fed back to Claude to fix before
# finishing). No-op when nothing relevant changed, so unrelated turns aren't slowed.
# Mirror of .github/workflows/ci.yml for fast local feedback. Disable via /hooks.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO" || exit 0

# 1) Only act when the CS-agent has staged OR unstaged changes.
if git diff --quiet -- agents/customer-service-agent && git diff --cached --quiet -- agents/customer-service-agent; then
  exit 0
fi

# 2) Only gate on code/test changes (skip pure docs/env/yaml edits).
CHANGED="$(git diff --name-only -- agents/customer-service-agent; git diff --cached --name-only -- agents/customer-service-agent)"
grep -qE '\.(ts|tsx)$' <<<"$CHANGED" || exit 0

cd "$REPO/agents/customer-service-agent" || exit 0

# 3) Typecheck, then tests. First failure blocks the stop with a trimmed report.
if ! OUT="$(npm run -s typecheck 2>&1)"; then
  { echo "❌ customer-service-agent TYPECHECK failed — fix before finishing:"; echo "$OUT" | tail -25; } >&2
  exit 2
fi
if ! OUT="$(npm test 2>&1)"; then
  { echo "❌ customer-service-agent TESTS failed — fix before finishing:"; echo "$OUT" | tail -25; } >&2
  exit 2
fi
exit 0

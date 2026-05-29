#!/usr/bin/env bash
# run-agent-local.sh
#
# Status: TODO stub. Spins up a local agent against localhost:8090 for dev.
#
# Intended usage (once implemented):
#   ./run-agent-local.sh "What's the status of order #1234?"

set -euo pipefail

NEMO_KEY="${NEMO_LOCAL_TEST_KEY:-}"
MSG="${1:-Hello — list my GitHub repos.}"

echo "[run-agent-local] TODO — implement before agent-market-place runtime ships."
echo ""
echo "Planned steps:"
echo "  1. Verify NEMO_LOCAL_TEST_KEY env is set (test virtual key for the demo org)"
echo "     (sourced via admin-keys / dot-env skills)"
echo "  2. Verify nemo-backend is running on localhost:8090 (curl /health/readiness)"
echo "  3. POST /v1/agents/sessions with agent_id='dev-test', model='claude-sonnet-4-6',"
echo "     tool_ids=['github-read','slack-send'], max_iterations=5"
echo "     Capture session_id from response"
echo "  4. POST /v1/agents/sessions/{session_id}/messages with stream=true"
echo "     Stream SSE events to stdout with friendly formatting"
echo "  5. On message_complete, print final text + total cost + iteration count"
echo ""
echo "Message would be: ${MSG}"
echo ""
echo "Currently a no-op — exits 0."

exit 0

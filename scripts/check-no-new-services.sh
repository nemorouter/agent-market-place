#!/usr/bin/env bash
# check-no-new-services.sh — sanity check for the "no new API services" constraint.
#
# Status: TODO stub. Wire up before implementation lands.
#
# What it should do once implemented:
#   1. Fail if a new FastAPI app() instance is added under agent-market-place/backend/
#   2. Fail if a new Cloud Run service appears in nemo-infra-cicd/terraform/
#      that isn't one of the four allowed names:
#        - nemo-backend
#        - nemo-frontend
#        - cloudact-super-admin
#        - (and only if Option B chosen) agent-runtime
#   3. Fail if a new hostname appears in DNS/Cloud Run mapping that isn't
#      api.nemorouter.ai / app.nemorouter.ai / <super-admin-host>
#
# Wire into pre-commit + CI once skills move from TODO to BUILD phase.

set -euo pipefail

echo "[check-no-new-services] TODO — implement before agent-market-place ships."
echo "  Spec: agent-market-place/docs/design.md §4 (no new APIs interpretation)"
echo "  Allowed services today:"
echo "    - nemo-backend         (port 8090, hosts the new /v1/agents/* + /v1/mcp/* routes)"
echo "    - nemo-frontend        (port 3001, hosts the playground UI)"
echo "    - cloudact-super-admin (separate confidential repo)"
echo ""
echo "  If a new service is proposed, update docs/design.md §4 and amp-architecture/SKILL.md first."

exit 0

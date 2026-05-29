#!/usr/bin/env bash
# validate-no-new-services.sh
#
# Status: TODO stub. Wire into CI + pre-commit before amp-* implementation lands.
#
# Enforces interpretation 4.A from amp-architecture/references/constraint-checklist.md:
# no new API services, no new hostnames, no new Cloud Run definitions outside
# the four allowed names.
#
# Allowed services (anything else fails):
#   - nemo-backend
#   - nemo-frontend
#   - cloudact-super-admin
#   - agent-runtime  ← only if Option B in amp-agent-runtime is chosen
#
# Allowed hostnames:
#   - api.nemorouter.ai
#   - app.nemorouter.ai
#   - <super-admin-host>
#   - cdn.nemorouter.ai  ← static widget bundle

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
INFRA_ROOT="${REPO_ROOT}/../nemo-infra-cicd"

echo "[validate-no-new-services] TODO — implement before BUILD phase."
echo ""
echo "Planned checks:"
echo ""
echo "  1. New FastAPI app detection (under agent-market-place/backend/):"
echo "     grep -r 'FastAPI(' \"${REPO_ROOT}/backend/\" --include='*.py' && exit 1"
echo ""
echo "  2. New Cloud Run service detection (under nemo-infra-cicd/terraform/):"
echo "     ALLOWED='nemo-backend|nemo-frontend|cloudact-super-admin|agent-runtime'"
echo "     grep -hE 'resource \"google_cloud_run_v2_service\"' \"\${INFRA_ROOT}\"/terraform/**/*.tf | \\"
echo "       grep -vE \"\${ALLOWED}\" && exit 1"
echo ""
echo "  3. New hostname detection (DNS records):"
echo "     ALLOWED_HOSTS='api|app|super-admin|cdn'"
echo "     grep -hE '\\.nemorouter\\.ai' \"\${INFRA_ROOT}\"/terraform/**/*.tf | \\"
echo "       grep -vE \"(\${ALLOWED_HOSTS})\\.nemorouter\\.ai\" && exit 1"
echo ""
echo "  4. New route discovery (any /v1/* not in the allowed list):"
echo "     ALLOWED_PREFIXES='/v1/(chat|completions|embeddings|models|agents|mcp|files|batches)'"
echo "     grep -rE '@(app|router)\\.(get|post|put|delete)' \\"
echo "       \"\${REPO_ROOT}/../nemo-router-mono-repo/03-nemo-backend/nemo_backend/\" | \\"
echo "       ... etc"
echo ""
echo "Decision authority: amp-architecture/references/constraint-checklist.md"
echo ""
echo "Currently a no-op — exits 0."

exit 0

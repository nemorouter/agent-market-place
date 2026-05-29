#!/usr/bin/env bash
# seed-tool-catalog.sh
#
# Status: TODO stub. Seeds the first 3 tools (GitHub-read, Slack-send, Exa-search)
# into super_admin.tool_accounts + super_admin.tool_pricing, then pushes the catalog
# to nemo.tool_cache via the /super-admin/tool-cache/replace endpoint.
#
# Intended usage (once implemented):
#   ./seed-tool-catalog.sh [local|stage|prod]
#
# Pre-flight:
#   1. admin-keys skill — load Supabase admin creds for the target env
#   2. dot-env skill — confirm correct env variant
#   3. Secret Manager — confirm the 3 secrets exist:
#      - tool-github-read-token
#      - tool-slack-bot-token
#      - tool-exa-api-key

set -euo pipefail

ENV="${1:-local}"

echo "[seed-tool-catalog] TODO — implement before first tool ships."
echo ""
echo "Target env: ${ENV}"
echo ""
echo "Planned steps:"
echo "  1. Verify super_admin.tool_accounts table exists (migration aXXX applied)"
echo "  2. Verify super_admin.tool_pricing table exists"
echo "  3. Verify nemo.tool_cache table exists"
echo "  4. Verify the 3 Secret Manager secrets exist:"
echo "       gcloud secrets describe tool-github-read-token --project=<gcp-project>"
echo "       gcloud secrets describe tool-slack-bot-token   --project=<gcp-project>"
echo "       gcloud secrets describe tool-exa-api-key       --project=<gcp-project>"
echo "  5. INSERT 3 rows into super_admin.tool_accounts (idempotent: ON CONFLICT (id) DO UPDATE)"
echo "  6. INSERT 3 rows into super_admin.tool_pricing"
echo "  7. POST /super-admin/tool-cache/replace to nemo-backend"
echo "  8. Verify: SELECT count(*) FROM nemo.tool_cache should be 3"
echo "  9. Verify: curl http://localhost:8090/v1/mcp/tools with a test sk-nemo-xxx returns 3 tools"
echo ""
echo "DDL + seed SQL: amp-mcp-gateway/references/tool-catalog-schema.md (last section)"
echo ""
echo "Currently a no-op — exits 0."

exit 0

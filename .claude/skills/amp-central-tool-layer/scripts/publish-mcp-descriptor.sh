#!/usr/bin/env bash
# publish-mcp-descriptor.sh
#
# Status: TODO stub. Wired up at Phase 2 (MCP-protocol native) launch.
# Publishes /.well-known/mcp-server.json so any MCP-compliant client can
# discover the Nemo Router MCP server.

set -euo pipefail

ENV="${1:-prod}"

echo "[publish-mcp-descriptor] TODO — implement at Phase 2 launch."
echo ""
echo "Target env: ${ENV}"
echo ""
echo "Planned behavior:"
echo "  1. Validate /v1/mcp/jsonrpc route is live on api.nemorouter.ai"
echo "  2. Validate mcp.nemorouter.ai DNS CNAME → api.nemorouter.ai is set"
echo "  3. Generate descriptor JSON with current protocol_version + tool_count_hint:"
echo ""
echo "     {"
echo "       \"protocol_version\": \"2024-11-05\","
echo "       \"name\": \"nemo-router\","
echo "       \"version\": \"1.0.0\","
echo "       \"description\": \"Nemo Router managed tool gateway.\","
echo "       \"endpoints\": {"
echo "         \"jsonrpc\": \"https://api.nemorouter.ai/v1/mcp/jsonrpc\""
echo "       },"
echo "       \"transports\": [\"http\"],"
echo "       \"auth\": {"
echo "         \"type\": \"bearer\","
echo "         \"header\": \"Authorization\","
echo "         \"scheme\": \"Bearer\","
echo "         \"docs_url\": \"https://nemorouter.ai/docs/get-an-api-key\""
echo "       },"
echo "       \"tool_count_hint\": <queried from /v1/mcp/tools as anonymous>,"
echo "       \"homepage\": \"https://nemorouter.ai\","
echo "       \"support\": \"support@nemorouter.ai\""
echo "     }"
echo ""
echo "  4. PUT to GCS bucket backing /.well-known/ on api.nemorouter.ai"
echo "     (existing static-asset Cloud CDN path; documented in nemo-infra-cicd)"
echo "  5. Invalidate CDN cache for /.well-known/mcp-server.json (24h TTL otherwise)"
echo "  6. Verify: curl https://api.nemorouter.ai/.well-known/mcp-server.json"
echo "  7. Verify: curl https://mcp.nemorouter.ai/.well-known/mcp-server.json"
echo "     (should return same payload via the CNAME)"
echo "  8. Submit listing to Anthropic MCP marketplace (manual; tracking issue link printed)"
echo ""
echo "Reference: amp-central-tool-layer/references/mcp-protocol-native.md (discovery section)"
echo ""
echo "Currently a no-op — exits 0."

exit 0

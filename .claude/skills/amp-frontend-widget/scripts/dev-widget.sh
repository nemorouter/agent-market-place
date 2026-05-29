#!/usr/bin/env bash
# dev-widget.sh
#
# Status: TODO stub. Will spin up the embed widget locally for dev.
#
# Intended usage (once implemented):
#   ./dev-widget.sh
#     → starts a static file server on http://localhost:5174
#     → serves frontend/dist/widget.js + iframe.html
#     → opens http://localhost:5174/test-host.html (a fake customer site)
#     → expects nemo-backend on localhost:8090

set -euo pipefail

echo "[dev-widget] TODO — implement after frontend/ has a build step."
echo ""
echo "Planned steps:"
echo "  1. cd ../../../frontend && pnpm install (when frontend/ has package.json)"
echo "  2. pnpm build:widget → emits dist/widget.js + dist/iframe.html"
echo "  3. python3 -m http.server 5174 --directory dist (or use vite preview)"
echo "  4. Open browser to http://localhost:5174/test-host.html"
echo "  5. Widget loads, iframe connects, ready to chat against http://localhost:8090"
echo ""
echo "Test host page (frontend/dev/test-host.html) should:"
echo "  - Include <script src=http://localhost:5174/widget.js"
echo "    data-nemo-key=\$NEMO_LOCAL_TEST_KEY data-agent-id=dev async></script>"
echo "  - Display some lorem ipsum so we can see iframe positioning"
echo "  - Allow editing data-theme + data-brand-color via URL hash for quick visual QA"
echo ""
echo "Currently a no-op — exits 0."

exit 0

#!/usr/bin/env bash
# ingest.sh <local|stage|prod> [base-url] — re-index docs/website into the KB.
#   local: ./scripts/ingest.sh local                  (hits http://localhost:3000)
#   cloud: ./scripts/ingest.sh prod https://acme-support-xxxx.run.app
set -euo pipefail
cd "$(dirname "$0")/.."

ENV="${1:-local}"
FILE=".env.${ENV}"
[ -f "$FILE" ] || { echo "✗ Missing $FILE"; exit 1; }
set -a; # shellcheck disable=SC1090
source "$FILE"; set +a

BASE="${2:-http://localhost:${PORT:-3000}}"
echo "▶ POST $BASE/api/ingest"
curl -fsS -X POST "$BASE/api/ingest" -H "Authorization: Bearer ${ADMIN_TOKEN}" && echo

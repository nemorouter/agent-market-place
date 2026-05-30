#!/usr/bin/env bash
# deploy.sh <local|stage|prod> — configure once via .env.<env>, deploy with one command.
#
#   local  → build + run on http://localhost:3000
#   gcp    → Google Cloud Run (today)      — set CLOUD=gcp in the env file
#   azure  → Azure Container Apps (tomorrow)
#   aws    → ECS/App Runner (later)
#
# The cloud is chosen by the CLOUD var inside .env.<env> (mirrors Nemo's active-cloud).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV="${1:-local}"
FILE=".env.${ENV}"
if [ ! -f "$FILE" ]; then
  echo "✗ Missing $FILE — copy ${FILE}.example → ${FILE} and fill it in."
  exit 1
fi

# Load the environment (these become real env vars; Next reads process.env).
set -a; # shellcheck disable=SC1090
source "$FILE"; set +a

CLOUD="${CLOUD:-local}"
echo "▶ deploy  env=$ENV  cloud=$CLOUD  agent=${AGENT_ID:-?}"

case "$CLOUD" in
  local)
    npm run build
    PORT="${PORT:-3000}" npm run start
    ;;

  gcp)
    : "${GCP_PROJECT:?set GCP_PROJECT in $FILE}"
    : "${GCP_REGION:?set GCP_REGION in $FILE}"
    : "${SERVICE_NAME:?set SERVICE_NAME in $FILE}"
    command -v gcloud >/dev/null || { echo "✗ gcloud not found"; exit 1; }
    TMP="$(mktemp).yaml"
    python3 scripts/env-to-yaml.py "$FILE" > "$TMP"
    echo "▶ gcloud run deploy $SERVICE_NAME (Cloud Run, $GCP_REGION) — builds from Dockerfile"
    gcloud run deploy "$SERVICE_NAME" \
      --source . \
      --project "$GCP_PROJECT" \
      --region "$GCP_REGION" \
      --platform managed \
      --allow-unauthenticated \
      --port 8080 \
      --env-vars-file "$TMP"
    rm -f "$TMP"
    echo "✓ deployed. Re-run knowledge ingest with: ./scripts/ingest.sh $ENV <SERVICE_URL>"
    ;;

  azure)
    echo "→ Azure Container Apps path is planned (tomorrow). The Dockerfile already"
    echo "  works on ACA; the dispatch step lands next. Use CLOUD=gcp for today."
    exit 2
    ;;

  aws)
    echo "→ AWS (ECS/App Runner) path is planned. Use CLOUD=gcp for today."
    exit 2
    ;;

  *)
    echo "✗ Unknown CLOUD='$CLOUD' (use local|gcp|azure|aws)"
    exit 2
    ;;
esac

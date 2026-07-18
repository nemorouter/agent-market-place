#!/usr/bin/env bash
# deploy.sh <local|stage|prod> — configure once via .env.<env>, deploy with one command.
#
#   local  → build + run on http://localhost:3000
#   gcp    → Google Cloud Run            (today)   — CLOUD=gcp
#   azure  → Azure Container Apps        (today)   — CLOUD=azure
#   aws    → ECS / App Runner            (planned) — CLOUD=aws
#
# The cloud is chosen by the CLOUD var inside .env.<env> (mirrors Nemo's active-cloud).
# The same Dockerfile (Next standalone, $PORT-driven) is used by every cloud.
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
    command -v docker >/dev/null || { echo "✗ docker not found"; exit 1; }
    # Build locally + push to Artifact Registry — Cloud Build is disabled in
    # nemo-prod-deploy, so `gcloud run deploy --source` cannot work there.
    REGISTRY="${GCP_REGISTRY:-${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/nemo-router}"
    TAG="main-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
    IMAGE="${REGISTRY}/${SERVICE_NAME}:${TAG}"
    TMP="$(mktemp).yaml"
    python3 scripts/env-to-yaml.py "$FILE" yaml > "$TMP"
    echo "▶ docker build $IMAGE (linux/amd64)"
    docker buildx build --platform linux/amd64 -t "$IMAGE" --push .
    echo "▶ gcloud run deploy $SERVICE_NAME (Cloud Run, $GCP_REGION) — image $TAG"
    gcloud run deploy "$SERVICE_NAME" \
      --image "$IMAGE" \
      --project "$GCP_PROJECT" \
      --region "$GCP_REGION" \
      --platform managed \
      --allow-unauthenticated \
      --port 8080 \
      --min-instances "${CS_AGENT_MIN_INSTANCES:-0}" \
      --max-instances "${CS_AGENT_MAX_INSTANCES:-2}" \
      --env-vars-file "$TMP"
    rm -f "$TMP"
    echo "✓ deployed. Index prod KB: ./scripts/ingest.sh $ENV <SERVICE_URL>"
    ;;

  azure)
    : "${AZURE_RESOURCE_GROUP:?set AZURE_RESOURCE_GROUP in $FILE}"
    : "${AZURE_LOCATION:?set AZURE_LOCATION in $FILE}"
    : "${SERVICE_NAME:?set SERVICE_NAME in $FILE}"
    command -v az >/dev/null || { echo "✗ az CLI not found"; exit 1; }
    # Build the --env-vars array (bash 3.2-safe; no mapfile for macOS).
    ENVARGS=()
    while IFS= read -r kv; do [ -n "$kv" ] && ENVARGS+=("$kv"); done \
      < <(python3 scripts/env-to-yaml.py "$FILE" kv)
    echo "▶ az containerapp up $SERVICE_NAME (Azure Container Apps, $AZURE_LOCATION)"
    az containerapp up \
      --name "$SERVICE_NAME" \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --location "$AZURE_LOCATION" \
      --registry-server nemorouter.azurecr.io \
      --source . \
      --ingress external \
      --target-port 8080 \
      --env-vars "${ENVARGS[@]}"
    # `az containerapp up` takes no scaling flags → it leaves ACA defaults (min 0 / max 10).
    # Reconcile to policy: scale-to-zero when idle (customer Ask-AI widget; cold-start on the
    # first request after idle is accepted), capped at max 2. Same overrides as the GCP branch.
    echo "▶ reconcile scaling: min=${CS_AGENT_MIN_INSTANCES:-0} max=${CS_AGENT_MAX_INSTANCES:-2}"
    az containerapp update \
      --name "$SERVICE_NAME" \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --min-replicas "${CS_AGENT_MIN_INSTANCES:-0}" \
      --max-replicas "${CS_AGENT_MAX_INSTANCES:-2}" \
      --output none
    echo "✓ deployed. Index prod KB: ./scripts/ingest.sh $ENV <SERVICE_URL>"
    ;;

  aws)
    echo "→ AWS (ECS / App Runner) path is planned. Use CLOUD=gcp or CLOUD=azure today."
    exit 2
    ;;

  *)
    echo "✗ Unknown CLOUD='$CLOUD' (use local|gcp|azure|aws)"
    exit 2
    ;;
esac

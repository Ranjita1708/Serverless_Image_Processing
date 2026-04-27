#!/usr/bin/env bash
# =============================================================================
# setup-minio-webhook.sh — Create buckets and configure MinIO → OpenFaaS webhook
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MC_ALIAS="local"

# MinIO runs inside Docker — use Docker host gateway IP so it can reach faasd
DOCKER_HOST_IP=$(docker network inspect serverless-image-processing_serverless-net \
  --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || echo "172.17.0.1")
OPENFAAS_GATEWAY="${OPENFAAS_GATEWAY:-http://${DOCKER_HOST_IP}:8080}"
info "Using OpenFaaS gateway URL (from Docker network): $OPENFAAS_GATEWAY"

# =============================================================================
# Verify mc is installed
# =============================================================================
if ! command -v mc &>/dev/null; then
    error "mc (MinIO client) not found. Run ./scripts/setup.sh first."
fi

# =============================================================================
# 1. Configure mc alias
# =============================================================================
info "Configuring mc alias '$MC_ALIAS' → $MINIO_ENDPOINT ..."
mc alias set "$MC_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4
success "mc alias set"

# =============================================================================
# 2. Create buckets
# =============================================================================
for bucket in images processed; do
    if mc ls "${MC_ALIAS}/${bucket}" &>/dev/null; then
        success "Bucket '${bucket}' already exists"
    else
        info "Creating bucket '${bucket}'..."
        mc mb "${MC_ALIAS}/${bucket}"
        success "Bucket '${bucket}' created"
    fi
done

# Set public download policy on processed bucket (optional)
mc anonymous set download "${MC_ALIAS}/processed" 2>/dev/null || true

# =============================================================================
# 3. Register MinIO webhook endpoint pointing to fn-minio-trigger
# =============================================================================
WEBHOOK_URL="${OPENFAAS_GATEWAY}/function/fn-minio-trigger"
WEBHOOK_ID="fn-minio-trigger"

info "Registering MinIO webhook: $WEBHOOK_URL ..."

mc admin config set "${MC_ALIAS}" \
    "notify_webhook:${WEBHOOK_ID}" \
    endpoint="${WEBHOOK_URL}" \
    queue_limit="0" \
    queue_dir="" \
    auth_token="" \
    client_cert="" \
    client_key=""

success "Webhook '$WEBHOOK_ID' registered"

# =============================================================================
# 4. Restart MinIO to apply config (only needed when running via mc admin)
# =============================================================================
info "Restarting MinIO service to apply configuration..."
mc admin service restart "${MC_ALIAS}" --wait 2>/dev/null || true
sleep 3

# =============================================================================
# 5. Subscribe the 'images' bucket to ObjectCreated events
# =============================================================================
info "Subscribing 'images' bucket to s3:ObjectCreated:* events..."

# Remove any existing event subscription first
mc event remove "${MC_ALIAS}/images" \
    "arn:minio:sqs::${WEBHOOK_ID}:webhook" 2>/dev/null || true

mc event add "${MC_ALIAS}/images" \
    "arn:minio:sqs::${WEBHOOK_ID}:webhook" \
    --event "s3:ObjectCreated:*"

success "Event subscription created on 'images' bucket"

# =============================================================================
# 6. Verify registration
# =============================================================================
info "Verifying webhook registration..."
echo ""
echo "  Bucket events on 'images':"
mc event list "${MC_ALIAS}/images" 2>/dev/null || warn "Could not list events — check MinIO logs"
echo ""

success "MinIO webhook setup complete!"
echo ""
echo -e "  Upload a test image to trigger the pipeline:"
echo -e "  ${YELLOW}mc cp test.jpg ${MC_ALIAS}/images/resize/test.jpg${NC}"
echo ""
echo -e "  Processed output will appear at:"
echo -e "  ${YELLOW}mc ls ${MC_ALIAS}/processed/resize/${NC}"

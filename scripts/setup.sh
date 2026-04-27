#!/usr/bin/env bash
# =============================================================================
# setup.sh — Full environment setup for Serverless Image Processing (WSL/Ubuntu 22.04)
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

# Project root (directory of this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

OPENFAAS_GATEWAY="${OPENFAAS_GATEWAY:-http://127.0.0.1:8080}"
OPENFAAS_PASSWORD="${OPENFAAS_PASSWORD:-admin}"

# =============================================================================
# 1. Install Docker Engine (if not present)
# =============================================================================
install_docker() {
    if command -v docker &>/dev/null; then
        success "Docker already installed: $(docker --version)"
        return
    fi

    info "Installing Docker Engine..."
    sudo apt-get update -qq
    sudo apt-get install -y ca-certificates curl gnupg lsb-release

    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update -qq
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    sudo usermod -aG docker "$USER"
    sudo service docker start || true
    success "Docker installed successfully"
}

# =============================================================================
# 2. Install faasd (OpenFaaS daemon — no Kubernetes, no Docker Swarm)
# =============================================================================
install_faasd() {
    if command -v faasd &>/dev/null; then
        success "faasd already installed: $(faasd version 2>/dev/null || echo 'version unknown')"
        return
    fi

    info "Installing faasd..."
    curl -sfL https://raw.githubusercontent.com/openfaas/faasd/master/hack/install.sh \
        | sudo bash -s -
    success "faasd installed"
}

# =============================================================================
# 3. Install faas-cli
# =============================================================================
install_faas_cli() {
    if command -v faas-cli &>/dev/null; then
        success "faas-cli already installed: $(faas-cli version --short 2>/dev/null || echo 'ok')"
        return
    fi

    info "Installing faas-cli..."
    curl -sL https://cli.openfaas.com | sudo sh
    success "faas-cli installed"
}

# =============================================================================
# 4. Install MinIO mc client
# =============================================================================
install_mc() {
    if command -v mc &>/dev/null; then
        success "mc (MinIO client) already installed"
        return
    fi

    info "Installing MinIO mc client..."
    curl -Lo /tmp/mc https://dl.min.io/client/mc/release/linux-amd64/mc
    chmod +x /tmp/mc
    sudo mv /tmp/mc /usr/local/bin/mc
    success "mc installed"
}

# =============================================================================
# 5. Start faasd service
# =============================================================================
start_faasd() {
    info "Starting faasd service..."
    if sudo systemctl is-active --quiet faasd 2>/dev/null; then
        success "faasd is already running"
    else
        sudo systemctl enable faasd 2>/dev/null || true
        sudo systemctl start faasd 2>/dev/null || sudo service faasd start || true
    fi

    # Wait for OpenFaaS gateway to come up
    info "Waiting for OpenFaaS gateway at $OPENFAAS_GATEWAY ..."
    for i in $(seq 1 30); do
        if curl -sf "$OPENFAAS_GATEWAY/healthz" &>/dev/null; then
            success "OpenFaaS gateway is ready"
            return
        fi
        sleep 2
    done
    warn "OpenFaaS gateway did not respond in time — continuing anyway"
}

# =============================================================================
# 6. Start Docker Compose services
# =============================================================================
start_compose() {
    info "Starting Docker Compose services (MinIO, Prometheus, Grafana, gateway)..."
    cd "$PROJECT_DIR"

    if docker compose version &>/dev/null; then
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &>/dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        error "docker compose / docker-compose not found"
    fi

    $COMPOSE_CMD up -d --build

    info "Waiting for MinIO to be healthy..."
    for i in $(seq 1 30); do
        if curl -sf http://localhost:9000/minio/health/live &>/dev/null; then
            success "MinIO is ready"
            break
        fi
        sleep 2
    done

    success "Docker Compose services started"
}

# =============================================================================
# 7. Pull OpenFaaS python3-http template
# =============================================================================
pull_template() {
    info "Pulling OpenFaaS python3-http template..."
    cd "$PROJECT_DIR"
    faas-cli template store pull python3-http 2>/dev/null || \
        faas-cli template pull https://github.com/openfaas/python-flask-template 2>/dev/null || \
        true
    success "Template pulled"
}

# =============================================================================
# 8. Login to OpenFaaS and deploy functions
# =============================================================================
deploy_functions() {
    info "Logging into OpenFaaS..."
    cd "$PROJECT_DIR"

    echo -n "$OPENFAAS_PASSWORD" | faas-cli login \
        --gateway "$OPENFAAS_GATEWAY" \
        --username admin \
        --password-stdin 2>/dev/null || \
        faas-cli login \
            --gateway "$OPENFAAS_GATEWAY" \
            --username admin \
            --password "$OPENFAAS_PASSWORD" 2>/dev/null || true

    info "Building OpenFaaS functions..."
    faas-cli build -f stack.yml

    info "Deploying OpenFaaS functions..."
    faas-cli deploy -f stack.yml --gateway "$OPENFAAS_GATEWAY"

    success "All functions deployed"
}

# =============================================================================
# 9. Run MinIO bucket + webhook setup
# =============================================================================
setup_minio() {
    info "Setting up MinIO buckets and webhook..."
    bash "$SCRIPT_DIR/setup-minio-webhook.sh"
}

# =============================================================================
# 10. Print service URLs
# =============================================================================
print_urls() {
    echo ""
    echo -e "${GREEN}============================================================${NC}"
    echo -e "${GREEN}  ✅  Serverless Image Processing — All Services Ready${NC}"
    echo -e "${GREEN}============================================================${NC}"
    echo ""
    printf "  %-25s %s\n" "OpenFaaS Gateway:"   "$OPENFAAS_GATEWAY"
    printf "  %-25s %s\n" "OpenFaaS UI:"        "$OPENFAAS_GATEWAY/ui/"
    printf "  %-25s %s\n" "MinIO Console:"      "http://localhost:9001  (user: minioadmin / pass: minioadmin)"
    printf "  %-25s %s\n" "MinIO API:"          "http://localhost:9000"
    printf "  %-25s %s\n" "FastAPI Gateway:"    "http://localhost:5000"
    printf "  %-25s %s\n" "FastAPI Docs:"       "http://localhost:5000/docs"
    printf "  %-25s %s\n" "Prometheus:"         "http://localhost:9090"
    printf "  %-25s %s\n" "Grafana:"            "http://localhost:3000  (user: admin / pass: admin)"
    echo ""
    echo -e "  Run tests: ${YELLOW}./scripts/test.sh${NC}"
    echo ""
}

# =============================================================================
# Main
# =============================================================================
main() {
    info "=== Serverless Image Processing Setup ==="
    info "Project: $PROJECT_DIR"
    echo ""

    install_docker
    install_faasd
    install_faas_cli
    install_mc
    start_faasd
    start_compose
    pull_template
    deploy_functions
    setup_minio
    print_urls
}

main "$@"

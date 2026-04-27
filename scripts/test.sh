#!/usr/bin/env bash
# =============================================================================
# test.sh — End-to-end test script for Serverless Image Processing
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[TEST]${NC}  $*"; }
pass()    { echo -e "${GREEN}[PASS]${NC}  $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail()    { echo -e "${RED}[FAIL]${NC}  $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }

PASS_COUNT=0
FAIL_COUNT=0

GATEWAY="${GATEWAY:-http://localhost:5000}"
OPENFAAS_GATEWAY="${OPENFAAS_GATEWAY:-http://127.0.0.1:8080}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
TEST_IMAGE="/tmp/serverless_test_image.jpg"

# =============================================================================
# 1. Create a test JPEG image using Python + Pillow
# =============================================================================
create_test_image() {
    info "Creating test JPEG image..."
    python3 - <<'EOF'
import sys
try:
    from PIL import Image, ImageDraw
    import os

    img = Image.new("RGB", (400, 300), color=(70, 130, 180))
    draw = ImageDraw.Draw(img)

    # Draw some shapes for visual variety
    draw.rectangle([50, 50, 200, 150], fill=(255, 165, 0), outline=(255, 255, 255), width=3)
    draw.ellipse([220, 60, 360, 200], fill=(220, 20, 60), outline=(255, 255, 255), width=3)
    draw.line([(0, 0), (400, 300)], fill=(255, 255, 0), width=4)
    draw.text((10, 270), "Serverless Image Processing Test", fill=(255, 255, 255))

    path = "/tmp/serverless_test_image.jpg"
    img.save(path, "JPEG", quality=90)
    print(f"Test image created: {path} ({os.path.getsize(path)} bytes)")
except ImportError:
    print("Pillow not installed, creating minimal JPEG via bytes...")
    # Minimal valid JPEG (1x1 white pixel)
    import base64
    minimal_jpeg = base64.b64decode(
        "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS"
        "Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ"
        "CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
        "MjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/"
        "EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAA"
        "AAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k="
    )
    with open("/tmp/serverless_test_image.jpg", "wb") as f:
        f.write(minimal_jpeg)
    print("Minimal JPEG created")
EOF
}

# =============================================================================
# Helper: encode image as base64
# =============================================================================
encode_image() {
    base64 -w 0 "$TEST_IMAGE"
}

# =============================================================================
# Helper: POST JSON to an OpenFaaS function directly
# =============================================================================
call_fn() {
    local fn_name="$1"
    local payload="$2"
    curl -sf -X POST \
        "$OPENFAAS_GATEWAY/function/$fn_name" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        --max-time 60
}

# =============================================================================
# Helper: validate response has status=ok and image_b64
# =============================================================================
validate_response() {
    local name="$1"
    local response="$2"

    if echo "$response" | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d.get('status') == 'ok', f'status={d.get(\"status\")}'
assert 'image_b64' in d, 'missing image_b64'
assert 'meta' in d, 'missing meta'
assert 'processing_time_ms' in d['meta'], 'missing processing_time_ms'
print('  status=ok, image_b64 present, meta valid')
" 2>&1; then
        pass "$name"
    else
        fail "$name"
    fi
}

# =============================================================================
# 2. Test fn-image-resize
# =============================================================================
test_resize() {
    info "Testing fn-image-resize..."
    local b64
    b64=$(encode_image)
    local payload
    payload=$(python3 -c "import json; print(json.dumps({'image_b64': '$b64', 'width': 200, 'height': 150}))")

    local response
    response=$(call_fn "fn-image-resize" "$payload") || { fail "fn-image-resize: connection failed"; return; }
    validate_response "fn-image-resize (200x150)" "$response"
}

# =============================================================================
# 3. Test fn-image-enhance
# =============================================================================
test_enhance() {
    info "Testing fn-image-enhance..."
    local b64
    b64=$(encode_image)
    local payload
    payload=$(python3 -c "import json; print(json.dumps({'image_b64': '$b64', 'brightness': 1.2, 'contrast': 1.3, 'auto_equalize': False}))")

    local response
    response=$(call_fn "fn-image-enhance" "$payload") || { fail "fn-image-enhance: connection failed"; return; }
    validate_response "fn-image-enhance (brightness+contrast)" "$response"
}

# =============================================================================
# 4. Test fn-image-filter with valid filters
# =============================================================================
test_filters() {
    info "Testing fn-image-filter with valid filters..."
    local b64
    b64=$(encode_image)

    for filter_name in grayscale blur sepia invert; do
        local payload
        payload=$(python3 -c "import json; print(json.dumps({'image_b64': '$b64', 'filter': '$filter_name'}))")
        local response
        response=$(call_fn "fn-image-filter" "$payload") || { fail "fn-image-filter ($filter_name): connection failed"; continue; }
        validate_response "fn-image-filter ($filter_name)" "$response"
    done
}

# =============================================================================
# 5. Test fn-image-filter with invalid filter → expect 400
# =============================================================================
test_invalid_filter() {
    info "Testing fn-image-filter with invalid filter (expect 400)..."
    local b64
    b64=$(encode_image)
    local payload
    payload=$(python3 -c "import json; print(json.dumps({'image_b64': '$b64', 'filter': 'invalid_filter_xyz'}))")

    local http_code
    http_code=$(curl -s -o /tmp/filter_resp.json -w "%{http_code}" \
        -X POST "$OPENFAAS_GATEWAY/function/fn-image-filter" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        --max-time 30)

    if [ "$http_code" = "400" ]; then
        # Also verify available_filters is in the response
        if python3 -c "
import json
d = json.load(open('/tmp/filter_resp.json'))
assert 'available_filters' in d, 'missing available_filters'
print('  available_filters present in 400 response')
" 2>&1; then
            pass "fn-image-filter invalid filter → 400 with available_filters"
        else
            fail "fn-image-filter invalid filter → 400 but missing available_filters"
        fi
    else
        fail "fn-image-filter invalid filter → expected 400, got $http_code"
    fi
}

# =============================================================================
# 6. Test FastAPI gateway health
# =============================================================================
test_gateway_health() {
    info "Testing FastAPI gateway /health..."
    local response
    response=$(curl -sf "$GATEWAY/health" --max-time 10) || { fail "FastAPI gateway /health: connection failed"; return; }

    if echo "$response" | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d.get('status') == 'ok', f'status={d.get(\"status\")}'
print('  Gateway is healthy')
" 2>&1; then
        pass "FastAPI gateway /health"
    else
        fail "FastAPI gateway /health: unexpected response"
    fi
}

# =============================================================================
# 7. Test FastAPI gateway /process/resize (multipart)
# =============================================================================
test_gateway_resize() {
    info "Testing FastAPI gateway POST /process/resize..."
    local response
    response=$(curl -sf -X POST "$GATEWAY/process/resize" \
        -F "file=@$TEST_IMAGE" \
        -F "width=100" \
        -F "height=100" \
        --max-time 60) || { fail "FastAPI /process/resize: connection failed"; return; }
    validate_response "FastAPI /process/resize" "$response"
}

# =============================================================================
# 8. Test MinIO trigger via file upload
# =============================================================================
test_minio_trigger() {
    info "Testing MinIO trigger via file upload to images/resize/..."
    if ! command -v mc &>/dev/null; then
        warn "mc not found — skipping MinIO trigger test"
        return
    fi

    mc cp "$TEST_IMAGE" "local/images/resize/test_trigger.jpg" 2>/dev/null || {
        warn "mc upload failed — MinIO may not be configured. Skipping trigger test."
        return
    }

    # Wait briefly for the webhook to fire
    sleep 5

    # Check if the processed file appeared
    if mc ls "local/processed/resize/test_trigger.jpg" &>/dev/null; then
        pass "MinIO trigger → processed file appeared in processed/resize/"
    else
        warn "Processed file not found — trigger may still be processing (non-fatal)"
    fi
}

# =============================================================================
# 9. Test fn-image-resize — no input → expect 400
# =============================================================================
test_no_input() {
    info "Testing fn-image-resize with no input (expect 400)..."
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "$OPENFAAS_GATEWAY/function/fn-image-resize" \
        -H "Content-Type: application/json" \
        -d '{}' \
        --max-time 30)

    if [ "$http_code" = "400" ]; then
        pass "fn-image-resize no input → 400"
    else
        fail "fn-image-resize no input → expected 400, got $http_code"
    fi
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo ""
    echo -e "${BLUE}================================================================${NC}"
    echo -e "${BLUE}  Serverless Image Processing — End-to-End Test Suite${NC}"
    echo -e "${BLUE}================================================================${NC}"
    echo ""

    create_test_image
    echo ""

    test_resize
    test_enhance
    test_filters
    test_invalid_filter
    test_no_input
    test_gateway_health
    test_gateway_resize
    test_minio_trigger

    # Summary
    echo ""
    echo -e "${BLUE}================================================================${NC}"
    TOTAL=$((PASS_COUNT + FAIL_COUNT))
    echo -e "  Results: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC} (${TOTAL} total)"
    echo -e "${BLUE}================================================================${NC}"
    echo ""

    if [ "$FAIL_COUNT" -gt 0 ]; then
        exit 1
    fi
}

main "$@"

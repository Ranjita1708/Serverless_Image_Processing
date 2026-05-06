# Serverless DevOps: Event-Driven Image Processing

A complete, production-ready serverless image processing pipeline running entirely locally on **WSL/Ubuntu 22.04** using **OpenFaaS (faasd)**, **MinIO**, **Docker**, **FastAPI**, **Prometheus**, and **Grafana**.

---

## Table of Contents

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Service URLs](#service-urls)
- [API Reference](#api-reference)
- [MinIO Event Trigger Walkthrough](#minio-event-trigger-walkthrough)
- [Grafana Auto-Provisioning](#grafana-auto-provisioning)
- [CI/CD Setup](#cicd-setup)
- [Running Tests Locally](#running-tests-locally)
- [OpenFaaS Autoscaling (Without Kubernetes)](#openfaas-autoscaling-without-kubernetes)
- [Day-to-Day Operations](#day-to-day-operations)
- [File Structure](#file-structure)

---

## Architecture

```
User Upload
    │
    ▼
MinIO (images/ bucket)
    │  S3 webhook event (ObjectCreated)
    ▼
fn-minio-trigger ─────────────────────────────────────────────
    │  routes by object_key prefix                            │
    ├── resize/*  ──► fn-image-resize  ──► processed/resize/ │
    ├── enhance/* ──► fn-image-enhance ──► processed/enhance/│
    └── filter/*  ──► fn-image-filter  ──► processed/filter/ │
                                                              │
FastAPI Gateway (:5000)                                       │
    ├── POST /process/resize                                  │
    ├── POST /process/enhance                                 │
    ├── POST /process/filter                                  │
    └── POST /process/pipeline (resize→enhance→filter)        │
                                                              │
Prometheus (:9090) ──► Grafana (:3000)                        │
    scrapes: OpenFaaS gateway (172.18.0.1:8080)               │
             MinIO metrics (:9000)                            │
             FastAPI gateway (:5000)                          │
```

### Technology Stack

| Component | Technology | Mode |
|-----------|-----------|------|
| Serverless Runtime | OpenFaaS **faasd** | Binary daemon (no K8s, no Swarm) |
| Object Storage | MinIO | Docker container |
| API Gateway | FastAPI + uvicorn | Docker container (2 workers) |
| Monitoring | Prometheus (standalone) + Grafana | Prometheus binary; Grafana in Docker |
| Functions | Python 3 (`python3-http` template) | OpenFaaS containers via containerd |
| Image Processing | Pillow | In-function |
| Storage SDK | MinIO Python SDK | In-function |
| Local Image Registry | Docker Registry v2 | Docker container on port 5001 |
| CI/CD | GitHub Actions → GHCR | Cloud (build & push only) |

---

## Quick Start

### Prerequisites

- WSL 2 with Ubuntu 22.04
- Internet access (for installation)

### One-command setup

```bash
git clone <your-repo-url> serverless-image-processing
cd serverless-image-processing
chmod +x scripts/*.sh
./scripts/setup.sh
```

This script will:
1. Install Docker Engine (if not present)
2. Install `faasd` (OpenFaaS daemon binary)
3. Install `faas-cli`
4. Install MinIO `mc` client
5. Start faasd service (via `containerd`)
6. Start a local Docker registry on port **5001**
7. Start Docker Compose (MinIO + Grafana + FastAPI gateway)
8. Start Prometheus (standalone binary or container)
9. Pull the `python3-http` OpenFaaS template
10. Build and deploy all 4 functions to the local registry
11. Configure MinIO buckets and webhooks
12. Print all service URLs

### Restarting after a reboot

A convenience script is provided to restart all daemons and containers after a WSL/system restart:

```bash
chmod +x start.sh
./start.sh
```

This will:
- Start Docker and containerd daemons
- Start `faasd-provider` and `faasd` services
- Start (or create) the local Docker registry container
- Bring up Docker Compose (MinIO, Grafana, FastAPI gateway)

---

## Service URLs

| Service | URL | Credentials |
|---------|-----|-------------|
| **OpenFaaS Gateway** | http://localhost:8080 | admin / (check `/var/lib/faasd/secrets/basic-auth-password`) |
| **OpenFaaS UI** | http://localhost:8080/ui/ | same as above |
| **MinIO API** | http://localhost:9000 | minioadmin / minioadmin |
| **MinIO Console** | http://localhost:9001 | minioadmin / minioadmin |
| **FastAPI Gateway** | http://localhost:5000 | none |
| **FastAPI Docs (Swagger)** | http://localhost:5000/docs | none |
| **FastAPI Docs (ReDoc)** | http://localhost:5000/redoc | none |
| **Prometheus** | http://localhost:9090 | none |
| **Grafana** | http://localhost:3000 | admin / admin |
| **Local Docker Registry** | http://localhost:5001 | none |

---

## API Reference

All endpoints on the **FastAPI Gateway** (`http://localhost:5000`).

---

### `GET /health`

Returns gateway status and OpenFaaS connectivity.

**Response:**
```json
{
  "status": "ok",
  "gateway": "fastapi",
  "openfaas_reachable": true,
  "openfaas_gateway": "http://localhost:8080",
  "openfaas_detail": "OK",
  "timestamp": 1714000000.0
}
```

---

### `GET /functions`

Lists all available functions and their accepted parameters.

**Response:**
```json
{
  "functions": [
    {
      "name": "fn-image-resize",
      "endpoint": "/process/resize",
      "description": "Resize image to specified dimensions.",
      "params": { "width": "...", "height": "...", ... }
    },
    ...
  ]
}
```

---

### `POST /process/resize`

Resize an uploaded image.

**Content-Type:** `multipart/form-data`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `file` | File | **required** | Image file to process |
| `width` | int | `null` | Target width in pixels |
| `height` | int | `null` | Target height in pixels |
| `maintain_aspect_ratio` | bool | `false` | If true, missing dimension is auto-computed |
| `format` | string | `JPEG` | Output format: `JPEG`, `PNG`, `WEBP` |
| `quality` | int | `85` | Output quality (1–95) |

**Example:**
```bash
curl -X POST http://localhost:5000/process/resize \
  -F "file=@photo.jpg" \
  -F "width=800" \
  -F "maintain_aspect_ratio=true"
```

**Response:**
```json
{
  "status": "ok",
  "image_b64": "<base64-encoded-image>",
  "meta": {
    "processing_time_ms": 142,
    "operation": "resize",
    "params": { "width": 800, "height": 533, "maintain_aspect_ratio": true, "format": "JPEG", "quality": 85 }
  }
}
```

---

### `POST /process/enhance`

Adjust brightness, contrast, sharpness, and color saturation.

**Content-Type:** `multipart/form-data`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `file` | File | **required** | Image file |
| `brightness` | float | `1.0` | `< 1` darker, `> 1` brighter |
| `contrast` | float | `1.0` | `< 1` less contrast, `> 1` more |
| `sharpness` | float | `1.0` | `< 1` blur, `> 1` sharpen |
| `color` | float | `1.0` | `0` = grayscale, `> 1` = saturated |
| `auto_equalize` | bool | `false` | Apply histogram equalization |

**Example:**
```bash
curl -X POST http://localhost:5000/process/enhance \
  -F "file=@photo.jpg" \
  -F "brightness=1.3" \
  -F "contrast=1.5" \
  -F "auto_equalize=true"
```

---

### `POST /process/filter`

Apply an artistic or transformative filter.

**Content-Type:** `multipart/form-data`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `file` | File | **required** | Image file |
| `filter` | string | `grayscale` | See supported filters below |

**Supported filters:**

| Filter | Description |
|--------|-------------|
| `grayscale` | Convert to black & white |
| `blur` | Soft Gaussian blur |
| `blur_heavy` | Strong Gaussian blur (radius 5) |
| `sharpen` | Sharpen edges |
| `edge` | Highlight edges on black background |
| `emboss` | 3D emboss effect |
| `smooth` | Smooth out noise |
| `detail` | Enhance fine details |
| `contour` | Outline contours |
| `sepia` | Warm vintage sepia tone |
| `invert` | Invert all colors |
| `posterize` | Reduce color depth (3 bits) |
| `solarize` | Solarization effect (threshold 128) |

**Invalid filter → 400:**
```json
{
  "status": "error",
  "message": "Unknown filter: 'rainbow'",
  "available_filters": ["grayscale", "blur", "blur_heavy", ...],
  "trace": ""
}
```

---

### `POST /process/pipeline`

Chain **resize → enhance → filter** fully in memory (nothing written to MinIO between steps).

**Content-Type:** `multipart/form-data`

Accepts all params from all three endpoints above, plus:

| Field | Type | Default | Note |
|-------|------|---------|------|
| `resize_format` | string | `JPEG` | Format used in resize step |
| `resize_quality` | int | `85` | Quality used in resize step |

**Example:**
```bash
curl -X POST http://localhost:5000/process/pipeline \
  -F "file=@photo.jpg" \
  -F "width=400" \
  -F "maintain_aspect_ratio=true" \
  -F "brightness=1.2" \
  -F "filter=sepia"
```

**Response:**
```json
{
  "status": "ok",
  "image_b64": "<base64-encoded-final-image>",
  "meta": {
    "processing_time_ms": 380,
    "operation": "pipeline",
    "steps": ["resize", "enhance", "filter"],
    "params": { "resize": {...}, "enhance": {...}, "filter": {...} }
  },
  "step_times_ms": { "resize": 120, "enhance": 95, "filter": 165 }
}
```

---

## MinIO Event Trigger Walkthrough

### How it works

1. Upload an image to the `images/` bucket with one of these prefixes:
   - `resize/` → routes to `fn-image-resize`
   - `enhance/` → routes to `fn-image-enhance`
   - `filter/` → routes to `fn-image-filter`

2. MinIO fires an S3 `ObjectCreated` webhook to `fn-minio-trigger`.

3. The trigger parses the event JSON, URL-decodes the object key, identifies the prefix, and calls the target function with `?object_key=<key>`.

4. The target function fetches the image from MinIO, processes it, saves the result to `processed/{function}/{filename}`, and returns the result.

### Example MinIO S3 Event JSON

```json
{
  "Records": [
    {
      "eventName": "s3:ObjectCreated:Put",
      "s3": {
        "bucket": {
          "name": "images"
        },
        "object": {
          "key": "resize%2Fphoto.jpg",
          "size": 204800
        }
      }
    }
  ]
}
```

The trigger URL-decodes `resize%2Fphoto.jpg` → `resize/photo.jpg`, detects the `resize` prefix, and calls `fn-image-resize?object_key=resize/photo.jpg`.

### Manual trigger test

```bash
# Upload image to trigger the pipeline
mc cp ~/photo.jpg local/images/resize/photo.jpg

# Wait ~2 seconds, then check output
mc ls local/processed/resize/
```

---

## Grafana Auto-Provisioning

Grafana is **fully auto-provisioned** on first boot — no manual steps required.

### How it works

The `docker-compose.yml` mounts three directories into the Grafana container:

```
monitoring/provisioning/datasources/datasource.yml
    → /etc/grafana/provisioning/datasources/

monitoring/provisioning/dashboards/dashboard.yml
    → /etc/grafana/provisioning/dashboards/

monitoring/provisioning/dashboards/image-processing.json
    → /var/lib/grafana/dashboards/
```

- `datasource.yml` automatically registers Prometheus as the default datasource.
- `dashboard.yml` tells Grafana to load JSON dashboards from `/var/lib/grafana/dashboards/`.
- `image-processing.json` is a complete pre-built dashboard that loads automatically.

> **Note:** Grafana uses `host.docker.internal` (mapped to `host-gateway`) to reach Prometheus and the OpenFaaS faasd gateway running on the WSL host.

### Dashboard panels

| Panel | Query |
|-------|-------|
| Requests per Function (rate/1m) | `rate(gateway_function_invocation_total[1m])` |
| p50 & p95 Latency | `histogram_quantile(0.50/0.95, rate(gateway_functions_seconds_bucket[5m]))` |
| Error Rate % | `100 * rate(...{status_code=~"5.."}[5m]) / rate(...[5m])` |
| Invocation Count (total) | `gateway_function_invocation_total` |

Visit **http://localhost:3000** (admin/admin) — the dashboard will already be loaded.

### Prometheus Scrape Targets

Prometheus is configured to scrape three targets (see `monitoring/prometheus.yml`):

| Job | Target | Metrics Path |
|-----|--------|-------------|
| `openfaas-gateway` | `172.18.0.1:8080` | `/metrics` |
| `minio` | `minio:9000` | `/minio/v2/metrics/cluster` |
| `fastapi-gateway` | `gateway:5000` | `/metrics` |

> **Note:** `172.18.0.1` is the default WSL2 bridge IP used to reach the faasd host from within Docker containers.

---

## CI/CD Setup

The GitHub Actions pipeline (`.github/workflows/openfaas-ci.yml`) has one job that triggers on pushes and pull requests to `main`:

| Job | Trigger | Steps |
|-----|---------|-------|
| `build-and-push` | Push/PR to `main` | Lowercase owner name → checkout → QEMU + Buildx setup → login to GHCR → install faas-cli → rewrite stack.yml image refs to GHCR → `faas-cli build` + `faas-cli push` |

### Registry

Images are pushed to **GitHub Container Registry (GHCR)** at:
```
ghcr.io/<your-github-username>/<function-name>:latest
```

The CI pipeline rewrites image references in `stack.yml` from the local registry (`127.0.0.1:5001/...`) to GHCR automatically.

### Required Secrets / Permissions

| Secret / Permission | Description |
|---------------------|-------------|
| `GITHUB_TOKEN` | Automatically provided — used to authenticate with GHCR |

No additional secrets are needed. GHCR authentication uses the built-in `GITHUB_TOKEN` with `packages: write` permission.

### Get your OpenFaaS password (local)

```bash
sudo cat /var/lib/faasd/secrets/basic-auth-password
```

### Deploying after a CI build

The CI pipeline builds and pushes images but **does not auto-deploy**. To deploy locally after images are pushed:

```bash
# Pull updated images from GHCR and deploy
faas-cli deploy -f stack.yml --replace=false
```

Or use the local registry flow:
```bash
faas-cli build -f stack.yml
faas-cli push -f stack.yml
faas-cli deploy -f stack.yml
```

---

## Running Tests Locally

### Unit tests (no live services needed)

```bash
pip install pytest pillow minio requests
pytest tests/ -v
```

All MinIO calls are mocked — tests run completely offline.

### End-to-end test script (requires running services)

```bash
./scripts/test.sh
```

This will:
- Generate a test JPEG using Pillow
- POST to each function directly via OpenFaaS gateway
- Test all responses for `status=ok` and valid `image_b64`
- Test invalid filter → assert HTTP 400
- Test missing image → assert HTTP 400
- Upload to MinIO and verify trigger fires
- Print pass/fail summary

---

## OpenFaaS Autoscaling (Without Kubernetes)

`faasd` is the lightweight OpenFaaS daemon that runs as a **single binary** on Linux. It uses `containerd` (not Docker) to run function containers.

### How autoscaling works in faasd

1. **Prometheus** scrapes the OpenFaaS gateway at `/metrics`, collecting per-function request rate and latency.

2. **faasd's built-in autoscaler** (`faas-idler`) monitors these metrics.

3. When request rate exceeds thresholds, it scales **up** by launching more container replicas (up to `com.openfaas.scale.max`).

4. When idle, it scales **down** to `com.openfaas.scale.min` (default 1 — never to zero in faasd mode unless configured).

### Scale labels in stack.yml

All four functions are configured with the same autoscaling parameters:

```yaml
labels:
  com.openfaas.scale.min: 3     # Always keep at least 3 replicas warm
  com.openfaas.scale.max: 10    # Maximum replicas under load
  com.openfaas.scale.factor: 20 # Scale up by 20% of max per step
```

### Key difference from Kubernetes

- No pods, no deployments, no cluster nodes
- Functions run as **containerd tasks** directly on the host
- Autoscaler is a simple process (`faas-idler`) watching Prometheus metrics
- Cold start is fast (~100ms) because images are already pulled
- Ideal for single-node local development and edge deployments

---

## Day-to-Day Operations

### Start everything after a reboot

```bash
./start.sh
```

### Check all services are healthy

```bash
# OpenFaaS
curl http://localhost:8080/healthz

# FastAPI gateway
curl http://localhost:5000/health

# MinIO
curl http://localhost:9000/minio/health/live
```

### Deploy/redeploy functions

```bash
# Build against local registry
faas-cli build -f stack.yml

# Push to local registry (127.0.0.1:5001)
faas-cli push -f stack.yml

# Deploy/redeploy
faas-cli deploy -f stack.yml
```

### View function logs

```bash
faas-cli logs fn-image-resize
faas-cli logs fn-image-enhance
faas-cli logs fn-image-filter
faas-cli logs fn-minio-trigger
```

### Set up MinIO webhook (after fresh MinIO start)

```bash
./scripts/setup-minio-webhook.sh
```

---

## File Structure

```
serverless-image-processing/
├── stack.yml                           # OpenFaaS function definitions (local registry: 127.0.0.1:5001)
├── docker-compose.yml                  # MinIO, Grafana, FastAPI gateway
├── start.sh                            # Restart all services after reboot
│
├── fn-image-resize/
│   ├── handler.py                      # Resize logic + MinIO I/O
│   └── requirements.txt               # Pillow, minio
│
├── fn-image-enhance/
│   ├── handler.py                      # Enhance logic (brightness/contrast/sharpness/color)
│   └── requirements.txt               # Pillow, minio
│
├── fn-image-filter/
│   ├── handler.py                      # 13 named filters via Pillow
│   └── requirements.txt               # Pillow, minio
│
├── fn-minio-trigger/
│   ├── handler.py                      # S3 event parser + function router
│   └── requirements.txt               # requests
│
├── gateway/
│   ├── app.py                          # FastAPI app (6 endpoints, CORS enabled)
│   ├── requirements.txt               # fastapi, uvicorn, pillow, minio, requests
│   └── Dockerfile                      # python:3.11-slim, 2 uvicorn workers
│
├── monitoring/
│   ├── prometheus.yml                  # Scrape: OpenFaaS (172.18.0.1:8080), MinIO, FastAPI
│   └── provisioning/
│       ├── datasources/
│       │   └── datasource.yml          # Auto-configure Prometheus datasource in Grafana
│       └── dashboards/
│           ├── dashboard.yml           # Dashboard provider config
│           └── image-processing.json   # Pre-built Grafana dashboard
│
├── scripts/
│   ├── setup.sh                        # One-command environment setup
│   ├── setup-minio-webhook.sh          # Bucket + webhook configuration
│   └── test.sh                         # End-to-end test suite
│
├── tests/
│   └── test_functions.py               # pytest unit tests (mocked MinIO)
│
├── .github/
│   └── workflows/
│       └── openfaas-ci.yml             # CI: build + push to GHCR on push/PR to main
│
└── README.md
```

---

## Function Contract Reference

Every function accepts input in one of two ways:

1. **JSON body** with `image_b64` (base64-encoded image bytes)
2. **Query param** `object_key` (fetches image from MinIO `images/` bucket)

If both are provided, `object_key` takes priority.

Every function returns the same JSON structure:

```json
{
  "status": "ok",
  "image_b64": "<base64>",
  "meta": {
    "processing_time_ms": 142,
    "operation": "resize",
    "params": { ... }
  }
}
```

Error responses:

```json
{ "status": "error", "message": "...", "trace": "<traceback or empty>" }
```

HTTP status codes: `200` success, `400` bad input, `500` processing error.

---

## License

MIT

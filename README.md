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
    scrapes: OpenFaaS gateway + MinIO metrics                 │
```

### Technology Stack

| Component | Technology | Mode |
|-----------|-----------|------|
| Serverless Runtime | OpenFaaS **faasd** | Binary daemon (no K8s, no Swarm) |
| Object Storage | MinIO | Docker container |
| API Gateway | FastAPI + uvicorn | Docker container |
| Monitoring | Prometheus + Grafana | Docker Compose |
| Functions | Python 3 (`python3-http` template) | OpenFaaS containers |
| Image Processing | Pillow | In-function |
| Storage SDK | MinIO Python SDK | In-function |
| CI/CD | GitHub Actions | Cloud |

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
5. Start faasd service
6. Start Docker Compose (MinIO + Prometheus + Grafana + FastAPI gateway)
7. Pull the `python3-http` OpenFaaS template
8. Build and deploy all 4 functions
9. Configure MinIO buckets and webhooks
10. Print all service URLs

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
| **Prometheus** | http://localhost:9090 | none |
| **Grafana** | http://localhost:3000 | admin / admin |

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

### Dashboard panels

| Panel | Query |
|-------|-------|
| Requests per Function (rate/1m) | `rate(gateway_function_invocation_total[1m])` |
| p50 & p95 Latency | `histogram_quantile(0.50/0.95, rate(gateway_functions_seconds_bucket[5m]))` |
| Error Rate % | `100 * rate(...{status_code=~"5.."}[5m]) / rate(...[5m])` |
| Invocation Count (total) | `gateway_function_invocation_total` |

Visit **http://localhost:3000** (admin/admin) — the dashboard will already be loaded.

---

## CI/CD Setup

The GitHub Actions pipeline (`.github/workflows/deploy.yml`) has three jobs:

| Job | Trigger | Steps |
|-----|---------|-------|
| `test` | Every push/PR | `pytest tests/` with mocked MinIO |
| `build-and-push` | Push to `main` only | Build + push Docker images to DockerHub |
| `deploy` | After build succeeds | `faas-cli build` + `faas-cli push` + `faas-cli deploy` |

### Required Secrets

Add these in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | Your DockerHub username |
| `DOCKERHUB_TOKEN` | DockerHub access token (not password) |
| `OPENFAAS_GATEWAY` | Full URL of your OpenFaaS gateway e.g. `http://1.2.3.4:8080` |
| `OPENFAAS_PASSWORD` | OpenFaaS admin password |

### Get your OpenFaaS password (local)

```bash
sudo cat /var/lib/faasd/secrets/basic-auth-password
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

```yaml
labels:
  com.openfaas.scale.min: 1    # Always keep at least 1 replica warm
  com.openfaas.scale.max: 5    # Maximum replicas under load
  com.openfaas.scale.factor: 20 # Scale up by 20% of max per step
```

### Key difference from Kubernetes

- No pods, no deployments, no cluster nodes
- Functions run as **containerd tasks** directly on the host
- Autoscaler is a simple process (`faas-idler`) watching Prometheus metrics
- Cold start is fast (~100ms) because images are already pulled
- Ideal for single-node local development and edge deployments

---

## File Structure

```
serverless-image-processing/
├── stack.yml                           # OpenFaaS function definitions
├── docker-compose.yml                  # MinIO, Prometheus, Grafana, gateway
│
├── fn-image-resize/
│   ├── handler.py                      # Resize logic + MinIO I/O
│   └── requirements.txt
│
├── fn-image-enhance/
│   ├── handler.py                      # Enhance logic (brightness/contrast/etc)
│   └── requirements.txt
│
├── fn-image-filter/
│   ├── handler.py                      # 13 named filters
│   └── requirements.txt
│
├── fn-minio-trigger/
│   ├── handler.py                      # S3 event parser + router
│   └── requirements.txt
│
├── gateway/
│   ├── app.py                          # FastAPI app (6 endpoints)
│   ├── requirements.txt
│   └── Dockerfile
│
├── monitoring/
│   ├── prometheus.yml                  # Scrape config
│   └── provisioning/
│       ├── datasources/
│       │   └── datasource.yml          # Auto-configure Prometheus datasource
│       └── dashboards/
│           ├── dashboard.yml           # Dashboard provider config
│           └── image-processing.json   # Pre-built dashboard
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
│       └── deploy.yml                  # CI/CD: test → build → push → deploy
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

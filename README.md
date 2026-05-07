# Serverless Image Processing Architecture

An enterprise-grade, event-driven image processing ecosystem engineered for low-latency, scalable execution. This project leverages **OpenFaaS** for serverless compute, **MinIO** for high-performance object storage, and a **FastAPI** orchestration gateway.

---

## 🏗️ System Architecture

This platform provides an end-to-end serverless workflow for sophisticated image manipulation. It decouples the heavy lifting of image processing from the main application flow.

### Component Overview

| Component | Technology | Role |
|-----------|-----------|------|
| **Control Plane** | FastAPI | Request routing, UI health checks, and orchestration. Exposes `/process/*` and `/image/*` endpoints. |
| **Compute Engine** | OpenFaaS (`faasd`) | Resource-efficient serverless function execution. Scales from zero. |
| **Serverless Functions** | Python (Pillow) | 4 Microservices: `fn-image-resize`, `fn-image-enhance`, `fn-image-filter`, and `fn-minio-trigger`. |
| **Object Storage** | MinIO (S3 Compatible)| Stores raw images in the `images` bucket and finished artifacts in the `processed` bucket. |
| **User Interface** | React (Vite) | Real-time dashboard to test functions, build pipelines, and view MinIO files. |
| **Monitoring** | Grafana / Prometheus | Dimensional telemetry tracking OpenFaaS invocations and latency. |

### The Data Flow

```text
User ──► Frontend UI ──► FastAPI Gateway ──► OpenFaaS (fn-image-*)
                               │                      │
                               ▼                      ▼
                           MinIO S3 ◄───────── "processed" bucket
```

**Background Async Processing (Webhook):**
If you drop an image directly into the MinIO `images` bucket, MinIO fires an event to `fn-minio-trigger`, which automatically processes the image in the background without tying up the Gateway!

---

## 🚀 Getting Started

### Prerequisites
*   Windows Subsystem for Linux (WSL 2) running Ubuntu
*   Docker Engine & Node.js 18+
*   OpenFaaS `faas-cli` installed

### 1. Start the Backend Infrastructure
We have bundled the startup of MinIO, Grafana, the local Docker registry, and the FastAPI Gateway into a single script. Run this in WSL:

```bash
chmod +x start.sh
./start.sh
```
*(Note: This script may ask for your sudo password to ensure Docker daemons are running).*

### 2. Deploy Serverless Functions
Build and deploy the 4 OpenFaaS functions to your local OpenFaaS environment:

```bash
faas-cli up -f stack.yml
```

### 3. Start the Frontend Dashboard
The React UI was recently moved to the `frontend` directory. Run it locally:

```bash
cd frontend
npm install
npm run dev
```

---

## 📡 Operational Endpoints

| Service | Local Access URL |
|---------|------------|
| **Interactive Dashboard** | http://localhost:5173 (or 5174) |
| **FastAPI Gateway** | http://localhost:5000/docs |
| **OpenFaaS Console** | http://localhost:8080/ui/ |
| **MinIO Storage Console** | http://localhost:9001 |
| **Grafana Metrics** | http://localhost:3000 |

*(Default credentials for MinIO and Grafana are `minioadmin`:`minioadmin` and `admin`:`admin` respectively).*

---

## 🤖 CI/CD Automation

This repository utilizes **GitHub Actions** for continuous integration and delivery.

1. **Static Analysis (`static-analysis.yml`)**: Runs on every push/PR. It uses `flake8` for PEP8 syntax linting and `bandit` for security vulnerability scanning.
2. **Docker Build & Push (`openfaas-ci.yml`)**: Builds the OpenFaaS functions and publishes them to the GitHub Container Registry (`ghcr.io`) for remote deployment.

---

## 📜 License
This project is licensed under the MIT License.

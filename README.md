# Advanced Serverless Image Processing Architecture

An enterprise-grade, event-driven image processing ecosystem engineered for low-latency, scalable execution. This project leverages **OpenFaaS (faasd)** for serverless compute, **MinIO** for high-performance object storage, and a **FastAPI** orchestration gateway.

---

## Technical Overview

This platform provides an end-to-end serverless workflow for sophisticated image manipulation, featuring:
*   **Orchestrated Pipeline Execution**: Sequential multi-stage processing with atomic state management.
*   **Automated Persistence Layer**: Unique filename generation and collision avoidance utilizing SHA-256 derived hashes and temporal entropy.
*   **Event-Driven Triggering**: Native S3 notification integration for background task automation.
*   **Real-Time Observability**: Comprehensive telemetry via Prometheus and Grafana, monitoring function lifecycle and system throughput.

---

## System Architecture

### Orchestration Workflow
The architecture follows a modular gateway pattern where the FastAPI instance acts as the central controller, delegating intensive compute tasks to the OpenFaaS function provider.

```
Request Source ──► FastAPI Gateway (Orchestrator) ──► OpenFaaS Provider (Compute)
                         │                                    │
                         │ (State Persistence)                │ (Atomic Processing)
                         ▼                                    ▼
High-Performance Storage (MinIO) ◄────────────────────────────┘
```

### Component Specification

| Component | Technology | Role |
|-----------|-----------|------|
| **Control Plane** | FastAPI / Uvicorn | Request routing, security, and orchestration |
| **Compute Engine** | OpenFaaS (faasd) | Resource-efficient serverless function execution |
| **Object Storage** | MinIO (S3 Compatible) | High-availability persistence and event emission |
| **User Interface** | React 18 | Real-time administrative dashboard (Pastel Design System) |
| **Monitoring** | Grafana / Prometheus | Dimensional telemetry and performance analysis |

---

## Deployment & Configuration

### Environment Requirements
*   **OS**: Windows Subsystem for Linux (WSL 2) - Ubuntu 22.04 LTS
*   **Runtime**: Docker Engine 24.0+ & Node.js 18+
*   **Provider**: OpenFaaS `faasd` binary deployment

### Initialization Sequence

1. **Infrastructure Provisioning**:
   ```bash
   wsl docker-compose up -d
   ```

2. **Compute Provider Startup**:
   ```bash
   cd ~/faasd && sudo ./faasd up
   ```

3. **Dashboard Interface**:
   ```bash
   cd dashboard-ui && npm install && npm run dev
   ```

---

## API Specification

### Persistent Image Transformation
`POST /image/{function_id}`
Executes a single processing function (Resize, Enhance, or Filter). The gateway ensures the resulting artifact is uniquely persisted to the `processed/` bucket before returning the response.

### Sequential Processing Pipeline
`POST /image/pipeline`
Orchestrates a complex multi-function sequence. The gateway manages the data flow between functions, ensuring memory efficiency and final state persistence.

---

## Operational Endpoints

| Service | Access URL |
|---------|------------|
| **Administrative UI** | http://localhost:5173 |
| **API Gateway** | http://localhost:5000 |
| **OpenFaaS Console** | http://localhost:8080/ui/ |
| **Storage Management** | http://localhost:9001 |
| **Monitoring Suite** | http://localhost:3000 |

---

## License
This project is licensed under the MIT License - see the LICENSE file for details.

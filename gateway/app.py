"""
FastAPI Gateway for Serverless Image Processing Pipeline
=========================================================
Endpoints:
  GET  /health              — gateway + OpenFaaS connectivity
  GET  /functions           — list all available functions & params
  POST /process/resize      — multipart upload → fn-image-resize
  POST /process/enhance     — multipart upload → fn-image-enhance
  POST /process/filter      — multipart upload → fn-image-filter
  POST /process/pipeline    — chain: resize → enhance → filter (in-memory base64)
"""

import base64
import json
import os
import time
from typing import Optional

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
OPENFAAS_GATEWAY = os.environ.get("OPENFAAS_GATEWAY", "http://localhost:8080")
FN_TIMEOUT = 60  # seconds per function call

app = FastAPI(
    title="Serverless Image Processing Gateway",
    description="API gateway for event-driven image processing via OpenFaaS functions.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fn_url(name: str) -> str:
    return f"{OPENFAAS_GATEWAY}/function/{name}"


def _call_fn(fn_name: str, payload: dict) -> dict:
    """POST JSON payload to an OpenFaaS function, return parsed JSON body."""
    try:
        resp = requests.post(
            _fn_url(fn_name),
            json=payload,
            timeout=FN_TIMEOUT,
        )
    except requests.Timeout:
        raise HTTPException(status_code=504, detail=f"{fn_name} timed out after {FN_TIMEOUT}s")
    except requests.ConnectionError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach {fn_name}: {exc}")

    try:
        body = resp.json()
    except Exception:
        body = {"raw": resp.text}

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=body)

    return body


def _file_to_b64(upload: UploadFile) -> str:
    data = upload.file.read()
    return base64.b64encode(data).decode()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health", summary="Health check")
def health():
    """Returns gateway status and OpenFaaS connectivity."""
    openfaas_ok = False
    openfaas_detail = ""
    try:
        r = requests.get(f"{OPENFAAS_GATEWAY}/healthz", timeout=5)
        openfaas_ok = r.status_code == 200
        openfaas_detail = r.text[:200]
    except Exception as exc:
        openfaas_detail = str(exc)

    return {
        "status": "ok",
        "gateway": "fastapi",
        "openfaas_reachable": openfaas_ok,
        "openfaas_gateway": OPENFAAS_GATEWAY,
        "openfaas_detail": openfaas_detail,
        "timestamp": time.time(),
    }


@app.get("/functions", summary="List available functions and their parameters")
def list_functions():
    return {
        "functions": [
            {
                "name": "fn-image-resize",
                "endpoint": "/process/resize",
                "description": "Resize image to specified dimensions.",
                "params": {
                    "width": "int (optional) — target width in pixels",
                    "height": "int (optional) — target height in pixels",
                    "maintain_aspect_ratio": "bool (default: false) — compute missing dimension automatically",
                    "format": "str (default: JPEG) — output format: JPEG, PNG, WEBP",
                    "quality": "int (default: 85) — output quality 1–95",
                },
            },
            {
                "name": "fn-image-enhance",
                "endpoint": "/process/enhance",
                "description": "Enhance image brightness, contrast, sharpness, and color saturation.",
                "params": {
                    "brightness": "float (default: 1.0) — multiplier; >1 brighter",
                    "contrast":   "float (default: 1.0) — multiplier; >1 more contrast",
                    "sharpness":  "float (default: 1.0) — multiplier; >1 sharper",
                    "color":      "float (default: 1.0) — saturation multiplier; 0=grayscale",
                    "auto_equalize": "bool (default: false) — apply histogram equalization",
                },
            },
            {
                "name": "fn-image-filter",
                "endpoint": "/process/filter",
                "description": "Apply a named artistic or transformative filter.",
                "params": {
                    "filter": (
                        "str (default: grayscale) — one of: grayscale, blur, blur_heavy, "
                        "sharpen, edge, emboss, smooth, detail, contour, sepia, invert, "
                        "posterize, solarize"
                    ),
                },
            },
            {
                "name": "fn-minio-trigger",
                "endpoint": "MinIO S3 webhook (internal)",
                "description": "Receives MinIO S3 events and routes to the correct function.",
                "params": {
                    "Records": "MinIO S3 event JSON array",
                },
            },
        ]
    }


@app.post("/process/resize", summary="Resize an uploaded image")
async def process_resize(
    file: UploadFile = File(...),
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
    maintain_aspect_ratio: bool = Form(False),
    format: str = Form("JPEG"),
    quality: int = Form(85),
):
    payload = {
        "image_b64": _file_to_b64(file),
        "width": width,
        "height": height,
        "maintain_aspect_ratio": maintain_aspect_ratio,
        "format": format,
        "quality": quality,
    }
    return JSONResponse(_call_fn("fn-image-resize", payload))


@app.post("/process/enhance", summary="Enhance an uploaded image")
async def process_enhance(
    file: UploadFile = File(...),
    brightness: float = Form(1.0),
    contrast: float = Form(1.0),
    sharpness: float = Form(1.0),
    color: float = Form(1.0),
    auto_equalize: bool = Form(False),
):
    payload = {
        "image_b64": _file_to_b64(file),
        "brightness": brightness,
        "contrast": contrast,
        "sharpness": sharpness,
        "color": color,
        "auto_equalize": auto_equalize,
    }
    return JSONResponse(_call_fn("fn-image-enhance", payload))


@app.post("/process/filter", summary="Apply a filter to an uploaded image")
async def process_filter(
    file: UploadFile = File(...),
    filter: str = Form("grayscale"),
):
    payload = {
        "image_b64": _file_to_b64(file),
        "filter": filter,
    }
    return JSONResponse(_call_fn("fn-image-filter", payload))


@app.post("/process/pipeline", summary="Chain resize → enhance → filter (fully in-memory)")
async def process_pipeline(
    file: UploadFile = File(...),
    # Resize params
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
    maintain_aspect_ratio: bool = Form(False),
    resize_format: str = Form("JPEG"),
    resize_quality: int = Form(85),
    # Enhance params
    brightness: float = Form(1.0),
    contrast: float = Form(1.0),
    sharpness: float = Form(1.0),
    color: float = Form(1.0),
    auto_equalize: bool = Form(False),
    # Filter params
    filter: str = Form("grayscale"),
):
    t_start = time.time()

    # Step 1: resize
    resize_result = _call_fn("fn-image-resize", {
        "image_b64": _file_to_b64(file),
        "width": width,
        "height": height,
        "maintain_aspect_ratio": maintain_aspect_ratio,
        "format": resize_format,
        "quality": resize_quality,
    })
    b64_after_resize = resize_result["image_b64"]

    # Step 2: enhance (pass previous b64)
    enhance_result = _call_fn("fn-image-enhance", {
        "image_b64": b64_after_resize,
        "brightness": brightness,
        "contrast": contrast,
        "sharpness": sharpness,
        "color": color,
        "auto_equalize": auto_equalize,
    })
    b64_after_enhance = enhance_result["image_b64"]

    # Step 3: filter (pass previous b64)
    filter_result = _call_fn("fn-image-filter", {
        "image_b64": b64_after_enhance,
        "filter": filter,
    })

    elapsed_ms = int((time.time() - t_start) * 1000)

    return JSONResponse({
        "status": "ok",
        "image_b64": filter_result["image_b64"],
        "meta": {
            "processing_time_ms": elapsed_ms,
            "operation": "pipeline",
            "steps": ["resize", "enhance", "filter"],
            "params": {
                "resize":  resize_result.get("meta", {}).get("params", {}),
                "enhance": enhance_result.get("meta", {}).get("params", {}),
                "filter":  filter_result.get("meta", {}).get("params", {}),
            },
        },
        "step_times_ms": {
            "resize":  resize_result.get("meta", {}).get("processing_time_ms"),
            "enhance": enhance_result.get("meta", {}).get("processing_time_ms"),
            "filter":  filter_result.get("meta", {}).get("processing_time_ms"),
        },
    })


# ---------------------------------------------------------------------------
# Entry point (for local dev)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=5000, reload=True)

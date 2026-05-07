"""
FastAPI Gateway for Serverless Image Processing Pipeline
=========================================================
Endpoints:
  GET  /health              — gateway + OpenFaaS connectivity
  GET  /functions           — list all available functions & params
  POST /process/resize      — multipart upload → fn-image-resize       (JSON)
  POST /process/enhance     — multipart upload → fn-image-enhance      (JSON)
  POST /process/filter      — multipart upload → fn-image-filter       (JSON)
  POST /process/pipeline    — chain: resize → enhance → filter         (JSON)
  POST /image/resize        — same as /process/resize  but returns raw image file
  POST /image/enhance       — same as /process/enhance but returns raw image file
  POST /image/filter        — same as /process/filter  but returns raw image file
  POST /image/pipeline      — same as /process/pipeline but returns raw image file
"""

import base64
import json
import os
import time
import uuid
from typing import Optional

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import io
from minio import Minio

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
OPENFAAS_GATEWAY = os.environ.get("OPENFAAS_GATEWAY", "http://localhost:8080")
FN_TIMEOUT = 60  # seconds per function call

MINIO_ENDPOINT   = os.environ.get("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
MINIO_SECURE     = os.environ.get("MINIO_SECURE", "false").lower() == "true"

def _get_minio_client() -> Minio:
    return Minio(
        MINIO_ENDPOINT, 
        access_key=MINIO_ACCESS_KEY, 
        secret_key=MINIO_SECRET_KEY, 
        secure=MINIO_SECURE
    )

app = FastAPI(
    title="Serverless Image Processing Gateway",
    description=(
        "API gateway for event-driven image processing via OpenFaaS functions.\n\n"
        "**Tip:** Use the `/image/*` endpoints to get the processed image directly "
        "(viewable in browser / downloadable). Use `/process/*` endpoints for JSON responses."
    ),
    version="1.1.0",
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


def _unique_filename(original_name: str) -> str:
    """Generate a unique filename: <timestamp>_<uuid8>_<original>."""
    ts = int(time.time())
    uid = uuid.uuid4().hex[:8]
    safe_name = original_name.replace(" ", "_") if original_name else "upload.jpg"
    return f"{ts}_{uid}_{safe_name}"


def _save_bytes_to_minio(bucket_name: str, object_name: str, data: bytes, content_type: str = "image/jpeg"):
    """Internal helper to save raw bytes to a specific MinIO bucket/key."""
    try:
        client = _get_minio_client()
        if not client.bucket_exists(bucket_name):
            client.make_bucket(bucket_name)
        
        import io
        client.put_object(
            bucket_name,
            object_name,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
        print(f"MinIO Save Success: {bucket_name}/{object_name}")
    except Exception as e:
        print(f"MinIO Save Error: {e}")

def _b64_to_image_response(b64_str: str, fmt: str = "JPEG", minio_path: str = "") -> Response:
    """Decode a base64 image string and return it as a raw HTTP image response."""
    image_bytes = base64.b64decode(b64_str)
    fmt_upper = fmt.upper()
    media_type_map = {
        "JPEG": "image/jpeg",
        "JPG":  "image/jpeg",
        "PNG":  "image/png",
        "WEBP": "image/webp",
        "GIF":  "image/gif",
    }
    media_type = media_type_map.get(fmt_upper, "image/jpeg")
    ext_map = {"JPEG": "jpg", "JPG": "jpg", "PNG": "png", "WEBP": "webp", "GIF": "gif"}
    ext = ext_map.get(fmt_upper, "jpg")
    headers = {"Content-Disposition": f'inline; filename="processed.{ext}"'}
    if minio_path:
        headers["X-MinIO-Path"] = minio_path
        bucket_name = minio_path.split("/")[0]
        object_name = "/".join(minio_path.split("/")[1:])
        _save_bytes_to_minio(bucket_name, object_name, image_bytes, media_type)

    return Response(content=image_bytes, media_type=media_type, headers=headers)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/ping", summary="Instant liveness check")
def ping():
    """Ultra-fast liveness probe — always responds immediately."""
    return {"status": "ok", "gateway": "fastapi", "timestamp": time.time()}


@app.get("/health", summary="Health check")
def health():
    """Returns gateway status and downstream service connectivity."""
    openfaas_ok = False
    openfaas_detail = ""
    minio_ok = False
    minio_detail = ""

    # Non-blocking probes with short timeouts so the gateway always responds fast
    try:
        r = requests.get(f"{OPENFAAS_GATEWAY}/healthz", timeout=1)
        openfaas_ok = r.status_code == 200
        openfaas_detail = r.text[:200]
    except Exception as exc:
        openfaas_detail = str(exc)[:120]

    try:
        client = _get_minio_client()
        client.list_buckets()
        minio_ok = True
        minio_detail = "reachable"
    except Exception as exc:
        minio_detail = str(exc)[:120]

    return {
        "status": "ok",
        "gateway": "fastapi",
        "openfaas_reachable": openfaas_ok,
        "openfaas_gateway": OPENFAAS_GATEWAY,
        "openfaas_detail": openfaas_detail,
        "minio_ok": minio_ok,
        "minio_detail": minio_detail,
        "timestamp": time.time(),
    }

@app.get("/openfaas/status", summary="Get real-time function replicas and invocation counts")
def get_openfaas_status():
    try:
        r = requests.get(f"{OPENFAAS_GATEWAY}/system/functions", auth=("admin", "admin"), timeout=5)
        if r.status_code == 200:
            return {"status": "ok", "functions": r.json()}
        return {"status": "error", "detail": r.text}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}

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
# /image/* endpoints — return raw image bytes AND save to MinIO processed/
# ---------------------------------------------------------------------------

@app.post("/image/resize", summary="Resize image — returns raw image file + saves to MinIO", response_class=Response)
async def image_resize(
    file: UploadFile = File(...),
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
    maintain_aspect_ratio: bool = Form(False),
    format: str = Form("JPEG"),
    quality: int = Form(85),
):
    fname = _unique_filename(file.filename or "upload.jpg")
    source_bytes = file.file.read()
    file.file.seek(0) # reset for next reads
    _save_bytes_to_minio("images", fname, source_bytes, file.content_type or "image/jpeg")

    payload = {
        "image_b64": base64.b64encode(source_bytes).decode(),
        "filename": fname,
        "width": width,
        "height": height,
        "maintain_aspect_ratio": maintain_aspect_ratio,
        "format": format,
        "quality": quality,
    }
    result = _call_fn("fn-image-resize", payload)
    minio_path = f"processed/resize/{fname}"
    return _b64_to_image_response(result["image_b64"], format, minio_path)


@app.post("/image/enhance", summary="Enhance image — returns raw image file + saves to MinIO", response_class=Response)
async def image_enhance(
    file: UploadFile = File(...),
    brightness: float = Form(1.0),
    contrast: float = Form(1.0),
    sharpness: float = Form(1.0),
    color: float = Form(1.0),
    auto_equalize: bool = Form(False),
    format: str = Form("JPEG"),
):
    fname = _unique_filename(file.filename or "upload.jpg")
    source_bytes = file.file.read()
    file.file.seek(0)
    _save_bytes_to_minio("images", fname, source_bytes, file.content_type or "image/jpeg")

    payload = {
        "image_b64": base64.b64encode(source_bytes).decode(),
        "filename": fname,
        "brightness": brightness,
        "contrast": contrast,
        "sharpness": sharpness,
        "color": color,
        "auto_equalize": auto_equalize,
    }
    result = _call_fn("fn-image-enhance", payload)
    minio_path = f"processed/enhance/{fname}"
    return _b64_to_image_response(result["image_b64"], format, minio_path)


@app.post("/image/filter", summary="Filter image — returns raw image file + saves to MinIO", response_class=Response)
async def image_filter(
    file: UploadFile = File(...),
    filter: str = Form("grayscale"),
    format: str = Form("JPEG"),
):
    fname = _unique_filename(file.filename or "upload.jpg")
    source_bytes = file.file.read()
    file.file.seek(0)
    _save_bytes_to_minio("images", fname, source_bytes, file.content_type or "image/jpeg")

    payload = {
        "image_b64": base64.b64encode(source_bytes).decode(),
        "filename": fname,
        "filter": filter,
    }
    result = _call_fn("fn-image-filter", payload)
    minio_path = f"processed/filter/{fname}"
    return _b64_to_image_response(result["image_b64"], format, minio_path)


@app.post("/image/pipeline", summary="Full pipeline (resize→enhance→filter) — returns raw image + saves to MinIO", response_class=Response)
async def image_pipeline(
    file: UploadFile = File(...),
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
    maintain_aspect_ratio: bool = Form(False),
    resize_format: str = Form("JPEG"),
    resize_quality: int = Form(85),
    brightness: float = Form(1.0),
    contrast: float = Form(1.0),
    sharpness: float = Form(1.0),
    color: float = Form(1.0),
    auto_equalize: bool = Form(False),
    filter: str = Form("grayscale"),
):
    fname = _unique_filename(file.filename or "upload.jpg")
    source_bytes = file.file.read()
    file.file.seek(0)
    _save_bytes_to_minio("images", fname, source_bytes, file.content_type or "image/jpeg")

    # Step 1: resize
    resize_result = _call_fn("fn-image-resize", {
        "image_b64": base64.b64encode(source_bytes).decode(),
        "filename": fname,
        "width": width,
        "height": height,
        "maintain_aspect_ratio": maintain_aspect_ratio,
        "format": "JPEG",
        "quality": resize_quality,
    })
    
    # Step 2: enhance
    enhance_result = _call_fn("fn-image-enhance", {
        "image_b64": resize_result["image_b64"],
        "filename": fname,
        "brightness": brightness,
        "contrast": contrast,
        "sharpness": sharpness,
        "color": color,
        "auto_equalize": auto_equalize,
    })

    # Step 3: filter
    filter_result = _call_fn("fn-image-filter", {
        "image_b64": enhance_result["image_b64"],
        "filename": fname,
        "filter": filter,
    })

    minio_path = f"processed/pipeline/{fname}"
    return _b64_to_image_response(filter_result["image_b64"], "JPEG", minio_path)


# ---------------------------------------------------------------------------
# MinIO Browser Endpoints (for UI)
# ---------------------------------------------------------------------------

@app.get("/minio/list/{bucket}", summary="List objects in a MinIO bucket")
def list_minio_bucket(bucket: str = Path(...)):
    try:
        client = _get_minio_client()
        if not client.bucket_exists(bucket):
            return {"status": "ok", "objects": []}
            
        objects = client.list_objects(bucket, recursive=True)
        res = []
        for obj in objects:
            res.append({
                "key": obj.object_name,
                "size": obj.size,
                "last_modified": obj.last_modified.isoformat() if obj.last_modified else None,
            })
        return {"status": "ok", "objects": res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/minio/get/{bucket}/{key:path}", summary="Get object from MinIO as base64")
def get_minio_object(bucket: str = Path(...), key: str = Path(...)):
    try:
        client = _get_minio_client()
        response = client.get_object(bucket, key)
        data = response.read()
        response.close()
        response.release_conn()
        return {"status": "ok", "image_b64": base64.b64encode(data).decode()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/minio/download/{bucket}/{key:path}", summary="Get raw object from MinIO")
def download_minio_object(bucket: str = Path(...), key: str = Path(...)):
    try:
        client = _get_minio_client()
        response = client.get_object(bucket, key)
        data = response.read()
        response.close()
        response.release_conn()
        
        # Determine content type from extension
        ext = key.split('.')[-1].lower() if '.' in key else 'jpeg'
        media_type = f"image/{ext}" if ext in ['png', 'gif', 'webp'] else "image/jpeg"
        
        return Response(content=data, media_type=media_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/minio/upload/{prefix}", summary="Upload a file directly to images/{prefix}/")
async def upload_to_minio(
    prefix: str = Path(...), 
    file: UploadFile = File(...)
):
    try:
        client = _get_minio_client()
        bucket = "images"
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
            
        data = await file.read()
        fname = _unique_filename(file.filename)
        dest_key = f"{prefix}/{fname}"
        
        client.put_object(
            bucket, 
            dest_key, 
            io.BytesIO(data), 
            length=len(data), 
            content_type=file.content_type or "image/jpeg"
        )
        return {"status": "ok", "bucket": bucket, "key": dest_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ---------------------------------------------------------------------------
# Entry point (for local dev)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=5000, reload=True)

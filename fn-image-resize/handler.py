import json
import base64
import os
import io
import time
import traceback
from PIL import Image
from minio import Minio

# ---------------------------------------------------------------------------
# MinIO client
# ---------------------------------------------------------------------------
def _get_minio_client() -> Minio:
    endpoint   = os.environ.get("MINIO_ENDPOINT", "localhost:9000")
    access_key = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
    secret_key = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
    secure     = os.environ.get("MINIO_SECURE", "false").lower() == "true"
    return Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)


def _fetch_from_minio(object_key: str) -> bytes:
    client = _get_minio_client()
    response = client.get_object("images", object_key)
    data = response.read()
    response.close()
    response.release_conn()
    return data


def _save_to_minio(image_bytes: bytes, filename: str, fmt: str = "JPEG"):
    client = _get_minio_client()
    bucket = "processed"
    dest_key = f"resize/{filename}"
    content_type = "image/jpeg" if fmt.upper() in ("JPEG", "JPG") else f"image/{fmt.lower()}"

    # Ensure bucket exists
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)

    client.put_object(
        bucket,
        dest_key,
        io.BytesIO(image_bytes),
        length=len(image_bytes),
        content_type=content_type,
    )


# ---------------------------------------------------------------------------
# Core processing
# ---------------------------------------------------------------------------
def _resize_image(
    image_bytes: bytes,
    width: int | None,
    height: int | None,
    maintain_aspect_ratio: bool,
    fmt: str,
    quality: int,
) -> bytes:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    orig_w, orig_h = img.size

    if maintain_aspect_ratio:
        if width and not height:
            ratio = width / orig_w
            height = int(orig_h * ratio)
        elif height and not width:
            ratio = height / orig_h
            width = int(orig_w * ratio)
        elif width and height:
            ratio = min(width / orig_w, height / orig_h)
            width  = int(orig_w * ratio)
            height = int(orig_h * ratio)
        else:
            width, height = orig_w, orig_h
    else:
        width  = width  or orig_w
        height = height or orig_h

    img = img.resize((width, height), Image.LANCZOS)

    buf = io.BytesIO()
    save_fmt = fmt.upper()
    if save_fmt == "JPG":
        save_fmt = "JPEG"
    img.save(buf, format=save_fmt, quality=quality)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# OpenFaaS handler entry point
# ---------------------------------------------------------------------------
def handle(event, context):
    t_start = time.time()
    image_bytes = None
    filename = "output.jpg"

    try:
        # ── Parse input ──────────────────────────────────────────────────
        body = {}
        if event.body:
            try:
                body = json.loads(event.body)
            except (json.JSONDecodeError, TypeError):
                pass

        query = getattr(event, "query", {}) or {}
        object_key = query.get("object_key") or body.get("object_key")

        if object_key:
            filename   = os.path.basename(object_key)
            image_bytes = _fetch_from_minio(object_key)
        elif body.get("image_b64"):
            image_bytes = base64.b64decode(body["image_b64"])
        else:
            return {
                "statusCode": 400,
                "body": json.dumps({
                    "status": "error",
                    "message": "No image provided. Send 'image_b64' in body or 'object_key' query param.",
                    "trace": "",
                }),
            }

        # ── Processing params ────────────────────────────────────────────
        raw_w = body.get("width")
        width = int(raw_w) if raw_w else None
        
        raw_h = body.get("height")
        height = int(raw_h) if raw_h else None
        maintain_aspect_ratio = str(body.get("maintain_aspect_ratio", "false")).lower() == "true"
        fmt                  = body.get("format", "JPEG").upper()
        quality              = int(body.get("quality", 85))

        params = {
            "width": width,
            "height": height,
            "maintain_aspect_ratio": maintain_aspect_ratio,
            "format": fmt,
            "quality": quality,
        }

        # ── Resize ───────────────────────────────────────────────────────
        result_bytes = _resize_image(image_bytes, width, height, maintain_aspect_ratio, fmt, quality)

        # ── Save to MinIO ────────────────────────────────────────────────
        try:
            _save_to_minio(result_bytes, filename, fmt)
        except Exception:
            pass  # non-fatal — still return result

        # ── Build response ───────────────────────────────────────────────
        elapsed_ms = int((time.time() - t_start) * 1000)
        return {
            "statusCode": 200,
            "body": json.dumps({
                "status": "ok",
                "image_b64": base64.b64encode(result_bytes).decode(),
                "meta": {
                    "processing_time_ms": elapsed_ms,
                    "operation": "resize",
                    "params": params,
                },
            }),
        }

    except Exception as exc:
        return {
            "statusCode": 500,
            "body": json.dumps({
                "status": "error",
                "message": str(exc),
                "trace": traceback.format_exc(),
            }),
        }

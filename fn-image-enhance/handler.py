import json
import base64
import os
import io
import time
import traceback
from PIL import Image, ImageEnhance, ImageOps
from minio import Minio

# ---------------------------------------------------------------------------
# MinIO helpers
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


def _save_to_minio(image_bytes: bytes, filename: str):
    client = _get_minio_client()
    bucket = "processed"
    dest_key = f"enhance/{filename}"
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)
    client.put_object(
        bucket, dest_key, io.BytesIO(image_bytes),
        length=len(image_bytes), content_type="image/jpeg",
    )


# ---------------------------------------------------------------------------
# Core processing
# ---------------------------------------------------------------------------
def _enhance_image(
    image_bytes: bytes,
    brightness: float,
    contrast: float,
    sharpness: float,
    color: float,
    auto_equalize: bool,
) -> bytes:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    img = ImageEnhance.Brightness(img).enhance(brightness)
    img = ImageEnhance.Contrast(img).enhance(contrast)
    img = ImageEnhance.Sharpness(img).enhance(sharpness)
    img = ImageEnhance.Color(img).enhance(color)

    if auto_equalize:
        img = ImageOps.equalize(img)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# OpenFaaS handler entry point
# ---------------------------------------------------------------------------
def handle(event, context):
    t_start = time.time()
    image_bytes = None
    filename = "output.jpg"

    try:
        body = {}
        if event.body:
            try:
                body = json.loads(event.body)
            except (json.JSONDecodeError, TypeError):
                pass

        query = getattr(event, "query", {}) or {}
        object_key = query.get("object_key") or body.get("object_key")

        if object_key:
            filename    = os.path.basename(object_key)
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

        brightness    = float(body.get("brightness") if body.get("brightness") is not None else 1.0)
        contrast      = float(body.get("contrast")   if body.get("contrast")   is not None else 1.0)
        sharpness     = float(body.get("sharpness")  if body.get("sharpness")  is not None else 1.0)
        color         = float(body.get("color")      if body.get("color")      is not None else 1.0)
        auto_equalize = str(body.get("auto_equalize", "false")).lower() == "true"

        params = {
            "brightness": brightness,
            "contrast": contrast,
            "sharpness": sharpness,
            "color": color,
            "auto_equalize": auto_equalize,
        }

        result_bytes = _enhance_image(image_bytes, brightness, contrast, sharpness, color, auto_equalize)

        try:
            _save_to_minio(result_bytes, filename)
        except Exception:
            pass

        elapsed_ms = int((time.time() - t_start) * 1000)
        return {
            "statusCode": 200,
            "body": json.dumps({
                "status": "ok",
                "image_b64": base64.b64encode(result_bytes).decode(),
                "meta": {
                    "processing_time_ms": elapsed_ms,
                    "operation": "enhance",
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

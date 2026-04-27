import json
import base64
import os
import io
import time
import traceback
from PIL import Image, ImageFilter, ImageOps, ImageEnhance
from minio import Minio

# ---------------------------------------------------------------------------
# Supported filters
# ---------------------------------------------------------------------------
AVAILABLE_FILTERS = [
    "grayscale", "blur", "blur_heavy", "sharpen", "edge", "emboss",
    "smooth", "detail", "contour", "sepia", "invert", "posterize", "solarize",
]


def _apply_filter(img: Image.Image, filter_name: str) -> Image.Image:
    """Apply a named filter to a PIL Image (RGB) and return the result."""
    name = filter_name.lower()

    if name == "grayscale":
        return img.convert("L").convert("RGB")

    elif name == "blur":
        return img.filter(ImageFilter.BLUR)

    elif name == "blur_heavy":
        return img.filter(ImageFilter.GaussianBlur(radius=5))

    elif name == "sharpen":
        return img.filter(ImageFilter.SHARPEN)

    elif name == "edge":
        gray = img.convert("L")
        edges = gray.filter(ImageFilter.FIND_EDGES)
        return edges.convert("RGB")

    elif name == "emboss":
        return img.filter(ImageFilter.EMBOSS)

    elif name == "smooth":
        return img.filter(ImageFilter.SMOOTH_MORE)

    elif name == "detail":
        return img.filter(ImageFilter.DETAIL)

    elif name == "contour":
        return img.filter(ImageFilter.CONTOUR)

    elif name == "sepia":
        grayscale = img.convert("L").convert("RGB")
        r, g, b = grayscale.split()
        r = r.point(lambda i: min(255, int(i * 1.08)))
        g = g.point(lambda i: min(255, int(i * 0.87)))
        b = b.point(lambda i: min(255, int(i * 0.69)))
        return Image.merge("RGB", (r, g, b))

    elif name == "invert":
        return ImageOps.invert(img)

    elif name == "posterize":
        return ImageOps.posterize(img, bits=3)

    elif name == "solarize":
        return ImageOps.solarize(img, threshold=128)

    else:
        raise ValueError(f"Unknown filter: '{filter_name}'")


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
    dest_key = f"filter/{filename}"
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)
    client.put_object(
        bucket, dest_key, io.BytesIO(image_bytes),
        length=len(image_bytes), content_type="image/jpeg",
    )


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

        filter_name = body.get("filter", "grayscale")
        params = {"filter": filter_name}

        # Validate filter early to return 400
        if filter_name.lower() not in AVAILABLE_FILTERS:
            return {
                "statusCode": 400,
                "body": json.dumps({
                    "status": "error",
                    "message": f"Unknown filter: '{filter_name}'",
                    "available_filters": AVAILABLE_FILTERS,
                    "trace": "",
                }),
            }

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img = _apply_filter(img, filter_name)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        result_bytes = buf.getvalue()

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
                    "operation": "filter",
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

import json
import os
import time
import urllib.parse
import traceback
import requests

# ---------------------------------------------------------------------------
# Routing table: object_key prefix → function name
# ---------------------------------------------------------------------------
PREFIX_ROUTES = {
    "resize":  "fn-image-resize",
    "enhance": "fn-image-enhance",
    "filter":  "fn-image-filter",
}

OPENFAAS_GATEWAY = os.environ.get("OPENFAAS_GATEWAY", "http://127.0.0.1:8080")
CALL_TIMEOUT     = 30   # seconds
MAX_RETRIES      = 1


def _call_function(fn_name: str, object_key: str) -> requests.Response:
    """Call an OpenFaaS function with object_key query param. 1 retry on timeout/5xx."""
    url = f"{OPENFAAS_GATEWAY}/function/{fn_name}"
    params = {"object_key": object_key}
    last_exc = None

    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = requests.get(url, params=params, timeout=CALL_TIMEOUT)
            if resp.status_code < 500:
                return resp
            last_exc = None  # got a response, treat as last attempt result
            if attempt < MAX_RETRIES:
                continue
            return resp
        except requests.Timeout as exc:
            last_exc = exc
            if attempt < MAX_RETRIES:
                continue

    if last_exc:
        raise last_exc
    return resp


# ---------------------------------------------------------------------------
# OpenFaaS handler entry point
# ---------------------------------------------------------------------------
def handle(event, context):
    t_start = time.time()

    try:
        # ── Parse MinIO S3 event JSON ──────────────────────────────────
        body = {}
        if event.body:
            try:
                body = json.loads(event.body)
            except (json.JSONDecodeError, TypeError):
                return {
                    "statusCode": 400,
                    "body": json.dumps({
                        "status": "error",
                        "message": "Invalid JSON body",
                        "trace": "",
                    }),
                }

        # Support both direct object_key param (for testing) and full S3 event
        query = getattr(event, "query", {}) or {}
        object_key = query.get("object_key") or body.get("object_key")

        if not object_key:
            # Try to extract from MinIO S3 event format
            try:
                records = body.get("Records", [])
                if not records:
                    raise ValueError("No Records in event")
                raw_key = records[0]["s3"]["object"]["key"]
                object_key = urllib.parse.unquote_plus(raw_key)
            except (KeyError, IndexError, ValueError) as exc:
                return {
                    "statusCode": 400,
                    "body": json.dumps({
                        "status": "error",
                        "message": f"Cannot extract object key from event: {exc}",
                        "trace": traceback.format_exc(),
                    }),
                }

        # ── Route based on prefix ──────────────────────────────────────
        prefix = object_key.split("/")[0].lower()
        fn_name = PREFIX_ROUTES.get(prefix)

        if not fn_name:
            return {
                "statusCode": 400,
                "body": json.dumps({
                    "status": "error",
                    "message": (
                        f"No route for prefix '{prefix}'. "
                        f"Valid prefixes: {list(PREFIX_ROUTES.keys())}"
                    ),
                    "trace": "",
                }),
            }

        # ── Invoke target function ─────────────────────────────────────
        resp = _call_function(fn_name, object_key)
        elapsed_ms = int((time.time() - t_start) * 1000)

        try:
            fn_body = resp.json()
        except Exception:
            fn_body = {"raw": resp.text}

        return {
            "statusCode": resp.status_code,
            "body": json.dumps({
                "status": "ok" if resp.status_code == 200 else "error",
                "routed_to": fn_name,
                "object_key": object_key,
                "function_response": fn_body,
                "meta": {
                    "processing_time_ms": elapsed_ms,
                    "operation": "trigger",
                    "params": {"prefix": prefix, "fn": fn_name},
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

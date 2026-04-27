"""
test_functions.py — pytest unit tests for all OpenFaaS functions
All tests mock the MinIO client so no live server is required.
"""

import base64
import io
import json
import sys
import os
import types
import unittest
from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from PIL import Image

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_jpeg_bytes(width: int = 100, height: int = 80, color=(120, 80, 60)) -> bytes:
    """Create a minimal JPEG image in memory."""
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _make_png_bytes(width: int = 100, height: int = 80) -> bytes:
    img = Image.new("RGB", (width, height), color=(200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _make_event(body: dict | None = None, query: dict | None = None):
    """Build a minimal mock OpenFaaS event object."""
    event = MagicMock()
    event.body = json.dumps(body).encode() if body else b""
    event.query = query or {}
    return event


def _make_minio_mock(image_bytes: bytes | None = None):
    """Return a mock Minio instance that returns image_bytes on get_object."""
    mock_client = MagicMock()
    if image_bytes:
        mock_resp = MagicMock()
        mock_resp.read.return_value = image_bytes
        mock_client.get_object.return_value = mock_resp
    mock_client.bucket_exists.return_value = True
    return mock_client


def _validate_ok_response(response: dict):
    """Assert the strict output contract is satisfied."""
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["status"] == "ok", f"Expected status=ok, got: {body}"
    assert "image_b64" in body, "Missing image_b64"
    assert "meta" in body, "Missing meta"
    assert "processing_time_ms" in body["meta"], "Missing processing_time_ms"
    assert "operation" in body["meta"], "Missing operation"
    assert "params" in body["meta"], "Missing params"
    return body


# ---------------------------------------------------------------------------
# Patch helpers
# ---------------------------------------------------------------------------

RESIZE_MODULE  = "fn-image-resize.handler"
ENHANCE_MODULE = "fn-image-enhance.handler"
FILTER_MODULE  = "fn-image-filter.handler"
TRIGGER_MODULE = "fn-minio-trigger.handler"


def _import_handler(folder: str):
    """Dynamically import a handler module from the function folder."""
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler_path = os.path.join(project_root, folder, "handler.py")

    spec_name = folder.replace("-", "_") + "_handler"
    import importlib.util
    spec = importlib.util.spec_from_file_location(spec_name, handler_path)
    module = importlib.util.module_from_spec(spec)
    # Provide a dummy 'minio' module so import doesn't fail without the package
    if "minio" not in sys.modules:
        fake_minio = types.ModuleType("minio")
        fake_minio.Minio = MagicMock
        sys.modules["minio"] = fake_minio
        sys.modules["minio.error"] = types.ModuleType("minio.error")
    spec.loader.exec_module(module)
    return module


# Lazy-load modules once
@pytest.fixture(scope="session")
def resize_handler():
    return _import_handler("fn-image-resize")


@pytest.fixture(scope="session")
def enhance_handler():
    return _import_handler("fn-image-enhance")


@pytest.fixture(scope="session")
def filter_handler():
    return _import_handler("fn-image-filter")


@pytest.fixture(scope="session")
def trigger_handler():
    return _import_handler("fn-minio-trigger")


# ---------------------------------------------------------------------------
# fn-image-resize tests
# ---------------------------------------------------------------------------

class TestFnImageResize:

    def test_default_params_returns_ok(self, resize_handler):
        """Resize with default params (no width/height) should return original size."""
        img_bytes = _make_jpeg_bytes(200, 150)
        event = _make_event({"image_b64": _b64(img_bytes)})
        mock_client = _make_minio_mock()

        with patch.object(resize_handler, "_get_minio_client", return_value=mock_client):
            resp = resize_handler.handle(event, None)

        body = _validate_ok_response(resp)
        assert body["meta"]["operation"] == "resize"

    def test_custom_width_height(self, resize_handler):
        """Resize to 50x50."""
        img_bytes = _make_jpeg_bytes(200, 150)
        event = _make_event({"image_b64": _b64(img_bytes), "width": 50, "height": 50})
        mock_client = _make_minio_mock()

        with patch.object(resize_handler, "_get_minio_client", return_value=mock_client):
            resp = resize_handler.handle(event, None)

        body = _validate_ok_response(resp)
        # Verify the output image is actually 50x50
        result_img = Image.open(io.BytesIO(base64.b64decode(body["image_b64"])))
        assert result_img.size == (50, 50)

    def test_maintain_aspect_ratio_width_only(self, resize_handler):
        """Width=100, maintain_aspect_ratio=True → height computed automatically."""
        img_bytes = _make_jpeg_bytes(400, 200)  # 2:1 ratio
        event = _make_event({
            "image_b64": _b64(img_bytes),
            "width": 100,
            "maintain_aspect_ratio": "true",
        })
        mock_client = _make_minio_mock()

        with patch.object(resize_handler, "_get_minio_client", return_value=mock_client):
            resp = resize_handler.handle(event, None)

        body = _validate_ok_response(resp)
        result_img = Image.open(io.BytesIO(base64.b64decode(body["image_b64"])))
        w, h = result_img.size
        assert w == 100
        assert h == 50, f"Expected height=50 for 2:1 ratio at width=100, got {h}"

    def test_png_format_output(self, resize_handler):
        """Request PNG format — output should be a valid PNG."""
        img_bytes = _make_jpeg_bytes()
        event = _make_event({"image_b64": _b64(img_bytes), "format": "PNG", "width": 60})
        mock_client = _make_minio_mock()

        with patch.object(resize_handler, "_get_minio_client", return_value=mock_client):
            resp = resize_handler.handle(event, None)

        body = _validate_ok_response(resp)
        result_img = Image.open(io.BytesIO(base64.b64decode(body["image_b64"])))
        assert result_img.format == "PNG"

    def test_no_input_returns_400(self, resize_handler):
        """No image_b64 and no object_key → 400."""
        event = _make_event({})  # empty body
        resp = resize_handler.handle(event, None)
        assert resp["statusCode"] == 400
        body = json.loads(resp["body"])
        assert body["status"] == "error"
        assert body["trace"] == ""

    def test_bad_image_data_returns_500(self, resize_handler):
        """Corrupt base64 image data → 500 with traceback."""
        event = _make_event({"image_b64": _b64(b"not-an-image-xyzxyz")})
        mock_client = _make_minio_mock()

        with patch.object(resize_handler, "_get_minio_client", return_value=mock_client):
            resp = resize_handler.handle(event, None)

        assert resp["statusCode"] == 500
        body = json.loads(resp["body"])
        assert body["status"] == "error"
        assert len(body["trace"]) > 0

    def test_object_key_takes_priority(self, resize_handler):
        """If object_key AND image_b64 both provided, object_key wins."""
        img_bytes = _make_jpeg_bytes(300, 200)
        mock_client = _make_minio_mock(img_bytes)
        # image_b64 is corrupt — if it's used, we get 500; object_key should win
        event = _make_event(
            body={"image_b64": _b64(b"garbage"), "object_key": "resize/test.jpg"},
        )

        with patch.object(resize_handler, "_get_minio_client", return_value=mock_client):
            resp = resize_handler.handle(event, None)

        _validate_ok_response(resp)
        mock_client.get_object.assert_called_once_with("images", "resize/test.jpg")


# ---------------------------------------------------------------------------
# fn-image-enhance tests
# ---------------------------------------------------------------------------

class TestFnImageEnhance:

    def test_default_params(self, enhance_handler):
        """All defaults (1.0) — image should come back as valid RGB."""
        img_bytes = _make_jpeg_bytes()
        event = _make_event({"image_b64": _b64(img_bytes)})
        mock_client = _make_minio_mock()

        with patch.object(enhance_handler, "_get_minio_client", return_value=mock_client):
            resp = enhance_handler.handle(event, None)

        body = _validate_ok_response(resp)
        result_img = Image.open(io.BytesIO(base64.b64decode(body["image_b64"])))
        assert result_img.mode == "RGB"

    def test_custom_brightness_and_contrast(self, enhance_handler):
        """Enhance brightness=1.5, contrast=2.0 — should succeed."""
        img_bytes = _make_jpeg_bytes()
        event = _make_event({"image_b64": _b64(img_bytes), "brightness": 1.5, "contrast": 2.0})
        mock_client = _make_minio_mock()

        with patch.object(enhance_handler, "_get_minio_client", return_value=mock_client):
            resp = enhance_handler.handle(event, None)

        body = _validate_ok_response(resp)
        assert body["meta"]["params"]["brightness"] == 1.5
        assert body["meta"]["params"]["contrast"] == 2.0

    def test_auto_equalize(self, enhance_handler):
        """auto_equalize=true — output should still be valid RGB."""
        img_bytes = _make_jpeg_bytes()
        event = _make_event({"image_b64": _b64(img_bytes), "auto_equalize": "true"})
        mock_client = _make_minio_mock()

        with patch.object(enhance_handler, "_get_minio_client", return_value=mock_client):
            resp = enhance_handler.handle(event, None)

        body = _validate_ok_response(resp)
        assert body["meta"]["params"]["auto_equalize"] is True
        result_img = Image.open(io.BytesIO(base64.b64decode(body["image_b64"])))
        assert result_img.mode == "RGB"

    def test_no_input_returns_400(self, enhance_handler):
        event = _make_event({})
        resp = enhance_handler.handle(event, None)
        assert resp["statusCode"] == 400

    def test_output_is_valid_rgb_image(self, enhance_handler):
        """Verify the output image is decodable and RGB regardless of params."""
        img_bytes = _make_jpeg_bytes(150, 120, color=(30, 100, 200))
        event = _make_event({
            "image_b64": _b64(img_bytes),
            "sharpness": 2.0,
            "color": 0.5,
        })
        mock_client = _make_minio_mock()

        with patch.object(enhance_handler, "_get_minio_client", return_value=mock_client):
            resp = enhance_handler.handle(event, None)

        body = _validate_ok_response(resp)
        out = Image.open(io.BytesIO(base64.b64decode(body["image_b64"])))
        assert out.mode == "RGB"
        assert out.size[0] > 0 and out.size[1] > 0


# ---------------------------------------------------------------------------
# fn-image-filter tests
# ---------------------------------------------------------------------------

AVAILABLE_FILTERS = [
    "grayscale", "blur", "blur_heavy", "sharpen", "edge", "emboss",
    "smooth", "detail", "contour", "sepia", "invert", "posterize", "solarize",
]


class TestFnImageFilter:

    @pytest.mark.parametrize("filter_name", AVAILABLE_FILTERS)
    def test_all_filters(self, filter_handler, filter_name):
        """Every supported filter should return status=ok with image_b64."""
        img_bytes = _make_jpeg_bytes()
        event = _make_event({"image_b64": _b64(img_bytes), "filter": filter_name})
        mock_client = _make_minio_mock()

        with patch.object(filter_handler, "_get_minio_client", return_value=mock_client):
            resp = filter_handler.handle(event, None)

        body = _validate_ok_response(resp)
        assert body["meta"]["params"]["filter"] == filter_name

    def test_invalid_filter_returns_400(self, filter_handler):
        """Unknown filter name → 400 with available_filters list."""
        img_bytes = _make_jpeg_bytes()
        event = _make_event({"image_b64": _b64(img_bytes), "filter": "rainbow_explosion"})
        mock_client = _make_minio_mock()

        with patch.object(filter_handler, "_get_minio_client", return_value=mock_client):
            resp = filter_handler.handle(event, None)

        assert resp["statusCode"] == 400
        body = json.loads(resp["body"])
        assert body["status"] == "error"
        assert "available_filters" in body, "400 body must include available_filters"
        assert isinstance(body["available_filters"], list)
        assert len(body["available_filters"]) == 13

    def test_default_filter_is_grayscale(self, filter_handler):
        """Omitting 'filter' param should default to grayscale."""
        img_bytes = _make_jpeg_bytes()
        event = _make_event({"image_b64": _b64(img_bytes)})  # no filter key
        mock_client = _make_minio_mock()

        with patch.object(filter_handler, "_get_minio_client", return_value=mock_client):
            resp = filter_handler.handle(event, None)

        body = _validate_ok_response(resp)
        assert body["meta"]["params"]["filter"] == "grayscale"

    def test_grayscale_output_has_uniform_channels(self, filter_handler):
        """Grayscale output should have R==G==B for every pixel (converted to RGB)."""
        img_bytes = _make_jpeg_bytes(50, 50, color=(255, 128, 64))
        event = _make_event({"image_b64": _b64(img_bytes), "filter": "grayscale"})
        mock_client = _make_minio_mock()

        with patch.object(filter_handler, "_get_minio_client", return_value=mock_client):
            resp = filter_handler.handle(event, None)

        body = _validate_ok_response(resp)
        result_img = Image.open(io.BytesIO(base64.b64decode(body["image_b64"]))).convert("RGB")
        for pixel in list(result_img.getdata()):
            assert pixel[0] == pixel[1] == pixel[2], f"Non-uniform grayscale pixel: {pixel}"

    def test_no_input_returns_400(self, filter_handler):
        event = _make_event({})
        resp = filter_handler.handle(event, None)
        assert resp["statusCode"] == 400

    def test_processing_time_is_non_negative(self, filter_handler):
        img_bytes = _make_jpeg_bytes()
        event = _make_event({"image_b64": _b64(img_bytes), "filter": "blur"})
        mock_client = _make_minio_mock()

        with patch.object(filter_handler, "_get_minio_client", return_value=mock_client):
            resp = filter_handler.handle(event, None)

        body = _validate_ok_response(resp)
        assert body["meta"]["processing_time_ms"] >= 0


# ---------------------------------------------------------------------------
# fn-minio-trigger tests
# ---------------------------------------------------------------------------

class TestFnMinioTrigger:

    def _make_s3_event(self, key: str) -> dict:
        """Build a minimal MinIO S3 event JSON."""
        return {
            "Records": [
                {
                    "s3": {
                        "bucket": {"name": "images"},
                        "object": {"key": key, "size": 1024},
                    }
                }
            ]
        }

    def test_routes_resize_prefix(self, trigger_handler):
        """Key under resize/ → routes to fn-image-resize."""
        event = _make_event(self._make_s3_event("resize/photo.jpg"))

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "status": "ok",
            "image_b64": _b64(_make_jpeg_bytes()),
            "meta": {"processing_time_ms": 50, "operation": "resize", "params": {}},
        }

        with patch.object(trigger_handler, "_call_function", return_value=mock_resp):
            resp = trigger_handler.handle(event, None)

        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert body["routed_to"] == "fn-image-resize"

    def test_routes_enhance_prefix(self, trigger_handler):
        event = _make_event(self._make_s3_event("enhance/photo.jpg"))

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"status": "ok", "image_b64": _b64(_make_jpeg_bytes()), "meta": {"processing_time_ms": 30, "operation": "enhance", "params": {}}}

        with patch.object(trigger_handler, "_call_function", return_value=mock_resp):
            resp = trigger_handler.handle(event, None)

        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert body["routed_to"] == "fn-image-enhance"

    def test_routes_filter_prefix(self, trigger_handler):
        event = _make_event(self._make_s3_event("filter/photo.jpg"))

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"status": "ok", "image_b64": _b64(_make_jpeg_bytes()), "meta": {"processing_time_ms": 20, "operation": "filter", "params": {}}}

        with patch.object(trigger_handler, "_call_function", return_value=mock_resp):
            resp = trigger_handler.handle(event, None)

        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert body["routed_to"] == "fn-image-filter"

    def test_unknown_prefix_returns_400(self, trigger_handler):
        event = _make_event(self._make_s3_event("unknown/photo.jpg"))
        resp = trigger_handler.handle(event, None)
        assert resp["statusCode"] == 400
        body = json.loads(resp["body"])
        assert body["status"] == "error"

    def test_urldecoded_key(self, trigger_handler):
        """URL-encoded key (spaces encoded as +) should be decoded."""
        event = _make_event(self._make_s3_event("resize/my+photo+test.jpg"))

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"status": "ok", "image_b64": _b64(_make_jpeg_bytes()), "meta": {"processing_time_ms": 10, "operation": "resize", "params": {}}}

        with patch.object(trigger_handler, "_call_function", return_value=mock_resp) as mock_call:
            resp = trigger_handler.handle(event, None)

        assert resp["statusCode"] == 200
        # Verify the decoded key was passed
        call_args = mock_call.call_args
        assert "resize/my photo test.jpg" == call_args[0][1]

    def test_invalid_json_returns_400(self, trigger_handler):
        event = MagicMock()
        event.body = b"not json {{{"
        event.query = {}
        resp = trigger_handler.handle(event, None)
        assert resp["statusCode"] == 400

    def test_empty_records_returns_400(self, trigger_handler):
        event = _make_event({"Records": []})
        resp = trigger_handler.handle(event, None)
        assert resp["statusCode"] == 400

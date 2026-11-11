"""Local smoke tests. These check API plumbing/model loading, not medical accuracy."""
from fastapi.testclient import TestClient
from PIL import Image
from io import BytesIO

from app.main import app


def _jpeg_bytes() -> bytes:
    image = Image.new("RGB", (512, 512), (170, 120, 110))
    buffer = BytesIO()
    image.save(buffer, format="JPEG")
    return buffer.getvalue()


def test_health_and_classes():
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["model_loaded"] is True

        classes = client.get("/api/v1/ai/skin-lesion/classes")
        assert classes.status_code == 200
        assert len(classes.json()["classes"]) == 7


def test_prediction_shape_and_safety_fields():
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/ai/skin-lesion/predict",
            files={"file": ("smoke_test.jpg", _jpeg_bytes(), "image/jpeg")},
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["predicted_class_code"] in {
            "akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"
        }
        assert len(payload["class_scores"]) == 7
        assert payload["requires_doctor_review"] is True
        assert payload["score_type"] == "uncalibrated_softmax_score"

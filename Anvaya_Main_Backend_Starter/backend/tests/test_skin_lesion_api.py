import io
import uuid
import pytest
from PIL import Image
from fastapi import status

from app.core.config import settings
from app.core.rate_limit import reset_rate_limits
from app.models.consent_record import ConsentRecord
from app.models.skin_lesion_analysis import SkinLesionAnalysis


def _create_test_image(format="JPEG", size=(128, 128), color=(180, 80, 80)) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", size, color=color)
    img.save(buf, format=format)
    return buf.getvalue()


def test_get_skin_lesion_classes(client):
    response = client.get("/api/v1/ai/skin-lesion/classes")
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert "classes" in data
    assert len(data["classes"]) == 7
    codes = [c["code"] for c in data["classes"]]
    assert "mel" in codes
    assert "nv" in codes
    assert "disclaimer" in data


def test_analyze_skin_lesion_requires_auth(client):
    img_bytes = _create_test_image()
    response = client.post(
        "/api/v1/ai/skin-lesion/analyze",
        files={"file": ("lesion.jpg", img_bytes, "image/jpeg")},
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_analyze_skin_lesion_forbidden_for_doctor(client, doctor_headers):
    img_bytes = _create_test_image()
    response = client.post(
        "/api/v1/ai/skin-lesion/analyze",
        headers=doctor_headers,
        files={"file": ("lesion.jpg", img_bytes, "image/jpeg")},
    )
    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_analyze_skin_lesion_empty_file_rejected(client, patient_headers):
    response = client.post(
        "/api/v1/ai/skin-lesion/analyze",
        headers=patient_headers,
        files={"file": ("empty.jpg", b"", "image/jpeg")},
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_analyze_skin_lesion_unsupported_format_rejected(client, patient_headers):
    response = client.post(
        "/api/v1/ai/skin-lesion/analyze",
        headers=patient_headers,
        files={"file": ("doc.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == status.HTTP_415_UNSUPPORTED_MEDIA_TYPE


def test_analyze_skin_lesion_success_and_history(client, patient_headers):
    img_bytes = _create_test_image()
    response = client.post(
        "/api/v1/ai/skin-lesion/analyze?language=en",
        headers=patient_headers,
        files={"file": ("lesion.jpg", img_bytes, "image/jpeg")},
    )
    assert response.status_code == status.HTTP_201_CREATED
    data = response.json()
    assert "id" in data
    assert data["predicted_class"] in ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]
    assert 0.0 <= data["confidence"] <= 1.0
    assert len(data["probabilities"]) == 7
    assert data["risk_level"] in ["low", "medium", "high"]
    assert "disclaimer" in data
    assert data["education_title"] is not None
    analysis_id = data["id"]

    # Check history endpoint /me
    history_resp = client.get(
        "/api/v1/ai/skin-lesion/me",
        headers=patient_headers,
    )
    assert history_resp.status_code == status.HTTP_200_OK
    h_data = history_resp.json()
    assert h_data["total"] >= 1
    ids = [item["id"] for item in h_data["items"]]
    assert analysis_id in ids


def test_doctor_access_fail_closed_without_consent(
    client,
    patient_account,
    doctor_headers,
    db_session,
):
    patient_profile_id = patient_account["profile"].id
    # Create an analysis for patient
    analysis = SkinLesionAnalysis(
        patient_profile_id=patient_profile_id,
        predicted_class="mel",
        predicted_label="Melanoma",
        confidence=0.88,
        probabilities={"mel": 0.88, "nv": 0.12},
        risk_level="high",
        disclaimer="Standard disclaimer",
    )
    db_session.add(analysis)
    db_session.commit()

    # Doctor requests patient analysis WITHOUT consent -> 403 Forbidden
    resp = client.get(
        f"/api/v1/ai/skin-lesion/patient/{patient_profile_id}",
        headers=doctor_headers,
    )
    assert resp.status_code == status.HTTP_403_FORBIDDEN
    assert "consent is required" in resp.json()["detail"].lower()

    # Doctor tries to review WITHOUT consent -> 403 Forbidden
    review_resp = client.patch(
        f"/api/v1/ai/skin-lesion/{analysis.id}/review",
        headers=doctor_headers,
        json={"doctor_notes": "Clinical review without consent."},
    )
    assert review_resp.status_code == status.HTTP_403_FORBIDDEN


def test_doctor_access_and_review_with_active_consent(
    client,
    patient_account,
    approved_doctor,
    doctor_headers,
    db_session,
):
    patient_profile_id = patient_account["profile"].id
    doctor_profile_id = approved_doctor["profile"].id

    analysis = SkinLesionAnalysis(
        patient_profile_id=patient_profile_id,
        predicted_class="bcc",
        predicted_label="Basal cell carcinoma",
        confidence=0.75,
        probabilities={"bcc": 0.75, "nv": 0.25},
        risk_level="medium",
        disclaimer="Standard disclaimer",
    )
    db_session.add(analysis)

    # Grant active consent
    consent = ConsentRecord(
        patient_profile_id=patient_profile_id,
        doctor_profile_id=doctor_profile_id,
        data_scopes=["clinical_notes", "diagnoses"],
        is_active=True,
    )
    db_session.add(consent)
    db_session.commit()

    # Doctor requests patient analyses WITH active consent -> 200 OK
    resp = client.get(
        f"/api/v1/ai/skin-lesion/patient/{patient_profile_id}",
        headers=doctor_headers,
    )
    assert resp.status_code == status.HTTP_200_OK
    items = resp.json()["items"]
    assert len(items) >= 1
    assert items[0]["id"] == str(analysis.id)

    # Doctor submits review WITH active consent -> 200 OK
    notes = "Lesion exhibits suspicious borders; biopsy recommended."
    review_resp = client.patch(
        f"/api/v1/ai/skin-lesion/{analysis.id}/review",
        headers=doctor_headers,
        json={"doctor_notes": notes},
    )
    assert review_resp.status_code == status.HTTP_200_OK
    reviewed_data = review_resp.json()
    assert reviewed_data["doctor_notes"] == notes
    assert reviewed_data["reviewed_by_doctor_id"] == str(doctor_profile_id)
    assert reviewed_data["reviewed_at"] is not None


def test_rate_limiter_enforcement_and_429(client):
    """Explicit test verifying sliding-window rate limiting (429 Too Many Requests)."""
    reset_rate_limits()
    prev = settings.rate_limit_enabled
    settings.rate_limit_enabled = True

    try:
        # Auth login pair rate limit is 10/minute
        for i in range(10):
            r = client.post(
                "/api/v1/auth/login",
                json={"email": "wrong@example.com", "password": "wrong"},
            )
            # Should be 401 unauthorized
            assert r.status_code in [status.HTTP_401_UNAUTHORIZED, status.HTTP_404_NOT_FOUND]

        # 11th request must trigger 429
        rate_limited_resp = client.post(
            "/api/v1/auth/login",
            json={"email": "wrong@example.com", "password": "wrong"},
        )
        assert rate_limited_resp.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        assert "Retry-After" in rate_limited_resp.headers
    finally:
        settings.rate_limit_enabled = prev
        reset_rate_limits()

import io
from pathlib import Path
from uuid import UUID
import pytest
from PIL import Image, PngImagePlugin
from fastapi import status

from app.core.config import settings
from app.core.rate_limit import reset_rate_limits
from app.models.consent_record import ConsentRecord
from app.models.skin_lesion_analysis import SkinLesionAnalysis
from app.services.skin_lesion_service import ModelUnavailableError, SkinLesionService
from app.api.routes import skin_lesion

@pytest.fixture(autouse=True)
def isolated_uploads(tmp_path, monkeypatch):
    directory = tmp_path / "skin-uploads"
    monkeypatch.setattr(settings, "skin_lesion_upload_dir", str(directory))
    return directory


@pytest.fixture
def mocked_inference(monkeypatch):
    service = SkinLesionService.__new__(SkinLesionService)
    service.model = object()
    service.model_version = "fixture-version"
    service.checkpoint_sha256 = "a" * 64
    result = {
        "predicted_class": "nv", "predicted_label": "Fixture class", "confidence": 0.7,
        "probabilities": {"akiec": .05, "bcc": .05, "bkl": .05, "df": .05, "mel": .05, "nv": .7, "vasc": .05},
        "disclaimer": "Fixture disclaimer", "education_title": "Fixture education",
        "education_summary": None, "education_content": None,
        "inference_mode": "pytorch_efficientnet_b0", "model_version": service.model_version,
        "checkpoint_sha256": service.checkpoint_sha256,
    }
    monkeypatch.setattr(service, "predict", lambda *_args: result)
    monkeypatch.setattr(skin_lesion, "get_skin_lesion_service", lambda: service)
    return service


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


def test_analyze_skin_lesion_success_and_history(client, patient_headers, mocked_inference, db_session, isolated_uploads):
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
    assert data["risk_level"] is None
    assert data["inference_mode"] == "pytorch_efficientnet_b0"
    assert data["model_version"] == "fixture-version"
    assert data["checkpoint_sha256"] == "a" * 64
    saved = db_session.get(SkinLesionAnalysis, UUID(data["id"]))
    assert saved.checkpoint_sha256 == data["checkpoint_sha256"]
    assert Path(saved.image_path).parent == isolated_uploads
    assert Path(saved.image_path).name == data["image_filename"]
    assert "lesion.jpg" not in data["image_filename"]
    # History must keep its original identity after a model change.
    mocked_inference.model_version = "another-version"
    mocked_inference.checkpoint_sha256 = "b" * 64
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
    assert h_data["items"][0]["model_version"] == "fixture-version"
    assert h_data["items"][0]["checkpoint_sha256"] == "a" * 64


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
    assert items[0]["inference_mode"] == "unknown"
    assert items[0]["predicted_class"] is None
    assert items[0]["predicted_label"] is None
    assert items[0]["confidence"] is None
    assert items[0]["probabilities"] == {}

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
    assert reviewed_data["inference_mode"] == "unknown"
    assert reviewed_data["confidence"] is None


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

def test_unavailable_model_returns_503_without_analysis_or_file(
    client, patient_headers, db_session, mocked_inference, isolated_uploads, monkeypatch,
):
    def unavailable(*_args):
        raise ModelUnavailableError("private path and fixture secret")
    monkeypatch.setattr(mocked_inference, "predict", unavailable)
    response = client.post("/api/v1/ai/skin-lesion/analyze", headers=patient_headers,
                           files={"file": ("fixture.jpg", _create_test_image(), "image/jpeg")})
    assert response.status_code == 503
    assert response.json() == {"detail": "Skin lesion screening is temporarily unavailable."}
    assert db_session.query(SkinLesionAnalysis).count() == 0
    assert not isolated_uploads.exists()


def test_normalized_upload_never_stores_client_metadata(client, patient_headers, mocked_inference, isolated_uploads):
    image = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("location", "synthetic private metadata")
    Image.new("RGB", (128, 128)).save(image, format="PNG", pnginfo=metadata)
    mismatch = client.post("/api/v1/ai/skin-lesion/analyze", headers=patient_headers,
                           files={"file": ("fixture.jpg", image.getvalue(), "image/jpeg")})
    assert mismatch.status_code == 415
    response = client.post("/api/v1/ai/skin-lesion/analyze", headers=patient_headers,
                           files={"file": ("../synthetic-private.png", image.getvalue(), "image/png")})
    assert response.status_code == 201
    assert "synthetic-private" not in response.text
    with Image.open(next(isolated_uploads.iterdir())) as saved:
        assert saved.mode == "RGB"
        assert "location" not in saved.info


def test_failed_database_write_removes_new_file(
    client, patient_headers, db_session, mocked_inference, isolated_uploads, monkeypatch,
):
    from sqlalchemy.exc import SQLAlchemyError
    from sqlalchemy.orm import Session

    def fail_commit(_session):
        raise SQLAlchemyError("private database marker")
    monkeypatch.setattr(Session, "commit", fail_commit)
    response = client.post("/api/v1/ai/skin-lesion/analyze", headers=patient_headers,
                           files={"file": ("fixture.jpg", _create_test_image(), "image/jpeg")})
    assert response.json() == {"detail": "Could not save the screening result."}
    assert response.status_code == 503
    assert not list(isolated_uploads.iterdir())
    assert db_session.query(SkinLesionAnalysis).count() == 0


def test_history_and_review_role_boundaries(client, patient_account, patient_headers, doctor_headers):
    profile = patient_account["profile"].id
    assert client.get("/api/v1/ai/skin-lesion/me").status_code == 401
    assert client.get("/api/v1/ai/skin-lesion/me", headers=doctor_headers).status_code == 403
    assert client.get(f"/api/v1/ai/skin-lesion/patient/{profile}", headers=patient_headers).status_code == 403
    review = client.patch(f"/api/v1/ai/skin-lesion/{profile}/review", headers=patient_headers,
                          json={"doctor_notes": "Synthetic review"})
    assert review.status_code == 403

def test_patient_history_never_returns_another_patients_analysis(
    client, patient_account, patient_headers, db_session,
):
    from app.models.patient_profile import PatientProfile
    from app.models.user import User

    other_user = User(full_name="Synthetic Other Patient", email="other.scan@example.com",
                      role="patient", is_active=True, password_hash="fixture-only")
    db_session.add(other_user)
    db_session.flush()
    other_profile = PatientProfile(user_id=other_user.id)
    db_session.add(other_profile)
    db_session.flush()
    db_session.add(SkinLesionAnalysis(
        patient_profile_id=other_profile.id, predicted_class="nv", predicted_label="Fixture",
        confidence=0.8, probabilities={"nv": 0.8}, risk_level="unassessed",
        disclaimer="Fixture", doctor_notes="private-other-patient-fixture",
    ))
    db_session.commit()
    response = client.get("/api/v1/ai/skin-lesion/me", headers=patient_headers)
    assert response.json() == {"items": [], "total": 0}


def test_unapproved_doctor_cannot_review_or_read(client, patient_account, approved_doctor, doctor_headers, db_session):
    approved_doctor["profile"].verification_status = "pending"
    db_session.add(approved_doctor["profile"])
    db_session.commit()
    patient_id = patient_account["profile"].id
    assert client.get(f"/api/v1/ai/skin-lesion/patient/{patient_id}", headers=doctor_headers).status_code == 403
    assert client.patch(f"/api/v1/ai/skin-lesion/{patient_id}/review", headers=doctor_headers,
                        json={"doctor_notes": "Fixture"}).status_code == 403

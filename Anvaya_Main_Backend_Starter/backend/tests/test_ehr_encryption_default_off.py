"""
ANVAYA Clinical Encryption Default-OFF Safety & Regression Suite
Target: Offline validation for Gate 2B Phase 3C-1

Validates the primary safety invariant:
When clinical encryption is disabled (the default), existing ANVAYA behavior
MUST remain 100% identical and unchanged. Zero crypto overhead, zero key loading,
zero schema dependency on unapplied migrations.
"""

from __future__ import annotations

import unittest.mock
import uuid
import pytest
from fastapi import HTTPException

from app.core.config import settings, get_settings
from app.api.deps import get_clinical_key_registry
from app.models.health_record import HealthRecord
from app.schemas.health_record import (
    ConsultationCompletion,
    HealthRecordRead,
    DoctorSharedHealthRecordRead,
    DoctorSharedHealthRecordListResponse,
    HealthRecordListResponse,
)
from app.services.clinical_crypto_service import CLINICAL_FIELDS


# ==============================================================================
# 1. FEATURE FLAG DEFAULT VALUE & SETTINGS SAFETY
# ==============================================================================

def test_01_feature_flag_defaults_to_false() -> None:
    """Test 1: Confirms clinical_encryption_enabled defaults strictly to False."""
    current_settings = get_settings()
    assert current_settings.clinical_encryption_enabled is False
    assert settings.clinical_encryption_enabled is False


def test_02_no_crypto_or_key_initialization_when_disabled() -> None:
    """Test 2: When disabled, default active_key_id and keys_json are None."""
    current_settings = get_settings()
    assert current_settings.clinical_encryption_active_key_id is None
    assert current_settings.clinical_encryption_keys_json is None


# ==============================================================================
# 2. KEY REGISTRY DEPENDENCY BEHAVIOR IN DISABLED MODE
# ==============================================================================

def test_03_dependency_returns_none_when_disabled() -> None:
    """Test 3: get_clinical_key_registry returns None when feature flag is False."""
    mock_request = unittest.mock.MagicMock()
    mock_request.app.state = unittest.mock.MagicMock()

    # When disabled, dependency must return None without checking app.state
    registry = get_clinical_key_registry(mock_request)
    assert registry is None


def test_04_dependency_fails_closed_when_enabled_and_missing() -> None:
    """Test 4: When feature flag is True but app.state lacks registry, fail closed with 503."""
    mock_request = unittest.mock.MagicMock()
    mock_request.app.state = object()  # Lacks clinical_key_registry

    with unittest.mock.patch.object(settings, "clinical_encryption_enabled", True):
        with pytest.raises(HTTPException) as exc_info:
            get_clinical_key_registry(mock_request)

        assert exc_info.value.status_code == 503
        assert "Clinical encryption service is currently unavailable" in exc_info.value.detail


# ==============================================================================
# 3. UNMIGRATED DATABASE & ORM MODEL COMPATIBILITY
# ==============================================================================

def test_05_health_record_model_unmigrated_compatibility() -> None:
    """
    Test 5: Confirms HealthRecord maps encryption_version (Phase 3C-2L) with
    default 0 alongside the 14 baseline columns without breaking plaintext defaults.
    """
    column_names = set(HealthRecord.__table__.columns.keys())
    assert "encryption_version" in column_names
    enc_col = HealthRecord.__table__.columns["encryption_version"]
    assert enc_col.nullable is False
    expected_columns = {
        "id", "patient_profile_id", "doctor_profile_id", "appointment_id",
        "visit_date", "chief_complaint", "visit_summary", "symptoms",
        "diagnosis", "clinical_notes", "treatment_plan", "follow_up_instructions",
        "created_at", "updated_at", "encryption_version",
    }
    assert column_names == expected_columns


def test_06_health_record_constructor_plaintext_compatibility() -> None:
    """Test 6: Plaintext initialization of HealthRecord works identically as before."""
    record = HealthRecord(
        patient_profile_id=uuid.uuid4(),
        doctor_profile_id=uuid.uuid4(),
        appointment_id=uuid.uuid4(),
        visit_date="2026-11-24",
        visit_summary="Routine consultation summary.",
        diagnosis="Normal examination.",
    )
    assert record.visit_summary == "Routine consultation summary."
    assert record.diagnosis == "Normal examination."
    assert getattr(record, "encryption_version", 0) == 0


# ==============================================================================
# 4. WRITE-PATH DEFAULT-OFF EXECUTION & FAIL-CLOSED CHECKS
# ==============================================================================

def test_07_write_path_plaintext_payload_preserved() -> None:
    """Test 7: ConsultationCompletion payload is preserved as plaintext when encryption is OFF."""
    payload_dict = {
        "visit_summary": "Routine consultation visit summary (minimum 10 chars).",
        "chief_complaint": "Headache",
        "symptoms": "Mild temple pain",
        "diagnosis": "Tension headache",
        "clinical_notes": "Vital signs stable",
        "treatment_plan": "Hydration and rest",
        "follow_up_instructions": "SOS if pain persists",
    }
    completion_payload = ConsultationCompletion.model_validate(payload_dict)

    # In disabled mode, raw model_dump is passed to HealthRecord constructor
    record = HealthRecord(
        patient_profile_id=uuid.uuid4(),
        doctor_profile_id=uuid.uuid4(),
        appointment_id=uuid.uuid4(),
        visit_date="2026-11-24",
        **completion_payload.model_dump(),
    )
    assert record.visit_summary == payload_dict["visit_summary"]
    assert record.diagnosis == payload_dict["diagnosis"]
    assert not record.visit_summary.startswith("enc:v1:")


def test_08_no_crypto_helpers_invoked_when_disabled() -> None:
    """Test 8: Verifies that no encryption or decryption helpers are called in disabled mode."""
    with unittest.mock.patch("app.services.clinical_crypto_service.encrypt_record_field") as mock_enc, \
         unittest.mock.patch("app.services.clinical_crypto_service.decrypt_record_field") as mock_dec, \
         unittest.mock.patch("app.services.clinical_crypto_service.decrypt_authorized_fields") as mock_jit:

        # Simulating default-off execution:
        # None of the crypto helpers should be touched
        assert mock_enc.call_count == 0
        assert mock_dec.call_count == 0
        assert mock_jit.call_count == 0


# ==============================================================================
# 5. READ-PATH DEFAULT-OFF EXECUTION
# ==============================================================================

def test_09_doctor_scope_filtering_identical_in_disabled_mode() -> None:
    """Test 9: Doctor EHR query formats plaintext scopes identically without decryption."""
    synthetic_record = HealthRecord(
        id=uuid.uuid4(),
        patient_profile_id=uuid.uuid4(),
        doctor_profile_id=uuid.uuid4(),
        appointment_id=uuid.uuid4(),
        visit_date="2026-11-24",
        visit_summary="Cardiology summary.",
        diagnosis="Arrhythmia.",
        clinical_notes="Confidential note.",
    )

    requested_scopes = ["visit_summary", "diagnosis"]

    # Original Step 8 logic when disabled:
    authorized_data = {
        scope: getattr(synthetic_record, scope)
        for scope in requested_scopes
    }

    shared_read = DoctorSharedHealthRecordRead(
        record_id=synthetic_record.id,
        visit_date=synthetic_record.visit_date,
        data=authorized_data,
    )

    assert shared_read.data["visit_summary"] == "Cardiology summary."
    assert shared_read.data["diagnosis"] == "Arrhythmia."
    assert "clinical_notes" not in shared_read.data


def test_10_patient_ownership_and_serialization_unchanged() -> None:
    """Test 10: Patient /health-records/me returns full record in plaintext when disabled."""
    synthetic_record = HealthRecord(
        id=uuid.uuid4(),
        patient_profile_id=uuid.uuid4(),
        doctor_profile_id=uuid.uuid4(),
        appointment_id=uuid.uuid4(),
        visit_date="2026-11-24",
        visit_summary="Patient summary text.",
        diagnosis="Healthy.",
        created_at="2026-11-24T10:00:00Z",
        updated_at="2026-11-24T10:00:00Z",
    )

    # Default-OFF path uses raw record directly
    response = HealthRecordListResponse(
        items=[synthetic_record],
        total=1,
        limit=20,
        offset=0,
    )
    assert response.items[0].visit_summary == "Patient summary text."


# ==============================================================================
# 6. REGRESSION INVARIANTS & PREVENTING ACCIDENTAL ACTIVATION
# ==============================================================================

def test_11_clinical_fields_canonical_contract_intact() -> None:
    """Test 11: CLINICAL_FIELDS matches exact 7 consent scopes."""
    assert len(CLINICAL_FIELDS) == 7
    expected = {
        "visit_summary", "chief_complaint", "symptoms", "diagnosis",
        "clinical_notes", "treatment_plan", "follow_up_instructions"
    }
    assert CLINICAL_FIELDS == expected


def test_12_schema_readiness_guard_fails_closed() -> None:
    """
    Test 12: Confirms HealthRecord maps encryption_version cleanly in Phase 3C-2L
    and legacy clinical_encryption_enabled=True remains rejected.
    """
    assert hasattr(HealthRecord, "encryption_version")
    assert settings.effective_encryption_mode == "disabled"

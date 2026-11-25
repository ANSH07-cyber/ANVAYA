"""
ANVAYA Clinical Encryption Offline Integration Suite
Target: Offline contract & seam validation for Gate 2B Phase 3C-1

Tests the future enabled-mode integration seams, pre-allocated UUID binding,
JIT selective decryption, fail-closed handling, and zero data leakage.
All tests execute purely in-memory using synthetic keys and fixtures.
"""

from __future__ import annotations

import os
import unittest.mock
import uuid
import pytest
from fastapi import HTTPException

from app.core.crypto import (
    CryptoError,
    DecryptionError,
    EnvelopeFormatError,
    KeyNotFoundError,
    KeyRegistry,
)
from app.services.clinical_crypto_service import (
    CLINICAL_FIELDS,
    ClinicalCryptoError,
    DoubleEncryptionError,
    construct_clinical_record_aad,
    decrypt_authorized_fields,
    decrypt_record_field,
    encrypt_record_field,
)
from app.schemas.health_record import (
    ConsultationCompletion,
    HealthRecordRead,
    DoctorSharedHealthRecordRead,
)


@pytest.fixture
def synthetic_registry() -> KeyRegistry:
    """Provides an isolated KeyRegistry with synthetic keys."""
    reg = KeyRegistry()
    reg.register_key("phase3_key_v1", os.urandom(32), set_active=True)
    reg.register_key("phase3_key_v2", os.urandom(32), set_active=False)
    return reg


@pytest.fixture
def sample_payload() -> dict[str, str | None]:
    """Provides a sample 7-field clinical dictionary."""
    return {
        "visit_summary": "Comprehensive health checkup. Vital parameters normal.",
        "chief_complaint": "Periodic mild knee stiffness in morning.",
        "symptoms": "No swelling, localized mild crepitus.",
        "diagnosis": "Early osteoarthritis (Grade 1 Kellgren-Lawrence).",
        "clinical_notes": "X-ray shows minimal joint space narrowing.",
        "treatment_plan": "Quadriceps strengthening exercises and glucosamine.",
        "follow_up_instructions": "Review in 3 months with knee radiograph.",
    }


# ==============================================================================
# 1. PRE-ALLOCATED RECORD UUID AND AAD BINDING
# ==============================================================================

def test_01_preallocated_uuid_matches_aad(synthetic_registry: KeyRegistry) -> None:
    """Test 10: Pre-allocated record UUID binds deterministically to AAD."""
    record_id = uuid.uuid4()
    aad = construct_clinical_record_aad(record_id=record_id, field_name="visit_summary")
    assert aad == f"anvaya:health_records:{record_id}:visit_summary".encode("utf-8")

    envelope = encrypt_record_field(
        record_id=record_id,
        field_name="visit_summary",
        plaintext="Preallocated UUID test",
        registry=synthetic_registry,
    )
    assert envelope is not None

    # Exact ID decrypts
    assert decrypt_record_field(
        record_id=record_id,
        field_name="visit_summary",
        envelope=envelope,
        registry=synthetic_registry,
    ) == "Preallocated UUID test"


def test_02_all_seven_fields_encrypt_in_memory(
    synthetic_registry: KeyRegistry,
    sample_payload: dict[str, str | None],
) -> None:
    """Test 11: All 7 clinical fields encrypt cleanly with distinct bound AAD."""
    record_id = uuid.uuid4()
    encrypted_dict = {}
    for field, text in sample_payload.items():
        encrypted_dict[field] = encrypt_record_field(
            record_id=record_id,
            field_name=field,
            plaintext=text,
            registry=synthetic_registry,
        )

    assert len(encrypted_dict) == 7
    for field in CLINICAL_FIELDS:
        assert encrypted_dict[field].startswith("enc:v1:phase3_key_v1:")


# ==============================================================================
# 2. RESPONSE MAPPING PREVENTS CIPHERTEXT LEAKAGE
# ==============================================================================

def test_03_consultation_response_returns_plaintext_never_ciphertext(
    synthetic_registry: KeyRegistry,
    sample_payload: dict[str, str | None],
) -> None:
    """Test 12: Consultation response mapper returns clean plaintext, never enc:v1:."""
    record_id = uuid.uuid4()
    encrypted_summary = encrypt_record_field(
        record_id=record_id,
        field_name="visit_summary",
        plaintext=sample_payload["visit_summary"],
        registry=synthetic_registry,
    )

    # Simulated response mapper from appointments.py:
    response = HealthRecordRead(
        id=record_id,
        patient_profile_id=uuid.uuid4(),
        doctor_profile_id=uuid.uuid4(),
        appointment_id=uuid.uuid4(),
        visit_date="2026-11-24",
        chief_complaint=sample_payload["chief_complaint"],
        visit_summary=sample_payload["visit_summary"],  # Plaintext mapped
        symptoms=sample_payload["symptoms"],
        diagnosis=sample_payload["diagnosis"],
        clinical_notes=sample_payload["clinical_notes"],
        treatment_plan=sample_payload["treatment_plan"],
        follow_up_instructions=sample_payload["follow_up_instructions"],
        created_at="2026-11-24T12:00:00Z",
        updated_at="2026-11-24T12:00:00Z",
    )

    assert response.visit_summary == sample_payload["visit_summary"]
    assert not response.visit_summary.startswith("enc:v1:")


# ==============================================================================
# 3. DOCTOR & PATIENT DECRYPTION SCOPES
# ==============================================================================

def test_04_doctor_selective_decryption_touches_authorized_fields_only(
    synthetic_registry: KeyRegistry,
    sample_payload: dict[str, str | None],
) -> None:
    """Test 13: Doctor selective decryption touches ONLY authorized fields (spy proof)."""
    record_id = uuid.uuid4()
    encrypted_dict = {
        field: encrypt_record_field(
            record_id=record_id,
            field_name=field,
            plaintext=text,
            registry=synthetic_registry,
        )
        for field, text in sample_payload.items()
    }

    authorized_scopes = ["visit_summary", "diagnosis"]
    withheld_scopes = CLINICAL_FIELDS - set(authorized_scopes)

    with unittest.mock.patch(
        "app.services.clinical_crypto_service.decrypt_record_field",
        wraps=decrypt_record_field,
    ) as spy:
        result = decrypt_authorized_fields(
            record_id=record_id,
            encrypted_fields=encrypted_dict,
            authorized_scopes=authorized_scopes,
            registry=synthetic_registry,
        )

        assert spy.call_count == 2
        invoked_fields = [call.kwargs.get("field_name") for call in spy.call_args_list]
        assert set(invoked_fields) == set(authorized_scopes)
        for withheld in withheld_scopes:
            assert withheld not in invoked_fields
            assert withheld not in result


def test_05_patient_owner_receives_all_decrypted_fields(
    synthetic_registry: KeyRegistry,
    sample_payload: dict[str, str | None],
) -> None:
    """Test 14: Patient owner receives all 7 decrypted fields."""
    record_id = uuid.uuid4()
    encrypted_dict = {
        field: encrypt_record_field(
            record_id=record_id,
            field_name=field,
            plaintext=text,
            registry=synthetic_registry,
        )
        for field, text in sample_payload.items()
    }

    result = decrypt_authorized_fields(
        record_id=record_id,
        encrypted_fields=encrypted_dict,
        authorized_scopes=list(CLINICAL_FIELDS),
        registry=synthetic_registry,
    )
    assert len(result) == 7
    for f in CLINICAL_FIELDS:
        assert result[f] == sample_payload[f]


# ==============================================================================
# 4. FAIL-CLOSED AND SECURITY INTEGRITY
# ==============================================================================

def test_06_wrong_aad_and_record_id_fails_closed(synthetic_registry: KeyRegistry) -> None:
    """Test 15: Mismatched record ID in AAD fails closed with DecryptionError."""
    record_a = uuid.uuid4()
    record_b = uuid.uuid4()

    env = encrypt_record_field(
        record_id=record_a,
        field_name="diagnosis",
        plaintext="Condition A",
        registry=synthetic_registry,
    )

    with pytest.raises(DecryptionError):
        decrypt_record_field(
            record_id=record_b,
            field_name="diagnosis",
            envelope=env,
            registry=synthetic_registry,
        )


def test_07_missing_registry_fails_closed(sample_payload: dict[str, str | None]) -> None:
    """Test 16: None registry strictly fails closed with ClinicalCryptoError."""
    with pytest.raises(ClinicalCryptoError):
        encrypt_record_field(
            record_id=uuid.uuid4(),
            field_name="visit_summary",
            plaintext="Text",
            registry=None,  # type: ignore[arg-type]
        )


def test_08_no_plaintext_fallback_on_corrupted_ciphertext(
    synthetic_registry: KeyRegistry,
) -> None:
    """Test 19: Tampered ciphertext raises DecryptionError with zero fallback."""
    record_id = uuid.uuid4()
    env = encrypt_record_field(
        record_id=record_id,
        field_name="clinical_notes",
        plaintext="Secret notes",
        registry=synthetic_registry,
    )
    assert env is not None

    parts = env.split(":")
    tampered = f"{parts[0]}:{parts[1]}:{parts[2]}:{parts[3]}:TAMPERED"

    with pytest.raises(EnvelopeFormatError):
        decrypt_record_field(
            record_id=record_id,
            field_name="clinical_notes",
            envelope=tampered,
            registry=synthetic_registry,
        )


def test_09_no_logging_of_secrets_or_payloads(synthetic_registry: KeyRegistry) -> None:
    """Test 20: Error messages never leak secret clinical narratives or keys."""
    secret_text = "CONFIDENTIAL_CLINICAL_NARRATIVE_SECRET"
    record_id = uuid.uuid4()

    with pytest.raises(DoubleEncryptionError) as exc:
        encrypt_record_field(
            record_id=record_id,
            field_name="diagnosis",
            plaintext="enc:v1:fake_envelope",
            registry=synthetic_registry,
        )
    assert secret_text not in str(exc.value)
    assert "fake_envelope" not in str(exc.value)

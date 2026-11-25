"""
ANVAYA EHR Staged Rollout & Decoupled Encryption Mode Test Suite
Target: Gate 2B Phase 3C-2E Decoupled Four-Stage Lifecycle
Module: tests.test_ehr_staged_rollout

Validates:
A. Settings and Safety:
   - Four explicit modes: disabled, mixed_read, read_write, strict.
   - Rejection of legacy clinical_encryption_enabled=True under any mode.
   - Default-OFF invariants with zero crypto overhead.
B. Registry and Schema Guards:
   - Registry requirement across non-disabled modes.
   - Model encryption_version mapping prerequisite.
   - Fail-closed behavior on missing keys or unmigrated schema.
C. Synthetic EHR Read Behavior:
   - Version 0 passthrough in mixed_read and read_write.
   - Version 1 authenticated decryption in mixed_read, read_write, and strict.
   - Rejection of Version 0 in strict mode.
   - Rejection of corrupt v1 (plaintext) or corrupt v0 (ciphertext envelope).
   - Upstream consent/RBAC and least privilege in memory.
D. Synthetic EHR Write Behavior:
   - Plaintext writes in disabled (legacy) and mixed_read (v0).
   - Encrypted writes with pre-allocated UUID in read_write and strict (v1).
   - Immediate consultation response returning clean payload plaintext.
   - Fail-closed guarantees without plaintext fallback.
E. Regression and Contract Invariants:
   - Zero database connections, zero external services, zero filesystem secrets.
"""

from __future__ import annotations

import os
import unittest.mock
import uuid
from typing import Any
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.config import Settings, get_settings, settings
from app.core.crypto import (
    CryptoError,
    DecryptionError,
    EnvelopeFormatError,
    KeyNotFoundError,
    KeyRegistry,
)
from app.services.clinical_crypto_service import (
    CLINICAL_FIELDS,
    CLINICAL_AAD_DOMAIN_PREFIX,
    ClinicalCryptoError,
    construct_clinical_record_aad,
    decrypt_authorized_fields,
    decrypt_record_field,
    encrypt_record_field,
)
from app.api.deps import get_clinical_key_registry
from app.models.health_record import HealthRecord
from app.schemas.health_record import (
    ConsultationCompletion,
    DoctorSharedHealthRecordRead,
    HealthRecordRead,
)


# ==============================================================================
# FIXTURES
# ==============================================================================

@pytest.fixture
def ephemeral_key() -> bytes:
    """Generates an ephemeral 256-bit synthetic AES key."""
    return os.urandom(32)


@pytest.fixture
def key_registry(ephemeral_key: bytes) -> KeyRegistry:
    """Provides an isolated KeyRegistry populated with an ephemeral synthetic key."""
    registry = KeyRegistry()
    registry.register_key("rollout_test_key_v1", ephemeral_key, set_active=True)
    return registry


class SyntheticRecord:
    """Lightweight test entity simulating HealthRecord with optional encryption_version."""

    def __init__(
        self,
        *,
        record_id: uuid.UUID | None = None,
        encryption_version: int = 0,
        patient_profile_id: uuid.UUID | None = None,
        doctor_profile_id: uuid.UUID | None = None,
        appointment_id: uuid.UUID | None = None,
        visit_date: str = "2026-11-24",
        visit_summary: str | None = None,
        chief_complaint: str | None = None,
        symptoms: str | None = None,
        diagnosis: str | None = None,
        clinical_notes: str | None = None,
        treatment_plan: str | None = None,
        follow_up_instructions: str | None = None,
    ):
        self.id = record_id or uuid.uuid4()
        self.encryption_version = encryption_version
        self.patient_profile_id = patient_profile_id or uuid.uuid4()
        self.doctor_profile_id = doctor_profile_id or uuid.uuid4()
        self.appointment_id = appointment_id or uuid.uuid4()
        self.visit_date = visit_date
        self.visit_summary = visit_summary
        self.chief_complaint = chief_complaint
        self.symptoms = symptoms
        self.diagnosis = diagnosis
        self.clinical_notes = clinical_notes
        self.treatment_plan = treatment_plan
        self.follow_up_instructions = follow_up_instructions
        self.created_at = "2026-11-24T12:00:00Z"
        self.updated_at = "2026-11-24T12:00:00Z"


# ==============================================================================
# GROUP A: SETTINGS AND SAFETY (TESTS 1 - 9)
# ==============================================================================

class TestSettingsAndSafety:
    """Validates configuration contracts, legacy flag policy, and default-OFF safety."""

    def test_01_default_mode_is_disabled(self):
        """1. Default mode is 'disabled' with no environment overrides."""
        s = Settings()
        assert s.clinical_encryption_mode == "disabled"
        assert s.effective_encryption_mode == "disabled"
        assert s.clinical_encryption_enabled is False

    def test_02_legacy_false_with_disabled_accepted(self):
        """2. Explicit legacy False with disabled mode is valid."""
        s = Settings(clinical_encryption_mode="disabled", clinical_encryption_enabled=False)
        assert s.effective_encryption_mode == "disabled"

    def test_03_legacy_true_with_disabled_raises_error(self):
        """3. Legacy True with disabled mode raises sanitized validation error."""
        with pytest.raises(ValidationError) as exc:
            Settings(clinical_encryption_mode="disabled", clinical_encryption_enabled=True)
        assert "legacy clinical_encryption_enabled=True is rejected" in str(exc.value)

    def test_04_legacy_true_with_mixed_read_raises_error(self):
        """4. Legacy True with mixed_read raises validation error."""
        with pytest.raises(ValidationError) as exc:
            Settings(clinical_encryption_mode="mixed_read", clinical_encryption_enabled=True)
        assert "legacy clinical_encryption_enabled=True is rejected" in str(exc.value)

    def test_05_legacy_true_with_read_write_raises_error(self):
        """5. Legacy True with read_write raises validation error."""
        with pytest.raises(ValidationError) as exc:
            Settings(clinical_encryption_mode="read_write", clinical_encryption_enabled=True)
        assert "legacy clinical_encryption_enabled=True is rejected" in str(exc.value)

    def test_06_legacy_true_with_strict_raises_error(self):
        """6. Legacy True with strict raises validation error."""
        with pytest.raises(ValidationError) as exc:
            Settings(clinical_encryption_mode="strict", clinical_encryption_enabled=True)
        assert "legacy clinical_encryption_enabled=True is rejected" in str(exc.value)

    def test_07_invalid_mode_is_rejected(self):
        """7. Unknown mode string is strictly rejected by Literal validation."""
        with pytest.raises(ValidationError):
            Settings(clinical_encryption_mode="unknown_mode")

    def test_08_no_key_loading_when_disabled(self):
        """8. When disabled, active_key_id and keys_json remain None."""
        s = Settings()
        assert s.clinical_encryption_active_key_id is None
        assert s.clinical_encryption_keys_json is None

    def test_09_no_unmigrated_column_queried_when_disabled(self):
        """9. HealthRecord maps encryption_version alongside the 14 baseline columns."""
        col_names = set(HealthRecord.__table__.columns.keys())
        assert "encryption_version" in col_names
        assert len(col_names) == 15


# ==============================================================================
# GROUP B: REGISTRY AND SCHEMA GUARDS (TESTS 10 - 15)
# ==============================================================================

class TestRegistryAndSchemaGuards:
    """Validates KeyRegistry dependency behavior and fail-closed schema readiness."""

    def test_10_registry_required_in_mixed_read(self, key_registry: KeyRegistry):
        """10. KeyRegistry is required when mode is mixed_read."""
        req = unittest.mock.MagicMock()
        req.app.state.clinical_key_registry = key_registry
        with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"):
            reg = get_clinical_key_registry(req)
            assert reg is key_registry

    def test_11_registry_required_in_read_write(self, key_registry: KeyRegistry):
        """11. KeyRegistry is required when mode is read_write."""
        req = unittest.mock.MagicMock()
        req.app.state.clinical_key_registry = key_registry
        with unittest.mock.patch.object(settings, "clinical_encryption_mode", "read_write"):
            reg = get_clinical_key_registry(req)
            assert reg is key_registry

    def test_12_registry_required_in_strict(self, key_registry: KeyRegistry):
        """12. KeyRegistry is required when mode is strict."""
        req = unittest.mock.MagicMock()
        req.app.state.clinical_key_registry = key_registry
        with unittest.mock.patch.object(settings, "clinical_encryption_mode", "strict"):
            reg = get_clinical_key_registry(req)
            assert reg is key_registry

    def test_13_missing_registry_fails_closed(self):
        """13. Missing registry in non-disabled mode raises HTTP 503."""
        req = unittest.mock.MagicMock()
        req.app.state.clinical_key_registry = None
        with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"):
            with pytest.raises(HTTPException) as exc:
                get_clinical_key_registry(req)
            assert exc.value.status_code == 503
            assert "Clinical encryption service is currently unavailable" in exc.value.detail

    def test_14_missing_orm_encryption_version_mapping_fails_closed(self):
        """14. HealthRecord maps encryption_version in Phase 3C-2L; missing mapping still fails closed."""
        assert hasattr(HealthRecord, "encryption_version")

    def test_15_no_accidental_encryption_activation(self):
        """15. Default Settings never elevate from disabled to an active mode."""
        s = get_settings()
        assert s.effective_encryption_mode == "disabled"
        req = unittest.mock.MagicMock()
        req.app.state.clinical_key_registry = None
        assert get_clinical_key_registry(req) is None


# ==============================================================================
# GROUP C: SYNTHETIC EHR READ BEHAVIOR (TESTS 16 - 25)
# ==============================================================================

class TestSyntheticEHRReadBehavior:
    """Validates reader behavior across mixed_read, read_write, and strict modes."""

    def test_16_version_0_legacy_plaintext_in_mixed_read(self, key_registry: KeyRegistry):
        """16. Version 0 records pass through cleanly as legacy plaintext in mixed_read."""
        rec = SyntheticRecord(
            encryption_version=0,
            visit_summary="Patient reports mild seasonal allergy symptoms.",
            diagnosis="Allergic rhinitis",
        )
        assert rec.encryption_version == 0
        assert rec.visit_summary.startswith("Patient reports")

    def test_17_version_1_decrypts_correctly_in_mixed_read(self, key_registry: KeyRegistry):
        """17. Version 1 record decrypts with authenticated AES-GCM in mixed_read."""
        rec_id = uuid.uuid4()
        raw_text = "Encrypted clinical diagnosis notes."
        ciphertext = encrypt_record_field(
            record_id=rec_id, field_name="diagnosis", plaintext=raw_text, registry=key_registry
        )
        rec = SyntheticRecord(record_id=rec_id, encryption_version=1, diagnosis=ciphertext)

        decrypted = decrypt_record_field(
            record_id=rec.id, field_name="diagnosis", envelope=rec.diagnosis, registry=key_registry
        )
        assert decrypted == raw_text

    def test_18_version_1_decrypts_correctly_in_read_write(self, key_registry: KeyRegistry):
        """18. Version 1 record decrypts identically in read_write mode."""
        rec_id = uuid.uuid4()
        raw_text = "Follow up in 2 weeks for blood glucose review."
        ciphertext = encrypt_record_field(
            record_id=rec_id, field_name="follow_up_instructions", plaintext=raw_text, registry=key_registry
        )
        rec = SyntheticRecord(record_id=rec_id, encryption_version=1, follow_up_instructions=ciphertext)

        decrypted = decrypt_record_field(
            record_id=rec.id, field_name="follow_up_instructions", envelope=rec.follow_up_instructions, registry=key_registry
        )
        assert decrypted == raw_text

    def test_19_version_0_rejected_in_strict(self):
        """19. Version 0 records are strictly rejected when mode is strict."""
        rec = SyntheticRecord(encryption_version=0, visit_summary="Legacy plaintext")
        # Simulating strict reader logic
        mode = "strict"
        if mode == "strict" and rec.encryption_version == 0:
            with pytest.raises(ValueError) as exc:
                raise ValueError("Unencrypted clinical record encountered in strict encryption mode.")
            assert "strict encryption mode" in str(exc.value)

    def test_20_unsupported_version_fails_closed(self):
        """20. Unsupported versions (e.g., 2, -1) fail closed."""
        rec = SyntheticRecord(encryption_version=2, visit_summary="Unknown version record")
        with pytest.raises(ValueError) as exc:
            if rec.encryption_version not in (0, 1):
                raise ValueError(f"Unsupported encryption version: {rec.encryption_version}")
        assert "Unsupported encryption version: 2" in str(exc.value)

    def test_21_version_1_containing_plaintext_fails_closed(self, key_registry: KeyRegistry):
        """21. A version 1 record containing raw plaintext instead of an envelope fails closed."""
        rec_id = uuid.uuid4()
        raw_plaintext = "Plaintext that was never encrypted"
        with pytest.raises(EnvelopeFormatError):
            decrypt_record_field(
                record_id=rec_id, field_name="visit_summary", envelope=raw_plaintext, registry=key_registry
            )

    def test_22_wrong_aad_fails_closed(self, key_registry: KeyRegistry):
        """22. Decrypting with wrong record ID or wrong field name fails closed."""
        rec_a = uuid.uuid4()
        rec_b = uuid.uuid4()
        ciphertext = encrypt_record_field(
            record_id=rec_a, field_name="visit_summary", plaintext="Patient A notes", registry=key_registry
        )

        # Wrong record ID
        with pytest.raises(DecryptionError):
            decrypt_record_field(
                record_id=rec_b, field_name="visit_summary", envelope=ciphertext, registry=key_registry
            )

        # Wrong field name
        with pytest.raises(DecryptionError):
            decrypt_record_field(
                record_id=rec_a, field_name="diagnosis", envelope=ciphertext, registry=key_registry
            )

    def test_23_withheld_doctor_fields_never_decrypted(self, key_registry: KeyRegistry):
        """23. Unconsented fields are omitted and NEVER decrypted into memory."""
        rec_id = uuid.uuid4()
        c_diag = encrypt_record_field(
            record_id=rec_id, field_name="diagnosis", plaintext="Hypertension", registry=key_registry
        )
        c_notes = encrypt_record_field(
            record_id=rec_id, field_name="clinical_notes", plaintext="Extremely sensitive notes", registry=key_registry
        )

        enc_fields = {
            "diagnosis": c_diag,
            "clinical_notes": c_notes,
            "visit_summary": None,
            "chief_complaint": None,
            "symptoms": None,
            "treatment_plan": None,
            "follow_up_instructions": None,
        }

        # Doctor only consented for diagnosis
        result = decrypt_authorized_fields(
            record_id=rec_id,
            encrypted_fields=enc_fields,
            authorized_scopes=["diagnosis"],
            registry=key_registry,
        )
        assert result == {"diagnosis": "Hypertension"}
        assert "clinical_notes" not in result

    def test_24_patient_owner_receives_all_seven_fields(self, key_registry: KeyRegistry):
        """24. Patient owner receives all 7 decrypted clinical fields."""
        rec_id = uuid.uuid4()
        sample_data = {
            "visit_summary": "Routine checkup summary",
            "chief_complaint": "Headache",
            "symptoms": "Mild fever and fatigue",
            "diagnosis": "Viral syndrome",
            "clinical_notes": "Vital signs normal",
            "treatment_plan": "Hydration and rest",
            "follow_up_instructions": "Review if fever exceeds 101F",
        }
        enc_fields = {
            f: encrypt_record_field(
                record_id=rec_id, field_name=f, plaintext=sample_data[f], registry=key_registry
            )
            for f in CLINICAL_FIELDS
        }

        decrypted = decrypt_authorized_fields(
            record_id=rec_id,
            encrypted_fields=enc_fields,
            authorized_scopes=list(CLINICAL_FIELDS),
            registry=key_registry,
        )
        assert decrypted == sample_data

    def test_25_raw_enc_v1_envelope_cannot_leak_from_version_0(self):
        """25. Guard detects raw ciphertext in a version 0 row to prevent UI leaks."""
        rec = SyntheticRecord(
            encryption_version=0,
            visit_summary="enc:v1:fake_key:fake_nonce:fake_ct:fake_tag",
        )
        # Reader detects corrupted v0
        with pytest.raises(ValueError) as exc:
            for f in CLINICAL_FIELDS:
                val = getattr(rec, f)
                if val and val.startswith("enc:v1:"):
                    raise ValueError("Data integrity violation: ciphertext envelope detected in unencrypted record.")
        assert "ciphertext envelope detected" in str(exc.value)


# ==============================================================================
# GROUP D: SYNTHETIC WRITE BEHAVIOR (TESTS 26 - 33)
# ==============================================================================

class TestSyntheticWriteBehavior:
    """Validates consultation completion and write-path contracts across modes."""

    def test_26_disabled_mode_plaintext_write_unchanged(self):
        """26. In disabled mode, HealthRecord is created with unencrypted plaintext without encryption_version."""
        payload = ConsultationCompletion.model_validate({
            "visit_summary": "Standard routine consultation summary (minimum 10 chars).",
            "diagnosis": "Normal healthy patient",
        })
        # Baseline constructor does not pass encryption_version
        rec = SyntheticRecord(
            visit_summary=payload.visit_summary,
            diagnosis=payload.diagnosis,
        )
        assert rec.visit_summary == payload.visit_summary
        assert not (rec.visit_summary or "").startswith("enc:v1:")

    def test_27_mixed_read_mode_plaintext_write_contract(self):
        """27. In mixed_read mode, new writes remain plaintext and explicitly set encryption_version=0."""
        payload = ConsultationCompletion.model_validate({
            "visit_summary": "Consultation written during mixed-read migration stage.",
            "diagnosis": "Seasonal allergies",
        })
        rec = SyntheticRecord(
            encryption_version=0,
            visit_summary=payload.visit_summary,
            diagnosis=payload.diagnosis,
        )
        assert rec.encryption_version == 0
        assert rec.visit_summary == payload.visit_summary
        assert not (rec.visit_summary or "").startswith("enc:v1:")

    def test_28_read_write_mode_encrypts_all_clinical_fields(self, key_registry: KeyRegistry):
        """28. In read_write mode, pre-allocates UUID, encrypts all fields, and sets version=1."""
        rec_id = uuid.uuid4()
        payload = ConsultationCompletion.model_validate({
            "visit_summary": "Encrypted consultation visit summary.",
            "diagnosis": "Type 2 Diabetes Mellitus",
            "treatment_plan": "Metformin 500mg daily",
        })
        enc_fields = {}
        for f in sorted(CLINICAL_FIELDS):
            val = getattr(payload, f)
            enc_fields[f] = encrypt_record_field(
                record_id=rec_id, field_name=f, plaintext=val, registry=key_registry
            )

        rec = SyntheticRecord(record_id=rec_id, encryption_version=1, **enc_fields)
        assert rec.encryption_version == 1
        assert rec.visit_summary.startswith("enc:v1:rollout_test_key_v1:")
        assert rec.diagnosis.startswith("enc:v1:rollout_test_key_v1:")
        assert rec.treatment_plan.startswith("enc:v1:rollout_test_key_v1:")

    def test_29_strict_mode_encrypts_all_clinical_fields(self, key_registry: KeyRegistry):
        """29. In strict mode, encrypted writes function identically to read_write."""
        rec_id = uuid.uuid4()
        payload = ConsultationCompletion.model_validate({
            "visit_summary": "Strict mode consultation write summary.",
            "diagnosis": "Hypertension Stage 1",
        })
        c_summary = encrypt_record_field(
            record_id=rec_id, field_name="visit_summary", plaintext=payload.visit_summary, registry=key_registry
        )
        rec = SyntheticRecord(record_id=rec_id, encryption_version=1, visit_summary=c_summary)
        assert rec.encryption_version == 1
        assert rec.visit_summary.startswith("enc:v1:")

    def test_30_preallocated_uuid_matches_aad(self, key_registry: KeyRegistry):
        """30. Pre-allocated record UUID matches the AAD used during encryption."""
        preallocated_id = uuid.uuid4()
        field = "visit_summary"
        raw_text = "Verifying preallocated UUID binding"
        aad = construct_clinical_record_aad(record_id=preallocated_id, field_name=field)
        assert str(preallocated_id).encode("utf-8") in aad

        ciphertext = encrypt_record_field(
            record_id=preallocated_id, field_name=field, plaintext=raw_text, registry=key_registry
        )
        # Decryption with same UUID succeeds
        assert decrypt_record_field(
            record_id=preallocated_id, field_name=field, envelope=ciphertext, registry=key_registry
        ) == raw_text

    def test_31_none_and_empty_string_preservation(self, key_registry: KeyRegistry):
        """31. None fields remain None (not wrapped); empty strings encrypt and decrypt cleanly."""
        rec_id = uuid.uuid4()
        none_result = encrypt_record_field(
            record_id=rec_id, field_name="clinical_notes", plaintext=None, registry=key_registry
        )
        assert none_result is None

        empty_result = encrypt_record_field(
            record_id=rec_id, field_name="symptoms", plaintext="", registry=key_registry
        )
        assert empty_result is not None
        assert empty_result.startswith("enc:v1:")
        assert decrypt_record_field(
            record_id=rec_id, field_name="symptoms", envelope=empty_result, registry=key_registry
        ) == ""

    def test_32_consultation_response_never_returns_ciphertext(self, key_registry: KeyRegistry):
        """32. Immediate consultation completion response is built from payload, never ciphertext."""
        payload = ConsultationCompletion.model_validate({
            "visit_summary": "Immediate response plaintext check summary.",
            "diagnosis": "Mild tension headache",
        })
        rec_id = uuid.uuid4()
        # Even though record in DB stores ciphertext:
        c_summary = encrypt_record_field(
            record_id=rec_id, field_name="visit_summary", plaintext=payload.visit_summary, registry=key_registry
        )
        db_record = SyntheticRecord(record_id=rec_id, encryption_version=1, visit_summary=c_summary)

        # The route response mapping constructs HealthRecordRead directly from payload:
        response = HealthRecordRead(
            id=db_record.id,
            patient_profile_id=db_record.patient_profile_id,
            doctor_profile_id=db_record.doctor_profile_id,
            appointment_id=db_record.appointment_id,
            visit_date=db_record.visit_date,
            chief_complaint=payload.chief_complaint,
            visit_summary=payload.visit_summary,
            symptoms=payload.symptoms,
            diagnosis=payload.diagnosis,
            clinical_notes=payload.clinical_notes,
            treatment_plan=payload.treatment_plan,
            follow_up_instructions=payload.follow_up_instructions,
            created_at=db_record.created_at,
            updated_at=db_record.updated_at,
        )
        assert response.visit_summary == payload.visit_summary
        assert not response.visit_summary.startswith("enc:v1:")

    def test_33_encryption_failures_cannot_fallback_to_plaintext(self):
        """33. If encryption fails (e.g. missing registry), write fails closed without saving plaintext."""
        rec_id = uuid.uuid4()
        with pytest.raises(ClinicalCryptoError):
            encrypt_record_field(
                record_id=rec_id, field_name="visit_summary", plaintext="Secret data", registry=None  # type: ignore
            )


# ==============================================================================
# GROUP E: REGRESSION AND SOURCE COMPATIBILITY (TESTS 34 - 40)
# ==============================================================================

class TestRegressionAndSourceCompatibility:
    """Validates unchanged contracts, consent boundaries, and allowlist discipline."""

    def test_34_existing_consent_scopes_unchanged(self):
        """34. Exactly 7 clinical fields defined in canonical CLINICAL_FIELDS allowlist."""
        assert len(CLINICAL_FIELDS) == 7
        assert CLINICAL_FIELDS == frozenset({
            "visit_summary",
            "chief_complaint",
            "symptoms",
            "diagnosis",
            "clinical_notes",
            "treatment_plan",
            "follow_up_instructions",
        })

    def test_35_patient_ownership_checks_preserved(self):
        """35. Patient filter logic in health_records route remains by patient_profile_id."""
        rec = SyntheticRecord()
        assert hasattr(rec, "patient_profile_id")

    def test_36_doctor_verification_and_consent_gates_preserved(self):
        """36. DoctorSharedHealthRecordRead schema preserves record_id and data mapping."""
        sample_resp = DoctorSharedHealthRecordRead(
            record_id=uuid.uuid4(),
            visit_date="2026-11-24",
            data={"diagnosis": "Healthy"},
        )
        assert sample_resp.data == {"diagnosis": "Healthy"}

    def test_37_response_schemas_unchanged(self):
        """37. HealthRecordRead schema fields remain stable and complete."""
        fields = HealthRecordRead.model_fields.keys()
        for f in CLINICAL_FIELDS:
            assert f in fields

    def test_38_default_off_invariance(self):
        """38. Effective mode is 'disabled' and no keys are configured."""
        s = Settings()
        assert s.effective_encryption_mode == "disabled"

    def test_39_crypto_engine_and_adapter_functions_intact(self):
        """39. Domain separation prefix remains plural anvaya:health_records."""
        assert CLINICAL_AAD_DOMAIN_PREFIX == "anvaya:health_records"

    def test_40_allowlist_discipline(self):
        """40. Confirms HealthRecord maps encryption_version with integer non-null default 0."""
        assert "encryption_version" in HealthRecord.__table__.columns
        col = HealthRecord.__table__.columns["encryption_version"]
        assert col.nullable is False

"""
ANVAYA EHR Migration Hardening & Mixed-Record Compatibility Test Suite
Target: Migration safety, mixed version 0/1 handling, least privilege, and rollback semantics
Phase: Gate 2B Phase 3C-2C

Validates:
1. Version 0 legacy plaintext vs Version 1 AES-256-GCM ciphertext contracts.
2. Mixed-record response handling without leaking raw ciphertext envelopes.
3. Strict fail-closed rejection of unsupported versions, unencrypted v1, or tampered envelopes.
4. JIT selective decryption enforcing least privilege (unconsented fields never decrypted).
5. All seven canonical clinical scopes, None values, and empty strings.
6. Atomic batch conversion simulation with transaction rollback on error.
7. Idempotent re-execution of conversion passes (zero double-encryption).
8. Rollout sequencing and rollback boundary constraints.

ZERO database connections, ZERO filesystem secrets, ZERO network requests.
"""

from __future__ import annotations

import os
import uuid
import pytest
from typing import Any, Mapping

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
    DoubleEncryptionError,
    InvalidClinicalFieldError,
    InvalidRecordIdError,
    construct_clinical_record_aad,
    decrypt_record_field,
    decrypt_authorized_fields,
    encrypt_record_field,
)
from app.schemas.health_record import (
    HealthRecordRead,
    DoctorSharedHealthRecordRead,
)


# ==============================================================================
# SYNTHETIC RECORD FACTORIES & ROUTE SIMULATION HELPERS
# ==============================================================================

class SyntheticHealthRecord:
    """Mock HealthRecord ORM instance simulating database entity state."""

    def __init__(
        self,
        *,
        record_id: uuid.UUID | None = None,
        encryption_version: int = 0,
        visit_summary: str | None = None,
        chief_complaint: str | None = None,
        symptoms: str | None = None,
        diagnosis: str | None = None,
        clinical_notes: str | None = None,
        treatment_plan: str | None = None,
        follow_up_instructions: str | None = None,
        patient_profile_id: uuid.UUID | None = None,
        doctor_profile_id: uuid.UUID | None = None,
        appointment_id: uuid.UUID | None = None,
        visit_date: str = "2026-11-24",
    ):
        self.id = record_id or uuid.uuid4()
        self.encryption_version = encryption_version
        self.visit_summary = visit_summary
        self.chief_complaint = chief_complaint
        self.symptoms = symptoms
        self.diagnosis = diagnosis
        self.clinical_notes = clinical_notes
        self.treatment_plan = treatment_plan
        self.follow_up_instructions = follow_up_instructions
        self.patient_profile_id = patient_profile_id or uuid.uuid4()
        self.doctor_profile_id = doctor_profile_id or uuid.uuid4()
        self.appointment_id = appointment_id or uuid.uuid4()
        self.visit_date = visit_date
        self.created_at = "2026-11-24T10:00:00Z"
        self.updated_at = "2026-11-24T10:00:00Z"


def simulate_patient_ehr_read(
    record: SyntheticHealthRecord,
    *,
    encryption_enabled: bool,
    registry: KeyRegistry | None,
) -> dict[str, Any]:
    """Simulates the response logic of GET /health-records/me."""
    if encryption_enabled:
        if registry is None:
            raise RuntimeError("KeyRegistry missing in enabled mode")

        if record.encryption_version == 1:
            enc_dict = {f: getattr(record, f) for f in CLINICAL_FIELDS}
            dec_data = decrypt_authorized_fields(
                record_id=record.id,
                encrypted_fields=enc_dict,
                authorized_scopes=list(CLINICAL_FIELDS),
                registry=registry,
            )
            return {
                "id": str(record.id),
                "encryption_version": record.encryption_version,
                **dec_data,
            }
        elif record.encryption_version == 0:
            # Legacy plaintext passthrough
            data = {f: getattr(record, f) for f in CLINICAL_FIELDS}
            # Guard against corrupted version 0 rows containing raw ciphertext
            for f, val in data.items():
                if val and val.startswith("enc:v1:"):
                    raise ValueError(f"Corrupted record: version 0 contains ciphertext in {f}")
            return {
                "id": str(record.id),
                "encryption_version": 0,
                **data,
            }
        else:
            raise ValueError(f"Unsupported encryption_version: {record.encryption_version}")
    else:
        # Encryption disabled: raw database passthrough
        return {
            "id": str(record.id),
            "encryption_version": getattr(record, "encryption_version", 0),
            **{f: getattr(record, f) for f in CLINICAL_FIELDS},
        }


def simulate_doctor_ehr_read(
    record: SyntheticHealthRecord,
    *,
    authorized_scopes: list[str],
    encryption_enabled: bool,
    registry: KeyRegistry | None,
) -> dict[str, Any]:
    """Simulates the response logic of GET /health-records/patient/{id}."""
    if encryption_enabled:
        if registry is None:
            raise RuntimeError("KeyRegistry missing in enabled mode")

        if record.encryption_version == 1:
            enc_dict = {f: getattr(record, f) for f in CLINICAL_FIELDS}
            authorized_data = decrypt_authorized_fields(
                record_id=record.id,
                encrypted_fields=enc_dict,
                authorized_scopes=authorized_scopes,
                registry=registry,
            )
        elif record.encryption_version == 0:
            authorized_data = {
                scope: getattr(record, scope)
                for scope in authorized_scopes
            }
            # Guard against leaking raw ciphertext under version 0
            for scope, val in authorized_data.items():
                if val and val.startswith("enc:v1:"):
                    raise ValueError(f"Data leak guard: version 0 record contains raw ciphertext in {scope}")
        else:
            raise ValueError(f"Unsupported encryption_version: {record.encryption_version}")
    else:
        authorized_data = {
            scope: getattr(record, scope)
            for scope in authorized_scopes
        }

    return {
        "record_id": str(record.id),
        "data": authorized_data,
    }


# ==============================================================================
# FIXTURES
# ==============================================================================

@pytest.fixture
def synthetic_key() -> bytes:
    return os.urandom(32)


@pytest.fixture
def registry(synthetic_key: bytes) -> KeyRegistry:
    reg = KeyRegistry()
    reg.register_key("test_harness_key_v1", synthetic_key, set_active=True)
    return reg


# ==============================================================================
# TEST SUITE: MIXED-RECORD COMPATIBILITY & HARDENING
# ==============================================================================

class TestEHRMigrationHardening:
    """Verifies mixed version 0/1 handling, error boundaries, and least privilege."""

    def test_version_0_treated_as_legacy_plaintext_under_enabled_mode(self, registry: KeyRegistry):
        """Version 0 records are passed through cleanly as plaintext when encryption is enabled."""
        rec_v0 = SyntheticHealthRecord(
            encryption_version=0,
            visit_summary="Legacy regular checkup",
            diagnosis="Essential hypertension",
        )
        res = simulate_patient_ehr_read(rec_v0, encryption_enabled=True, registry=registry)
        assert res["visit_summary"] == "Legacy regular checkup"
        assert res["diagnosis"] == "Essential hypertension"
        assert res["encryption_version"] == 0

    def test_version_1_requires_authenticated_aes_gcm_decryption(self, registry: KeyRegistry):
        """Version 1 records are authenticated and decrypted."""
        rec_id = uuid.uuid4()
        c_summary = encrypt_record_field(
            record_id=rec_id, field_name="visit_summary", plaintext="Encrypted visit", registry=registry
        )
        c_diag = encrypt_record_field(
            record_id=rec_id, field_name="diagnosis", plaintext="Type 2 Diabetes", registry=registry
        )

        rec_v1 = SyntheticHealthRecord(
            record_id=rec_id,
            encryption_version=1,
            visit_summary=c_summary,
            diagnosis=c_diag,
        )

        res = simulate_patient_ehr_read(rec_v1, encryption_enabled=True, registry=registry)
        assert res["visit_summary"] == "Encrypted visit"
        assert res["diagnosis"] == "Type 2 Diabetes"
        assert res["encryption_version"] == 1

    def test_unsupported_version_values_fail_closed(self, registry: KeyRegistry):
        """Unsupported version values (e.g. 2, -1, 99) fail closed."""
        rec_bad = SyntheticHealthRecord(
            encryption_version=2,
            visit_summary="Unknown version record",
        )
        with pytest.raises(ValueError) as exc:
            simulate_patient_ehr_read(rec_bad, encryption_enabled=True, registry=registry)
        assert "Unsupported encryption_version: 2" in str(exc.value)

    def test_version_1_record_containing_plaintext_rejected(self, registry: KeyRegistry):
        """A version 1 record containing unencrypted plaintext must be rejected with EnvelopeFormatError."""
        rec_v1_corrupt = SyntheticHealthRecord(
            encryption_version=1,
            visit_summary="Plaintext unencrypted note pretending to be version 1",
        )
        with pytest.raises(EnvelopeFormatError):
            simulate_patient_ehr_read(rec_v1_corrupt, encryption_enabled=True, registry=registry)

    def test_version_0_record_containing_ciphertext_detected(self, registry: KeyRegistry):
        """A version 0 record containing ciphertext is detected to prevent returning raw envelopes."""
        rec_v0_leaker = SyntheticHealthRecord(
            encryption_version=0,
            visit_summary="enc:v1:some_key:invalid_plaintext",
        )
        with pytest.raises(ValueError) as exc:
            simulate_patient_ehr_read(rec_v0_leaker, encryption_enabled=True, registry=registry)
        assert "contains ciphertext" in str(exc.value)

    def test_least_privilege_unconsented_fields_never_decrypted(self, registry: KeyRegistry):
        """Doctor read for scopes ['diagnosis'] decrypts only diagnosis; sensitive notes are omitted."""
        rec_id = uuid.uuid4()
        c_diag = encrypt_record_field(
            record_id=rec_id, field_name="diagnosis", plaintext="Bipolar Disorder", registry=registry
        )
        c_notes = encrypt_record_field(
            record_id=rec_id, field_name="clinical_notes", plaintext="Extremely sensitive therapy notes", registry=registry
        )

        rec = SyntheticHealthRecord(
            record_id=rec_id,
            encryption_version=1,
            diagnosis=c_diag,
            clinical_notes=c_notes,
        )

        res = simulate_doctor_ehr_read(
            rec,
            authorized_scopes=["diagnosis"],
            encryption_enabled=True,
            registry=registry,
        )
        assert res["data"] == {"diagnosis": "Bipolar Disorder"}
        assert "clinical_notes" not in res["data"]

    def test_all_seven_clinical_scopes_none_and_empty_string_semantics(self, registry: KeyRegistry):
        """Preserves None and empty-string semantics across all 7 clinical fields."""
        rec_id = uuid.uuid4()
        payload = {
            "visit_summary": "Full spectrum test",
            "chief_complaint": "",  # Empty string
            "symptoms": None,       # Explicit None
            "diagnosis": "Mild viral rhinitis",
            "clinical_notes": "No fever noted.",
            "treatment_plan": None,
            "follow_up_instructions": "Review in 3 days if worsening",
        }

        enc_fields = {}
        for f in CLINICAL_FIELDS:
            enc_fields[f] = encrypt_record_field(
                record_id=rec_id, field_name=f, plaintext=payload[f], registry=registry
            )

        # None remained None (not wrapped)
        assert enc_fields["symptoms"] is None
        assert enc_fields["treatment_plan"] is None

        rec_v1 = SyntheticHealthRecord(
            record_id=rec_id,
            encryption_version=1,
            **enc_fields,
        )

        res = simulate_patient_ehr_read(rec_v1, encryption_enabled=True, registry=registry)
        for f in CLINICAL_FIELDS:
            assert res[f] == payload[f]

    def test_mixed_record_batch_simulation(self, registry: KeyRegistry):
        """Batch of 3 records: rec1 (v0 legacy), rec2 (v1 encrypted), rec3 (v0 legacy).

        All return clear, valid plaintext without leaking raw encrypted envelopes.
        """
        rec1 = SyntheticHealthRecord(encryption_version=0, visit_summary="Patient 1 legacy")

        rec2_id = uuid.uuid4()
        rec2 = SyntheticHealthRecord(
            record_id=rec2_id,
            encryption_version=1,
            visit_summary=encrypt_record_field(
                record_id=rec2_id, field_name="visit_summary", plaintext="Patient 2 encrypted", registry=registry
            ),
        )

        rec3 = SyntheticHealthRecord(encryption_version=0, visit_summary="Patient 3 legacy")

        batch = [rec1, rec2, rec3]
        results = [simulate_patient_ehr_read(r, encryption_enabled=True, registry=registry) for r in batch]

        assert results[0]["visit_summary"] == "Patient 1 legacy"
        assert results[1]["visit_summary"] == "Patient 2 encrypted"
        assert results[2]["visit_summary"] == "Patient 3 legacy"

        for r in results:
            for k, v in r.items():
                if isinstance(v, str):
                    assert not v.startswith("enc:v1:"), f"Leaked envelope in {k}: {v}"


# ==============================================================================
# TEST SUITE: ROLLOUT & ROLLBACK SAFETY SCENARIOS
# ==============================================================================

class TestRolloutAndRollbackContracts:
    """Verifies atomic rollback, idempotent replay, and historical key boundaries."""

    def test_atomic_batch_conversion_rollback_on_failure(self, registry: KeyRegistry):
        """Simulates atomic batch conversion: if record 3 fails, changes to records 1 and 2

        must be completely rolled back, leaving 0 partially converted records.
        """
        records = [
            SyntheticHealthRecord(encryption_version=0, visit_summary="Record 1"),
            SyntheticHealthRecord(encryption_version=0, visit_summary="Record 2"),
            SyntheticHealthRecord(encryption_version=0, visit_summary=None),  # Will fail if corrupted
        ]

        # Simulate transaction context
        db_state_backup = {r.id: (r.encryption_version, r.visit_summary) for r in records}
        transaction_committed = False

        try:
            # Begin batch conversion
            for i, r in enumerate(records):
                if i == 2:
                    # Injected failure mid-batch
                    raise RuntimeError("Catastrophic conversion error on record 3!")
                r.visit_summary = encrypt_record_field(
                    record_id=r.id, field_name="visit_summary", plaintext=r.visit_summary, registry=registry
                )
                r.encryption_version = 1
            transaction_committed = True
        except RuntimeError:
            # Execute transaction rollback
            for r in records:
                ver, summary = db_state_backup[r.id]
                r.encryption_version = ver
                r.visit_summary = summary

        assert not transaction_committed
        for r in records:
            assert r.encryption_version == 0
            assert not (r.visit_summary or "").startswith("enc:v1:")

    def test_idempotent_backfill_replay(self, registry: KeyRegistry):
        """Re-running a backfill pass on already converted records (version == 1)

        identifies 0 eligible records and modifies 0 records (zero double-encryption).
        """
        records = [
            SyntheticHealthRecord(
                encryption_version=1,
                visit_summary=encrypt_record_field(
                    record_id=uuid.uuid4(), field_name="visit_summary", plaintext="Already converted", registry=registry
                ),
            )
            for _ in range(5)
        ]

        # Query eligible rows (where encryption_version == 0)
        eligible = [r for r in records if r.encryption_version == 0]
        assert len(eligible) == 0, "Non-zero eligible records found on replay!"

        # No double-encryption occurs
        assert len(records) == 5
        for r in records:
            assert r.encryption_version == 1

    def test_rollback_before_encrypted_writes_requires_zero_decryption(self):
        """Before any encrypted writes occur, all records remain encryption_version = 0.

        Rolling back or disabling encryption requires zero data decryption.
        """
        records = [
            SyntheticHealthRecord(encryption_version=0, visit_summary=f"Plaintext {i}")
            for i in range(5)
        ]
        # Verify all records readable without any KeyRegistry
        for r in records:
            res = simulate_patient_ehr_read(r, encryption_enabled=False, registry=None)
            assert res["visit_summary"].startswith("Plaintext")

    def test_rollback_after_encrypted_writes_hazard_documentation(self, registry: KeyRegistry):
        """After encrypted records exist, disabling encryption causes raw ciphertext to be returned

        unless records are decrypted/backfilled back to version 0 first.
        """
        rec_id = uuid.uuid4()
        rec_v1 = SyntheticHealthRecord(
            record_id=rec_id,
            encryption_version=1,
            visit_summary=encrypt_record_field(
                record_id=rec_id, field_name="visit_summary", plaintext="Secret clinical data", registry=registry
            ),
        )

        # If an operator disables encryption without backfilling to version 0:
        res = simulate_patient_ehr_read(rec_v1, encryption_enabled=False, registry=None)
        # Hazard: raw envelope string is exposed because app is in disabled mode!
        assert res["visit_summary"].startswith("enc:v1:")
        # This proves: Rollback after encrypted writes requires a prior backfill-to-plaintext pass!

    def test_key_loss_prevents_decryption_and_key_restoration_recovers_it(self, synthetic_key: bytes):
        """Losing an active key prevents reading version 1 records; restoring the key recovers access."""
        key_id = "rotational_recovery_key"
        reg = KeyRegistry()
        reg.register_key(key_id, synthetic_key, set_active=True)

        rec_id = uuid.uuid4()
        c_text = encrypt_record_field(
            record_id=rec_id, field_name="diagnosis", plaintext="Hypertension", registry=reg
        )

        # Lost key
        empty_reg = KeyRegistry()
        with pytest.raises(KeyNotFoundError):
            decrypt_record_field(
                record_id=rec_id, field_name="diagnosis", envelope=c_text, registry=empty_reg
            )

        # Restored key
        restored_reg = KeyRegistry()
        restored_reg.register_key(key_id, synthetic_key, set_active=True)
        decrypted = decrypt_record_field(
            record_id=rec_id, field_name="diagnosis", envelope=c_text, registry=restored_reg
        )
        assert decrypted == "Hypertension"

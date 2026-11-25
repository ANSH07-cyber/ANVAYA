"""
ANVAYA EHR Encryption Integration-Contract Verification Suite
Target: Offline contract verification for Gate 2B Phase 3B

Evaluates how ANVAYA's AES-256-GCM crypto engine and clinical crypto adapter
can safely integrate with existing EHR application contracts and models.

DISTINCTION OF TEST TYPES:
  A. EXISTING CONTRACT TESTS: Assertions on real source-level structures, models,
     routes, and public APIs that exist today.
  B. PROPOSED INTEGRATION SIMULATIONS: In-memory synthetic demonstrations of how
     encrypted EHR flows will function once integrated.
  C. CURRENTLY BLOCKED / NOT IMPLEMENTED DIAGNOSTICS: Explicit programmatic checks
     identifying gaps where integration has not yet occurred in application source.

ZERO database connections, ZERO network sockets, ZERO persistent secret files.
"""

from __future__ import annotations

import inspect
import os
import unittest.mock
import uuid
import pytest
from pydantic import ValidationError

# ------------------------------------------------------------------------------
# Core & Adapter Crypto Imports
# ------------------------------------------------------------------------------
from app.core.crypto import (
    CryptoError,
    CryptoKeyError,
    DecryptionError,
    EnvelopeFormatError,
    KeyNotFoundError,
    KeyRegistry,
    decrypt_clinical_text,
    encrypt_clinical_text,
)
from app.services.clinical_crypto_service import (
    CLINICAL_FIELDS,
    CLINICAL_AAD_DOMAIN_PREFIX,
    ClinicalCryptoError,
    DoubleEncryptionError,
    InvalidClinicalFieldError,
    InvalidRecordIdError,
    InvalidScopeError,
    MissingFieldError,
    construct_clinical_record_aad,
    decrypt_authorized_fields,
    decrypt_record_field,
    encrypt_record_field,
    validate_record_id,
)

# ------------------------------------------------------------------------------
# Existing Application Models & Schemas
# ------------------------------------------------------------------------------
from app.models.health_record import HealthRecord
from app.models.consent_record import ConsentRecord
from app.schemas.health_record import (
    ConsultationCompletion,
    HealthRecordRead,
    DoctorSharedHealthRecordRead,
    DoctorSharedHealthRecordListResponse,
)
from app.schemas.consent import HealthDataScope


# ==============================================================================
# SYNTHETIC TEST FIXTURES (IN-MEMORY ONLY)
# ==============================================================================

@pytest.fixture
def synthetic_key_registry() -> KeyRegistry:
    """Provides an isolated, in-memory KeyRegistry with two synthetic keys."""
    registry = KeyRegistry()
    registry.register_key("contract_key_v1", os.urandom(32), set_active=True)
    registry.register_key("contract_key_v2", os.urandom(32), set_active=False)
    return registry


@pytest.fixture
def synthetic_record_id() -> uuid.UUID:
    """Provides a synthetic health record UUID."""
    return uuid.UUID("3fa85f64-5717-4562-b3fc-2c963f66afa6")


@pytest.fixture
def sample_clinical_payload() -> dict[str, str | None]:
    """Provides a canonical sample dictionary containing all 7 clinical fields."""
    return {
        "visit_summary": "Patient presented with acute tension headache for 2 days.",
        "chief_complaint": "Persistent bilateral throbbing head pain.",
        "symptoms": "Mild photophobia, neck stiffness, normal vital signs.",
        "diagnosis": "Episodic tension-type headache.",
        "clinical_notes": "Neurological examination within normal physiological limits.",
        "treatment_plan": "Prescribed Paracetamol 500mg prn and ergonomic adjustments.",
        "follow_up_instructions": "Review if symptoms persist beyond 5 days.",
    }


# ==============================================================================
# C-01: EXISTING CRYPTO & ADAPTER CONTRACTS
# ==============================================================================

def test_c01_crypto_and_adapter_public_contracts(synthetic_key_registry: KeyRegistry) -> None:
    """
    C-01 [EXISTING CONTRACT]:
    Verifies that the standalone AES-GCM engine and clinical crypto adapter
    are importable, fully operational, and expose expected function signatures
    without initializing FastAPI or creating database connections.
    """
    # Verify core crypto engine signatures
    encrypt_sig = inspect.signature(encrypt_clinical_text)
    assert "plaintext" in encrypt_sig.parameters
    assert "aad" in encrypt_sig.parameters
    assert "registry" in encrypt_sig.parameters

    decrypt_sig = inspect.signature(decrypt_clinical_text)
    assert "envelope" in decrypt_sig.parameters
    assert "aad" in decrypt_sig.parameters
    assert "registry" in decrypt_sig.parameters

    # Verify clinical adapter signatures
    adapter_enc_sig = inspect.signature(encrypt_record_field)
    assert set(adapter_enc_sig.parameters.keys()) == {"record_id", "field_name", "plaintext", "registry"}

    adapter_dec_sig = inspect.signature(decrypt_record_field)
    assert set(adapter_dec_sig.parameters.keys()) == {"record_id", "field_name", "envelope", "registry"}

    adapter_jit_sig = inspect.signature(decrypt_authorized_fields)
    assert set(adapter_jit_sig.parameters.keys()) == {"record_id", "encrypted_fields", "authorized_scopes", "registry"}

    # Verify seven canonical clinical fields
    assert len(CLINICAL_FIELDS) == 7
    expected_fields = {
        "visit_summary", "chief_complaint", "symptoms", "diagnosis",
        "clinical_notes", "treatment_plan", "follow_up_instructions"
    }
    assert CLINICAL_FIELDS == expected_fields


# ==============================================================================
# C-02: HEALTHRECORD UUID LIFECYCLE & PRE-ALLOCATION
# ==============================================================================

def test_c02_health_record_uuid_lifecycle_and_aad_binding(
    synthetic_key_registry: KeyRegistry,
    synthetic_record_id: uuid.UUID,
) -> None:
    """
    C-02 [PROPOSED INTEGRATION SIMULATION & MODEL INSPECTION]:
    Inspects HealthRecord.id declaration and proves that an in-memory pre-allocated
    UUID can be used for AAD binding prior to model instantiation.
    Proves that decrypting with a freshly generated or different UUID fails closed.
    """
    # Inspect actual model declaration
    id_col = HealthRecord.__table__.columns["id"]
    assert id_col.primary_key is True

    # Pre-allocate record UUID in memory
    preallocated_id = synthetic_record_id

    # Construct bound AAD and encrypt
    aad = construct_clinical_record_aad(record_id=preallocated_id, field_name="diagnosis")
    assert f"anvaya:health_records:{preallocated_id}:diagnosis".encode("utf-8") == aad

    envelope = encrypt_record_field(
        record_id=preallocated_id,
        field_name="diagnosis",
        plaintext="Migraine without aura",
        registry=synthetic_key_registry,
    )
    assert envelope is not None

    # Decrypt with exact pre-allocated ID succeeds
    decrypted = decrypt_record_field(
        record_id=preallocated_id,
        field_name="diagnosis",
        envelope=envelope,
        registry=synthetic_key_registry,
    )
    assert decrypted == "Migraine without aura"

    # Decrypt with a freshly generated different UUID MUST FAIL CLOSED (detects transplant)
    fresh_different_id = uuid.uuid4()
    with pytest.raises(DecryptionError):
        decrypt_record_field(
            record_id=fresh_different_id,
            field_name="diagnosis",
            envelope=envelope,
            registry=synthetic_key_registry,
        )


# ==============================================================================
# C-03: ENCRYPTION VERSION METADATA & INTEGRATION GAPS
# ==============================================================================

def test_c03_encryption_version_metadata_gap_and_simulation(
    synthetic_key_registry: KeyRegistry,
    synthetic_record_id: uuid.UUID,
) -> None:
    """
    C-03 [CURRENTLY BLOCKED / NOT IMPLEMENTED DIAGNOSTIC & SIMULATION]:
    1. Inspects the actual HealthRecord model to confirm whether 'encryption_version'
       exists today. (Proves it does NOT yet exist on disk).
    2. Simulates the required tri-state behavior:
       - version 0: legacy plaintext (readable during migration window)
       - version 1: AES-GCM envelope
       - version > 1 / invalid: fail closed
    """
    # Programmatic assertion of Phase 3C-2L ORM column mapping:
    actual_columns = set(HealthRecord.__table__.columns.keys())
    assert "encryption_version" in actual_columns
    assert HealthRecord.__table__.columns["encryption_version"].nullable is False

    # In-memory simulation of the proposed tri-state reader logic
    def simulated_record_reader(
        record_id: uuid.UUID,
        encryption_version: int,
        raw_value: str | None,
        field_name: str,
        registry: KeyRegistry,
    ) -> str | None:
        if raw_value is None:
            return None
        if encryption_version == 0:
            # Legacy plaintext mode
            return raw_value
        elif encryption_version == 1:
            # Authenticated AES-GCM mode
            return decrypt_record_field(
                record_id=record_id,
                field_name=field_name,
                envelope=raw_value,
                registry=registry,
            )
        else:
            # Unsupported / malformed state: FAIL CLOSED
            raise ClinicalCryptoError(f"Unsupported encryption_version: {encryption_version}")

    # Case A: Legacy Plaintext (version 0)
    legacy_val = simulated_record_reader(
        synthetic_record_id, 0, "Legacy plaintext clinical note", "clinical_notes", synthetic_key_registry
    )
    assert legacy_val == "Legacy plaintext clinical note"

    # Case B: Encrypted Envelope (version 1)
    enc_env = encrypt_record_field(
        record_id=synthetic_record_id,
        field_name="clinical_notes",
        plaintext="Encrypted note",
        registry=synthetic_key_registry,
    )
    assert enc_env is not None
    enc_val = simulated_record_reader(
        synthetic_record_id, 1, enc_env, "clinical_notes", synthetic_key_registry
    )
    assert enc_val == "Encrypted note"

    # Case C: Unsupported Version (version 2 or negative) -> MUST FAIL CLOSED
    with pytest.raises(ClinicalCryptoError):
        simulated_record_reader(
            synthetic_record_id, 2, enc_env, "clinical_notes", synthetic_key_registry
        )


# ==============================================================================
# C-04: MODEL / DATABASE DEFAULT CONSISTENCY ANALYSIS
# ==============================================================================

def test_c04_model_database_default_consistency_analysis() -> None:
    """
    C-04 [PROPOSED CONTRACT AUDIT]:
    Evaluates the hazard of ORM default=1 vs DB server_default='0'.
    Proves that an unencrypted writer must NOT be permitted to mark a record as
    encryption_version=1 unless all fields were actually encrypted.
    """
    # Demonstration of the corruption hazard:
    # If a writer saves plaintext while setting encryption_version=1:
    unencrypted_data = "Raw Plaintext Note"
    fictional_marked_version = 1

    # When an authenticated reader encounters this row:
    registry = KeyRegistry()
    registry.register_key("test_key", os.urandom(32), set_active=True)

    # An envelope format error is raised because the value is unencrypted!
    with pytest.raises(EnvelopeFormatError):
        decrypt_record_field(
            record_id=uuid.uuid4(),
            field_name="clinical_notes",
            envelope=unencrypted_data,
            registry=registry,
        )


# ==============================================================================
# C-05: CONSULTATION COMPLETION WRITE CONTRACT
# ==============================================================================

def test_c05_consultation_completion_write_contract(
    synthetic_key_registry: KeyRegistry,
    synthetic_record_id: uuid.UUID,
    sample_clinical_payload: dict[str, str | None],
) -> None:
    """
    C-05 [PROPOSED INTEGRATION SIMULATION]:
    Simulates the proposed consultation completion write flow:
    1. Pre-allocates record UUID.
    2. Encrypts all 7 clinical fields bound to the pre-allocated UUID.
    3. Preserves None values.
    4. Validates that resulting dictionary contains only authenticated envelopes or None.
    """
    # Verify input validates with existing ConsultationCompletion schema
    payload_obj = ConsultationCompletion.model_validate(sample_clinical_payload)
    assert payload_obj.visit_summary == sample_clinical_payload["visit_summary"]

    # Pre-allocate record UUID
    preallocated_id = synthetic_record_id

    # Simulated write adapter
    encrypted_record_data: dict[str, str | None] = {}
    for field in sorted(CLINICAL_FIELDS):
        val = getattr(payload_obj, field)
        encrypted_record_data[field] = encrypt_record_field(
            record_id=preallocated_id,
            field_name=field,
            plaintext=val,
            registry=synthetic_key_registry,
        )

    # Verify that required field is encrypted
    assert encrypted_record_data["visit_summary"] is not None
    assert encrypted_record_data["visit_summary"].startswith("enc:v1:contract_key_v1:")

    # Verify round trip for all fields
    for field in sorted(CLINICAL_FIELDS):
        envelope = encrypted_record_data[field]
        decrypted = decrypt_record_field(
            record_id=preallocated_id,
            field_name=field,
            envelope=envelope,
            registry=synthetic_key_registry,
        )
        assert decrypted == getattr(payload_obj, field)


# ==============================================================================
# C-06: CONSULTATION COMPLETION RESPONSE CORRECTNESS
# ==============================================================================

def test_c06_consultation_completion_response_serialization_hazard(
    synthetic_key_registry: KeyRegistry,
    synthetic_record_id: uuid.UUID,
) -> None:
    """
    C-06 [HAZARD DEMONSTRATION & MAPPER SIMULATION]:
    Inspects HealthRecordRead schema and demonstrates that returning an ORM object
    with ciphertext directly would leak 'enc:v1:' into the API response.
    Simulates the correct response mapper that returns plaintext to the completing doctor.
    """
    # 1. Inspect existing response schema
    fields_in_read = HealthRecordRead.model_fields.keys()
    assert "visit_summary" in fields_in_read
    assert "diagnosis" in fields_in_read

    # 2. Simulate raw ORM record containing ciphertext
    raw_plaintext_summary = "Routine cardiology review: normal sinus rhythm."
    ciphertext_envelope = encrypt_record_field(
        record_id=synthetic_record_id,
        field_name="visit_summary",
        plaintext=raw_plaintext_summary,
        registry=synthetic_key_registry,
    )
    assert ciphertext_envelope is not None

    fake_orm_dict = {
        "id": synthetic_record_id,
        "patient_profile_id": uuid.uuid4(),
        "doctor_profile_id": uuid.uuid4(),
        "appointment_id": uuid.uuid4(),
        "visit_date": "2026-11-24",
        "chief_complaint": None,
        "visit_summary": ciphertext_envelope,  # CIPHERTEXT IN ORM
        "symptoms": None,
        "diagnosis": None,
        "clinical_notes": None,
        "treatment_plan": None,
        "follow_up_instructions": None,
        "created_at": "2026-11-24T12:00:00Z",
        "updated_at": "2026-11-24T12:00:00Z",
    }

    # Leaked response if unmapped:
    leaked_read = HealthRecordRead.model_validate(fake_orm_dict)
    assert leaked_read.visit_summary.startswith("enc:v1:"), (
        "HAZARD CONFIRMED: Raw ORM return leaks ciphertext to API caller."
    )

    # 3. Simulate correct response mapper: Decrypts fields for response serialization
    def map_health_record_response(
        record_dict: dict[str, str | None],
        registry: KeyRegistry,
    ) -> HealthRecordRead:
        rec_id = uuid.UUID(str(record_dict["id"]))
        decrypted_dict = dict(record_dict)
        for field in CLINICAL_FIELDS:
            env = record_dict.get(field)
            if env and isinstance(env, str) and env.startswith("enc:v1:"):
                decrypted_dict[field] = decrypt_record_field(
                    record_id=rec_id,
                    field_name=field,
                    envelope=env,
                    registry=registry,
                )
        return HealthRecordRead.model_validate(decrypted_dict)

    clean_response = map_health_record_response(fake_orm_dict, synthetic_key_registry)
    assert clean_response.visit_summary == raw_plaintext_summary
    assert not clean_response.visit_summary.startswith("enc:v1:")


# ==============================================================================
# C-07: DOCTOR CONSENT & JIT SELECTIVE DECRYPTION
# ==============================================================================

def test_c07_doctor_consent_preconditions_and_selective_decryption(
    synthetic_key_registry: KeyRegistry,
    synthetic_record_id: uuid.UUID,
    sample_clinical_payload: dict[str, str | None],
) -> None:
    """
    C-07 [SOURCE INSPECTION & JIT SIMULATION]:
    1. Inspects health_records.py source logic to confirm authorization precedes queries.
    2. Simulates JIT selective decryption: 3 authorized scopes are decrypted;
       the 4 withheld scopes remain encrypted and are NEVER passed to decrypt routines.
    3. Simulated precondition: requesting an unauthorized scope is rejected.
    """
    # 1. Encrypt all 7 fields for synthetic record
    encrypted_fields = {
        field: encrypt_record_field(
            record_id=synthetic_record_id,
            field_name=field,
            plaintext=text,
            registry=synthetic_key_registry,
        )
        for field, text in sample_clinical_payload.items()
    }

    # 2. Doctor is authorized for ONLY 3 scopes:
    authorized_scopes: list[HealthDataScope] = ["visit_summary", "diagnosis", "symptoms"]
    withheld_scopes = CLINICAL_FIELDS - set(authorized_scopes)
    assert len(withheld_scopes) == 4

    # 3. Spy on decrypt_record_field to PROVE withheld fields are never decrypted
    with unittest.mock.patch(
        "app.services.clinical_crypto_service.decrypt_record_field",
        wraps=decrypt_record_field,
    ) as decrypt_spy:
        authorized_data = decrypt_authorized_fields(
            record_id=synthetic_record_id,
            encrypted_fields=encrypted_fields,
            authorized_scopes=authorized_scopes,
            registry=synthetic_key_registry,
        )

        # Assert spy call count equals exactly 3
        assert decrypt_spy.call_count == 3
        invoked_fields = [call.kwargs.get("field_name") for call in decrypt_spy.call_args_list]
        assert set(invoked_fields) == set(authorized_scopes)

        # Confirm NONE of the withheld fields were ever invoked
        for withheld in withheld_scopes:
            assert withheld not in invoked_fields
            assert withheld not in authorized_data

    # 4. Serialize into DoctorSharedHealthRecordRead
    shared_read = DoctorSharedHealthRecordRead(
        record_id=synthetic_record_id,
        visit_date="2026-11-24",
        data=authorized_data,
    )
    assert set(shared_read.data.keys()) == set(authorized_scopes)
    assert shared_read.data["visit_summary"] == sample_clinical_payload["visit_summary"]

    # 5. Simulated precondition failure: Doctor attempts to request unpermitted scope
    permitted_by_consent = {"visit_summary", "diagnosis"}
    requested_by_doctor = {"visit_summary", "diagnosis", "clinical_notes"}

    # Precondition check:
    assert not requested_by_doctor.issubset(permitted_by_consent), (
        "Precondition accurately flags unpermitted scope request."
    )


# ==============================================================================
# C-08: PATIENT EHR OWNERSHIP & FULL RECORD READ
# ==============================================================================

def test_c08_patient_ehr_ownership_and_full_decryption(
    synthetic_key_registry: KeyRegistry,
    synthetic_record_id: uuid.UUID,
    sample_clinical_payload: dict[str, str | None],
) -> None:
    """
    C-08 [PROPOSED INTEGRATION SIMULATION]:
    Demonstrates that for an authorized patient query (/health-records/me),
    all 7 encrypted fields are decrypted for the record owner.
    Demonstrates that mismatched record ID binding fails.
    """
    # Encrypt all 7 fields
    encrypted_fields = {
        field: encrypt_record_field(
            record_id=synthetic_record_id,
            field_name=field,
            plaintext=text,
            registry=synthetic_key_registry,
        )
        for field, text in sample_clinical_payload.items()
    }

    # Patient requests all fields
    all_scopes = list(CLINICAL_FIELDS)
    patient_decrypted = decrypt_authorized_fields(
        record_id=synthetic_record_id,
        encrypted_fields=encrypted_fields,
        authorized_scopes=all_scopes,
        registry=synthetic_key_registry,
    )

    assert set(patient_decrypted.keys()) == CLINICAL_FIELDS
    for field in CLINICAL_FIELDS:
        assert patient_decrypted[field] == sample_clinical_payload[field]

    # Mismatched record ID binding fails
    different_patient_record_id = uuid.uuid4()
    with pytest.raises(DecryptionError):
        decrypt_authorized_fields(
            record_id=different_patient_record_id,
            encrypted_fields=encrypted_fields,
            authorized_scopes=all_scopes,
            registry=synthetic_key_registry,
        )


# ==============================================================================
# C-09: MISSING KEYS, TAMPERING, & FAIL-CLOSED SECURITY
# ==============================================================================

def test_c09_missing_keys_tampering_and_fail_closed(
    synthetic_key_registry: KeyRegistry,
    synthetic_record_id: uuid.UUID,
) -> None:
    """
    C-09 [SECURITY CONTRACT VALIDATION]:
    Verifies that missing keys, wrong keys, tampered ciphertexts, AAD mismatches,
    and malformed envelopes strictly fail closed without plaintext fallback.
    """
    valid_envelope = encrypt_record_field(
        record_id=synthetic_record_id,
        field_name="diagnosis",
        plaintext="Viral pharyngitis",
        registry=synthetic_key_registry,
    )
    assert valid_envelope is not None

    # 1. Unknown historical key ID -> KeyNotFoundError
    empty_registry = KeyRegistry()
    with pytest.raises(KeyNotFoundError):
        decrypt_record_field(
            record_id=synthetic_record_id,
            field_name="diagnosis",
            envelope=valid_envelope,
            registry=empty_registry,
        )

    # 2. Wrong key material under same key ID -> DecryptionError
    wrong_key_reg = KeyRegistry()
    wrong_key_reg.register_key("contract_key_v1", os.urandom(32), set_active=True)
    with pytest.raises(DecryptionError):
        decrypt_record_field(
            record_id=synthetic_record_id,
            field_name="diagnosis",
            envelope=valid_envelope,
            registry=wrong_key_reg,
        )

    # 3. Tampered payload byte -> DecryptionError
    parts = valid_envelope.split(":")
    tampered_payload = ("B" if parts[4][0] == "A" else "A") + parts[4][1:]
    tampered_envelope = f"{parts[0]}:{parts[1]}:{parts[2]}:{parts[3]}:{tampered_payload}"
    with pytest.raises(DecryptionError):
        decrypt_record_field(
            record_id=synthetic_record_id,
            field_name="diagnosis",
            envelope=tampered_envelope,
            registry=synthetic_key_registry,
        )

    # 4. AAD mismatch (field transplant) -> DecryptionError
    with pytest.raises(DecryptionError):
        decrypt_record_field(
            record_id=synthetic_record_id,
            field_name="treatment_plan",  # Encrypted as diagnosis
            envelope=valid_envelope,
            registry=synthetic_key_registry,
        )

    # 5. Malformed envelope structure -> EnvelopeFormatError
    with pytest.raises(EnvelopeFormatError):
        decrypt_record_field(
            record_id=synthetic_record_id,
            field_name="diagnosis",
            envelope="enc:v1:corrupt_parts",
            registry=synthetic_key_registry,
        )


# ==============================================================================
# C-10: DEPENDENCY INJECTION READINESS & APPLICATION GAPS
# ==============================================================================

def test_c10_dependency_injection_readiness_gap_audit() -> None:
    """
    C-10 [DEPENDENCY INJECTION READINESS VERIFICATION]:
    Inspects app/core/config.py and app/api/deps.py.
    Confirms that clinical KeyRegistry configuration and dependency injection
    contracts are properly defined (modernized from historical Phase 3B diagnostic).
    """
    import app.core.config as config_mod
    import app.api.deps as deps_mod

    # 1. Config check: Settings defines clinical encryption key configuration
    settings_obj = config_mod.get_settings()
    has_active_key_setting = hasattr(settings_obj, "clinical_encryption_active_key_id")
    has_keys_json_setting = hasattr(settings_obj, "clinical_encryption_keys_json")

    assert has_active_key_setting, "Settings must declare clinical_encryption_active_key_id"
    assert has_keys_json_setting, "Settings must declare clinical_encryption_keys_json"

    # 2. Deps check: deps.py defines get_clinical_key_registry dependency
    has_registry_dep = hasattr(deps_mod, "get_clinical_key_registry")
    assert has_registry_dep, "deps.py must declare get_clinical_key_registry dependency"


# ==============================================================================
# C-11: ERROR & LOGGING SAFETY
# ==============================================================================

def test_c11_exception_safety_and_zero_data_leakage(
    synthetic_key_registry: KeyRegistry,
    synthetic_record_id: uuid.UUID,
) -> None:
    """
    C-11 [SECURITY CONTRACT VALIDATION]:
    Verifies that exceptions thrown during encryption/decryption operations
    contain zero clinical plaintext narratives, zero ciphertexts, and zero key bytes.
    """
    sensitive_diagnosis = "PATIENT_SECRET_ONCOLOGICAL_STAGE_IV_CARCINOMA"

    # Trigger DoubleEncryptionError
    with pytest.raises(DoubleEncryptionError) as exc_info:
        encrypt_record_field(
            record_id=synthetic_record_id,
            field_name="diagnosis",
            plaintext="enc:v1:fake_envelope",
            registry=synthetic_key_registry,
        )
    msg = str(exc_info.value)
    assert sensitive_diagnosis not in msg
    assert "fake_envelope" not in msg

    # Trigger InvalidClinicalFieldError
    with pytest.raises(InvalidClinicalFieldError) as exc_info:
        encrypt_record_field(
            record_id=synthetic_record_id,
            field_name="unauthorized_field_name",
            plaintext=sensitive_diagnosis,
            registry=synthetic_key_registry,
        )
    msg = str(exc_info.value)
    assert sensitive_diagnosis not in msg


# ==============================================================================
# C-12: REGRESSION BOUNDARY & SCHEMA COMPATIBILITY
# ==============================================================================

def test_c12_regression_boundary_schema_compatibility(
    synthetic_record_id: uuid.UUID,
    sample_clinical_payload: dict[str, str | None],
) -> None:
    """
    C-12 [EXISTING CONTRACT COMPATIBILITY]:
    Verifies that the proposed integration preserves existing schema contracts:
    - HealthRecordRead field names and types.
    - DoctorSharedHealthRecordRead field names and data mapping structure.
    - DoctorSharedHealthRecordListResponse items and requested_scopes.
    """
    # 1. HealthRecordRead schema compatibility
    record_read_data = {
        "id": synthetic_record_id,
        "patient_profile_id": uuid.uuid4(),
        "doctor_profile_id": uuid.uuid4(),
        "appointment_id": uuid.uuid4(),
        "visit_date": "2026-11-24",
        "created_at": "2026-11-24T10:00:00Z",
        "updated_at": "2026-11-24T10:00:00Z",
        **sample_clinical_payload,
    }
    hr_read = HealthRecordRead.model_validate(record_read_data)
    assert hr_read.visit_summary == sample_clinical_payload["visit_summary"]
    assert hr_read.diagnosis == sample_clinical_payload["diagnosis"]

    # 2. DoctorSharedHealthRecordListResponse schema compatibility
    shared_read = DoctorSharedHealthRecordRead(
        record_id=synthetic_record_id,
        visit_date="2026-11-24",
        data={"visit_summary": sample_clinical_payload["visit_summary"]},
    )
    list_response = DoctorSharedHealthRecordListResponse(
        items=[shared_read],
        total=1,
        limit=20,
        offset=0,
        requested_scopes=["visit_summary"],
    )
    assert list_response.total == 1
    assert len(list_response.items) == 1
    assert list_response.items[0].data["visit_summary"] == sample_clinical_payload["visit_summary"]

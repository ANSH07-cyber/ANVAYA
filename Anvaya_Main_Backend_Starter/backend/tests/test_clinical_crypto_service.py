"""
ANVAYA Clinical Storage Cryptographic Service Adapter Unit Test Suite
Target: app.services.clinical_crypto_service

Isolated in-memory unit tests validating record-and-field AAD binding, JIT selective
decryption, double-encryption prevention, fail-closed security, and zero data leakage.
Zero database connections, zero external services, zero filesystem secrets.
"""

from __future__ import annotations

import os
import unittest.mock
import uuid
import pytest

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


# ==============================================================================
# FIXTURES & SYNTHETIC DATA
# ==============================================================================

@pytest.fixture
def synthetic_key_primary() -> bytes:
    """Generates an ephemeral 256-bit synthetic test key."""
    return os.urandom(32)


@pytest.fixture
def synthetic_key_secondary() -> bytes:
    """Generates a second ephemeral 256-bit synthetic test key."""
    return os.urandom(32)


@pytest.fixture
def test_registry(synthetic_key_primary: bytes, synthetic_key_secondary: bytes) -> KeyRegistry:
    """Provides an isolated KeyRegistry populated with two synthetic test keys."""
    registry = KeyRegistry()
    registry.register_key("test_clinical_key_v1", synthetic_key_primary, set_active=True)
    registry.register_key("test_clinical_key_v2", synthetic_key_secondary, set_active=False)
    return registry


@pytest.fixture
def sample_record_id() -> uuid.UUID:
    """Provides a synthetic health record UUID."""
    return uuid.UUID("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")


# ==============================================================================
# 1. BASIC SINGLE-FIELD ROUND TRIP
# ==============================================================================

def test_01_single_field_round_trip(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 1: Encrypt and decrypt a single clinical field round trip."""
    plaintext = "Patient presents with persistent cough and fatigue for 3 days."
    envelope = encrypt_record_field(
        record_id=sample_record_id,
        field_name="visit_summary",
        plaintext=plaintext,
        registry=test_registry,
    )

    assert isinstance(envelope, str)
    assert envelope.startswith("enc:v1:test_clinical_key_v1:")

    decrypted = decrypt_record_field(
        record_id=sample_record_id,
        field_name="visit_summary",
        envelope=envelope,
        registry=test_registry,
    )
    assert decrypted == plaintext


# ==============================================================================
# 2. ALL SEVEN ALLOWED CLINICAL FIELDS ROUND TRIP
# ==============================================================================

def test_02_all_seven_fields_round_trip(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 2: Encrypt and decrypt all seven allowed clinical fields with distinct narratives."""
    clinical_data = {
        "visit_summary": "Routine cardiology follow-up consultation.",
        "chief_complaint": "Occasional palpitations during moderate exercise.",
        "symptoms": "Mild shortness of breath, no chest pain, no radiating discomfort.",
        "diagnosis": "Benign sinus arrhythmia, mild hypertension.",
        "clinical_notes": "ECG within normal sinus limits. Rest BP 130/84 mmHg.",
        "treatment_plan": "Continue lifestyle modifications and daily 30-min walking regimen.",
        "follow_up_instructions": "Review ambulatory blood pressure log in 6 weeks.",
    }

    assert len(clinical_data) == 7
    assert set(clinical_data.keys()) == CLINICAL_FIELDS

    encrypted_map: dict[str, str | None] = {}
    for field, text in clinical_data.items():
        encrypted_map[field] = encrypt_record_field(
            record_id=sample_record_id,
            field_name=field,
            plaintext=text,
            registry=test_registry,
        )

    for field, envelope in encrypted_map.items():
        assert isinstance(envelope, str)
        decrypted = decrypt_record_field(
            record_id=sample_record_id,
            field_name=field,
            envelope=envelope,
            registry=test_registry,
        )
        assert decrypted == clinical_data[field]


# ==============================================================================
# 3. UNICODE, HINDI, AND SPECIAL SYMBOLS ROUND TRIP
# ==============================================================================

def test_03_unicode_hindi_and_symbols_round_trip(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 3: Exact UTF-8 preservation of Hindi (हिंदी), French accents, and medical symbols."""
    multilingual = (
        "रोगी को हल्का सिरदर्द और थकान की शिकायत है। "
        "Rx: Paracétamol 500mg — Take post-prandial. "
        "SpO₂: 98% on room air; Temp: 37.1°C ± 0.2°C 🩺."
    )
    envelope = encrypt_record_field(
        record_id=sample_record_id,
        field_name="clinical_notes",
        plaintext=multilingual,
        registry=test_registry,
    )
    decrypted = decrypt_record_field(
        record_id=sample_record_id,
        field_name="clinical_notes",
        envelope=envelope,
        registry=test_registry,
    )
    assert decrypted == multilingual


# ==============================================================================
# 4. EMPTY STRING ENCRYPTION / DECRYPTION
# ==============================================================================

def test_04_empty_string_encryption_decryption(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 4: Empty string encrypts to an authenticated envelope and decrypts back to empty string."""
    envelope = encrypt_record_field(
        record_id=sample_record_id,
        field_name="follow_up_instructions",
        plaintext="",
        registry=test_registry,
    )
    assert isinstance(envelope, str)
    assert envelope.startswith("enc:v1:")

    decrypted = decrypt_record_field(
        record_id=sample_record_id,
        field_name="follow_up_instructions",
        envelope=envelope,
        registry=test_registry,
    )
    assert decrypted == ""


# ==============================================================================
# 5. NONE VALUE PRESERVATION
# ==============================================================================

def test_05_none_preservation(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 5: Passing None to encrypt or decrypt returns None without error."""
    assert encrypt_record_field(
        record_id=sample_record_id,
        field_name="symptoms",
        plaintext=None,
        registry=test_registry,
    ) is None

    assert decrypt_record_field(
        record_id=sample_record_id,
        field_name="symptoms",
        envelope=None,
        registry=test_registry,
    ) is None


# ==============================================================================
# 6. DIFFERENT RECORD IDS PRODUCE DIFFERENT AAD
# ==============================================================================

def test_06_different_record_ids_produce_different_aad() -> None:
    """Test 6: Distinct record UUIDs produce cryptographically distinct AAD."""
    id1 = uuid.uuid4()
    id2 = uuid.uuid4()
    aad1 = construct_clinical_record_aad(record_id=id1, field_name="diagnosis")
    aad2 = construct_clinical_record_aad(record_id=id2, field_name="diagnosis")

    assert aad1 != aad2
    assert f"anvaya:health_records:{id1}:diagnosis".encode("utf-8") == aad1
    assert f"anvaya:health_records:{id2}:diagnosis".encode("utf-8") == aad2


# ==============================================================================
# 7. DIFFERENT FIELDS PRODUCE DIFFERENT AAD
# ==============================================================================

def test_07_different_fields_produce_different_aad(sample_record_id: uuid.UUID) -> None:
    """Test 7: The same record UUID produces distinct AAD for different clinical fields."""
    aad_diag = construct_clinical_record_aad(record_id=sample_record_id, field_name="diagnosis")
    aad_symp = construct_clinical_record_aad(record_id=sample_record_id, field_name="symptoms")

    assert aad_diag != aad_symp
    assert b":diagnosis" in aad_diag
    assert b":symptoms" in aad_symp


# ==============================================================================
# 8. WRONG RECORD ID DECRYPTION FAILS (AAD TRANSPLANT REJECTION)
# ==============================================================================

def test_08_wrong_record_id_decryption_fails(test_registry: KeyRegistry) -> None:
    """Test 8: Decrypting ciphertext with a different record ID fails closed (detects transplant)."""
    record_id_a = uuid.uuid4()
    record_id_b = uuid.uuid4()

    envelope = encrypt_record_field(
        record_id=record_id_a,
        field_name="diagnosis",
        plaintext="Type 2 Diabetes Mellitus",
        registry=test_registry,
    )

    with pytest.raises(DecryptionError):
        decrypt_record_field(
            record_id=record_id_b,
            field_name="diagnosis",
            envelope=envelope,
            registry=test_registry,
        )


# ==============================================================================
# 9. WRONG FIELD NAME DECRYPTION FAILS
# ==============================================================================

def test_09_wrong_field_name_decryption_fails(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 9: Decrypting ciphertext under a different field name fails closed."""
    envelope = encrypt_record_field(
        record_id=sample_record_id,
        field_name="diagnosis",
        plaintext="Hypertension Stage 1",
        registry=test_registry,
    )

    with pytest.raises(DecryptionError):
        decrypt_record_field(
            record_id=sample_record_id,
            field_name="symptoms",
            envelope=envelope,
            registry=test_registry,
        )


# ==============================================================================
# 10. TAMPERED CIPHERTEXT FAILS CLOSED
# ==============================================================================

def test_10_tampered_ciphertext_fails_closed(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 10: Bit-flipped or modified ciphertext envelope fails closed with DecryptionError."""
    envelope = encrypt_record_field(
        record_id=sample_record_id,
        field_name="treatment_plan",
        plaintext="Amoxicillin 500mg tid for 7 days",
        registry=test_registry,
    )
    assert envelope is not None

    parts = envelope.split(":")
    # Flip characters in base64 payload
    payload = parts[4]
    tampered_payload = ("A" if payload[0] != "A" else "B") + payload[1:]
    tampered_envelope = f"{parts[0]}:{parts[1]}:{parts[2]}:{parts[3]}:{tampered_payload}"

    with pytest.raises(DecryptionError):
        decrypt_record_field(
            record_id=sample_record_id,
            field_name="treatment_plan",
            envelope=tampered_envelope,
            registry=test_registry,
        )


# ==============================================================================
# 11. WRONG KEY FAILS CLOSED
# ==============================================================================

def test_11_wrong_key_fails_closed(sample_record_id: uuid.UUID) -> None:
    """Test 11: Decrypting with an incompatible key under the same key ID fails closed."""
    reg1 = KeyRegistry()
    reg1.register_key("shared_key_id", os.urandom(32), set_active=True)

    reg2 = KeyRegistry()
    reg2.register_key("shared_key_id", os.urandom(32), set_active=True)

    envelope = encrypt_record_field(
        record_id=sample_record_id,
        field_name="clinical_notes",
        plaintext="CONFIDENTIAL OBSERVATION",
        registry=reg1,
    )

    with pytest.raises(DecryptionError):
        decrypt_record_field(
            record_id=sample_record_id,
            field_name="clinical_notes",
            envelope=envelope,
            registry=reg2,
        )


# ==============================================================================
# 12. UNKNOWN KEY ID FAILS CLOSED
# ==============================================================================

def test_12_unknown_key_id_fails_closed(sample_record_id: uuid.UUID) -> None:
    """Test 12: Envelope referencing an unknown key ID raises KeyNotFoundError."""
    empty_registry = KeyRegistry()

    fake_envelope = "enc:v1:unregistered_key_id:AAECAwQFBgcICQoL:AQIDBAUGBwgJCgsMDQ4PEA=="
    with pytest.raises(KeyNotFoundError):
        decrypt_record_field(
            record_id=sample_record_id,
            field_name="diagnosis",
            envelope=fake_envelope,
            registry=empty_registry,
        )


# ==============================================================================
# 13. LEGACY PLAINTEXT DECRYPTION REJECTED (ZERO FALLBACK)
# ==============================================================================

def test_13_legacy_plaintext_decryption_rejected(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 13: Attempting to decrypt unencrypted legacy text raises EnvelopeFormatError."""
    legacy_text = "Patient has history of seasonal allergies."
    with pytest.raises(EnvelopeFormatError):
        decrypt_record_field(
            record_id=sample_record_id,
            field_name="symptoms",
            envelope=legacy_text,
            registry=test_registry,
        )


# ==============================================================================
# 14. VALID CIPHERTEXT DOUBLE-ENCRYPTION REJECTED
# ==============================================================================

def test_14_valid_ciphertext_double_encryption_rejected(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 14: Passing a valid enc:v1: envelope to encrypt_record_field raises DoubleEncryptionError."""
    envelope = encrypt_record_field(
        record_id=sample_record_id,
        field_name="visit_summary",
        plaintext="Initial assessment notes.",
        registry=test_registry,
    )
    assert envelope is not None

    with pytest.raises(DoubleEncryptionError):
        encrypt_record_field(
            record_id=sample_record_id,
            field_name="visit_summary",
            plaintext=envelope,
            registry=test_registry,
        )


# ==============================================================================
# 15. MALFORMED / PREFIX ENVELOPE DOUBLE-ENCRYPTION REJECTED
# ==============================================================================

def test_15_malformed_envelope_prefix_double_encryption_rejected(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 15: Passing strings starting with 'enc:', 'enc:v2:', or standalone 'enc' raises DoubleEncryptionError."""
    dangerous_inputs = [
        "enc:v1:truncated_string",
        "enc:v2:future_version:data",
        "enc:malformed_envelope",
        "enc:",
        "enc",
        "ENC:v1:uppercase_prefix",
        "  enc:v1:with_spaces  ",
    ]

    for dangerous in dangerous_inputs:
        with pytest.raises(DoubleEncryptionError):
            encrypt_record_field(
                record_id=sample_record_id,
                field_name="clinical_notes",
                plaintext=dangerous,
                registry=test_registry,
            )


# ==============================================================================
# 16. UNKNOWN CLINICAL FIELD REJECTED
# ==============================================================================

def test_16_unknown_clinical_field_rejected(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 16: Unknown or unwhitelisted fields are strictly rejected across all helper operations."""
    invalid_field = "patient_credit_card"

    with pytest.raises(InvalidClinicalFieldError):
        construct_clinical_record_aad(record_id=sample_record_id, field_name=invalid_field)

    with pytest.raises(InvalidClinicalFieldError):
        encrypt_record_field(
            record_id=sample_record_id,
            field_name=invalid_field,
            plaintext="Safe narrative",
            registry=test_registry,
        )

    with pytest.raises(InvalidClinicalFieldError):
        decrypt_record_field(
            record_id=sample_record_id,
            field_name=invalid_field,
            envelope="enc:v1:key:nonce:tag",
            registry=test_registry,
        )


# ==============================================================================
# 17. INVALID RECORD UUID REJECTED
# ==============================================================================

def test_17_invalid_record_uuid_rejected() -> None:
    """Test 17: Malformed, non-canonical, empty, or wrong-type record IDs are rejected."""
    invalid_record_ids = [
        "",
        "   ",
        "not-a-uuid",
        "12345678-1234-1234-1234",  # truncated
        "12345678123412341234123456789abc",  # unhyphenated 32 hex
        "{a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d}",  # braced
        "urn:uuid:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",  # URN format
        12345,  # int
        None,   # None
        ["a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"],  # list
    ]

    for bad_id in invalid_record_ids:
        with pytest.raises(InvalidRecordIdError):
            validate_record_id(bad_id)  # type: ignore[arg-type]


# ==============================================================================
# 18. CANONICAL UUID STRING NORMALIZATION
# ==============================================================================

def test_18_canonical_uuid_string_normalization(test_registry: KeyRegistry) -> None:
    """Test 18: Uppercase UUID strings normalize to canonical lowercase and interoperate seamlessly."""
    raw_uuid = uuid.uuid4()
    canonical_lower = str(raw_uuid).lower()
    uppercase_str = str(raw_uuid).upper()

    assert validate_record_id(uppercase_str) == canonical_lower
    assert validate_record_id(raw_uuid) == canonical_lower

    # Encrypt using UUID object, decrypt using uppercase string
    envelope = encrypt_record_field(
        record_id=raw_uuid,
        field_name="treatment_plan",
        plaintext="Physical therapy 2x weekly.",
        registry=test_registry,
    )

    decrypted = decrypt_record_field(
        record_id=uppercase_str,
        field_name="treatment_plan",
        envelope=envelope,
        registry=test_registry,
    )
    assert decrypted == "Physical therapy 2x weekly."


# ==============================================================================
# 19. SELECTIVE DECRYPTION OF THREE AUTHORIZED SCOPES
# ==============================================================================

def test_19_selective_decryption_three_authorized_scopes(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 19: JIT adapter selectively decrypts exactly the three requested scopes."""
    full_data = {
        "visit_summary": "Consultation for back pain.",
        "chief_complaint": "Lumbar ache after heavy lifting.",
        "symptoms": "Stiffness, localized tenderness.",
        "diagnosis": "Lumbar strain.",
        "clinical_notes": "No radiculopathy.",
        "treatment_plan": "Rest and analgesics.",
        "follow_up_instructions": "Return if symptoms worsen.",
    }

    encrypted_record = {
        field: encrypt_record_field(
            record_id=sample_record_id,
            field_name=field,
            plaintext=text,
            registry=test_registry,
        )
        for field, text in full_data.items()
    }

    authorized = ["visit_summary", "diagnosis", "symptoms"]
    result = decrypt_authorized_fields(
        record_id=sample_record_id,
        encrypted_fields=encrypted_record,
        authorized_scopes=authorized,
        registry=test_registry,
    )

    assert set(result.keys()) == set(authorized)
    assert result["visit_summary"] == full_data["visit_summary"]
    assert result["diagnosis"] == full_data["diagnosis"]
    assert result["symptoms"] == full_data["symptoms"]


# ==============================================================================
# 20. FOUR WITHHELD SCOPES ABSENT FROM OUTPUT
# ==============================================================================

def test_20_four_withheld_scopes_absent_from_output(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 20: The four withheld scopes are completely excluded from the output mapping."""
    encrypted_record = {
        field: encrypt_record_field(
            record_id=sample_record_id,
            field_name=field,
            plaintext=f"Data for {field}",
            registry=test_registry,
        )
        for field in CLINICAL_FIELDS
    }

    authorized = ["visit_summary", "diagnosis", "symptoms"]
    withheld = CLINICAL_FIELDS - set(authorized)
    assert len(withheld) == 4

    result = decrypt_authorized_fields(
        record_id=sample_record_id,
        encrypted_fields=encrypted_record,
        authorized_scopes=authorized,
        registry=test_registry,
    )

    for withheld_scope in withheld:
        assert withheld_scope not in result


# ==============================================================================
# 21. WITHHELD FIELDS ARE NEVER PASSED TO DECRYPT FUNCTION (SPY PROOF)
# ==============================================================================

def test_21_withheld_fields_never_passed_to_decrypt(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 21: Spies on decrypt_record_field to prove withheld fields are NEVER touched in memory."""
    encrypted_record = {
        field: encrypt_record_field(
            record_id=sample_record_id,
            field_name=field,
            plaintext=f"Secret payload for {field}",
            registry=test_registry,
        )
        for field in sorted(CLINICAL_FIELDS)
    }

    authorized = ["visit_summary", "symptoms"]
    withheld = CLINICAL_FIELDS - set(authorized)

    with unittest.mock.patch(
        "app.services.clinical_crypto_service.decrypt_record_field",
        wraps=decrypt_record_field,
    ) as decrypt_spy:
        result = decrypt_authorized_fields(
            record_id=sample_record_id,
            encrypted_fields=encrypted_record,
            authorized_scopes=authorized,
            registry=test_registry,
        )

        assert decrypt_spy.call_count == 2
        invoked_fields = [call.kwargs.get("field_name") for call in decrypt_spy.call_args_list]

        assert set(invoked_fields) == set(authorized)
        for withheld_field in withheld:
            assert withheld_field not in invoked_fields


# ==============================================================================
# 22. EMPTY AUTHORIZED SCOPES RETURN EMPTY OUTPUT
# ==============================================================================

def test_22_empty_authorized_scopes_return_empty_output(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 22: When authorized_scopes is empty, an empty dictionary is returned with zero decrypt calls."""
    encrypted_record = {
        "visit_summary": encrypt_record_field(
            record_id=sample_record_id,
            field_name="visit_summary",
            plaintext="Summary",
            registry=test_registry,
        )
    }

    result = decrypt_authorized_fields(
        record_id=sample_record_id,
        encrypted_fields=encrypted_record,
        authorized_scopes=[],
        registry=test_registry,
    )
    assert result == {}

    result_set = decrypt_authorized_fields(
        record_id=sample_record_id,
        encrypted_fields=encrypted_record,
        authorized_scopes=set(),
        registry=test_registry,
    )
    assert result_set == {}


# ==============================================================================
# 23. MISSING AUTHORIZED FIELD RAISES CONTROLLED ERROR
# ==============================================================================

def test_23_missing_authorized_field_raises_controlled_error(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 23: If an authorized scope is absent from the encrypted record mapping, fail closed."""
    incomplete_record = {
        "visit_summary": encrypt_record_field(
            record_id=sample_record_id,
            field_name="visit_summary",
            plaintext="Summary",
            registry=test_registry,
        )
    }

    with pytest.raises(MissingFieldError) as exc_info:
        decrypt_authorized_fields(
            record_id=sample_record_id,
            encrypted_fields=incomplete_record,
            authorized_scopes=["visit_summary", "treatment_plan"],
            registry=test_registry,
        )

    assert "treatment_plan" in str(exc_info.value)


# ==============================================================================
# 24. INVALID OR DUPLICATE AUTHORIZED SCOPES REJECTED
# ==============================================================================

def test_24_invalid_or_duplicate_authorized_scopes_rejected(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 24: Strings, duplicate scopes, and unknown fields in authorized_scopes are rejected."""
    valid_record = {
        "visit_summary": encrypt_record_field(
            record_id=sample_record_id,
            field_name="visit_summary",
            plaintext="Summary",
            registry=test_registry,
        )
    }

    # Single string instead of collection
    with pytest.raises(InvalidScopeError):
        decrypt_authorized_fields(
            record_id=sample_record_id,
            encrypted_fields=valid_record,
            authorized_scopes="visit_summary",  # type: ignore[arg-type]
            registry=test_registry,
        )

    # Duplicate scopes in list
    with pytest.raises(InvalidScopeError):
        decrypt_authorized_fields(
            record_id=sample_record_id,
            encrypted_fields=valid_record,
            authorized_scopes=["visit_summary", "visit_summary"],
            registry=test_registry,
        )

    # Unknown scope
    with pytest.raises(InvalidClinicalFieldError):
        decrypt_authorized_fields(
            record_id=sample_record_id,
            encrypted_fields=valid_record,
            authorized_scopes=["visit_summary", "billing_statement"],
            registry=test_registry,
        )


# ==============================================================================
# 25. NO SENSITIVE VALUES APPEAR IN EXCEPTION MESSAGES
# ==============================================================================

def test_25_no_sensitive_values_appear_in_exception_messages(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 25: Validates that error messages never leak plaintext narratives or secret keys."""
    sensitive_secret_text = "CONFIDENTIAL_PATIENT_HIV_STATUS_POSITIVE"

    # Double-encryption rejection
    with pytest.raises(DoubleEncryptionError) as exc_info:
        encrypt_record_field(
            record_id=sample_record_id,
            field_name="diagnosis",
            plaintext="enc:v1:fake_envelope",
            registry=test_registry,
        )
    assert sensitive_secret_text not in str(exc_info.value)
    assert "fake_envelope" not in str(exc_info.value)

    # Invalid field rejection
    with pytest.raises(InvalidClinicalFieldError) as exc_info:
        encrypt_record_field(
            record_id=sample_record_id,
            field_name="unauthorized_field",
            plaintext=sensitive_secret_text,
            registry=test_registry,
        )
    assert sensitive_secret_text not in str(exc_info.value)


# ==============================================================================
# 26. KEY ROTATION & HISTORICAL KEY DECRYPTABILITY
# ==============================================================================

def test_26_key_rotation_historical_decryptability(sample_record_id: uuid.UUID) -> None:
    """Test 26: Rotating the active key preserves the ability to decrypt historical records."""
    key_v1 = os.urandom(32)
    key_v2 = os.urandom(32)

    registry = KeyRegistry()
    registry.register_key("key_2025", key_v1, set_active=True)

    # Encrypt record under key_2025
    envelope_v1 = encrypt_record_field(
        record_id=sample_record_id,
        field_name="visit_summary",
        plaintext="Historical visit note from 2025.",
        registry=registry,
    )
    assert envelope_v1 is not None
    assert envelope_v1.startswith("enc:v1:key_2025:")

    # Rotate: register key_2026 as active
    registry.register_key("key_2026", key_v2, set_active=True)

    # Encrypt new record under key_2026
    envelope_v2 = encrypt_record_field(
        record_id=sample_record_id,
        field_name="visit_summary",
        plaintext="New visit note from 2026.",
        registry=registry,
    )
    assert envelope_v2 is not None
    assert envelope_v2.startswith("enc:v1:key_2026:")

    # Verify BOTH historical and new records decrypt cleanly from the same registry
    assert decrypt_record_field(
        record_id=sample_record_id,
        field_name="visit_summary",
        envelope=envelope_v1,
        registry=registry,
    ) == "Historical visit note from 2025."

    assert decrypt_record_field(
        record_id=sample_record_id,
        field_name="visit_summary",
        envelope=envelope_v2,
        registry=registry,
    ) == "New visit note from 2026."


# ==============================================================================
# 27. INVALID MAPPING VALUES REJECTED
# ==============================================================================

def test_27_invalid_mapping_values_rejected(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 27: Non-string and non-None field values in encrypted_fields are rejected."""
    bad_record = {
        "visit_summary": 12345,  # int instead of str/None
    }

    with pytest.raises(ClinicalCryptoError):
        decrypt_authorized_fields(
            record_id=sample_record_id,
            encrypted_fields=bad_record,  # type: ignore[arg-type]
            authorized_scopes=["visit_summary"],
            registry=test_registry,
        )


# ==============================================================================
# 28. NON-STRING FIELD KEYS REJECTED
# ==============================================================================

def test_28_non_string_field_keys_rejected(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 28: Non-string dictionary keys in encrypted_fields are rejected."""
    bad_record = {
        999: "enc:v1:key:nonce:tag",  # integer key
    }

    with pytest.raises(InvalidClinicalFieldError):
        decrypt_authorized_fields(
            record_id=sample_record_id,
            encrypted_fields=bad_record,  # type: ignore[arg-type]
            authorized_scopes=["visit_summary"],
            registry=test_registry,
        )


# ==============================================================================
# 29. UNEXPECTED DATA TYPES REJECTED
# ==============================================================================

def test_29_unexpected_data_types_rejected(sample_record_id: uuid.UUID) -> None:
    """Test 29: None registry or wrong types for arguments are rejected with ClinicalCryptoError."""
    with pytest.raises(ClinicalCryptoError):
        encrypt_record_field(
            record_id=sample_record_id,
            field_name="diagnosis",
            plaintext="Mild flu",
            registry=None,  # type: ignore[arg-type]
        )

    with pytest.raises(ClinicalCryptoError):
        encrypt_record_field(
            record_id=sample_record_id,
            field_name="diagnosis",
            plaintext=12345,  # type: ignore[arg-type]
            registry=KeyRegistry(),
        )


# ==============================================================================
# 30. ZERO EXTERNAL SIDE EFFECTS
# ==============================================================================

def test_30_zero_external_side_effects(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 30: Confirms operations execute purely in-memory without side effects."""
    envelope = encrypt_record_field(
        record_id=sample_record_id,
        field_name="visit_summary",
        plaintext="Side-effect free test",
        registry=test_registry,
    )
    decrypted = decrypt_record_field(
        record_id=sample_record_id,
        field_name="visit_summary",
        envelope=envelope,
        registry=test_registry,
    )
    assert decrypted == "Side-effect free test"


# ==============================================================================
# 31. CLINICAL WORDS NOT FALSELY FLAGGED AS DOUBLE ENCRYPTION
# ==============================================================================

def test_31_clinical_word_not_falsely_flagged(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 31: Clinical terms starting with 'enc' (encephalopathy, encounter, encephalitis) encrypt cleanly."""
    valid_clinical_narratives = [
        "Patient diagnosed with mild hepatic encephalopathy.",
        "Encephalitis ruled out following normal CSF analysis.",
        "Encounter concluded after medication reconciliation.",
        "Enclosing boundary around surgical excision site is 2cm.",
    ]

    for narrative in valid_clinical_narratives:
        envelope = encrypt_record_field(
            record_id=sample_record_id,
            field_name="clinical_notes",
            plaintext=narrative,
            registry=test_registry,
        )
        assert envelope is not None
        assert envelope.startswith("enc:v1:")
        decrypted = decrypt_record_field(
            record_id=sample_record_id,
            field_name="clinical_notes",
            envelope=envelope,
            registry=test_registry,
        )
        assert decrypted == narrative


# ==============================================================================
# 32. AUTHORIZED SCOPE WITH NONE VALUE
# ==============================================================================

def test_32_authorized_scope_with_none_value(test_registry: KeyRegistry, sample_record_id: uuid.UUID) -> None:
    """Test 32: An authorized scope whose value in encrypted_fields is None preserves None in output."""
    record_with_null = {
        "visit_summary": encrypt_record_field(
            record_id=sample_record_id,
            field_name="visit_summary",
            plaintext="Visit summary text",
            registry=test_registry,
        ),
        "symptoms": None,
    }

    result = decrypt_authorized_fields(
        record_id=sample_record_id,
        encrypted_fields=record_with_null,
        authorized_scopes=["visit_summary", "symptoms"],
        registry=test_registry,
    )

    assert result["visit_summary"] == "Visit summary text"
    assert result["symptoms"] is None

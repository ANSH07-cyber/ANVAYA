"""
ANVAYA Clinical Core Cryptographic Foundation Unit Test Suite
Target: app.core.crypto

Fully isolated in-memory unit tests using synthetic keys and fictional clinical
narratives. Zero database connections, zero external services, zero filesystem secrets.
"""

from __future__ import annotations

import base64
import os
import re
import pytest

from app.core.crypto import (
    CryptoError,
    CryptoKeyError,
    DecryptionError,
    EnvelopeFormatError,
    KeyNotFoundError,
    KeyRegistry,
    decrypt_clinical_text,
    default_registry,
    encrypt_clinical_text,
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
    registry.register_key("test_key_primary", synthetic_key_primary, set_active=True)
    registry.register_key("test_key_secondary", synthetic_key_secondary, set_active=False)
    return registry


# ==============================================================================
# 1. BASIC AES-GCM TEXT ROUND TRIP
# ==============================================================================

def test_01_basic_text_round_trip(test_registry: KeyRegistry) -> None:
    """Test 1: Standard clinical plaintext round-trip encryption and authenticated decryption."""
    plaintext = "Patient presents for routine follow-up. Vital signs stable. Blood pressure 120/80 mmHg."
    envelope = encrypt_clinical_text(plaintext, registry=test_registry)

    assert isinstance(envelope, str)
    assert envelope.startswith("enc:v1:test_key_primary:")

    decrypted = decrypt_clinical_text(envelope, registry=test_registry)
    assert decrypted == plaintext


# ==============================================================================
# 2. UNICODE, HINDI, SYMBOLS, AND EMOJI ROUND TRIP
# ==============================================================================

def test_02_unicode_hindi_and_symbols_round_trip(test_registry: KeyRegistry) -> None:
    """Test 2: Verifies exact UTF-8 preservation of Hindi (हिंदी), French accents, and symbols."""
    multilingual_text = (
        "रोगी को हल्का बुखार और सिरदर्द है (Patient reports mild fever and headache). "
        "Prescribed Paracétamol 500mg — Take with warm water. "
        "Temperature: 38.2°C ± 0.3°C. Clinical status: Stable 🩺."
    )
    envelope = encrypt_clinical_text(multilingual_text, registry=test_registry)
    decrypted = decrypt_clinical_text(envelope, registry=test_registry)
    assert decrypted == multilingual_text


# ==============================================================================
# 3. EMPTY STRING ROUND TRIP
# ==============================================================================

def test_03_empty_string_round_trip(test_registry: KeyRegistry) -> None:
    """Test 3: Verifies encrypting an empty string produces a valid envelope and decrypts to empty string."""
    envelope = encrypt_clinical_text("", registry=test_registry)
    assert isinstance(envelope, str)
    assert envelope.startswith("enc:v1:test_key_primary:")

    decrypted = decrypt_clinical_text(envelope, registry=test_registry)
    assert decrypted == ""


# ==============================================================================
# 4. LARGE 50 KB CLINICAL NARRATIVE ROUND TRIP
# ==============================================================================

def test_04_large_clinical_narrative_round_trip(test_registry: KeyRegistry) -> None:
    """Test 4: Verifies round-trip integrity for a substantial 50 KB clinical discharge narrative."""
    chunk = "Comprehensive clinical history: Patient evaluation, diagnostic lab review, treatment notes.\n"
    large_text = chunk * (50 * 1024 // len(chunk) + 1)
    assert len(large_text.encode("utf-8")) >= 50 * 1024

    envelope = encrypt_clinical_text(large_text, registry=test_registry)
    decrypted = decrypt_clinical_text(envelope, registry=test_registry)
    assert decrypted == large_text


# ==============================================================================
# 5. FRESH NONCE UNIQUENESS ACROSS REPEATED ENCRYPTIONS
# ==============================================================================

def test_05_nonce_uniqueness_across_encryptions(test_registry: KeyRegistry) -> None:
    """Test 5: Encrypting identical plaintext twice produces distinct nonces and distinct ciphertexts."""
    plaintext = "Repeat diagnostic evaluation note."
    env1 = encrypt_clinical_text(plaintext, registry=test_registry)
    env2 = encrypt_clinical_text(plaintext, registry=test_registry)

    assert env1 != env2

    parts1 = env1.split(":")
    parts2 = env2.split(":")

    # Nonce (part index 3) must be distinct
    assert parts1[3] != parts2[3]
    # Ciphertext + tag (part index 4) must be distinct
    assert parts1[4] != parts2[4]

    # Both decrypt to identical plaintext
    assert decrypt_clinical_text(env1, registry=test_registry) == plaintext
    assert decrypt_clinical_text(env2, registry=test_registry) == plaintext


# ==============================================================================
# 6. TAMPERED CIPHERTEXT REJECTION
# ==============================================================================

def test_06_tampered_ciphertext_rejected(test_registry: KeyRegistry) -> None:
    """Test 6: Flipped bit in ciphertext payload causes authentication tag failure."""
    plaintext = "Confidential clinical diagnosis."
    envelope = encrypt_clinical_text(plaintext, registry=test_registry)

    prefix, version, key_id, b64_nonce, b64_payload = envelope.split(":")
    payload_bytes = bytearray(base64.b64decode(b64_payload))

    # Flip bits in the ciphertext portion (first byte)
    payload_bytes[0] ^= 0x01
    tampered_b64_payload = base64.b64encode(bytes(payload_bytes)).decode("ascii")
    tampered_envelope = f"{prefix}:{version}:{key_id}:{b64_nonce}:{tampered_b64_payload}"

    with pytest.raises(DecryptionError, match="Authenticated decryption failed"):
        decrypt_clinical_text(tampered_envelope, registry=test_registry)


# ==============================================================================
# 7. TAMPERED AUTHENTICATION TAG REJECTION
# ==============================================================================

def test_07_tampered_tag_rejected(test_registry: KeyRegistry) -> None:
    """Test 7: Flipped bit in the 16-byte GCM tag causes authentication failure."""
    plaintext = "Sensitive treatment instructions."
    envelope = encrypt_clinical_text(plaintext, registry=test_registry)

    prefix, version, key_id, b64_nonce, b64_payload = envelope.split(":")
    payload_bytes = bytearray(base64.b64decode(b64_payload))

    # Flip bits in the authentication tag portion (last byte)
    payload_bytes[-1] ^= 0xFF
    tampered_b64_payload = base64.b64encode(bytes(payload_bytes)).decode("ascii")
    tampered_envelope = f"{prefix}:{version}:{key_id}:{b64_nonce}:{tampered_b64_payload}"

    with pytest.raises(DecryptionError, match="Authenticated decryption failed"):
        decrypt_clinical_text(tampered_envelope, registry=test_registry)


# ==============================================================================
# 8. TAMPERED NONCE REJECTION
# ==============================================================================

def test_08_tampered_nonce_rejected(test_registry: KeyRegistry) -> None:
    """Test 8: Altering the nonce causes authentication failure."""
    plaintext = "Standard clinical examination findings."
    envelope = encrypt_clinical_text(plaintext, registry=test_registry)

    prefix, version, key_id, b64_nonce, b64_payload = envelope.split(":")
    nonce_bytes = bytearray(base64.b64decode(b64_nonce))
    nonce_bytes[0] ^= 0x55
    tampered_b64_nonce = base64.b64encode(bytes(nonce_bytes)).decode("ascii")
    tampered_envelope = f"{prefix}:{version}:{key_id}:{tampered_b64_nonce}:{b64_payload}"

    with pytest.raises(DecryptionError, match="Authenticated decryption failed"):
        decrypt_clinical_text(tampered_envelope, registry=test_registry)


# ==============================================================================
# 9. WRONG ENCRYPTION KEY REJECTION
# ==============================================================================

def test_09_wrong_key_rejected(synthetic_key_primary: bytes, synthetic_key_secondary: bytes) -> None:
    """Test 9: Attempting to decrypt with a key different from the encryption key fails closed."""
    reg_a = KeyRegistry()
    reg_a.register_key("common_key_id", synthetic_key_primary, set_active=True)

    reg_b = KeyRegistry()
    reg_b.register_key("common_key_id", synthetic_key_secondary, set_active=True)

    envelope = encrypt_clinical_text("Clinical note encrypted under Key A", registry=reg_a)

    with pytest.raises(DecryptionError, match="Authenticated decryption failed"):
        decrypt_clinical_text(envelope, registry=reg_b)


# ==============================================================================
# 10. UNKNOWN KEY ID REJECTION
# ==============================================================================

def test_10_unknown_key_id_rejected(test_registry: KeyRegistry) -> None:
    """Test 10: Referencing an unregistered key_id in an envelope raises KeyNotFoundError."""
    plaintext = "Cardiology evaluation summary."
    envelope = encrypt_clinical_text(plaintext, registry=test_registry)

    prefix, version, _, b64_nonce, b64_payload = envelope.split(":")
    unregistered_envelope = f"{prefix}:{version}:unknown_key_999:{b64_nonce}:{b64_payload}"

    with pytest.raises(KeyNotFoundError, match="is not registered"):
        decrypt_clinical_text(unregistered_envelope, registry=test_registry)


# ==============================================================================
# 11. CORRECT AAD RECORD BINDING DECRYPTS SUCCESSFULLY
# ==============================================================================

def test_11_correct_aad_decrypts_successfully(test_registry: KeyRegistry) -> None:
    """Test 11: Supplying matching AAD during both encryption and decryption succeeds."""
    plaintext = "Patient reported symptoms: Persistent cough for 3 days."
    record_aad = b"anvaya:health_record:rec-synth-001:symptoms"

    envelope = encrypt_clinical_text(plaintext, aad=record_aad, registry=test_registry)
    decrypted = decrypt_clinical_text(envelope, aad=record_aad, registry=test_registry)

    assert decrypted == plaintext


# ==============================================================================
# 12. INCORRECT AAD REJECTION (TRANSPLANT DEFENSE)
# ==============================================================================

def test_12_mismatched_aad_rejected(test_registry: KeyRegistry) -> None:
    """Test 12: Supplying mismatched AAD during decryption fails authentication immediately."""
    plaintext = "Diagnosis: Acute bronchitis."
    aad_patient_a = b"anvaya:health_record:patient-synth-001:diagnosis"
    aad_patient_b = b"anvaya:health_record:patient-synth-002:diagnosis"

    envelope = encrypt_clinical_text(plaintext, aad=aad_patient_a, registry=test_registry)

    # Transplant attack: attempting to decrypt under Patient B's identity
    with pytest.raises(DecryptionError, match="Authenticated decryption failed"):
        decrypt_clinical_text(envelope, aad=aad_patient_b, registry=test_registry)


# ==============================================================================
# 13. MISSING REQUIRED AAD REJECTION
# ==============================================================================

def test_13_missing_aad_rejected(test_registry: KeyRegistry) -> None:
    """Test 13: Encrypting with AAD and attempting to decrypt without AAD fails authentication."""
    plaintext = "Treatment plan: Amoxicillin 500mg TDS for 5 days."
    record_aad = b"anvaya:health_record:rec-synth-003:treatment_plan"

    envelope = encrypt_clinical_text(plaintext, aad=record_aad, registry=test_registry)

    # Omitting AAD
    with pytest.raises(DecryptionError, match="Authenticated decryption failed"):
        decrypt_clinical_text(envelope, aad=None, registry=test_registry)

    # Conversely: encrypted without AAD, decrypted with AAD
    envelope_no_aad = encrypt_clinical_text(plaintext, aad=None, registry=test_registry)
    with pytest.raises(DecryptionError, match="Authenticated decryption failed"):
        decrypt_clinical_text(envelope_no_aad, aad=record_aad, registry=test_registry)


# ==============================================================================
# 14. MALFORMED ENVELOPE STRUCTURE REJECTION
# ==============================================================================

@pytest.mark.parametrize(
    "malformed_envelope",
    [
        "not_an_envelope",
        "enc:v1:key1:nonce_only",
        "enc:v1:key1:nonce:payload:extra_part",
        ":v1:key1:nonce:payload",
        "enc::key1:nonce:payload",
        "enc:v1::nonce:payload",
        "enc:v1:key1::payload",
        "enc:v1:key1:nonce:",
    ],
)
def test_14_malformed_envelope_rejected(malformed_envelope: str, test_registry: KeyRegistry) -> None:
    """Test 14: Envelopes with incorrect delimiter count or empty required components raise EnvelopeFormatError."""
    with pytest.raises(EnvelopeFormatError):
        decrypt_clinical_text(malformed_envelope, registry=test_registry)


# ==============================================================================
# 15. UNSUPPORTED ENVELOPE VERSION REJECTION
# ==============================================================================

def test_15_unsupported_version_rejected(test_registry: KeyRegistry) -> None:
    """Test 15: Envelope with prefix other than 'enc' or version other than 'v1' is rejected."""
    envelope = encrypt_clinical_text("Clinical data", registry=test_registry)
    _, _, key_id, b64_nonce, b64_payload = envelope.split(":")

    bad_prefix = f"bad_prefix:v1:{key_id}:{b64_nonce}:{b64_payload}"
    with pytest.raises(EnvelopeFormatError, match="Unsupported envelope prefix"):
        decrypt_clinical_text(bad_prefix, registry=test_registry)

    bad_version = f"enc:v2:{key_id}:{b64_nonce}:{b64_payload}"
    with pytest.raises(EnvelopeFormatError, match="Unsupported envelope version"):
        decrypt_clinical_text(bad_version, registry=test_registry)


# ==============================================================================
# 16. LEGACY PLAINTEXT REJECTION (FAIL-CLOSED)
# ==============================================================================

def test_16_legacy_plaintext_rejected_fail_closed(test_registry: KeyRegistry) -> None:
    """Test 16: Raw unencrypted clinical plaintext is strictly rejected without fallback."""
    raw_plaintext = "Patient has a history of seasonal allergic rhinitis."
    with pytest.raises(EnvelopeFormatError):
        decrypt_clinical_text(raw_plaintext, registry=test_registry)


# ==============================================================================
# 17. INVALID KEY LENGTH REJECTION
# ==============================================================================

@pytest.mark.parametrize("invalid_len", [0, 16, 24, 31, 33, 64])
def test_17_invalid_key_length_rejected(invalid_len: int) -> None:
    """Test 17: Attempting to register keys that are not exactly 32 bytes raises CryptoKeyError."""
    registry = KeyRegistry()
    with pytest.raises(CryptoKeyError, match="must be exactly 32 bytes"):
        registry.register_key("test_key", b"X" * invalid_len)


# ==============================================================================
# 18. INVALID KEY ID REJECTION
# ==============================================================================

@pytest.mark.parametrize(
    "invalid_id",
    [
        "",
        " ",
        "key with spaces",
        "key/slash",
        "key:colon",
        "key.dot",
        "X" * 65,  # Exceeds 64 chars
    ],
)
def test_18_invalid_key_id_rejected(invalid_id: str) -> None:
    """Test 18: Registering key IDs with spaces, slashes, colons, or excessive length raises CryptoKeyError."""
    registry = KeyRegistry()
    with pytest.raises(CryptoKeyError, match="Key ID must be a non-empty string"):
        registry.register_key(invalid_id, os.urandom(32))


# ==============================================================================
# 19. MISSING ACTIVE REGISTRY KEY REJECTION
# ==============================================================================

def test_19_missing_active_key_rejected() -> None:
    """Test 19: Encrypting without an active key configured in the registry raises KeyNotFoundError."""
    empty_registry = KeyRegistry()
    with pytest.raises(KeyNotFoundError, match="No active encryption key"):
        encrypt_clinical_text("Clinical note", registry=empty_registry)


# ==============================================================================
# 20. ENVELOPE HEADER TAMPERING REJECTION (EVEN WITH IDENTICAL KEY BYTES)
# ==============================================================================

def test_20_envelope_header_tampering_rejected_with_same_key_bytes(synthetic_key_primary: bytes) -> None:
    """
    Test 20: Tampering with key_id in the envelope header causes authenticated tag failure,
    even when both key IDs in the registry reference the EXACT SAME underlying key bytes!
    Proves that the header metadata is cryptographically bound into the AAD.
    """
    registry = KeyRegistry()
    # Register the identical key bytes under two distinct IDs
    registry.register_key("key_alias_alpha", synthetic_key_primary, set_active=True)
    registry.register_key("key_alias_beta", synthetic_key_primary, set_active=False)

    plaintext = "Immunization records: COVID-19 booster administered."
    envelope = encrypt_clinical_text(plaintext, key_id="key_alias_alpha", registry=registry)

    # Tamper with the envelope by altering the key_id to key_alias_beta
    prefix, version, _, b64_nonce, b64_payload = envelope.split(":")
    tampered_envelope = f"{prefix}:{version}:key_alias_beta:{b64_nonce}:{b64_payload}"

    # Must fail because canonical header in AAD was "enc:v1:key_alias_alpha"
    with pytest.raises(DecryptionError, match="Authenticated decryption failed"):
        decrypt_clinical_text(tampered_envelope, registry=registry)


# ==============================================================================
# 21. OVERSIZED OR NON-CANONICAL BASE64 REJECTION
# ==============================================================================

def test_21_non_canonical_and_whitespace_base64_rejected(test_registry: KeyRegistry) -> None:
    """Test 21: Nonces and payloads with whitespace, newlines, or invalid Base64 characters are rejected."""
    plaintext = "Follow-up schedule: Return in 2 weeks."
    envelope = encrypt_clinical_text(plaintext, registry=test_registry)
    prefix, version, key_id, b64_nonce, b64_payload = envelope.split(":")

    # Inject space into nonce
    bad_nonce_envelope = f"{prefix}:{version}:{key_id}:{b64_nonce[:4]} {b64_nonce[4:]}:{b64_payload}"
    with pytest.raises(EnvelopeFormatError, match="whitespace"):
        decrypt_clinical_text(bad_nonce_envelope, registry=test_registry)

    # Inject newline into payload
    bad_payload_envelope = f"{prefix}:{version}:{key_id}:{b64_nonce}:{b64_payload[:10]}\n{b64_payload[10:]}"
    with pytest.raises(EnvelopeFormatError, match="whitespace"):
        decrypt_clinical_text(bad_payload_envelope, registry=test_registry)


# ==============================================================================
# 22. ZERO SECRET LEAKAGE IN EXCEPTIONS
# ==============================================================================

def test_22_zero_secret_leakage_in_exceptions(test_registry: KeyRegistry) -> None:
    """Test 22: Exception messages contain no plaintext, key material, raw tokens, or sensitive AAD."""
    sensitive_plaintext = "SensitiveSecretPassword123"
    sensitive_aad = b"ConfidentialPatientSecretSSN999"

    envelope = encrypt_clinical_text(sensitive_plaintext, aad=sensitive_aad, registry=test_registry)

    # Trigger DecryptionError via bad AAD
    try:
        decrypt_clinical_text(envelope, aad=b"WrongAAD", registry=test_registry)
    except DecryptionError as exc:
        err_msg = str(exc)
        assert sensitive_plaintext not in err_msg
        assert "SensitiveSecret" not in err_msg
        assert "ConfidentialPatientSecret" not in err_msg

    # Trigger KeyNotFoundError
    prefix, version, _, b64_nonce, b64_payload = envelope.split(":")
    secret_key_envelope = f"{prefix}:{version}:key_secret_test:{b64_nonce}:{b64_payload}"
    try:
        decrypt_clinical_text(secret_key_envelope, registry=test_registry)
    except KeyNotFoundError as exc:
        err_msg = str(exc)
        assert sensitive_plaintext not in err_msg


# ==============================================================================
# ADDITIONAL HARDENING TESTS (TC-23 THROUGH TC-27)
# ==============================================================================

def test_23_invalid_input_types_rejected(test_registry: KeyRegistry) -> None:
    """Test 23: Non-string plaintext or non-bytes AAD raises CryptoError."""
    with pytest.raises(CryptoError, match="must be a string"):
        encrypt_clinical_text(12345, registry=test_registry)  # type: ignore

    with pytest.raises(CryptoError, match="must be bytes or None"):
        encrypt_clinical_text("Clinical note", aad="not_bytes", registry=test_registry)  # type: ignore

    with pytest.raises(EnvelopeFormatError, match="must be a string"):
        decrypt_clinical_text(None, registry=test_registry)  # type: ignore


def test_24_duplicate_key_overwrite_protection() -> None:
    """Test 24: Registering the same key_id with different key bytes raises CryptoKeyError."""
    registry = KeyRegistry()
    key1 = os.urandom(32)
    key2 = os.urandom(32)

    registry.register_key("key_1", key1)
    # Re-registering identical bytes is idempotent / allowed
    registry.register_key("key_1", key1)

    # Attempting to overwrite with different bytes raises CryptoKeyError
    with pytest.raises(CryptoKeyError, match="Cannot overwrite"):
        registry.register_key("key_1", key2)


def test_25_historical_key_preservation_after_promotion() -> None:
    """Test 25: Promoting a new active key preserves decryption capability for historical keys."""
    registry = KeyRegistry()
    key_v1 = os.urandom(32)
    key_v2 = os.urandom(32)

    registry.register_key("key_v1", key_v1, set_active=True)
    note_v1 = "Encounter note encrypted under v1."
    env_v1 = encrypt_clinical_text(note_v1, registry=registry)
    assert env_v1.startswith("enc:v1:key_v1:")

    # Promote v2 as the active key
    registry.register_key("key_v2", key_v2, set_active=True)
    note_v2 = "Encounter note encrypted under v2."
    env_v2 = encrypt_clinical_text(note_v2, registry=registry)
    assert env_v2.startswith("enc:v1:key_v2:")

    # Both records decrypt cleanly using the same registry
    assert decrypt_clinical_text(env_v1, registry=registry) == note_v1
    assert decrypt_clinical_text(env_v2, registry=registry) == note_v2


def test_26_clean_default_registry_state() -> None:
    """Test 26: Module-level default_registry initializes completely empty with zero side effects."""
    assert isinstance(default_registry, KeyRegistry)
    assert default_registry.active_key_id is None
    repr_str = repr(default_registry)
    assert "active=None" in repr_str
    assert "registered_keys=[]" in repr_str


def test_27_short_payload_raises_format_error(test_registry: KeyRegistry) -> None:
    """Test 27: Ciphertext payload shorter than 16-byte tag raises EnvelopeFormatError."""
    short_payload_b64 = base64.b64encode(b"short_10B!").decode("ascii")
    dummy_nonce_b64 = base64.b64encode(os.urandom(12)).decode("ascii")
    short_envelope = f"enc:v1:test_key_primary:{dummy_nonce_b64}:{short_payload_b64}"

    with pytest.raises(EnvelopeFormatError, match="Payload too short"):
        decrypt_clinical_text(short_envelope, registry=test_registry)

"""
ANVAYA Clinical Key Recovery & Restoration Unit Test Suite
Target: In-memory key serialization, restoration, and cryptographic recovery validation
Phase: Gate 2B Phase 3C-2C

Validates that:
1. Ephemeral synthetic AES-256 keys can be reconstructed from memory representations
   (e.g., matching the application's CLINICAL_ENCRYPTION_KEYS_JSON contract).
2. Ciphertexts encrypted under the original KeyRegistry instance can be decrypted
   identically by a restored, independent KeyRegistry instance.
3. Rotation, absent keys, wrong keys, and tampering fail closed with sanitized errors.
4. Key material and plaintext are NEVER leaked in exception messages or logs.

ZERO database connections, ZERO filesystem secrets, ZERO network requests.
"""

from __future__ import annotations

import base64
import json
import os
import uuid
import pytest

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
    construct_clinical_record_aad,
    decrypt_record_field,
    decrypt_authorized_fields,
    encrypt_record_field,
    validate_record_id,
)


# ==============================================================================
# IN-MEMORY KEY SERIALIZATION / RESTORATION HELPERS
# (Simulating application startup lifespan serialization without disk persistence)
# ==============================================================================

def export_in_memory_keys_json(keys_map: dict[str, bytes]) -> str:
    """Exports raw key bytes to a canonical Base64 JSON dictionary in process memory."""
    b64_map = {
        kid: base64.b64encode(kbytes).decode("ascii")
        for kid, kbytes in keys_map.items()
    }
    return json.dumps(b64_map)


def restore_registry_from_memory_json(
    keys_json: str,
    active_key_id: str | None = None,
) -> KeyRegistry:
    """Reconstructs an independent KeyRegistry from an in-memory JSON string."""
    registry = KeyRegistry()
    keys_dict = json.loads(keys_json)
    for kid, kb64 in keys_dict.items():
        kbytes = base64.b64decode(kb64, validate=True)
        registry.register_key(kid, kbytes, set_active=(kid == active_key_id))
    return registry


# ==============================================================================
# TEST SUITE: SYNTHETIC KEY RECOVERY (SCENARIOS 1 - 16)
# ==============================================================================

class TestClinicalKeyRecovery:
    """Tests synthetic key recovery across independent KeyRegistry lifecycles."""

    def test_01_to_08_ephemeral_key_generation_destruction_and_recovery(self):
        """Scenarios 1-8: Full lifecycle of ephemeral key creation, encryption,

        registry destruction, independent restoration, and authenticated decryption.
        """
        # 1. Generate ephemeral synthetic 32-byte key
        key_id = "canary_key_2026_v1"
        raw_key = os.urandom(32)

        # 2. Register in first registry
        registry_primary = KeyRegistry()
        registry_primary.register_key(key_id, raw_key, set_active=True)

        # 3. Encrypt synthetic text with canonical record-and-field AAD
        record_id = uuid.uuid4()
        field_name = "visit_summary"
        plaintext = "Patient presented for routine hypertension checkup. BP 124/82."

        ciphertext = encrypt_record_field(
            record_id=record_id,
            field_name=field_name,
            plaintext=plaintext,
            registry=registry_primary,
        )
        assert ciphertext is not None
        assert ciphertext.startswith(f"enc:v1:{key_id}:")

        # 4. Export synthetic key representation in process memory only
        memory_json = export_in_memory_keys_json({key_id: raw_key})

        # 5. Destroy first registry reference
        del registry_primary

        # 6. Construct second independent KeyRegistry
        # 7. Restore synthetic key bytes from in-memory representation
        registry_restored = restore_registry_from_memory_json(memory_json, active_key_id=key_id)

        # 8. Decrypt the original ciphertext successfully
        recovered_text = decrypt_record_field(
            record_id=record_id,
            field_name=field_name,
            envelope=ciphertext,
            registry=registry_restored,
        )
        assert recovered_text == plaintext

    def test_09_unicode_hindi_and_empty_string_recovery(self):
        """Scenario 9: Verify exact recovery of Devanagari/Hindi Unicode, emojis, and empty strings."""
        key_id = "unicode_test_key_v1"
        raw_key = os.urandom(32)
        memory_json = export_in_memory_keys_json({key_id: raw_key})

        registry_1 = restore_registry_from_memory_json(memory_json, active_key_id=key_id)
        record_id = uuid.uuid4()

        hindi_text = "रोगी को पिछले 3 दिनों से लगातार गंभीर सिरदर्द और थकान है। दवा: पैरासिटामोल 650mg।"
        empty_text = ""
        special_text = "Patient said: \"Heart fluttered\" & dizzy; BP < 90/60 mmHg (mild shock)."

        cipher_hindi = encrypt_record_field(
            record_id=record_id, field_name="chief_complaint", plaintext=hindi_text, registry=registry_1
        )
        cipher_empty = encrypt_record_field(
            record_id=record_id, field_name="symptoms", plaintext=empty_text, registry=registry_1
        )
        cipher_special = encrypt_record_field(
            record_id=record_id, field_name="clinical_notes", plaintext=special_text, registry=registry_1
        )

        del registry_1

        registry_2 = restore_registry_from_memory_json(memory_json, active_key_id=key_id)

        assert decrypt_record_field(
            record_id=record_id, field_name="chief_complaint", envelope=cipher_hindi, registry=registry_2
        ) == hindi_text

        assert decrypt_record_field(
            record_id=record_id, field_name="symptoms", envelope=cipher_empty, registry=registry_2
        ) == empty_text

        assert decrypt_record_field(
            record_id=record_id, field_name="clinical_notes", envelope=cipher_special, registry=registry_2
        ) == special_text

    def test_10_recovery_fails_when_key_material_absent(self):
        """Scenario 10: Verify recovery fails closed when key material is not registered."""
        key_id = "original_key"
        raw_key = os.urandom(32)
        registry_orig = KeyRegistry()
        registry_orig.register_key(key_id, raw_key, set_active=True)

        record_id = uuid.uuid4()
        ciphertext = encrypt_record_field(
            record_id=record_id, field_name="diagnosis", plaintext="Asthma", registry=registry_orig
        )

        # Empty restored registry (missing key)
        empty_registry = KeyRegistry()

        with pytest.raises(KeyNotFoundError) as exc_info:
            decrypt_record_field(
                record_id=record_id, field_name="diagnosis", envelope=ciphertext, registry=empty_registry
            )
        assert key_id in str(exc_info.value)

    def test_11_wrong_key_material_fails_authenticated_decryption(self):
        """Scenario 11: Verify wrong-key material under the same key_id fails decryption (AEAD tag mismatch)."""
        key_id = "colliding_key_id"
        correct_key = os.urandom(32)
        wrong_key = os.urandom(32)
        assert correct_key != wrong_key

        reg_enc = KeyRegistry()
        reg_enc.register_key(key_id, correct_key, set_active=True)

        record_id = uuid.uuid4()
        ciphertext = encrypt_record_field(
            record_id=record_id, field_name="treatment_plan", plaintext="Inhaler BID", registry=reg_enc
        )

        reg_wrong = KeyRegistry()
        reg_wrong.register_key(key_id, wrong_key, set_active=True)

        with pytest.raises(DecryptionError):
            decrypt_record_field(
                record_id=record_id, field_name="treatment_plan", envelope=ciphertext, registry=reg_wrong
            )

    def test_12_incorrect_record_id_or_field_name_fails_decryption(self):
        """Scenario 12: Verify incorrect record UUID or field name in AAD fails authenticated decryption."""
        key_id = "aad_test_key"
        raw_key = os.urandom(32)
        registry = KeyRegistry()
        registry.register_key(key_id, raw_key, set_active=True)

        rec_a = uuid.uuid4()
        rec_b = uuid.uuid4()
        ciphertext = encrypt_record_field(
            record_id=rec_a, field_name="visit_summary", plaintext="Record A notes", registry=registry
        )

        # Wrong record ID
        with pytest.raises(DecryptionError):
            decrypt_record_field(
                record_id=rec_b, field_name="visit_summary", envelope=ciphertext, registry=registry
            )

        # Wrong field name
        with pytest.raises(DecryptionError):
            decrypt_record_field(
                record_id=rec_a, field_name="diagnosis", envelope=ciphertext, registry=registry
            )

    def test_13_historical_key_rotation_compatibility(self):
        """Scenario 13: Verify historical key rotation: older key decrypts past records,

        newer active key encrypts new records, both coexisting in restored registry.
        """
        key_v1 = os.urandom(32)
        key_v2 = os.urandom(32)

        # Phase 1: v1 is active
        reg_v1 = KeyRegistry()
        reg_v1.register_key("key_v1", key_v1, set_active=True)

        rec_old = uuid.uuid4()
        cipher_old = encrypt_record_field(
            record_id=rec_old, field_name="visit_summary", plaintext="Historical visit 2025", registry=reg_v1
        )
        assert cipher_old.startswith("enc:v1:key_v1:")

        # Phase 2: Key rotation to v2; v1 preserved as historical
        keys_json = export_in_memory_keys_json({"key_v1": key_v1, "key_v2": key_v2})
        reg_rotated = restore_registry_from_memory_json(keys_json, active_key_id="key_v2")

        rec_new = uuid.uuid4()
        cipher_new = encrypt_record_field(
            record_id=rec_new, field_name="visit_summary", plaintext="Current visit 2026", registry=reg_rotated
        )
        assert cipher_new.startswith("enc:v1:key_v2:")

        # Decrypt both records under rotated registry
        assert decrypt_record_field(
            record_id=rec_old, field_name="visit_summary", envelope=cipher_old, registry=reg_rotated
        ) == "Historical visit 2025"

        assert decrypt_record_field(
            record_id=rec_new, field_name="visit_summary", envelope=cipher_new, registry=reg_rotated
        ) == "Current visit 2026"

    def test_14_missing_historical_key_causes_controlled_failure(self):
        """Scenario 14: Verify that if an old historical key is omitted during restoration,

        accessing old records raises sanitized KeyNotFoundError while new records still decrypt.
        """
        key_v1 = os.urandom(32)
        key_v2 = os.urandom(32)

        reg_v1 = KeyRegistry()
        reg_v1.register_key("key_v1", key_v1, set_active=True)
        rec_old = uuid.uuid4()
        cipher_old = encrypt_record_field(
            record_id=rec_old, field_name="visit_summary", plaintext="Old record", registry=reg_v1
        )

        # Restored registry only contains key_v2 (key_v1 lost or omitted)
        reg_partial = KeyRegistry()
        reg_partial.register_key("key_v2", key_v2, set_active=True)

        with pytest.raises(KeyNotFoundError) as exc_info:
            decrypt_record_field(
                record_id=rec_old, field_name="visit_summary", envelope=cipher_old, registry=reg_partial
            )
        assert "key_v1" in str(exc_info.value)

    def test_15_canonical_key_and_base64_validation(self):
        """Scenario 15: Verify key identifiers and Base64 representations are canonical."""
        # Non-32-byte key rejected by KeyRegistry
        with pytest.raises(CryptoKeyError):
            KeyRegistry().register_key("short_key", b"only_16_bytes_long!")

        with pytest.raises(CryptoKeyError):
            KeyRegistry().register_key("long_key", os.urandom(64))

        # Empty or non-string key ID rejected
        with pytest.raises((CryptoKeyError, ValueError)):
            KeyRegistry().register_key("", os.urandom(32))

        # Base64 with whitespace or invalid chars rejected during restoration
        bad_b64 = "====NotBase64===="
        with pytest.raises(Exception):
            base64.b64decode(bad_b64, validate=True)

    def test_16_sanitized_exceptions_zero_key_or_plaintext_leakage(self):
        """Scenario 16: Verify exception messages never expose key bytes, base64 strings, or plaintext."""
        secret_plaintext = "CONFIDENTIAL_PATIENT_HIV_STATUS_POSITIVE"
        raw_key = os.urandom(32)
        key_b64 = base64.b64encode(raw_key).decode("ascii")

        reg = KeyRegistry()
        reg.register_key("secret_key_id", raw_key, set_active=True)
        rec_id = uuid.uuid4()

        ciphertext = encrypt_record_field(
            record_id=rec_id, field_name="diagnosis", plaintext=secret_plaintext, registry=reg
        )

        # Corrupt ciphertext envelope
        corrupted_envelope = ciphertext[:-6] + "xxxxxx"

        try:
            decrypt_record_field(
                record_id=rec_id, field_name="diagnosis", envelope=corrupted_envelope, registry=reg
            )
            pytest.fail("Should have raised DecryptionError or EnvelopeFormatError")
        except CryptoError as e:
            err_msg = str(e)
            assert secret_plaintext not in err_msg, "Plaintext leaked in error message!"
            assert key_b64 not in err_msg, "Key Base64 leaked in error message!"
            assert str(raw_key) not in err_msg, "Raw key bytes leaked in error message!"

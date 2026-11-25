"""
ANVAYA Clinical Storage Cryptographic Service Adapter
Module: app.services.clinical_crypto_service

Provides record-and-field bound AES-256-GCM encryption and decryption for ANVAYA's
clinical storage layer. Reuses the core cryptographic engine in `app.core.crypto`.

Key Security Architectural Principles:
1. Canonical Additional Authenticated Data (AAD):
   Binds the immutable record UUID and canonical clinical field name to prevent
   ciphertext transplant attacks across records or fields.
2. Just-In-Time (JIT) Selective Decryption:
   Decrypts ONLY the clinical scopes already authorized by the Gate 2A consent system.
   Withheld fields are NEVER decrypted into application memory.
3. Accidental Double-Encryption Defense:
   Rejects inputs that appear to be versioned envelopes or envelope prefixes.
   (Limitation: Prefix inspection is a defensive guard against accidental operational
   re-encryption; it is not a substitute for strict typing at application boundaries).
4. Explicit Key Custody:
   Requires an explicitly provided KeyRegistry instance for all operations. Does not
   depend on or mutate the global default registry.
5. Strict Fail-Closed Verification:
   Rejects legacy plaintext, corrupted envelopes, tampered tags, and unknown fields
   with sanitized exceptions. Zero plaintext fallback.
"""

from __future__ import annotations

import collections.abc
import re
import uuid
from typing import Collection, Mapping

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

# ==============================================================================
# CANONICAL CLINICAL FIELD & AAD SPECIFICATIONS
# ==============================================================================

# Canonical allowlist of supported EHR clinical fields (strictly 7 fields)
CLINICAL_FIELDS: frozenset[str] = frozenset({
    "visit_summary",
    "chief_complaint",
    "symptoms",
    "diagnosis",
    "clinical_notes",
    "treatment_plan",
    "follow_up_instructions",
})

# Canonical domain separation prefix for health record AAD
CLINICAL_AAD_DOMAIN_PREFIX: str = "anvaya:health_records"

# Strict canonical hyphenated UUID pattern (8-4-4-4-12 hex characters)
UUID_CANONICAL_PATTERN: re.Pattern[str] = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

# Guard against accidental double-encryption:
# Matches "enc:" prefix (e.g. "enc:v1:...") or standalone "enc", case-insensitive.
# Does NOT match ordinary clinical words like "encephalopathy", "encounter", or "enclosing".
ENVELOPE_PREFIX_GUARD: re.Pattern[str] = re.compile(r"^enc(?::|$)", re.IGNORECASE)


# ==============================================================================
# SANITIZED EXCEPTION HIERARCHY
# ==============================================================================

class ClinicalCryptoError(CryptoError):
    """Base exception for all clinical crypto service adapter operations."""


class InvalidRecordIdError(ClinicalCryptoError):
    """Raised when a health record identifier is missing, malformed, noncanonical, or unsupported."""


class InvalidClinicalFieldError(ClinicalCryptoError):
    """Raised when a field name or requested scope is not in the canonical CLINICAL_FIELDS allowlist."""


class DoubleEncryptionError(ClinicalCryptoError):
    """Raised when an input value appears to be an encrypted envelope, preventing double-encryption."""


class MissingFieldError(ClinicalCryptoError):
    """Raised when an authorized clinical scope is absent from the input record mapping."""


class InvalidScopeError(ClinicalCryptoError):
    """Raised when authorized_scopes is malformed, not a collection, or contains duplicate scopes."""


# ==============================================================================
# IDENTIFIER VALIDATION & AAD BINDING HELPERS
# ==============================================================================

def validate_record_id(record_id: uuid.UUID | str) -> str:
    """
    Validates and normalizes a health record identifier to a canonical lowercase UUID string.

    Args:
        record_id: A uuid.UUID instance or a strictly formatted canonical UUID string.

    Returns:
        Canonical lowercase hyphenated 36-character UUID string.

    Raises:
        InvalidRecordIdError: If record_id is empty, noncanonical, malformed, or of unsupported type.
    """
    if isinstance(record_id, uuid.UUID):
        return str(record_id).lower()

    if isinstance(record_id, str):
        cleaned = record_id.strip()
        if not cleaned:
            raise InvalidRecordIdError("Record ID cannot be empty or whitespace.")
        if not UUID_CANONICAL_PATTERN.match(cleaned):
            raise InvalidRecordIdError("Record ID must be a standard canonical hyphenated 36-character UUID string.")
        try:
            parsed = uuid.UUID(cleaned)
            return str(parsed).lower()
        except ValueError:
            raise InvalidRecordIdError("Record ID is not a valid UUID.") from None

    raise InvalidRecordIdError(
        f"Record ID must be a uuid.UUID or canonical string, received {type(record_id).__name__}."
    )


def construct_clinical_record_aad(*, record_id: uuid.UUID | str, field_name: str) -> bytes:
    """
    Constructs deterministic Additional Authenticated Data (AAD) for a health record field.

    Format:
        "anvaya:health_records:{canonical_record_id}:{field_name}" encoded as UTF-8.

    Args:
        record_id: The UUID of the health record.
        field_name: The canonical clinical field name.

    Returns:
        Deterministic UTF-8 bytes binding the domain, record, and field.

    Raises:
        InvalidRecordIdError: If record_id is invalid.
        InvalidClinicalFieldError: If field_name is not in CLINICAL_FIELDS.
    """
    canonical_id = validate_record_id(record_id)

    if not isinstance(field_name, str) or field_name not in CLINICAL_FIELDS:
        raise InvalidClinicalFieldError(f"Unknown or unsupported clinical field: '{field_name}'.")

    return f"{CLINICAL_AAD_DOMAIN_PREFIX}:{canonical_id}:{field_name}".encode("utf-8")


# ==============================================================================
# ENCRYPT-ON-WRITE HELPER
# ==============================================================================

def encrypt_record_field(
    *,
    record_id: uuid.UUID | str,
    field_name: str,
    plaintext: str | None,
    registry: KeyRegistry,
) -> str | None:
    """
    Encrypts a single clinical record field for storage at rest using AES-256-GCM.

    Binds the record UUID and field name via AAD. Guards against accidental
    double-encryption by rejecting inputs that appear to already be encrypted envelopes.

    LIMITATION:
        The prefix guard is a secondary defense against unintended re-encryption.
        It is not a substitute for explicit typing and distinct storage columns.

    Args:
        record_id: Immutable health record UUID.
        field_name: Canonical clinical field name (must be in CLINICAL_FIELDS).
        plaintext: The raw text string to encrypt, or None.
        registry: Explicit KeyRegistry containing the active encryption key.

    Returns:
        Versioned ciphertext envelope string ("enc:v1:..."), or None if plaintext is None.

    Raises:
        InvalidRecordIdError: If record_id is invalid or noncanonical.
        InvalidClinicalFieldError: If field_name is not in CLINICAL_FIELDS.
        DoubleEncryptionError: If plaintext appears to already be an encrypted envelope.
        ClinicalCryptoError: If plaintext is not a string/None or registry is invalid.
        KeyNotFoundError: If no active encryption key is configured.
    """
    if plaintext is None:
        return None

    if not isinstance(plaintext, str):
        raise ClinicalCryptoError("Plaintext to encrypt must be a string or None.")

    if registry is None or not isinstance(registry, KeyRegistry):
        raise ClinicalCryptoError("An explicit KeyRegistry instance is required for clinical crypto operations.")

    # Guard against accidental double-encryption of already-encrypted envelopes
    if ENVELOPE_PREFIX_GUARD.match(plaintext.strip()):
        raise DoubleEncryptionError(
            "Double-encryption hazard detected: input string appears to be an encrypted envelope or envelope prefix."
        )

    # Validate identifiers and construct bound AAD
    aad = construct_clinical_record_aad(record_id=record_id, field_name=field_name)

    return encrypt_clinical_text(
        plaintext,
        aad=aad,
        registry=registry,
    )


# ==============================================================================
# DECRYPT-ON-AUTHORIZED-READ HELPER
# ==============================================================================

def decrypt_record_field(
    *,
    record_id: uuid.UUID | str,
    field_name: str,
    envelope: str | None,
    registry: KeyRegistry,
) -> str | None:
    """
    Decrypts a versioned clinical record field envelope for an authorized read.

    Constructs the identical AAD used during encryption and performs authenticated
    AES-256-GCM decryption. Fails closed with zero plaintext fallback.

    Args:
        record_id: Immutable health record UUID.
        field_name: Canonical clinical field name (must be in CLINICAL_FIELDS).
        envelope: Versioned ciphertext envelope string ("enc:v1:..."), or None.
        registry: Explicit KeyRegistry containing the referenced decryption key.

    Returns:
        Decrypted plaintext UTF-8 string, or None if envelope is None.

    Raises:
        InvalidRecordIdError: If record_id is invalid or noncanonical.
        InvalidClinicalFieldError: If field_name is not in CLINICAL_FIELDS.
        ClinicalCryptoError: If envelope is not a string/None or registry is invalid.
        EnvelopeFormatError: If envelope structure is invalid or unencrypted (legacy plaintext).
        KeyNotFoundError: If key referenced by the envelope is not registered.
        DecryptionError: If authentication tag fails, ciphertext is tampered, or AAD mismatches.
    """
    if envelope is None:
        return None

    if not isinstance(envelope, str):
        raise ClinicalCryptoError("Envelope must be a string or None.")

    if registry is None or not isinstance(registry, KeyRegistry):
        raise ClinicalCryptoError("An explicit KeyRegistry instance is required for clinical crypto operations.")

    # Validate identifiers and construct bound AAD
    aad = construct_clinical_record_aad(record_id=record_id, field_name=field_name)

    return decrypt_clinical_text(
        envelope,
        aad=aad,
        registry=registry,
    )


# ==============================================================================
# SELECTIVE DECRYPTION OF AUTHORIZED SCOPES (JIT ADAPTER)
# ==============================================================================

def decrypt_authorized_fields(
    *,
    record_id: uuid.UUID | str,
    encrypted_fields: Mapping[str, str | None],
    authorized_scopes: Collection[str],
    registry: KeyRegistry,
) -> dict[str, str | None]:
    """
    Selectively decrypts only authorized clinical scopes for a health record.

    TRUST BOUNDARY:
        `authorized_scopes` MUST represent authorization already verified by
        the Gate 2A consent and access control system. This function is NOT a
        consent engine; it enforces least privilege in memory by decrypting
        strictly the requested and approved scopes. Withheld scopes are NEVER
        decrypted and NEVER included in the output dictionary.

    Args:
        record_id: Immutable health record UUID.
        encrypted_fields: Mapping of field names to ciphertext envelopes (or None).
        authorized_scopes: Collection of already-authorized clinical field names.
        registry: Explicit KeyRegistry containing decryption keys.

    Returns:
        Dictionary mapping each authorized scope to its decrypted plaintext (or None).
        Withheld scopes are omitted entirely.

    Raises:
        InvalidRecordIdError: If record_id is invalid or noncanonical.
        InvalidClinicalFieldError: If any key in encrypted_fields or authorized_scopes is unknown.
        InvalidScopeError: If authorized_scopes is a string, non-collection, or has duplicates.
        MissingFieldError: If an authorized scope is missing from encrypted_fields mapping.
        ClinicalCryptoError: If encrypted_fields or registry is invalid.
        EnvelopeFormatError / DecryptionError / KeyNotFoundError: If decryption fails.
    """
    canonical_id = validate_record_id(record_id)

    if registry is None or not isinstance(registry, KeyRegistry):
        raise ClinicalCryptoError("An explicit KeyRegistry instance is required for clinical crypto operations.")

    if not isinstance(encrypted_fields, collections.abc.Mapping):
        raise ClinicalCryptoError("encrypted_fields must be a Mapping (e.g. dict).")

    # Validate all supplied field names in the input mapping
    for field_name, value in encrypted_fields.items():
        if not isinstance(field_name, str) or field_name not in CLINICAL_FIELDS:
            raise InvalidClinicalFieldError(f"Unknown or invalid clinical field in encrypted_fields: '{field_name}'.")
        if value is not None and not isinstance(value, str):
            raise ClinicalCryptoError(
                f"Field '{field_name}' value must be a string envelope or None, received {type(value).__name__}."
            )

    # Validate authorized_scopes collection structure
    if isinstance(authorized_scopes, (str, bytes)) or not isinstance(authorized_scopes, collections.abc.Collection):
        raise InvalidScopeError("authorized_scopes must be a non-string collection of strings.")

    # Reject duplicate scopes where input structure permits duplicates
    if isinstance(authorized_scopes, (list, tuple)):
        if len(authorized_scopes) != len(set(authorized_scopes)):
            raise InvalidScopeError("Duplicate scopes detected in authorized_scopes.")

    # Validate each requested scope against the canonical allowlist
    for scope in authorized_scopes:
        if not isinstance(scope, str) or scope not in CLINICAL_FIELDS:
            raise InvalidClinicalFieldError(f"Unknown or unsupported authorized scope: '{scope}'.")

    # If zero scopes are authorized, return empty mapping without decrypting any fields
    if len(authorized_scopes) == 0:
        return {}

    decrypted_results: dict[str, str | None] = {}

    for scope in authorized_scopes:
        # Fail closed if an authorized scope is missing from the record
        if scope not in encrypted_fields:
            raise MissingFieldError(
                f"Authorized scope '{scope}' is missing from the encrypted record fields."
            )

        envelope = encrypted_fields[scope]

        # Decrypt only the authorized scope
        decrypted_results[scope] = decrypt_record_field(
            record_id=canonical_id,
            field_name=scope,
            envelope=envelope,
            registry=registry,
        )

    return decrypted_results

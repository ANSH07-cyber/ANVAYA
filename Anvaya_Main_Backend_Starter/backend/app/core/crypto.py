"""
ANVAYA Clinical Core Cryptographic Foundation
Module: app.core.crypto

Implements standalone AES-256-GCM authenticated encryption and decryption for
clinical data at rest. Enforces cryptographically secure random nonces, versioned
ciphertext envelopes, cryptographic header and AAD binding, and strictly
fail-closed authentication with zero plaintext fallback.
"""

from __future__ import annotations

import base64
import os
import re
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ==============================================================================
# CRYPTOGRAPHIC CONSTANTS & SPECIFICATIONS
# ==============================================================================

ENVELOPE_PREFIX: str = "enc"
ENVELOPE_VERSION: str = "v1"

# Bounded Key ID: alphanumeric, underscores, hyphens, 1 to 64 chars
KEY_ID_PATTERN: re.Pattern[str] = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Nonce must be strictly 12 bytes (96 bits) for AES-GCM
NONCE_LENGTH_BYTES: int = 12

# AES-GCM authentication tag is 16 bytes (128 bits)
TAG_LENGTH_BYTES: int = 16

# AES-256 requires strictly 32-byte (256-bit) keys
KEY_LENGTH_BYTES: int = 32

# Upper bound on envelope string size to prevent untrusted allocation exhaustion (10 MB)
MAX_ENVELOPE_CHAR_LENGTH: int = 10 * 1024 * 1024

# Domain separation tag for canonical AAD framing
DOMAIN_SEPARATION_TAG: bytes = b"ANVAYA_CLINICAL_ENVELOPE_V1"


# ==============================================================================
# SANITIZED EXCEPTION HIERARCHY
# ==============================================================================

class CryptoError(Exception):
    """Base class for all clinical cryptographic errors. Never exposes secret data."""


class DecryptionError(CryptoError):
    """Raised when authentication tag verification fails, ciphertext is corrupted, or wrong key is supplied."""


class KeyNotFoundError(CryptoError):
    """Raised when an envelope references an unregistered or unavailable key ID."""


class EnvelopeFormatError(CryptoError):
    """Raised when an envelope string is malformed, truncated, oversized, or unsupported."""


class CryptoKeyError(CryptoError):
    """Raised when encryption key bytes or key identifier formats are invalid."""


# ==============================================================================
# CANONICAL AAD & ENVELOPE FRAMING
# ==============================================================================

def _construct_authenticated_data(canonical_header: str, user_aad: bytes | None) -> bytes:
    """
    Constructs unambiguous, length-prefixed Additional Authenticated Data (AAD)
    binding the domain separation label, canonical envelope header ('enc:v1:<key_id>'),
    and any caller-supplied record-binding AAD.

    Format:
      [2-byte BE domain len] + [domain] +
      [2-byte BE header len] + [header_bytes] +
      [4-byte BE user_aad len] + [user_aad_bytes]
    """
    hdr_bytes = canonical_header.encode("utf-8")
    user_bytes = user_aad if user_aad is not None else b""

    return (
        len(DOMAIN_SEPARATION_TAG).to_bytes(2, "big")
        + DOMAIN_SEPARATION_TAG
        + len(hdr_bytes).to_bytes(2, "big")
        + hdr_bytes
        + len(user_bytes).to_bytes(4, "big")
        + user_bytes
    )


def _strict_b64encode(data: bytes) -> str:
    """Encodes bytes to standard ASCII Base64 without newlines."""
    return base64.b64encode(data).decode("ascii")


def _strict_b64decode(data_str: str) -> bytes:
    """
    Decodes standard ASCII Base64 with strict canonical validation.
    Rejects any whitespace, carriage returns, or invalid characters.
    """
    if re.search(r"\s", data_str):
        raise EnvelopeFormatError("Envelope component contains invalid whitespace characters.")
    try:
        decoded = base64.b64decode(data_str, validate=True)
        # Verify canonical re-encoding to reject non-canonical padding or unused bits
        if _strict_b64encode(decoded) != data_str:
            raise EnvelopeFormatError("Envelope component contains non-canonical Base64 encoding.")
        return decoded
    except Exception as exc:
        if isinstance(exc, EnvelopeFormatError):
            raise
        raise EnvelopeFormatError("Failed to decode Base64 envelope component.") from None


# ==============================================================================
# IN-MEMORY KEY REGISTRY
# ==============================================================================

class KeyRegistry:
    """
    In-memory registry managing active and historical AES-256 keys.
    Validates key length and key ID bounds. Prevents silent key overwrites.
    Never prints or logs secret key material.
    """

    def __init__(self) -> None:
        self._keys: dict[str, bytes] = {}
        self._active_key_id: str | None = None

    def register_key(self, key_id: str, key_bytes: bytes, set_active: bool = False) -> None:
        """
        Registers a 32-byte (256-bit) AES key.

        Args:
            key_id: Identifier matching [A-Za-z0-9_-]{1,64}.
            key_bytes: Exactly 32 bytes of cryptographic key material.
            set_active: If True, sets this key as the active key for encryption.

        Raises:
            CryptoKeyError: If key_id or key_bytes format is invalid or overwrite attempted.
        """
        if not isinstance(key_id, str) or not KEY_ID_PATTERN.match(key_id):
            raise CryptoKeyError("Key ID must be a non-empty string of 1-64 alphanumeric characters, hyphens, or underscores.")

        if not isinstance(key_bytes, bytes):
            raise CryptoKeyError("Key material must be provided as bytes.")

        if len(key_bytes) != KEY_LENGTH_BYTES:
            raise CryptoKeyError(f"Key length must be exactly {KEY_LENGTH_BYTES} bytes (256 bits). Received {len(key_bytes)} bytes.")

        if key_id in self._keys and self._keys[key_id] != key_bytes:
            raise CryptoKeyError(f"Cannot overwrite existing key ID '{key_id}' with different key material.")

        self._keys[key_id] = key_bytes

        if set_active or self._active_key_id is None:
            self._active_key_id = key_id

    def get_key(self, key_id: str) -> bytes:
        """
        Retrieves registered key bytes by key ID.

        Raises:
            KeyNotFoundError: If the key_id has not been registered.
        """
        if not isinstance(key_id, str) or key_id not in self._keys:
            raise KeyNotFoundError(f"Requested key ID '{key_id}' is not registered.")
        return self._keys[key_id]

    def get_active_key(self) -> tuple[str, bytes]:
        """
        Returns (active_key_id, key_bytes) for new encryption operations.

        Raises:
            KeyNotFoundError: If no active key has been registered.
        """
        if self._active_key_id is None or self._active_key_id not in self._keys:
            raise KeyNotFoundError("No active encryption key has been configured in the registry.")
        return self._active_key_id, self._keys[self._active_key_id]

    def has_key(self, key_id: str) -> bool:
        """Checks if a key ID is present in the registry."""
        return isinstance(key_id, str) and key_id in self._keys

    @property
    def active_key_id(self) -> str | None:
        """Returns the current active key ID, or None if unset."""
        return self._active_key_id

    def __repr__(self) -> str:
        # Sanitized representation: reveals only registered IDs, NEVER key bytes
        return f"<KeyRegistry active={self._active_key_id!r} registered_keys={list(self._keys.keys())}>"

    def __str__(self) -> str:
        return self.__repr__()


# Default module-level registry (starts completely empty)
default_registry: KeyRegistry = KeyRegistry()


# ==============================================================================
# PUBLIC ENCRYPTION & DECRYPTION API
# ==============================================================================

def encrypt_clinical_text(
    plaintext: str,
    *,
    key_id: str | None = None,
    aad: bytes | None = None,
    registry: KeyRegistry | None = None,
) -> str:
    """
    Encrypts a clinical plaintext string using AES-256-GCM.

    Args:
        plaintext: The raw text string to encrypt (UTF-8 encoded).
        key_id: Optional specific key ID. If None, uses the active key from the registry.
        aad: Optional Additional Authenticated Data for record binding.
        registry: KeyRegistry to use (defaults to module-level default_registry).

    Returns:
        Formatted envelope string: "enc:v1:<key_id>:<b64_nonce>:<b64_ciphertext_and_tag>"

    Raises:
        CryptoError / TypeError: If plaintext is not a string or AAD is not bytes.
        KeyNotFoundError: If the specified or active key is unavailable.
    """
    if not isinstance(plaintext, str):
        raise CryptoError("Plaintext to encrypt must be a string.")

    if aad is not None and not isinstance(aad, bytes):
        raise CryptoError("Additional Authenticated Data (AAD) must be bytes or None.")

    active_reg = registry or default_registry

    if key_id is not None:
        target_key_id = key_id
        target_key = active_reg.get_key(key_id)
    else:
        target_key_id, target_key = active_reg.get_active_key()

    # Generate fresh cryptographically secure random 12-byte nonce
    nonce = os.urandom(NONCE_LENGTH_BYTES)

    # Construct canonical header and length-prefixed AAD
    canonical_header = f"{ENVELOPE_PREFIX}:{ENVELOPE_VERSION}:{target_key_id}"
    effective_aad = _construct_authenticated_data(canonical_header, aad)

    # Encode plaintext as UTF-8
    plaintext_bytes = plaintext.encode("utf-8")

    # Encrypt using AESGCM
    aesgcm = AESGCM(target_key)
    ciphertext_and_tag = aesgcm.encrypt(nonce, plaintext_bytes, effective_aad)

    # Base64 encode components
    b64_nonce = _strict_b64encode(nonce)
    b64_payload = _strict_b64encode(ciphertext_and_tag)

    return f"{canonical_header}:{b64_nonce}:{b64_payload}"


def decrypt_clinical_text(
    envelope: str,
    *,
    aad: bytes | None = None,
    registry: KeyRegistry | None = None,
) -> str:
    """
    Decrypts a versioned clinical envelope string using AES-256-GCM.
    Cryptographically authenticates the header, version, key ID, and optional user AAD.

    Args:
        envelope: Formatted envelope string "enc:v1:<key_id>:<b64_nonce>:<b64_payload>".
        aad: Optional Additional Authenticated Data. Must match AAD supplied during encryption.
        registry: KeyRegistry to use (defaults to module-level default_registry).

    Returns:
        Original decrypted UTF-8 plaintext string.

    Raises:
        EnvelopeFormatError: If envelope structure, prefix, version, or Base64 is malformed.
        KeyNotFoundError: If the key_id in the envelope is not registered.
        DecryptionError: If authentication tag verification fails, ciphertext is corrupted,
                         or wrong key / AAD is provided.
    """
    if not isinstance(envelope, str):
        raise EnvelopeFormatError("Envelope must be a string.")

    if len(envelope) > MAX_ENVELOPE_CHAR_LENGTH:
        raise EnvelopeFormatError(f"Envelope exceeds maximum allowed size of {MAX_ENVELOPE_CHAR_LENGTH} characters.")

    if aad is not None and not isinstance(aad, bytes):
        raise CryptoError("Additional Authenticated Data (AAD) must be bytes or None.")

    parts = envelope.split(":")
    if len(parts) != 5:
        raise EnvelopeFormatError("Envelope format invalid. Must contain exactly five colon-delimited components.")

    prefix, version, key_id, b64_nonce, b64_payload = parts

    if prefix != ENVELOPE_PREFIX:
        raise EnvelopeFormatError(f"Unsupported envelope prefix '{prefix}'. Expected '{ENVELOPE_PREFIX}'.")

    if version != ENVELOPE_VERSION:
        raise EnvelopeFormatError(f"Unsupported envelope version '{version}'. Expected '{ENVELOPE_VERSION}'.")

    if not KEY_ID_PATTERN.match(key_id):
        raise EnvelopeFormatError(f"Envelope key ID '{key_id}' contains invalid characters or bounds.")

    if not b64_nonce:
        raise EnvelopeFormatError("Envelope nonce component cannot be empty.")

    if not b64_payload:
        raise EnvelopeFormatError("Envelope payload component cannot be empty.")

    # Decode and validate nonce
    nonce = _strict_b64decode(b64_nonce)
    if len(nonce) != NONCE_LENGTH_BYTES:
        raise EnvelopeFormatError(f"Invalid nonce length: {len(nonce)} bytes. Expected {NONCE_LENGTH_BYTES} bytes.")

    # Decode and validate ciphertext + authentication tag
    ciphertext_and_tag = _strict_b64decode(b64_payload)
    if len(ciphertext_and_tag) < TAG_LENGTH_BYTES:
        raise EnvelopeFormatError(f"Payload too short: {len(ciphertext_and_tag)} bytes. Must contain at least {TAG_LENGTH_BYTES}-byte tag.")

    active_reg = registry or default_registry
    key_bytes = active_reg.get_key(key_id)

    # Reconstruct exact canonical header and effective AAD
    canonical_header = f"{prefix}:{version}:{key_id}"
    effective_aad = _construct_authenticated_data(canonical_header, aad)

    # Perform authenticated decryption
    aesgcm = AESGCM(key_bytes)
    try:
        decrypted_bytes = aesgcm.decrypt(nonce, ciphertext_and_tag, effective_aad)
    except InvalidTag:
        raise DecryptionError("Authenticated decryption failed: invalid authentication tag, tampered ciphertext, or mismatched AAD.") from None
    except Exception as exc:
        raise DecryptionError("Decryption failed due to an unexpected cryptographic error.") from exc

    try:
        return decrypted_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise DecryptionError("Decrypted payload contains invalid UTF-8 bytes.") from None

"""
ANVAYA Gate 2B Phase 3C-2M — Controlled Historical EHR Encryption Backfill CLI
Module: scripts/migrate_health_records_encryption.py

Transitions legacy plaintext HealthRecord rows (encryption_version = 0) to
AES-256-GCM encrypted envelopes (encryption_version = 1) using bounded
transactional batches, deterministic row-level locking (FOR UPDATE SKIP LOCKED),
canonical 7-field CLINICAL_FIELDS AAD binding, and Windows DPAPI key loading.

Defaults to --dry-run (zero mutations). Requires explicit --execute to write.
Never logs plaintext clinical narratives, ciphertext envelopes, or key material.
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import ctypes.wintypes
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Callable
from urllib.parse import urlparse

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session, sessionmaker

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings
from app.core.crypto import KeyRegistry
from app.models.health_record import HealthRecord
from app.services.clinical_crypto_service import (
    CLINICAL_FIELDS,
    DoubleEncryptionError,
    ENVELOPE_PREFIX_GUARD,
    encrypt_record_field,
)

EXPECTED_DB_HOST = "127.0.0.1"
EXPECTED_DB_PORT = 5432
EXPECTED_DB_NAME = "anvaya_db"
EXPECTED_DB_ROLE = "anvaya_app"
EXPECTED_ALEMBIC_REVISION = "d4e5f6a7b8c9"
EXPECTED_KEY_ID = "anvaya_dev_clinical_k1"
DEFAULT_BATCH_SIZE = 50
MAX_BATCH_SIZE = 500


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


def _dpapi_unprotect(ciphertext: bytes) -> bytes:
    """Decrypts DPAPI CurrentUser ciphertext strictly in process memory."""
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    cryptprotect_ui_forbidden = 0x1

    in_buf = (ctypes.c_byte * len(ciphertext)).from_buffer_copy(ciphertext)
    in_blob = _DATA_BLOB(len(ciphertext), in_buf)
    out_blob = _DATA_BLOB()
    ok = crypt32.CryptUnprotectData(
        ctypes.byref(in_blob),
        None,
        None,
        None,
        None,
        cryptprotect_ui_forbidden,
        ctypes.byref(out_blob),
    )
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def load_dpapi_clinical_registry(
    *,
    cred_dir: Path | None = None,
    expected_key_id: str = EXPECTED_KEY_ID,
) -> KeyRegistry:
    """Loads clinical KeyRegistry from DPAPI-protected custody outside OneDrive/Git."""
    base_dir = cred_dir or (Path(os.environ["LOCALAPPDATA"]) / "ANVAYA_CLINICAL_CREDENTIALS")
    dpapi_path = base_dir / "clinical_keys.dpapi"
    meta_path = base_dir / "clinical_key_metadata.json"

    if not dpapi_path.is_file() or not meta_path.is_file():
        raise RuntimeError("Missing DPAPI clinical key custody files.")

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("key_id") != expected_key_id:
        raise RuntimeError(f"Unexpected clinical key metadata ID: {meta.get('key_id')!r}")

    dpapi_bytes = dpapi_path.read_bytes()
    actual_sha = hashlib.sha256(dpapi_bytes).hexdigest()
    if meta.get("dpapi_sha256") != actual_sha:
        raise RuntimeError("Clinical DPAPI artifact checksum mismatch against metadata.")

    raw_json_bytes = _dpapi_unprotect(dpapi_bytes)
    keys_obj = json.loads(raw_json_bytes.decode("utf-8"))
    if not isinstance(keys_obj, dict) or expected_key_id not in keys_obj:
        raise RuntimeError("Expected active clinical key ID missing from DPAPI payload.")

    registry = KeyRegistry()
    for k_id, k_b64 in keys_obj.items():
        if not isinstance(k_b64, str) or any(c.isspace() for c in k_b64):
            raise RuntimeError(f"Malformed key material for key ID '{k_id}'.")
        k_bytes = base64.b64decode(k_b64, validate=True)
        if base64.b64encode(k_bytes).decode("ascii") != k_b64 or len(k_bytes) != 32:
            raise RuntimeError(f"Invalid canonical 32-byte key for key ID '{k_id}'.")
        registry.register_key(k_id, k_bytes, set_active=(k_id == expected_key_id))

    active_id, _ = registry.get_active_key()
    if active_id != expected_key_id:
        raise RuntimeError(f"Active key mismatch: expected '{expected_key_id}', got '{active_id}'.")
    return registry


def verify_configured_database_url(database_url: str) -> None:
    """Enforces allowlisted local PostgreSQL target before opening a connection."""
    norm = database_url.replace("postgresql+psycopg://", "postgresql://", 1)
    parsed = urlparse(norm)
    host = parsed.hostname
    port = parsed.port or 5432
    dbname = parsed.path.lstrip("/")
    user = parsed.username

    if host != EXPECTED_DB_HOST or port != EXPECTED_DB_PORT:
        raise RuntimeError(f"Refusing non-allowlisted host/port target: {host}:{port}")
    if dbname != EXPECTED_DB_NAME:
        raise RuntimeError(f"Refusing non-allowlisted database: {dbname!r}")
    if user != EXPECTED_DB_ROLE:
        raise RuntimeError(f"Refusing non-allowlisted database role: {user!r}")


def verify_postgres_preconditions(session: Session) -> dict[str, object]:
    """Verifies live PostgreSQL database identity, role, port, Alembic head, and ORM."""
    if not hasattr(HealthRecord, "encryption_version"):
        raise RuntimeError("HealthRecord ORM model lacks encryption_version mapping.")

    row = session.execute(
        text(
            "SELECT current_database(), current_user, inet_server_port(), "
            "(SELECT version_num FROM alembic_version)"
        )
    ).one()
    db_name, db_user, server_port, alembic_rev = row

    if db_name != EXPECTED_DB_NAME:
        raise RuntimeError(f"Database identity mismatch: {db_name!r}")
    if db_user != EXPECTED_DB_ROLE:
        raise RuntimeError(f"Database role mismatch: {db_user!r}")
    if server_port != EXPECTED_DB_PORT:
        raise RuntimeError(f"Database port mismatch: {server_port!r}")
    if alembic_rev != EXPECTED_ALEMBIC_REVISION:
        raise RuntimeError(f"Alembic revision mismatch: expected {EXPECTED_ALEMBIC_REVISION!r}, got {alembic_rev!r}")

    return {
        "database": db_name,
        "role": db_user,
        "port": server_port,
        "alembic_revision": alembic_rev,
    }


def _aggregate_counts(session: Session) -> dict[str, int]:
    """Returns sanitized aggregate record counts across encryption_version states."""
    total = session.scalar(select(func.count(HealthRecord.id))) or 0
    v0 = (
        session.scalar(
            select(func.count(HealthRecord.id)).where(HealthRecord.encryption_version == 0)
        )
        or 0
    )
    v1 = (
        session.scalar(
            select(func.count(HealthRecord.id)).where(HealthRecord.encryption_version == 1)
        )
        or 0
    )
    other = total - v0 - v1
    return {"total": int(total), "v0": int(v0), "v1": int(v1), "other": int(other)}


def _inspect_v0_envelope_anomalies(session: Session) -> list[str]:
    """Checks v0 rows for anomalous enc: prefixes without logging field content."""
    flagged_ids: list[str] = []
    v0_rows = session.scalars(
        select(HealthRecord)
        .where(HealthRecord.encryption_version == 0)
        .order_by(HealthRecord.id)
    ).all()
    for row in v0_rows:
        for field in sorted(CLINICAL_FIELDS):
            val = getattr(row, field)
            if isinstance(val, str) and ENVELOPE_PREFIX_GUARD.match(val.strip()):
                flagged_ids.append(str(row.id))
                break
    return flagged_ids


def encrypt_single_row_fields(
    row: HealthRecord,
    *,
    registry: KeyRegistry,
) -> dict[str, str | None]:
    """Encrypts all 7 canonical clinical fields bound to row.id and field_name."""
    if getattr(row, "encryption_version", None) != 0:
        raise RuntimeError(
            f"Refusing row {row.id}: expected encryption_version=0, got {getattr(row, 'encryption_version', None)!r}."
        )
    encrypted: dict[str, str | None] = {}
    for field in sorted(CLINICAL_FIELDS):
        raw_val = getattr(row, field)
        encrypted[field] = encrypt_record_field(
            record_id=row.id,
            field_name=field,
            plaintext=raw_val,
            registry=registry,
        )
    return encrypted


def run_backfill(
    session_factory: Callable[[], Session],
    registry: KeyRegistry,
    *,
    execute: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
    on_before_row_update: Callable[[HealthRecord], None] | None = None,
) -> dict[str, object]:
    """Executes dry-run or bounded transactional batch backfill cleanly."""
    if not (1 <= batch_size <= MAX_BATCH_SIZE):
        raise ValueError(f"batch_size must be between 1 and {MAX_BATCH_SIZE}.")

    active_key_id, _ = registry.get_active_key()

    with session_factory() as ro_session:
        before_counts = _aggregate_counts(ro_session)
        anomalies = _inspect_v0_envelope_anomalies(ro_session)

    if before_counts["other"] != 0:
        raise RuntimeError(
            f"Unsupported encryption_version values detected: count={before_counts['other']}."
        )
    if anomalies:
        raise DoubleEncryptionError(
            f"Aborting: {len(anomalies)} version-0 record(s) already match envelope prefix guard."
        )

    if not execute:
        return {
            "mode": "dry_run",
            "active_key_id": active_key_id,
            "before_counts": before_counts,
            "eligible_v0": before_counts["v0"],
            "batches_committed": 0,
            "rows_encrypted": 0,
            "after_counts": before_counts,
        }

    batches_committed = 0
    rows_encrypted = 0

    while True:
        batch_index = batches_committed + 1
        with session_factory() as batch_session:
            try:
                with batch_session.begin():
                    stmt = (
                        select(HealthRecord)
                        .where(HealthRecord.encryption_version == 0)
                        .order_by(HealthRecord.id)
                        .limit(batch_size)
                        .with_for_update(skip_locked=True)
                    )
                    rows = batch_session.scalars(stmt).all()
                    if not rows:
                        break

                    for row in rows:
                        if row.encryption_version != 0:
                            raise RuntimeError(f"Concurrent version drift on row {row.id}.")
                        encrypted = encrypt_single_row_fields(row, registry=registry)
                        if on_before_row_update is not None:
                            on_before_row_update(row)
                        for field, enc_val in encrypted.items():
                            setattr(row, field, enc_val)
                        row.encryption_version = 1

                    batch_session.flush()

                batches_committed += 1
                rows_encrypted += len(rows)
            except Exception as exc:
                batch_session.rollback()
                raise RuntimeError(
                    f"Backfill aborted cleanly in batch {batch_index} ({type(exc).__name__}): transaction rolled back."
                ) from exc

    with session_factory() as post_session:
        after_counts = _aggregate_counts(post_session)

    return {
        "mode": "execute",
        "active_key_id": active_key_id,
        "before_counts": before_counts,
        "eligible_v0": before_counts["v0"],
        "batches_committed": batches_committed,
        "rows_encrypted": rows_encrypted,
        "after_counts": after_counts,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ANVAYA historical HealthRecord v0 -> v1 encryption backfill CLI (dry-run by default)."
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--dry-run",
        action="store_true",
        help="Count eligible v0 records and verify preconditions without modifying rows (default).",
    )
    mode_group.add_argument(
        "--execute",
        action="store_true",
        help="Encrypt eligible v0 rows in bounded transactional batches.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Rows locked and committed per batch (1..{MAX_BATCH_SIZE}, default {DEFAULT_BATCH_SIZE}).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    execute = bool(args.execute)

    verify_configured_database_url(settings.database_url)
    registry = load_dpapi_clinical_registry(expected_key_id=EXPECTED_KEY_ID)

    engine = create_engine(settings.database_url, pool_pre_ping=True)
    SessionFactory = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    try:
        with SessionFactory() as pre_session:
            db_meta = verify_postgres_preconditions(pre_session)

        summary = run_backfill(
            SessionFactory,
            registry,
            execute=execute,
            batch_size=args.batch_size,
        )
        print(
            "BACKFILL_SUMMARY",
            json.dumps({"db": db_meta, **summary}, sort_keys=True),
        )
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())

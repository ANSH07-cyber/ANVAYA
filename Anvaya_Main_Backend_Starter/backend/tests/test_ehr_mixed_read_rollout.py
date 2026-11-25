"""
ANVAYA Phase 3C-2L Mixed-Read Compatibility, ORM Mapping & Key Startup Suite

Validates:
1. HealthRecord.encryption_version SQLAlchemy 2.x ORM mapping & CHECK constraint parity.
2. Mixed-read reads: version-0 plaintext passthrough and version-1 authenticated decryption.
3. Mixed-read writes: consultation completion persists version-0 plaintext (never calls encrypt_record_field).
4. Patient ownership, doctor RBAC/approval, consent scope enforcement, and cross-patient isolation.
5. Fail-closed error handling & sanitized responses for tampered/corrupt/unsupported records.
6. FastAPI lifespan startup validation: rejects missing, malformed, non-canonical, wrong-length,
   missing-active-key, and legacy boolean configurations; populates KeyRegistry on valid mixed_read.

All tests execute strictly offline against in-memory/tmp SQLite fixtures with zero protected DB access.
"""

from __future__ import annotations

import asyncio
import base64
from datetime import date, datetime, time, timedelta, timezone
import json
import os
import unittest.mock
import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import Integer

from app.api.routes.appointments import IST, update_appointment_status
from app.api.routes.health_records import (
    get_my_health_records,
    get_patient_health_records_for_doctor,
)
from app.core.config import Settings, settings
from app.core.crypto import DecryptionError, EnvelopeFormatError, KeyRegistry
from app.main import app, lifespan
from app.models.appointment import Appointment
from app.models.consent_record import ConsentRecord
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.patient_profile import PatientProfile
from app.models.user import User
from app.schemas.health_record import ConsultationCompletion
from app.services.clinical_crypto_service import CLINICAL_FIELDS, encrypt_record_field


@pytest.fixture
def synthetic_registry() -> KeyRegistry:
    reg = KeyRegistry()
    reg.register_key("mixed_read_test_k1", os.urandom(32), set_active=True)
    return reg


def _seed_entities(db_session):
    patient_a_user = User(
        id=uuid.uuid4(),
        full_name="Patient Alpha",
        email=f"pa_{uuid.uuid4().hex[:8]}@synthetic.test",
        role="patient",
        is_active=True,
    )
    patient_b_user = User(
        id=uuid.uuid4(),
        full_name="Patient Beta",
        email=f"pb_{uuid.uuid4().hex[:8]}@synthetic.test",
        role="patient",
        is_active=True,
    )
    doctor_user = User(
        id=uuid.uuid4(),
        full_name="Dr. Mixed Reader",
        email=f"doc_{uuid.uuid4().hex[:8]}@synthetic.test",
        role="doctor",
        is_active=True,
    )
    db_session.add_all([patient_a_user, patient_b_user, doctor_user])
    db_session.flush()

    patient_a = PatientProfile(
        id=uuid.uuid4(),
        user_id=patient_a_user.id,
        date_of_birth=date(1990, 1, 1),
        gender="other",
    )
    patient_b = PatientProfile(
        id=uuid.uuid4(),
        user_id=patient_b_user.id,
        date_of_birth=date(1992, 2, 2),
        gender="female",
    )
    doctor = DoctorProfile(
        id=uuid.uuid4(),
        user_id=doctor_user.id,
        specialization="General Medicine",
        qualification="MBBS, MD",
        license_number=f"LIC-{uuid.uuid4().hex[:8]}",
        verification_status="approved",
    )
    db_session.add_all([patient_a, patient_b, doctor])
    db_session.commit()
    return patient_a_user, patient_a, patient_b_user, patient_b, doctor_user, doctor


# ==============================================================================
# 1. ORM MAPPING & SCHEMA PARITY
# ==============================================================================


def test_01_health_record_encryption_version_orm_mapping(db_session) -> None:
    """HealthRecord maps encryption_version as INTEGER NOT NULL DEFAULT 0 with CHECK (0, 1)."""
    col = HealthRecord.__table__.columns["encryption_version"]
    assert isinstance(col.type, Integer)
    assert col.nullable is False
    assert col.default is not None and col.default.arg == 0
    assert col.server_default is not None

    check_names = {c.name for c in HealthRecord.__table__.constraints}
    assert "ck_health_records_encryption_version" in check_names

    _, patient_a, _, _, _, doctor = _seed_entities(db_session)
    appt = Appointment(
        id=uuid.uuid4(),
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_date=date(2026, 11, 25),
        start_time=time(9, 0),
        end_time=time(9, 30),
        status="completed",
    )
    db_session.add(appt)
    db_session.flush()

    hr = HealthRecord(
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_id=appt.id,
        visit_date=date(2026, 11, 25),
        visit_summary="Default ORM encryption_version compatibility check.",
    )
    db_session.add(hr)
    db_session.commit()
    db_session.refresh(hr)
    assert hr.encryption_version == 0


# ==============================================================================
# 2. MIXED_READ READS & WRITES (SQLITE ORM EXECUTION)
# ==============================================================================


def test_02_mixed_read_reads_v0_plaintext_and_v1_decrypted_and_isolates_patients(
    db_session,
    synthetic_registry: KeyRegistry,
) -> None:
    """In mixed_read, patient owns v0 plaintext + v1 encrypted records; other patient sees 0."""
    patient_a_user, patient_a, patient_b_user, _, _, doctor = _seed_entities(db_session)

    appt_v0 = Appointment(
        id=uuid.uuid4(),
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_date=date(2026, 11, 24),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="completed",
    )
    appt_v1 = Appointment(
        id=uuid.uuid4(),
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_date=date(2026, 11, 25),
        start_time=time(11, 0),
        end_time=time(11, 30),
        status="completed",
    )
    db_session.add_all([appt_v0, appt_v1])
    db_session.flush()

    hr_v0 = HealthRecord(
        id=uuid.uuid4(),
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_id=appt_v0.id,
        visit_date=date(2026, 11, 24),
        visit_summary="Legacy v0 plaintext summary.",
        diagnosis="Tension headache",
        encryption_version=0,
    )
    hr_v1_id = uuid.uuid4()
    hr_v1 = HealthRecord(
        id=hr_v1_id,
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_id=appt_v1.id,
        visit_date=date(2026, 11, 25),
        visit_summary=encrypt_record_field(
            record_id=hr_v1_id,
            field_name="visit_summary",
            plaintext="Synthetic v1 decrypted summary.",
            registry=synthetic_registry,
        ),
        diagnosis=encrypt_record_field(
            record_id=hr_v1_id,
            field_name="diagnosis",
            plaintext="Seasonal rhinitis",
            registry=synthetic_registry,
        ),
        encryption_version=1,
    )
    db_session.add_all([hr_v0, hr_v1])
    db_session.commit()

    with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"):
        resp_a = get_my_health_records(
            limit=20,
            offset=0,
            current_user=patient_a_user,
            db=db_session,
            key_registry=synthetic_registry,
        )
        resp_b = get_my_health_records(
            limit=20,
            offset=0,
            current_user=patient_b_user,
            db=db_session,
            key_registry=synthetic_registry,
        )

    assert resp_a.total == 2
    by_id = {item.id: item for item in resp_a.items}
    assert by_id[hr_v0.id].visit_summary == "Legacy v0 plaintext summary."
    assert by_id[hr_v1_id].visit_summary == "Synthetic v1 decrypted summary."
    assert by_id[hr_v1_id].diagnosis == "Seasonal rhinitis"
    assert resp_b.total == 0
    assert resp_b.items == []


def test_03_mixed_read_doctor_consent_scopes_and_withheld_fields_not_decrypted(
    db_session,
    synthetic_registry: KeyRegistry,
) -> None:
    """Doctor reads only consented fields; unconsented fields never decrypt; revoked/missing fail 403."""
    _, patient_a, _, patient_b, doctor_user, doctor = _seed_entities(db_session)
    appt = Appointment(
        id=uuid.uuid4(),
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_date=date(2026, 11, 25),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="completed",
    )
    db_session.add(appt)
    db_session.flush()

    hr_id = uuid.uuid4()
    hr = HealthRecord(
        id=hr_id,
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_id=appt.id,
        visit_date=date(2026, 11, 25),
        visit_summary=encrypt_record_field(
            record_id=hr_id,
            field_name="visit_summary",
            plaintext="Unconsented summary secret.",
            registry=synthetic_registry,
        ),
        diagnosis=encrypt_record_field(
            record_id=hr_id,
            field_name="diagnosis",
            plaintext="Authorized diagnosis text.",
            registry=synthetic_registry,
        ),
        encryption_version=1,
    )
    consent = ConsentRecord(
        id=uuid.uuid4(),
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        data_scopes=["diagnosis"],
        is_active=True,
    )
    db_session.add_all([hr, consent])
    db_session.commit()

    with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"):
        with unittest.mock.patch(
            "app.services.clinical_crypto_service.decrypt_record_field",
            wraps=__import__(
                "app.services.clinical_crypto_service", fromlist=["decrypt_record_field"]
            ).decrypt_record_field,
        ) as dec_spy:
            resp = get_patient_health_records_for_doctor(
                patient_profile_id=patient_a.id,
                scopes=["diagnosis"],
                limit=20,
                offset=0,
                current_user=doctor_user,
                db=db_session,
                key_registry=synthetic_registry,
            )
            assert dec_spy.call_count == 1
            assert dec_spy.call_args.kwargs["field_name"] == "diagnosis"

        assert resp.total == 1
        assert resp.items[0].data == {"diagnosis": "Authorized diagnosis text."}
        assert "visit_summary" not in resp.items[0].data

        # Unconsented scope rejected 403
        with pytest.raises(HTTPException) as exc_scope:
            get_patient_health_records_for_doctor(
                patient_profile_id=patient_a.id,
                scopes=["diagnosis", "visit_summary"],
                limit=20,
                offset=0,
                current_user=doctor_user,
                db=db_session,
                key_registry=synthetic_registry,
            )
        assert exc_scope.value.status_code == 403

        # Cross-patient access without consent rejected 403
        with pytest.raises(HTTPException) as exc_cross:
            get_patient_health_records_for_doctor(
                patient_profile_id=patient_b.id,
                scopes=["diagnosis"],
                limit=20,
                offset=0,
                current_user=doctor_user,
                db=db_session,
                key_registry=synthetic_registry,
            )
        assert exc_cross.value.status_code == 403

        # Revoked consent rejected 403
        consent.is_active = False
        consent.revoked_at = datetime.now(timezone.utc)
        db_session.commit()
        with pytest.raises(HTTPException) as exc_revoked:
            get_patient_health_records_for_doctor(
                patient_profile_id=patient_a.id,
                scopes=["diagnosis"],
                limit=20,
                offset=0,
                current_user=doctor_user,
                db=db_session,
                key_registry=synthetic_registry,
            )
        assert exc_revoked.value.status_code == 403


def test_04_mixed_read_new_consultation_writes_remain_v0_plaintext(
    db_session,
    synthetic_registry: KeyRegistry,
) -> None:
    """In mixed_read, completing an appointment persists encryption_version=0 plaintext and never encrypts."""
    _, patient_a, _, _, doctor_user, doctor = _seed_entities(db_session)
    started_dt = datetime.now(IST) - timedelta(minutes=15)
    # Keep start < end on same calendar date cleanly
    if started_dt.hour == 23 and started_dt.minute >= 40:
        started_dt = started_dt.replace(hour=23, minute=0)
    appt = Appointment(
        id=uuid.uuid4(),
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_date=started_dt.date(),
        start_time=started_dt.time().replace(microsecond=0),
        end_time=(started_dt + timedelta(minutes=20)).time().replace(microsecond=0),
        status="booked",
    )
    db_session.add(appt)
    db_session.commit()

    payload = ConsultationCompletion(
        visit_summary="Mixed-read consultation remains plaintext v0.",
        diagnosis="Healthy checkup",
    )
    with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"), \
         unittest.mock.patch("app.api.routes.appointments.encrypt_record_field") as enc_spy:
        result = update_appointment_status(
            appointment_id=appt.id,
            payload=payload,
            current_user=doctor_user,
            db=db_session,
            key_registry=synthetic_registry,
        )
        assert enc_spy.call_count == 0

    assert result.visit_summary == "Mixed-read consultation remains plaintext v0."
    saved = db_session.get(HealthRecord, result.id)
    assert saved is not None
    assert saved.encryption_version == 0
    assert saved.visit_summary == "Mixed-read consultation remains plaintext v0."


# ==============================================================================
# 3. FAIL-CLOSED ERROR SANITIZATION & STARTUP VALIDATION
# ==============================================================================


def test_05_tampered_ciphertext_fails_closed_without_exposing_secrets(
    db_session,
    synthetic_registry: KeyRegistry,
) -> None:
    """Corrupted v1 ciphertext raises sanitized crypto error without leaking keys or plaintext."""
    patient_a_user, patient_a, _, _, _, doctor = _seed_entities(db_session)
    appt = Appointment(
        id=uuid.uuid4(),
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_date=date(2026, 11, 25),
        start_time=time(14, 0),
        end_time=time(14, 30),
        status="completed",
    )
    db_session.add(appt)
    db_session.flush()

    hr_id = uuid.uuid4()
    valid_env = encrypt_record_field(
        record_id=hr_id,
        field_name="visit_summary",
        plaintext="SECRET_CLINICAL_TEXT_NEVER_LEAK",
        registry=synthetic_registry,
    )
    assert valid_env is not None
    parts = valid_env.split(":")
    tampered = f"{parts[0]}:{parts[1]}:{parts[2]}:{parts[3]}:AAAA"

    hr = HealthRecord(
        id=hr_id,
        patient_profile_id=patient_a.id,
        doctor_profile_id=doctor.id,
        appointment_id=appt.id,
        visit_date=date(2026, 11, 25),
        visit_summary=tampered,
        encryption_version=1,
    )
    db_session.add(hr)
    db_session.commit()

    with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"):
        with pytest.raises((DecryptionError, EnvelopeFormatError)) as exc_info:
            get_my_health_records(
                limit=20,
                offset=0,
                current_user=patient_a_user,
                db=db_session,
                key_registry=synthetic_registry,
            )
    err = str(exc_info.value)
    assert "SECRET_CLINICAL_TEXT_NEVER_LEAK" not in err
    assert "mixed_read_test_k1" not in err
    assert "enc:v1:" not in err


def _run_lifespan() -> None:
    async def _runner():
        async with lifespan(app):
            pass

    asyncio.run(_runner())


def test_06_startup_lifespan_rejects_invalid_and_accepts_valid_mixed_read_config() -> None:
    """FastAPI lifespan rejects missing/malformed/wrong-length keys and loads valid mixed_read registry."""
    valid_b64 = base64.b64encode(os.urandom(32)).decode("ascii")
    short_b64 = base64.b64encode(os.urandom(16)).decode("ascii")

    # Unknown mode rejected by Settings
    with pytest.raises(ValidationError):
        Settings(clinical_encryption_mode="invalid_mode")  # type: ignore[arg-type]

    # Legacy flag rejected even with mixed_read
    with pytest.raises(ValidationError):
        Settings(clinical_encryption_mode="mixed_read", clinical_encryption_enabled=True)

    # Missing keys in mixed_read -> RuntimeError
    with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"), \
         unittest.mock.patch.object(settings, "clinical_encryption_active_key_id", None), \
         unittest.mock.patch.object(settings, "clinical_encryption_keys_json", None):
        with pytest.raises(RuntimeError, match="missing"):
            _run_lifespan()

    # Wrong key length -> RuntimeError
    with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"), \
         unittest.mock.patch.object(settings, "clinical_encryption_active_key_id", "k1"), \
         unittest.mock.patch.object(settings, "clinical_encryption_keys_json", json.dumps({"k1": short_b64})):
        with pytest.raises(RuntimeError, match="32 bytes"):
            _run_lifespan()

    # Non-canonical Base64 whitespace -> RuntimeError
    with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"), \
         unittest.mock.patch.object(settings, "clinical_encryption_active_key_id", "k1"), \
         unittest.mock.patch.object(settings, "clinical_encryption_keys_json", json.dumps({"k1": f" {valid_b64}"})):
        with pytest.raises(RuntimeError, match="whitespace"):
            _run_lifespan()

    # Active key absent from keys JSON -> RuntimeError
    with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"), \
         unittest.mock.patch.object(settings, "clinical_encryption_active_key_id", "missing_k"), \
         unittest.mock.patch.object(settings, "clinical_encryption_keys_json", json.dumps({"k1": valid_b64})):
        with pytest.raises(RuntimeError, match="not found"):
            _run_lifespan()

    # Valid mixed_read config succeeds and binds app.state.clinical_key_registry
    with unittest.mock.patch.object(settings, "clinical_encryption_mode", "mixed_read"), \
         unittest.mock.patch.object(settings, "clinical_encryption_active_key_id", "k1"), \
         unittest.mock.patch.object(settings, "clinical_encryption_keys_json", json.dumps({"k1": valid_b64})):
        _run_lifespan()
        assert app.state.clinical_key_registry is not None
        assert app.state.clinical_key_registry.active_key_id == "k1"
        assert app.state.clinical_key_registry.has_key("k1")
        app.state.clinical_key_registry = None

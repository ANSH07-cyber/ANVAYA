"""
ANVAYA Gate 2B Phase 3C-2M — Read-Write Route, Backfill & Rollback Test Suite
Target: tests/test_ehr_read_write_backfill.py

Verifies offline against real SQLAlchemy models, FastAPI TestClient routes, and SQLite:
1. HealthRecord ORM defaults & SQL CHECK constraint (encryption_version IN (0, 1)).
2. FastAPI `read_write` consultation completion (`PATCH /api/v1/appointments/{id}/status`):
   persists `enc:v1:<key_id>:...` envelopes, `encryption_version=1`, preserves NULLs,
   encrypts empty strings cleanly, returns plaintext response, never leaks ciphertext.
3. Authorized patient & doctor selective reads across mixed v0 + v1 records, plus RBAC/consent denials.
4. Backfill CLI (`scripts/migrate_health_records_encryption.py`):
   - Dry-run default (0 writes)
   - Explicit `--execute` bounded batching (`batch_size=2`)
   - 7 canonical fields encrypted with bound UUID + field_name AAD
   - Double-encryption guard (`enc:` labeled v0 fails closed)
   - Atomic batch rollback on failure (unaffected batches preserved, failing batch stays v0 plaintext)
   - Strict idempotency (second run modifies 0 rows, never nests `enc:v1:`)
   - Database identity / role / Alembic revision / key ID preconditions fail closed.
5. Wrong AAD / tampered tag / missing key startup / zero silent plaintext fallback.
"""

from __future__ import annotations

import asyncio
import base64
from datetime import date, datetime, time, timedelta
import json
import os
import unittest.mock
import uuid

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.core.crypto import DecryptionError, EnvelopeFormatError, KeyRegistry
from app.core.security import create_access_token
from app.db.session import get_db
from app.main import app, lifespan
from app.models.appointment import Appointment
from app.models.consent_record import ConsentRecord
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.patient_profile import PatientProfile
from app.models.user import User
from app.services.clinical_crypto_service import (
    CLINICAL_FIELDS,
    DoubleEncryptionError,
    decrypt_record_field,
    encrypt_record_field,
)
from scripts import migrate_health_records_encryption as backfill_cli


def _make_key_b64() -> str:
    return base64.b64encode(os.urandom(32)).decode("ascii")


def test_01_orm_defaults_and_check_constraint(db_session, patient_account, approved_doctor, past_booked_appointment) -> None:
    """HealthRecord defaults omitted encryption_version to 0 and rejects values outside (0, 1)."""
    hr = HealthRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_id=past_booked_appointment.id,
        visit_date=past_booked_appointment.appointment_date,
        visit_summary="Baseline SQLAlchemy ORM default summary.",
    )
    assert hr.encryption_version == 0
    db_session.add(hr)
    db_session.commit()
    db_session.refresh(hr)
    assert hr.encryption_version == 0

    bad_appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=past_booked_appointment.appointment_date - timedelta(days=1),
        start_time=time(11, 0),
        end_time=time(11, 30),
        status="completed",
    )
    db_session.add(bad_appt)
    db_session.commit()

    bad_hr = HealthRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_id=bad_appt.id,
        visit_date=bad_appt.appointment_date,
        visit_summary="Invalid encryption version check.",
        encryption_version=2,
    )
    db_session.add(bad_hr)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_02_read_write_route_encrypts_persisted_row_and_enforces_rbac_consent(
    test_engine,
    db_session,
    patient_account,
    approved_doctor,
    past_booked_appointment,
    patient_headers,
    doctor_headers,
) -> None:
    """FastAPI PATCH appointment completion encrypts all populated CLINICAL_FIELDS in DB,
    preserves NULLs, returns plaintext response, and enforces patient/doctor/admin/consent boundaries."""
    key_id = "rw_e2e_k1"
    key_b64 = _make_key_b64()
    keys_json = json.dumps({key_id: key_b64})

    # Seed an admin, another patient, an unapproved doctor, and partial active consent
    admin_user = User(
        full_name="Test Admin",
        email="admin.rw@example.com",
        password_hash="h",
        role="admin",
        is_active=True,
    )
    other_patient_user = User(
        full_name="Other Patient",
        email="other.patient.rw@example.com",
        password_hash="h",
        role="patient",
        is_active=True,
    )
    pending_doc_user = User(
        full_name="Pending Doc",
        email="pending.doc.rw@example.com",
        password_hash="h",
        role="doctor",
        is_active=True,
    )
    db_session.add_all([admin_user, other_patient_user, pending_doc_user])
    db_session.flush()

    other_patient_profile = PatientProfile(user_id=other_patient_user.id)
    pending_doc_profile = DoctorProfile(
        user_id=pending_doc_user.id,
        specialization="General",
        qualification="MBBS",
        license_number="PENDING-RW-001",
        years_experience=2,
        clinic_name="Pending Clinic",
        verification_status="pending",
    )
    consent = ConsentRecord(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        data_scopes=["visit_summary", "diagnosis"],
        is_active=True,
    )
    db_session.add_all([other_patient_profile, pending_doc_profile, consent])
    db_session.commit()

    TestingSessionLocal = sessionmaker(bind=test_engine, autoflush=False, autocommit=False, expire_on_commit=False)

    def override_get_db():
        with TestingSessionLocal() as session:
            yield session

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db

    try:
        with unittest.mock.patch.object(settings, "clinical_encryption_mode", "read_write"), \
             unittest.mock.patch.object(settings, "clinical_encryption_active_key_id", key_id), \
             unittest.mock.patch.object(settings, "clinical_encryption_keys_json", keys_json):
            with TestClient(app) as client:
                # Complete appointment via real FastAPI route (note clinical_notes=None, treatment_plan whitespace -> None)
                payload = {
                    "visit_summary": "Read-write encrypted summary exceeding ten chars.",
                    "chief_complaint": "Persistent cough",
                    "symptoms": "Dry cough for 5 days",
                    "diagnosis": "Acute bronchitis",
                    "clinical_notes": None,
                    "treatment_plan": "   ",
                    "follow_up_instructions": "Hydrate and follow up in 7 days",
                }
                res = client.patch(
                    f"/api/v1/appointments/{past_booked_appointment.id}/status",
                    headers=doctor_headers,
                    json=payload,
                )
                assert res.status_code == 200
                body = res.json()
                assert body["visit_summary"] == payload["visit_summary"]
                assert body["diagnosis"] == "Acute bronchitis"
                assert body["clinical_notes"] is None
                assert body["treatment_plan"] is None
                assert not body["visit_summary"].startswith("enc:v1:")

                # Inspect persisted DB row directly
                with TestingSessionLocal() as verify_sess:
                    persisted = verify_sess.get(HealthRecord, uuid.UUID(body["id"]))
                    assert persisted is not None
                    assert persisted.encryption_version == 1
                    for field in ("visit_summary", "chief_complaint", "symptoms", "diagnosis", "follow_up_instructions"):
                        raw_col = getattr(persisted, field)
                        assert isinstance(raw_col, str)
                        assert raw_col.startswith(f"enc:v1:{key_id}:")
                        assert payload[field] not in raw_col
                    assert persisted.clinical_notes is None
                    assert persisted.treatment_plan is None

                    # Tamper defense check using same KeyRegistry loaded by lifespan
                    reg = client.app.state.clinical_key_registry
                    assert reg is not None
                    assert decrypt_record_field(
                        record_id=persisted.id,
                        field_name="diagnosis",
                        envelope=persisted.diagnosis,
                        registry=reg,
                    ) == "Acute bronchitis"
                    with pytest.raises(DecryptionError):
                        decrypt_record_field(
                            record_id=persisted.id,
                            field_name="visit_summary",
                            envelope=persisted.diagnosis,
                            registry=reg,
                        )

                # Unauthenticated -> 401
                assert client.get("/api/v1/health-records/me").status_code == 401
                assert client.get(f"/api/v1/health-records/patient/{patient_account['profile'].id}?scopes=visit_summary").status_code == 401

                # Admin cannot bypass patient/doctor EHR permissions -> 403
                admin_headers = {"Authorization": f"Bearer {create_access_token(str(admin_user.id))}"}
                assert client.get("/api/v1/health-records/me", headers=admin_headers).status_code == 403
                assert client.get(
                    f"/api/v1/health-records/patient/{patient_account['profile'].id}?scopes=visit_summary",
                    headers=admin_headers,
                ).status_code == 403

                # Patient owner reads decrypted fields
                me_res = client.get("/api/v1/health-records/me", headers=patient_headers)
                assert me_res.status_code == 200
                me_items = me_res.json()["items"]
                assert len(me_items) == 1
                assert me_items[0]["diagnosis"] == "Acute bronchitis"
                assert me_items[0]["visit_summary"] == payload["visit_summary"]

                # Cross-patient isolation: other patient gets 0 items
                other_headers = {"Authorization": f"Bearer {create_access_token(str(other_patient_user.id))}"}
                other_res = client.get("/api/v1/health-records/me", headers=other_headers)
                assert other_res.status_code == 200
                assert other_res.json()["total"] == 0
                assert other_res.json()["items"] == []

                # Consented doctor reads authorized subset ONLY
                doc_ok = client.get(
                    f"/api/v1/health-records/patient/{patient_account['profile'].id}?scopes=visit_summary&scopes=diagnosis",
                    headers=doctor_headers,
                )
                assert doc_ok.status_code == 200
                doc_item = doc_ok.json()["items"][0]
                assert set(doc_item["data"].keys()) == {"visit_summary", "diagnosis"}
                assert doc_item["data"]["diagnosis"] == "Acute bronchitis"

                # Out-of-scope request denied -> 403 without clinical leakage
                doc_oos = client.get(
                    f"/api/v1/health-records/patient/{patient_account['profile'].id}?scopes=symptoms",
                    headers=doctor_headers,
                )
                assert doc_oos.status_code == 403
                assert "Dry cough" not in doc_oos.text

                # Pending doctor denied -> 403
                pending_headers = {"Authorization": f"Bearer {create_access_token(str(pending_doc_user.id))}"}
                assert client.get(
                    f"/api/v1/health-records/patient/{patient_account['profile'].id}?scopes=visit_summary",
                    headers=pending_headers,
                ).status_code == 403
    finally:
        app.state.clinical_key_registry = None
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override


def _seed_five_v0_and_one_v1(db_session, patient_profile_id, doctor_profile_id, registry: KeyRegistry):
    v0_ids: list[uuid.UUID] = []
    base_day = date(2026, 11, 1)
    for i in range(5):
        appt = Appointment(
            patient_profile_id=patient_profile_id,
            doctor_profile_id=doctor_profile_id,
            appointment_date=base_day + timedelta(days=i),
            start_time=time(9, 0),
            end_time=time(9, 30),
            status="completed",
        )
        db_session.add(appt)
        db_session.flush()
        hr_id = uuid.uuid4()
        hr = HealthRecord(
            id=hr_id,
            patient_profile_id=patient_profile_id,
            doctor_profile_id=doctor_profile_id,
            appointment_id=appt.id,
            visit_date=appt.appointment_date,
            visit_summary=f"Legacy visit summary number {i}",
            chief_complaint="" if i == 0 else f"Complaint {i}",
            symptoms=None if i % 2 == 0 else f"Symptom {i}",
            diagnosis=f"Diagnosis {i}",
            clinical_notes=None,
            treatment_plan=f"Plan {i}",
            follow_up_instructions="Review PRN",
            encryption_version=0,
        )
        db_session.add(hr)
        v0_ids.append(hr_id)

    # Already encrypted v1 record
    appt_v1 = Appointment(
        patient_profile_id=patient_profile_id,
        doctor_profile_id=doctor_profile_id,
        appointment_date=base_day + timedelta(days=10),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="completed",
    )
    db_session.add(appt_v1)
    db_session.flush()
    v1_id = uuid.uuid4()
    hr_v1 = HealthRecord(
        id=v1_id,
        patient_profile_id=patient_profile_id,
        doctor_profile_id=doctor_profile_id,
        appointment_id=appt_v1.id,
        visit_date=appt_v1.appointment_date,
        visit_summary=encrypt_record_field(
            record_id=v1_id, field_name="visit_summary", plaintext="Already encrypted v1", registry=registry
        ),
        diagnosis=encrypt_record_field(
            record_id=v1_id, field_name="diagnosis", plaintext="Existing v1 diagnosis", registry=registry
        ),
        encryption_version=1,
    )
    db_session.add(hr_v1)
    db_session.commit()
    return v0_ids, v1_id


def test_03_backfill_dry_run_batching_idempotency_and_null_empty_handling(
    test_engine, db_session, patient_account, approved_doctor
) -> None:
    """Dry-run preserves v0, execute encrypts bounded batches atomically with AAD binding, and second run is idempotent."""
    reg = KeyRegistry()
    reg.register_key("anvaya_dev_clinical_k1", os.urandom(32), set_active=True)

    v0_ids, v1_id = _seed_five_v0_and_one_v1(
        db_session, patient_account["profile"].id, approved_doctor["profile"].id, reg
    )
    v1_orig_summary = db_session.get(HealthRecord, v1_id).visit_summary

    SessionFactory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False, expire_on_commit=False)

    # 1. Dry-run does 0 mutations
    dry = backfill_cli.run_backfill(SessionFactory, reg, execute=False, batch_size=2)
    assert dry["mode"] == "dry_run"
    assert dry["eligible_v0"] == 5
    assert dry["batches_committed"] == 0
    assert dry["after_counts"] == {"total": 6, "v0": 5, "v1": 1, "other": 0}

    # 2. Bounded execute (5 rows @ batch_size=2 -> 3 committed batches)
    res = backfill_cli.run_backfill(SessionFactory, reg, execute=True, batch_size=2)
    assert res["mode"] == "execute"
    assert res["batches_committed"] == 3
    assert res["rows_encrypted"] == 5
    assert res["after_counts"] == {"total": 6, "v0": 0, "v1": 6, "other": 0}

    with SessionFactory() as verify_sess:
        for i, hid in enumerate(v0_ids):
            rec = verify_sess.get(HealthRecord, hid)
            assert rec is not None and rec.encryption_version == 1
            assert rec.visit_summary.startswith("enc:v1:anvaya_dev_clinical_k1:")
            assert decrypt_record_field(
                record_id=hid, field_name="visit_summary", envelope=rec.visit_summary, registry=reg
            ) == f"Legacy visit summary number {i}"
            # Empty string preserved through encryption round-trip; None stayed None
            if i == 0:
                assert rec.chief_complaint.startswith("enc:v1:anvaya_dev_clinical_k1:")
                assert decrypt_record_field(
                    record_id=hid, field_name="chief_complaint", envelope=rec.chief_complaint, registry=reg
                ) == ""
            assert rec.clinical_notes is None
            if i % 2 == 0:
                assert rec.symptoms is None

        # Pre-existing v1 row was never re-encrypted
        v1_rec = verify_sess.get(HealthRecord, v1_id)
        assert v1_rec is not None and v1_rec.visit_summary == v1_orig_summary
        assert v1_rec.visit_summary.count("enc:v1:") == 1

    # 3. Idempotency: repeat dry-run and execute touch 0 rows
    dry2 = backfill_cli.run_backfill(SessionFactory, reg, execute=False, batch_size=2)
    assert dry2["eligible_v0"] == 0
    res2 = backfill_cli.run_backfill(SessionFactory, reg, execute=True, batch_size=2)
    assert res2["batches_committed"] == 0
    assert res2["rows_encrypted"] == 0
    assert res2["after_counts"] == {"total": 6, "v0": 0, "v1": 6, "other": 0}


def test_04_backfill_batch_rollback_and_double_encryption_guard(
    test_engine, db_session, patient_account, approved_doctor
) -> None:
    """Batch failure rolls back the whole batch atomically while preserving earlier committed batches."""
    reg = KeyRegistry()
    reg.register_key("anvaya_dev_clinical_k1", os.urandom(32), set_active=True)

    v0_ids, _ = _seed_five_v0_and_one_v1(
        db_session, patient_account["profile"].id, approved_doctor["profile"].id, reg
    )
    SessionFactory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False, expire_on_commit=False)

    # Deterministic order is ORDER BY id
    ordered_ids = sorted(v0_ids)
    failing_target = ordered_ids[3]  # 4th row -> falls in batch 2 of batch_size=2

    def inject_crash(row: HealthRecord) -> None:
        if row.id == failing_target:
            raise RuntimeError("Simulated DB/crypto failure mid-batch")

    with pytest.raises(RuntimeError, match="Backfill aborted cleanly in batch 2"):
        backfill_cli.run_backfill(
            SessionFactory,
            reg,
            execute=True,
            batch_size=2,
            on_before_row_update=inject_crash,
        )

    # Batch 1 (2 rows) committed as v1; Batch 2 (including row 3 before row 4!) rolled back to v0 plaintext
    with SessionFactory() as check_sess:
        for idx, hid in enumerate(ordered_ids):
            rec = check_sess.get(HealthRecord, hid)
            assert rec is not None
            if idx < 2:
                assert rec.encryption_version == 1
                assert rec.visit_summary.startswith("enc:v1:")
            else:
                assert rec.encryption_version == 0
                assert rec.visit_summary.startswith("Legacy visit summary number ")

    # Anomalous enc:v1 prefix labeled v0 blocks execution fail-closed
    with SessionFactory() as corrupt_sess:
        corrupt_rec = corrupt_sess.get(HealthRecord, ordered_ids[2])
        assert corrupt_rec is not None
        corrupt_rec.visit_summary = "enc:v1:anvaya_dev_clinical_k1:fake:fake"
        corrupt_sess.commit()

    with pytest.raises(DoubleEncryptionError):
        backfill_cli.run_backfill(SessionFactory, reg, execute=True, batch_size=2)


def test_05_backfill_target_guards_and_invalid_key_startup() -> None:
    """Target URL / PostgreSQL identity / Alembic revision guards and lifespan reject unapproved configs."""
    with pytest.raises(RuntimeError, match="host/port"):
        backfill_cli.verify_configured_database_url("postgresql+psycopg://anvaya_app:pw@127.0.0.1:5433/anvaya_db")
    with pytest.raises(RuntimeError, match="database"):
        backfill_cli.verify_configured_database_url("postgresql+psycopg://anvaya_app:pw@127.0.0.1:5432/HealthCare")
    with pytest.raises(RuntimeError, match="role"):
        backfill_cli.verify_configured_database_url("postgresql+psycopg://postgres:pw@127.0.0.1:5432/anvaya_db")

    class _FakeExec:
        def __init__(self, row):
            self._row = row

        def one(self):
            return self._row

    class _FakeSession:
        def __init__(self, row):
            self._row = row

        def execute(self, _stmt):
            return _FakeExec(self._row)

    with pytest.raises(RuntimeError, match="Alembic revision mismatch"):
        backfill_cli.verify_postgres_preconditions(
            _FakeSession(("anvaya_db", "anvaya_app", 5432, "c3d4e5f6a7b8"))  # type: ignore[arg-type]
        )

    # Invalid JSON / key startup fails closed in read_write
    async def _run_life():
        async with lifespan(app):
            pass

    with unittest.mock.patch.object(settings, "clinical_encryption_mode", "read_write"), \
         unittest.mock.patch.object(settings, "clinical_encryption_active_key_id", "k1"), \
         unittest.mock.patch.object(settings, "clinical_encryption_keys_json", "{bad json"):
        with pytest.raises(RuntimeError, match="not valid JSON"):
            asyncio.run(_run_life())


def test_06_mixed_v0_and_v1_reads_without_silent_plaintext_fallback(
    test_engine, db_session, patient_account, approved_doctor, patient_headers
) -> None:
    """In mixed_read and read_write, v0 + v1 rows coexist cleanly and corrupted v1 fails closed."""
    key_id = "mixed_v0v1_k1"
    key_b64 = _make_key_b64()
    raw = base64.b64decode(key_b64)
    reg = KeyRegistry()
    reg.register_key(key_id, raw, set_active=True)

    a0 = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=date(2026, 11, 10),
        start_time=time(9, 0),
        end_time=time(9, 30),
        status="completed",
    )
    a1 = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=date(2026, 11, 11),
        start_time=time(9, 0),
        end_time=time(9, 30),
        status="completed",
    )
    db_session.add_all([a0, a1])
    db_session.flush()

    r0 = HealthRecord(
        id=uuid.uuid4(),
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_id=a0.id,
        visit_date=a0.appointment_date,
        visit_summary="Legacy v0 summary text",
        encryption_version=0,
    )
    r1_id = uuid.uuid4()
    r1 = HealthRecord(
        id=r1_id,
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_id=a1.id,
        visit_date=a1.appointment_date,
        visit_summary=encrypt_record_field(
            record_id=r1_id, field_name="visit_summary", plaintext="Encrypted v1 summary text", registry=reg
        ),
        encryption_version=1,
    )
    db_session.add_all([r0, r1])
    db_session.commit()

    TestingSessionLocal = sessionmaker(bind=test_engine, autoflush=False, autocommit=False, expire_on_commit=False)

    def override_get_db():
        with TestingSessionLocal() as session:
            yield session

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db

    try:
        with unittest.mock.patch.object(settings, "clinical_encryption_mode", "read_write"), \
             unittest.mock.patch.object(settings, "clinical_encryption_active_key_id", key_id), \
             unittest.mock.patch.object(settings, "clinical_encryption_keys_json", json.dumps({key_id: key_b64})):
            with TestClient(app, raise_server_exceptions=False) as client:
                ok_res = client.get("/api/v1/health-records/me", headers=patient_headers)
                assert ok_res.status_code == 200
                summaries = [item["visit_summary"] for item in ok_res.json()["items"]]
                assert summaries == ["Encrypted v1 summary text", "Legacy v0 summary text"]

                # Corrupt v1 field to plaintext -> must fail closed (500 sanitized), zero plaintext fallback
                with TestingSessionLocal() as corrupt_s:
                    bad = corrupt_s.get(HealthRecord, r1_id)
                    assert bad is not None
                    bad.visit_summary = "RAW_PLAINTEXT_IN_V1_MUST_FAIL_CLOSED"
                    corrupt_s.commit()

                fail_res = client.get("/api/v1/health-records/me", headers=patient_headers)
                assert fail_res.status_code == 500
                assert "RAW_PLAINTEXT_IN_V1_MUST_FAIL_CLOSED" not in fail_res.text
    finally:
        app.state.clinical_key_registry = None
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override

"""
ANVAYA Disabled-Mode Ciphertext Exposure Guard Regression Suite
Target: Offline validation for Gate 2B Phase 3C-2G

Validates the defensive ciphertext envelope guard in `app.api.routes.health_records`
when `clinical_encryption_mode == "disabled"` (default):
- Patient `GET /health-records/me` and Doctor `GET /health-records/patient/{patient_profile_id}`
  inspect all seven canonical `CLINICAL_FIELDS` before serializing any response.
- Any `enc:v1:` or other `enc:` envelope fails closed with a sanitized HTTP error.
- Ordinary plaintext (including clinical words like "encephalopathy"), NULLs, empty strings,
  Hindi Unicode, pagination, RBAC, consent scopes, and audit controls remain intact.
- Zero crypto helpers invoked, zero KeyRegistry required, zero `encryption_version` dependency,
  and zero database or network connections.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import ast
import inspect
import textwrap
import unittest.mock
import uuid
from typing import Any

import pytest
from fastapi import HTTPException

from app.api.deps import get_clinical_key_registry, require_roles
from app.api.routes import health_records as health_records_routes
from app.api.routes.health_records import (
    _guard_disabled_mode_records,
    get_my_health_records,
    get_patient_health_records_for_doctor,
)
from app.core.config import settings
from app.models.consent_record import ConsentRecord
from app.models.doctor_profile import DoctorProfile
from app.models.health_record import HealthRecord
from app.models.patient_profile import PatientProfile
from app.models.user import User
from app.services.clinical_crypto_service import CLINICAL_FIELDS


# ==============================================================================
# IN-MEMORY TEST HARNESS (SYNTHETIC ROUTE SIMULATION HELPERS)
# ==============================================================================


class _ScalarListResult:
    """Minimal stand-in for SQLAlchemy ScalarResult supporting `.all()`."""

    def __init__(self, items: list[Any]) -> None:
        self._items = items

    def all(self) -> list[Any]:
        return list(self._items)


class _FakePatientSession:
    """In-memory DB session stub for `get_my_health_records` route tests."""

    def __init__(self, patient_profile: PatientProfile | None, records: list[HealthRecord]) -> None:
        self._patient_profile = patient_profile
        self._all_records = records
        self._scalar_calls = 0

    def scalar(self, _stmt: Any) -> Any:
        self._scalar_calls += 1
        if self._scalar_calls == 1:
            return self._patient_profile
        return len(self._all_records)

    def scalars(self, _stmt: Any) -> _ScalarListResult:
        # Simulate SQL ORDER BY visit_date DESC, created_at DESC with LIMIT/OFFSET
        limit = 20
        offset = 0
        if hasattr(_stmt, "_limit_clause") and _stmt._limit_clause is not None:
            limit = int(_stmt._limit_clause.value)
        if hasattr(_stmt, "_offset_clause") and _stmt._offset_clause is not None:
            offset = int(_stmt._offset_clause.value)
        return _ScalarListResult(self._all_records[offset : offset + limit])


class _FakeDoctorSession:
    """In-memory DB session stub for `get_patient_health_records_for_doctor` route tests."""

    def __init__(
        self,
        *,
        doctor_profile: DoctorProfile | None,
        patient_profile: PatientProfile | None,
        consents: list[ConsentRecord],
        records: list[HealthRecord],
    ) -> None:
        self._doctor_profile = doctor_profile
        self._patient_profile = patient_profile
        self._consents = consents
        self._records = records
        self._scalar_calls = 0
        self._scalars_calls = 0
        self.commits = 0

    def scalar(self, _stmt: Any) -> Any:
        self._scalar_calls += 1
        if self._scalar_calls == 1:
            return self._doctor_profile
        if self._scalar_calls == 2:
            return self._patient_profile
        return len(self._records)

    def scalars(self, _stmt: Any) -> _ScalarListResult:
        self._scalars_calls += 1
        if self._scalars_calls == 1:
            return _ScalarListResult(self._consents)
        limit = 20
        offset = 0
        if hasattr(_stmt, "_limit_clause") and _stmt._limit_clause is not None:
            limit = int(_stmt._limit_clause.value)
        if hasattr(_stmt, "_offset_clause") and _stmt._offset_clause is not None:
            offset = int(_stmt._offset_clause.value)
        return _ScalarListResult(self._records[offset : offset + limit])

    def commit(self) -> None:
        self.commits += 1


def _make_record(
    *,
    patient_profile_id: uuid.UUID,
    doctor_profile_id: uuid.UUID,
    visit_summary: str = "Routine follow-up summary in plaintext.",
    chief_complaint: str | None = "Mild fatigue",
    symptoms: str | None = "Low-grade evening fever",
    diagnosis: str | None = "Viral upper respiratory infection",
    clinical_notes: str | None = "Lungs clear on auscultation.",
    treatment_plan: str | None = "Rest and oral hydration.",
    follow_up_instructions: str | None = "Return in 5 days if persistent.",
) -> HealthRecord:
    """Builds an unmigrated in-memory `HealthRecord` ORM instance."""
    now = datetime(2026, 11, 25, 10, 0, tzinfo=timezone.utc)
    return HealthRecord(
        id=uuid.uuid4(),
        patient_profile_id=patient_profile_id,
        doctor_profile_id=doctor_profile_id,
        appointment_id=uuid.uuid4(),
        visit_date=date(2026, 11, 25),
        visit_summary=visit_summary,
        chief_complaint=chief_complaint,
        symptoms=symptoms,
        diagnosis=diagnosis,
        clinical_notes=clinical_notes,
        treatment_plan=treatment_plan,
        follow_up_instructions=follow_up_instructions,
        created_at=now,
        updated_at=now,
    )


def _make_identities() -> tuple[User, PatientProfile, User, DoctorProfile]:
    patient_user = User(
        id=uuid.uuid4(),
        full_name="Aarav Sharma",
        email="aarav@synthetic.test",
        role="patient",
        is_active=True,
    )
    patient_profile = PatientProfile(
        id=uuid.uuid4(),
        user_id=patient_user.id,
        date_of_birth=date(1990, 5, 12),
        gender="male",
    )
    doctor_user = User(
        id=uuid.uuid4(),
        full_name="Dr. Meera Iyer",
        email="meera@synthetic.test",
        role="doctor",
        is_active=True,
    )
    doctor_profile = DoctorProfile(
        id=uuid.uuid4(),
        user_id=doctor_user.id,
        specialization="Internal Medicine",
        qualification="MBBS, MD",
        license_number="SYNTH-MED-001",
        verification_status="approved",
    )
    return patient_user, patient_profile, doctor_user, doctor_profile


# ==============================================================================
# 1. SAFE PLAINTEXT, NULL, EMPTY STRING & UNICODE PRESERVATION
# ==============================================================================


def test_01_patient_ordinary_plaintext_null_empty_and_hindi_preserved() -> None:
    """Patient route preserves plaintext, NULLs, empty strings, 'enc*' words, and Hindi Unicode."""
    patient_user, patient_profile, _, doctor_profile = _make_identities()
    rec = _make_record(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        visit_summary="Encounter summary: patient evaluated for encephalopathy.",
        chief_complaint="मरीज को पिछले दो दिनों से तेज सिरदर्द और हल्का बुखार है।",
        symptoms="",
        diagnosis=None,
        clinical_notes="Normal neurological exam; enclosed discharge slip given.",
        treatment_plan=None,
        follow_up_instructions="",
    )
    db = _FakePatientSession(patient_profile, [rec])

    assert settings.effective_encryption_mode == "disabled"
    resp = get_my_health_records(
        limit=20,
        offset=0,
        current_user=patient_user,
        db=db,  # type: ignore[arg-type]
        key_registry=None,
    )

    assert resp.total == 1
    assert len(resp.items) == 1
    item = resp.items[0]
    assert item.visit_summary == "Encounter summary: patient evaluated for encephalopathy."
    assert item.chief_complaint == "मरीज को पिछले दो दिनों से तेज सिरदर्द और हल्का बुखार है।"
    assert item.symptoms == ""
    assert item.diagnosis is None
    assert item.treatment_plan is None
    assert item.follow_up_instructions == ""


def test_02_doctor_ordinary_plaintext_null_empty_and_hindi_preserved() -> None:
    """Doctor route preserves plaintext, NULLs, empty strings, Hindi Unicode, and scope limits."""
    _, patient_profile, doctor_user, doctor_profile = _make_identities()
    rec = _make_record(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        visit_summary="Encounter note.",
        chief_complaint="बुखार और खांसी।",
        symptoms="",
        diagnosis=None,
        clinical_notes="Private unconsented clinical note.",
    )
    consent = ConsentRecord(
        id=uuid.uuid4(),
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        data_scopes=["chief_complaint", "symptoms", "diagnosis"],
        is_active=True,
    )
    db = _FakeDoctorSession(
        doctor_profile=doctor_profile,
        patient_profile=patient_profile,
        consents=[consent],
        records=[rec],
    )

    with unittest.mock.patch("app.api.routes.health_records.add_audit_log") as mock_audit:
        resp = get_patient_health_records_for_doctor(
            patient_profile_id=patient_profile.id,
            scopes=["chief_complaint", "symptoms", "diagnosis"],
            limit=20,
            offset=0,
            current_user=doctor_user,
            db=db,  # type: ignore[arg-type]
            key_registry=None,
        )

    assert resp.total == 1
    assert len(resp.items) == 1
    data = resp.items[0].data
    assert set(data.keys()) == {"chief_complaint", "symptoms", "diagnosis"}
    assert data["chief_complaint"] == "बुखार और खांसी।"
    assert data["symptoms"] == ""
    assert data["diagnosis"] is None
    assert "clinical_notes" not in data
    assert "visit_summary" not in data
    assert mock_audit.call_count == 1
    assert mock_audit.call_args.kwargs["outcome"] == "success"


# ==============================================================================
# 2. CIPHERTEXT ENVELOPE DETECTION & SANITIZED ERROR HANDLING
# ==============================================================================


@pytest.mark.parametrize(
    "envelope_value",
    [
        "enc:v1:key_v1:AAAA:BBBB",
        "  enc:v1:key_v1:AAAA:BBBB  ",
        "enc:v2:key_v2:CCCC:DDDD",
        "ENC:v3:future_key:EEEE:FFFF",
        "enc:aes256gcm:key_a:1111:2222",
    ],
)
@pytest.mark.parametrize("field_name", sorted(CLINICAL_FIELDS))
def test_03_patient_route_rejects_any_encrypted_field_with_sanitized_error(
    field_name: str,
    envelope_value: str,
) -> None:
    """Patient route rejects any enc:v1: or other enc: envelope across all 7 canonical fields."""
    patient_user, patient_profile, _, doctor_profile = _make_identities()
    rec = _make_record(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        visit_summary="SENSITIVE_PLAINTEXT_NARRATIVE_MUST_NOT_LEAK",
    )
    setattr(rec, field_name, envelope_value)
    db = _FakePatientSession(patient_profile, [rec])

    with pytest.raises(HTTPException) as exc_info:
        get_my_health_records(
            limit=20,
            offset=0,
            current_user=patient_user,
            db=db,  # type: ignore[arg-type]
            key_registry=None,
        )

    detail = str(exc_info.value.detail)
    assert exc_info.value.status_code in (500, 503)
    assert "enc:" not in detail.lower()
    assert "key_v1" not in detail
    assert "key_v2" not in detail
    assert "future_key" not in detail
    assert "SENSITIVE_PLAINTEXT_NARRATIVE_MUST_NOT_LEAK" not in detail
    assert field_name not in detail


@pytest.mark.parametrize(
    "envelope_value",
    [
        "enc:v1:key_v1:AAAA:BBBB",
        "enc:v2:key_v2:CCCC:DDDD",
        "ENC:v9:legacy_alt:1111:2222",
    ],
)
@pytest.mark.parametrize("field_name", sorted(CLINICAL_FIELDS))
def test_04_doctor_route_rejects_any_encrypted_field_even_when_unrequested(
    field_name: str,
    envelope_value: str,
) -> None:
    """Doctor route fails closed if any of the 7 fields is encrypted, even if only diagnosis was requested."""
    _, patient_profile, doctor_user, doctor_profile = _make_identities()
    rec = _make_record(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        diagnosis="SENSITIVE_DIAGNOSIS_NARRATIVE_SECRET",
    )
    setattr(rec, field_name, envelope_value)
    consent = ConsentRecord(
        id=uuid.uuid4(),
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        data_scopes=["diagnosis"],
        is_active=True,
    )
    db = _FakeDoctorSession(
        doctor_profile=doctor_profile,
        patient_profile=patient_profile,
        consents=[consent],
        records=[rec],
    )

    with unittest.mock.patch("app.api.routes.health_records.add_audit_log") as mock_audit:
        with pytest.raises(HTTPException) as exc_info:
            get_patient_health_records_for_doctor(
                patient_profile_id=patient_profile.id,
                scopes=["diagnosis"],
                limit=20,
                offset=0,
                current_user=doctor_user,
                db=db,  # type: ignore[arg-type]
                key_registry=None,
            )

    detail = str(exc_info.value.detail)
    assert exc_info.value.status_code in (500, 503)
    assert "enc:" not in detail.lower()
    assert "key_v1" not in detail
    assert "key_v2" not in detail
    assert "SENSITIVE_DIAGNOSIS_NARRATIVE_SECRET" not in detail
    assert field_name not in detail
    # Guard triggers before STEP 9 success audit entry
    assert mock_audit.call_count == 0
    assert db.commits == 0


# ==============================================================================
# 3. PAGINATION & ANTI-PARTIAL-LEAKAGE INVARIANTS
# ==============================================================================


def test_05_encrypted_later_record_rejects_entire_patient_page() -> None:
    """Encrypted field in record #2 prevents partial leakage of record #1 on the same page."""
    patient_user, patient_profile, _, doctor_profile = _make_identities()
    plain_rec = _make_record(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        visit_summary="First record plaintext summary.",
    )
    enc_rec = _make_record(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        treatment_plan="enc:v1:key_v1:NONCE:CIPHER",
    )
    db = _FakePatientSession(patient_profile, [plain_rec, enc_rec])

    with pytest.raises(HTTPException) as exc_info:
        get_my_health_records(
            limit=20,
            offset=0,
            current_user=patient_user,
            db=db,  # type: ignore[arg-type]
            key_registry=None,
        )
    assert exc_info.value.status_code == 503


def test_06_encrypted_later_record_rejects_entire_doctor_page_and_preserves_clean_page_one() -> None:
    """Doctor page with encrypted record #2 fails completely; isolated plaintext page 1 still works."""
    _, patient_profile, doctor_user, doctor_profile = _make_identities()
    plain_rec = _make_record(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        diagnosis="Tension headache",
    )
    enc_rec = _make_record(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        clinical_notes="enc:v2:key_v2:NONCE:CIPHER",
    )
    consent = ConsentRecord(
        id=uuid.uuid4(),
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        data_scopes=["diagnosis"],
        is_active=True,
    )

    # Page covering both records fails closed with no partial items or success audit log
    db_combined = _FakeDoctorSession(
        doctor_profile=doctor_profile,
        patient_profile=patient_profile,
        consents=[consent],
        records=[plain_rec, enc_rec],
    )
    with unittest.mock.patch("app.api.routes.health_records.add_audit_log") as mock_audit:
        with pytest.raises(HTTPException) as exc_info:
            get_patient_health_records_for_doctor(
                patient_profile_id=patient_profile.id,
                scopes=["diagnosis"],
                limit=2,
                offset=0,
                current_user=doctor_user,
                db=db_combined,  # type: ignore[arg-type]
                key_registry=None,
            )
    assert exc_info.value.status_code == 503
    assert mock_audit.call_count == 0

    # Page 1 (limit=1, offset=0) contains only plain_rec -> allowed
    db_page1 = _FakeDoctorSession(
        doctor_profile=doctor_profile,
        patient_profile=patient_profile,
        consents=[consent],
        records=[plain_rec, enc_rec],
    )
    with unittest.mock.patch("app.api.routes.health_records.add_audit_log"):
        page1 = get_patient_health_records_for_doctor(
            patient_profile_id=patient_profile.id,
            scopes=["diagnosis"],
            limit=1,
            offset=0,
            current_user=doctor_user,
            db=db_page1,  # type: ignore[arg-type]
            key_registry=None,
        )
    assert page1.total == 2
    assert len(page1.items) == 1
    assert page1.items[0].data == {"diagnosis": "Tension headache"}

    # Page 2 (limit=1, offset=1) hits enc_rec -> fails closed
    db_page2 = _FakeDoctorSession(
        doctor_profile=doctor_profile,
        patient_profile=patient_profile,
        consents=[consent],
        records=[plain_rec, enc_rec],
    )
    with unittest.mock.patch("app.api.routes.health_records.add_audit_log"):
        with pytest.raises(HTTPException) as exc_page2:
            get_patient_health_records_for_doctor(
                patient_profile_id=patient_profile.id,
                scopes=["diagnosis"],
                limit=1,
                offset=1,
                current_user=doctor_user,
                db=db_page2,  # type: ignore[arg-type]
                key_registry=None,
            )
    assert exc_page2.value.status_code == 503


# ==============================================================================
# 4. RBAC, CONSENT ENFORCEMENT & ZERO CRYPTO / SCHEMA COUPLING
# ==============================================================================


def test_07_rbac_and_consent_enforcement_remain_intact() -> None:
    """Role checks, doctor approval, missing consent, and unauthorized scopes remain enforced."""
    patient_user, patient_profile, doctor_user, doctor_profile = _make_identities()

    # Role guard check via real require_roles dependency
    patient_checker = require_roles("patient")
    doctor_checker = require_roles("doctor")
    with pytest.raises(HTTPException) as exc_role_doc:
        patient_checker(current_user=doctor_user)
    assert exc_role_doc.value.status_code == 403
    with pytest.raises(HTTPException) as exc_role_pat:
        doctor_checker(current_user=patient_user)
    assert exc_role_pat.value.status_code == 403

    # Unapproved doctor denied
    pending_doctor = DoctorProfile(
        id=uuid.uuid4(),
        user_id=doctor_user.id,
        specialization="General",
        qualification="MBBS",
        license_number="PENDING-01",
        verification_status="pending",
    )
    db_unapproved = _FakeDoctorSession(
        doctor_profile=pending_doctor,
        patient_profile=patient_profile,
        consents=[],
        records=[],
    )
    with unittest.mock.patch("app.api.routes.health_records.add_audit_log") as mock_audit:
        with pytest.raises(HTTPException) as exc_unapp:
            get_patient_health_records_for_doctor(
                patient_profile_id=patient_profile.id,
                scopes=["diagnosis"],
                limit=20,
                offset=0,
                current_user=doctor_user,
                db=db_unapproved,  # type: ignore[arg-type]
                key_registry=None,
            )
    assert exc_unapp.value.status_code == 403
    assert mock_audit.call_args.kwargs["details"]["reason"] == "doctor_not_approved"

    # Active consent missing denied
    db_no_consent = _FakeDoctorSession(
        doctor_profile=doctor_profile,
        patient_profile=patient_profile,
        consents=[],
        records=[],
    )
    with unittest.mock.patch("app.api.routes.health_records.add_audit_log") as mock_audit:
        with pytest.raises(HTTPException) as exc_noconsent:
            get_patient_health_records_for_doctor(
                patient_profile_id=patient_profile.id,
                scopes=["diagnosis"],
                limit=20,
                offset=0,
                current_user=doctor_user,
                db=db_no_consent,  # type: ignore[arg-type]
                key_registry=None,
            )
    assert exc_noconsent.value.status_code == 403
    assert mock_audit.call_args.kwargs["details"]["reason"] == "active_consent_missing"

    # Scope outside consent denied
    partial_consent = ConsentRecord(
        id=uuid.uuid4(),
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        data_scopes=["diagnosis"],
        is_active=True,
    )
    db_bad_scope = _FakeDoctorSession(
        doctor_profile=doctor_profile,
        patient_profile=patient_profile,
        consents=[partial_consent],
        records=[],
    )
    with unittest.mock.patch("app.api.routes.health_records.add_audit_log") as mock_audit:
        with pytest.raises(HTTPException) as exc_scope:
            get_patient_health_records_for_doctor(
                patient_profile_id=patient_profile.id,
                scopes=["diagnosis", "clinical_notes"],
                limit=20,
                offset=0,
                current_user=doctor_user,
                db=db_bad_scope,  # type: ignore[arg-type]
                key_registry=None,
            )
    assert exc_scope.value.status_code == 403
    assert mock_audit.call_args.kwargs["details"]["reason"] == "requested_scopes_not_covered"


def test_08_no_key_registry_no_crypto_helpers_and_no_encryption_version_referenced() -> None:
    """Disabled mode requires no KeyRegistry, invokes zero crypto helpers, and ignores encryption_version."""
    patient_user, patient_profile, doctor_user, doctor_profile = _make_identities()
    rec = _make_record(
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
    )
    consent = ConsentRecord(
        id=uuid.uuid4(),
        patient_profile_id=patient_profile.id,
        doctor_profile_id=doctor_profile.id,
        data_scopes=["visit_summary"],
        is_active=True,
    )

    # Confirm ORM maps encryption_version (Phase 3C-2L) while helper AST never references it
    assert "encryption_version" in HealthRecord.__table__.columns
    guard_src = textwrap.dedent(inspect.getsource(_guard_disabled_mode_records))
    guard_ast = ast.parse(guard_src)
    guard_fn = guard_ast.body[0]
    assert isinstance(guard_fn, ast.FunctionDef)
    # Strip docstring node before checking executable AST tokens
    executable_nodes = (
        guard_fn.body[1:]
        if (
            guard_fn.body
            and isinstance(guard_fn.body[0], ast.Expr)
            and isinstance(guard_fn.body[0].value, ast.Constant)
        )
        else guard_fn.body
    )
    for stmt in executable_nodes:
        for node in ast.walk(stmt):
            if isinstance(node, ast.Name):
                assert node.id != "encryption_version"
            elif isinstance(node, ast.Attribute):
                assert node.attr != "encryption_version"
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                assert node.value != "encryption_version"
    assert "CLINICAL_FIELDS" in guard_src

    # Confirm get_clinical_key_registry returns None without touching app.state
    mock_req = unittest.mock.MagicMock()
    assert get_clinical_key_registry(mock_req) is None

    db_pat = _FakePatientSession(patient_profile, [rec])
    db_doc = _FakeDoctorSession(
        doctor_profile=doctor_profile,
        patient_profile=patient_profile,
        consents=[consent],
        records=[rec],
    )

    with unittest.mock.patch(
        "app.api.routes.health_records.decrypt_authorized_fields"
    ) as mock_route_dec, unittest.mock.patch(
        "app.services.clinical_crypto_service.decrypt_record_field"
    ) as mock_dec, unittest.mock.patch(
        "app.services.clinical_crypto_service.encrypt_record_field"
    ) as mock_enc, unittest.mock.patch(
        "app.core.crypto.decrypt_clinical_text"
    ) as mock_core_dec, unittest.mock.patch(
        "app.core.crypto.encrypt_clinical_text"
    ) as mock_core_enc, unittest.mock.patch(
        "app.api.routes.health_records.add_audit_log"
    ):
        pat_resp = get_my_health_records(
            limit=20,
            offset=0,
            current_user=patient_user,
            db=db_pat,  # type: ignore[arg-type]
            key_registry=None,
        )
        doc_resp = get_patient_health_records_for_doctor(
            patient_profile_id=patient_profile.id,
            scopes=["visit_summary"],
            limit=20,
            offset=0,
            current_user=doctor_user,
            db=db_doc,  # type: ignore[arg-type]
            key_registry=None,
        )

        assert pat_resp.total == 1
        assert doc_resp.total == 1
        assert mock_route_dec.call_count == 0
        assert mock_dec.call_count == 0
        assert mock_enc.call_count == 0
        assert mock_core_dec.call_count == 0
        assert mock_core_enc.call_count == 0

    # Also verify guard rejects ciphertext without inspecting encryption_version on bare object
    class _BareRecord:
        visit_summary = "enc:v1:key_v1:IV:CT"

    with pytest.raises(HTTPException) as exc_bare:
        _guard_disabled_mode_records([_BareRecord()])
    assert exc_bare.value.status_code == 503
    assert isinstance(health_records_routes, object)

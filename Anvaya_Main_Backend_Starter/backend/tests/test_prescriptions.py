
from datetime import date, timedelta, time
import uuid

from app.core.security import create_access_token
from app.models.appointment import Appointment
from app.models.doctor_profile import DoctorProfile
from app.models.patient_profile import PatientProfile
from app.models.user import User
from sqlalchemy import select

from app.models.audit_log import AuditLog


PRESCRIPTION_ENDPOINT = "/api/v1/prescriptions"

PRESCRIPTION_PAYLOAD = {
    "notes": "Doctor-recorded prescription for testing.",
    "items": [
        {
            "medicine_name": "Test Medicine A",
            "dosage": "500 mg",
            "route": "Oral",
            "frequency": "Twice daily",
            "duration": "5 days",
            "quantity": "10 tablets",
            "instructions": "Take after food.",
        },
        {
            "medicine_name": "Test Medicine B",
            "dosage": "10 mg",
            "route": "Oral",
            "frequency": "Once daily",
            "duration": "7 days",
            "quantity": "7 tablets",
            "instructions": "Take as directed by the doctor.",
        },
    ],
}


def complete_test_appointment(
    client,
    doctor_headers,
    appointment,
):
    payload = {
        "visit_summary": (
            "Patient consultation completed. "
            "Symptoms assessed and treatment discussed."
        ),
        "chief_complaint": "Routine consultation",
        "symptoms": "Test symptoms",
        "diagnosis": "Test diagnosis",
        "clinical_notes": "Patient examined.",
        "treatment_plan": "Doctor evaluation completed.",
        "follow_up_instructions": "Follow up as advised.",
    }

    response = client.patch(
        f"/api/v1/appointments/{appointment.id}/status",
        json=payload,
        headers=doctor_headers,
    )

    assert response.status_code == 200, response.text


def create_test_prescription(
    client,
    doctor_headers,
    appointment,
):
    return client.post(
        PRESCRIPTION_ENDPOINT,
        json={
            **PRESCRIPTION_PAYLOAD,
            "appointment_id": str(appointment.id),
        },
        headers=doctor_headers,
    )


# =====================================================
# 1. DOCTOR CAN CREATE PRESCRIPTION
# FOR COMPLETED APPOINTMENT
# =====================================================

def test_doctor_can_create_prescription(
    client,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    response = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    assert response.status_code == 201, response.text

    data = response.json()

    assert data["appointment_id"] == str(
        past_booked_appointment.id
    )

    assert data["patient_profile_id"] == str(
        past_booked_appointment.patient_profile_id
    )

    assert data["doctor_profile_id"] == str(
        past_booked_appointment.doctor_profile_id
    )

    assert len(data["items"]) == 2

    assert data["items"][0]["medicine_name"] == (
        "Test Medicine A"
    )

    assert data["items"][0]["sort_order"] == 0
    assert data["items"][1]["sort_order"] == 1


# =====================================================
# 2. DOCTOR CANNOT PRESCRIBE
# FOR A NON-COMPLETED APPOINTMENT
# =====================================================

def test_doctor_cannot_prescribe_uncompleted_appointment(
    client,
    doctor_headers,
    booked_appointment,
):
    response = create_test_prescription(
        client,
        doctor_headers,
        booked_appointment,
    )

    assert response.status_code == 409

    assert response.json()["detail"] == (
        "Prescription can only be issued for completed appointments."
    )


# =====================================================
# 3. PATIENT CANNOT CREATE PRESCRIPTION
# =====================================================

def test_patient_cannot_create_prescription(
    client,
    patient_headers,
    past_booked_appointment,
):
    response = client.post(
        PRESCRIPTION_ENDPOINT,
        json={
            **PRESCRIPTION_PAYLOAD,
            "appointment_id": str(
                past_booked_appointment.id
            ),
        },
        headers=patient_headers,
    )

    assert response.status_code == 403


# =====================================================
# 4. DOCTOR CANNOT PRESCRIBE
# FOR ANOTHER DOCTOR'S APPOINTMENT
# =====================================================

def test_doctor_cannot_prescribe_another_doctors_appointment(
    client,
    db_session,
    doctor_headers,
    patient_account,
):
    other_user = User(
        full_name="Another Test Doctor",
        email="another.prescription.doctor@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )

    db_session.add(other_user)
    db_session.flush()

    other_doctor = DoctorProfile(
        user_id=other_user.id,
        specialization="Dermatology",
        qualification="MBBS, MD Dermatology",
        license_number="PRESCRIPTION-OTHER-DOCTOR-001",
        years_experience=5,
        clinic_name="Another Test Clinic",
        verification_status="approved",
    )

    db_session.add(other_doctor)
    db_session.flush()

    other_appointment = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=other_doctor.id,
        appointment_date=date.today() - timedelta(days=2),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Another doctor's appointment",
    )

    db_session.add(other_appointment)
    db_session.commit()

    response = client.post(
        PRESCRIPTION_ENDPOINT,
        json={
            **PRESCRIPTION_PAYLOAD,
            "appointment_id": str(other_appointment.id),
        },
        headers=doctor_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Appointment not found."


# =====================================================
# 5. DUPLICATE PRESCRIPTION IS BLOCKED
# =====================================================

def test_duplicate_prescription_is_blocked(
    client,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    first_response = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    assert first_response.status_code == 201

    second_response = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    assert second_response.status_code == 409

    assert second_response.json()["detail"] == (
        "A prescription already exists for this appointment."
    )


# =====================================================
# 6. PATIENT CAN VIEW OWN PRESCRIPTIONS
# =====================================================

def test_patient_can_view_own_prescriptions(
    client,
    patient_headers,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    create_response = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    assert create_response.status_code == 201

    response = client.get(
        f"{PRESCRIPTION_ENDPOINT}/me",
        headers=patient_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["appointment_id"] == str(
        past_booked_appointment.id
    )

    assert len(data["items"][0]["items"]) == 2


# =====================================================
# 7. PATIENT CANNOT VIEW ANOTHER
# PATIENT'S PRESCRIPTIONS
# =====================================================

def test_patient_cannot_view_another_patients_prescriptions(
    client,
    db_session,
    patient_headers,
    doctor_headers,
    approved_doctor,
):
    other_user = User(
        full_name="Prescription Owner Two",
        email="prescription.owner.two@example.com",
        password_hash="test-only-password-hash",
        role="patient",
        is_active=True,
    )

    db_session.add(other_user)
    db_session.flush()

    other_patient = PatientProfile(
        user_id=other_user.id,
    )

    db_session.add(other_patient)
    db_session.flush()

    other_appointment = Appointment(
        patient_profile_id=other_patient.id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=date.today() - timedelta(days=2),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Other patient's consultation",
    )

    db_session.add(other_appointment)
    db_session.commit()

    complete_test_appointment(
        client,
        doctor_headers,
        other_appointment,
    )

    create_response = create_test_prescription(
        client,
        doctor_headers,
        other_appointment,
    )

    assert create_response.status_code == 201

    # The original patient must not see the other patient's prescription.
    response = client.get(
        f"{PRESCRIPTION_ENDPOINT}/me",
        headers=patient_headers,
    )

    assert response.status_code == 200

    assert response.json()["total"] == 0
    assert response.json()["items"] == []


# =====================================================
# 8. DOCTOR CANNOT ACCESS PATIENT PRESCRIPTION LIST
# =====================================================

def test_doctor_cannot_access_patient_prescription_list(
    client,
    doctor_headers,
):
    response = client.get(
        f"{PRESCRIPTION_ENDPOINT}/me",
        headers=doctor_headers,
    )

    assert response.status_code == 403


# =====================================================
# 9. PRESCRIPTION LIST REQUIRES AUTHENTICATION
# =====================================================

def test_prescription_list_requires_authentication(client):
    response = client.get(
        f"{PRESCRIPTION_ENDPOINT}/me"
    )

    assert response.status_code == 401


# =====================================================
# 10. UNAPPROVED DOCTOR CANNOT ISSUE PRESCRIPTION
# =====================================================

def test_unapproved_doctor_cannot_issue_prescription(
    client,
    db_session,
    approved_doctor,
    doctor_headers,
    booked_appointment,
):
    approved_doctor["profile"].verification_status = "rejected"
    db_session.commit()

    response = create_test_prescription(
        client,
        doctor_headers,
        booked_appointment,
    )

    assert response.status_code == 403

    assert response.json()["detail"] == (
        "Only approved doctors can issue prescriptions."
    )


# =====================================================
# 11. PRESCRIPTION REJECTS EMPTY MEDICINE LIST
# =====================================================

def test_prescription_requires_at_least_one_medicine(
    client,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    response = client.post(
        PRESCRIPTION_ENDPOINT,
        json={
            "appointment_id": str(
                past_booked_appointment.id
            ),
            "items": [],
        },
        headers=doctor_headers,
    )

    assert response.status_code == 422

# =====================================================
# 12. PRESCRIPTION CREATION CREATES AUDIT LOG
# =====================================================

def test_prescription_creation_creates_audit_log(
    client,
    db_session,
    doctor_headers,
    past_booked_appointment,
):
    # Complete the consultation first.
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    # Create prescription.
    response = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    )

    assert response.status_code == 201, response.text

    prescription_id = response.json()["id"]

    # Retrieve doctor information.
    doctor_profile = db_session.get(
        DoctorProfile,
        past_booked_appointment.doctor_profile_id,
    )

    assert doctor_profile is not None

    # Refresh session state before checking audit records.
    db_session.expire_all()

    audit_log = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "prescription.created",
            AuditLog.resource_id == prescription_id,
        )
    )

    # Verify audit event exists.
    assert audit_log is not None

    assert audit_log.outcome == "success"
    assert audit_log.resource_type == "prescription"

    # Verify actor and ownership information.
    assert audit_log.actor_user_id == doctor_profile.user_id

    assert audit_log.patient_profile_id == (
        past_booked_appointment.patient_profile_id
    )

    assert audit_log.doctor_profile_id == doctor_profile.id

    # Verify safe audit metadata.
    assert audit_log.details["appointment_id"] == str(
        past_booked_appointment.id
    )

    assert audit_log.details["medicine_item_count"] == 2

    # Clinical information must not be stored in audit metadata.
    assert "medicine_name" not in audit_log.details
    assert "dosage" not in audit_log.details


# =====================================================
# 13. APPROVED DOCTOR CAN LIST OWN PRESCRIPTIONS
# =====================================================

def test_approved_doctor_can_list_own_prescriptions(
    client,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )
    created_res = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    )
    assert created_res.status_code == 201

    response = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me",
        headers=doctor_headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()

    assert "items" in data
    assert "total" in data
    assert "limit" in data
    assert "offset" in data
    assert data["total"] >= 1

    matched = [item for item in data["items"] if item["id"] == created_res.json()["id"]]
    assert len(matched) == 1
    rx = matched[0]

    assert rx["patient_name"] == "Test Patient"
    assert rx["appointment_date"] == str(past_booked_appointment.appointment_date)
    assert len(rx["items"]) == 2
    assert rx["items"][0]["medicine_name"] == "Test Medicine A"
    assert rx["items"][1]["medicine_name"] == "Test Medicine B"


# =====================================================
# 14. DOCTOR PRESCRIPTIONS PAGINATION AND TOTAL COUNT
# =====================================================

def test_doctor_prescriptions_pagination_and_total_count(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    patient_account,
    past_booked_appointment,
):
    # Prescription 1
    complete_test_appointment(
        client,
        doctor_headers,
        past_booked_appointment,
    )
    rx1 = create_test_prescription(
        client,
        doctor_headers,
        past_booked_appointment,
    ).json()

    # Appointment 2 & Prescription 2
    appt2 = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=date.today() - timedelta(days=3),
        start_time=time(14, 0),
        end_time=time(14, 30),
        status="booked",
        reason="Follow up 2",
    )
    db_session.add(appt2)
    db_session.commit()
    db_session.refresh(appt2)

    complete_test_appointment(client, doctor_headers, appt2)
    rx2 = client.post(
        PRESCRIPTION_ENDPOINT,
        json={**PRESCRIPTION_PAYLOAD, "appointment_id": str(appt2.id)},
        headers=doctor_headers,
    ).json()

    # Page 1: limit 1, offset 0
    res_page1 = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?limit=1&offset=0",
        headers=doctor_headers,
    )
    assert res_page1.status_code == 200
    page1_data = res_page1.json()
    assert page1_data["total"] == 2
    assert len(page1_data["items"]) == 1
    assert page1_data["limit"] == 1
    assert page1_data["offset"] == 0

    # Page 2: limit 1, offset 1
    res_page2 = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?limit=1&offset=1",
        headers=doctor_headers,
    )
    assert res_page2.status_code == 200
    page2_data = res_page2.json()
    assert page2_data["total"] == 2
    assert len(page2_data["items"]) == 1
    assert page2_data["limit"] == 1
    assert page2_data["offset"] == 1

    # Verify distinct items across pages
    assert page1_data["items"][0]["id"] != page2_data["items"][0]["id"]


# =====================================================
# 15. DOCTOR PRESCRIPTIONS SEARCH BY PATIENT NAME
# =====================================================

def test_doctor_prescriptions_search_by_patient_name(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    past_booked_appointment,
):
    # Prescription 1 for Test Patient
    complete_test_appointment(client, doctor_headers, past_booked_appointment)
    create_test_prescription(client, doctor_headers, past_booked_appointment)

    # Second patient with distinct name
    second_user = User(
        full_name="Rajesh Sharma Unique",
        email="rajesh.unique@example.com",
        password_hash="test-only-password-hash",
        role="patient",
        is_active=True,
    )
    db_session.add(second_user)
    db_session.flush()

    second_patient = PatientProfile(user_id=second_user.id)
    db_session.add(second_patient)
    db_session.flush()

    appt2 = Appointment(
        patient_profile_id=second_patient.id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=date.today() - timedelta(days=2),
        start_time=time(15, 0),
        end_time=time(15, 30),
        status="booked",
        reason="Second patient consultation",
    )
    db_session.add(appt2)
    db_session.commit()
    db_session.refresh(appt2)

    complete_test_appointment(client, doctor_headers, appt2)
    rx2 = client.post(
        PRESCRIPTION_ENDPOINT,
        json={**PRESCRIPTION_PAYLOAD, "appointment_id": str(appt2.id)},
        headers=doctor_headers,
    ).json()

    # Search for "Rajesh"
    search_res = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?search=Rajesh",
        headers=doctor_headers,
    )
    assert search_res.status_code == 200
    search_data = search_res.json()
    assert search_data["total"] == 1
    assert search_data["items"][0]["patient_name"] == "Rajesh Sharma Unique"
    assert search_data["items"][0]["id"] == rx2["id"]

    # Search for non-existent patient
    empty_res = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?search=NonExistentPatientXYZ",
        headers=doctor_headers,
    )
    assert empty_res.status_code == 200
    assert empty_res.json()["total"] == 0
    assert len(empty_res.json()["items"]) == 0


# =====================================================
# 16. DOCTOR PRESCRIPTIONS SEARCH BY MEDICINE NAME
# =====================================================

def test_doctor_prescriptions_search_by_medicine_name(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    patient_account,
    past_booked_appointment,
):
    # Prescription 1 with Test Medicine A & B
    complete_test_appointment(client, doctor_headers, past_booked_appointment)
    create_test_prescription(client, doctor_headers, past_booked_appointment)

    # Prescription 2 with unique medicine
    appt2 = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=approved_doctor["profile"].id,
        appointment_date=date.today() - timedelta(days=4),
        start_time=time(16, 0),
        end_time=time(16, 30),
        status="booked",
        reason="Dermatology rash check",
    )
    db_session.add(appt2)
    db_session.commit()
    db_session.refresh(appt2)

    complete_test_appointment(client, doctor_headers, appt2)
    custom_payload = {
        "notes": "Antibiotic regimen",
        "items": [
            {
                "medicine_name": "Doxycycline Hyclate 100mg",
                "dosage": "100 mg",
                "route": "Oral",
                "frequency": "Twice daily",
                "duration": "7 days",
                "quantity": "14 capsules",
                "instructions": "Take with full glass of water.",
            }
        ],
    }
    rx2 = client.post(
        PRESCRIPTION_ENDPOINT,
        json={**custom_payload, "appointment_id": str(appt2.id)},
        headers=doctor_headers,
    ).json()

    # Search by medicine name "Doxycycline"
    med_res = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?search=Doxycycline",
        headers=doctor_headers,
    )
    assert med_res.status_code == 200
    med_data = med_res.json()
    assert med_data["total"] == 1
    assert med_data["items"][0]["id"] == rx2["id"]
    assert med_data["items"][0]["items"][0]["medicine_name"] == "Doxycycline Hyclate 100mg"


# =====================================================
# 17. DOCTOR PRESCRIPTIONS FILTER BY APPOINTMENT & PATIENT
# =====================================================

def test_doctor_prescriptions_filter_by_appointment_and_patient(
    client,
    db_session,
    doctor_headers,
    approved_doctor,
    patient_account,
    past_booked_appointment,
):
    complete_test_appointment(client, doctor_headers, past_booked_appointment)
    rx = create_test_prescription(client, doctor_headers, past_booked_appointment).json()

    # Filter by valid appointment_id
    res_appt = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?appointment_id={past_booked_appointment.id}",
        headers=doctor_headers,
    )
    assert res_appt.status_code == 200
    assert res_appt.json()["total"] == 1
    assert res_appt.json()["items"][0]["appointment_id"] == str(past_booked_appointment.id)

    # Filter by unmatching appointment_id
    random_appt_id = uuid.uuid4()
    res_no_appt = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?appointment_id={random_appt_id}",
        headers=doctor_headers,
    )
    assert res_no_appt.status_code == 200
    assert res_no_appt.json()["total"] == 0

    # Filter by valid patient_profile_id
    res_pt = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?patient_profile_id={patient_account['profile'].id}",
        headers=doctor_headers,
    )
    assert res_pt.status_code == 200
    assert res_pt.json()["total"] == 1
    assert res_pt.json()["items"][0]["patient_profile_id"] == str(patient_account["profile"].id)

    # Filter by unmatching patient_profile_id
    random_pt_id = uuid.uuid4()
    res_no_pt = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?patient_profile_id={random_pt_id}",
        headers=doctor_headers,
    )
    assert res_no_pt.status_code == 200
    assert res_no_pt.json()["total"] == 0


# =====================================================
# 18. DOCTOR CAN RETRIEVE OWN PRESCRIPTION DETAILS
# =====================================================

def test_doctor_can_retrieve_own_prescription_details(
    client,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(client, doctor_headers, past_booked_appointment)
    created = create_test_prescription(client, doctor_headers, past_booked_appointment).json()
    rx_id = created["id"]

    response = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/{rx_id}",
        headers=doctor_headers,
    )

    assert response.status_code == 200, response.text
    data = response.json()

    assert data["id"] == rx_id
    assert data["patient_name"] == "Test Patient"
    assert data["appointment_date"] == str(past_booked_appointment.appointment_date)
    assert data["doctor_profile_id"] == str(past_booked_appointment.doctor_profile_id)
    assert len(data["items"]) == 2
    assert data["items"][0]["medicine_name"] == "Test Medicine A"
    assert data["items"][0]["dosage"] == "500 mg"
    assert data["items"][1]["medicine_name"] == "Test Medicine B"


# =====================================================
# 19. DOCTOR CANNOT ACCESS ANOTHER DOCTOR'S PRESCRIPTION (404)
# =====================================================

def test_doctor_cannot_access_another_doctors_prescription(
    client,
    db_session,
    doctor_headers,
    patient_account,
):
    # Setup Doctor 2
    doc2_user = User(
        full_name="Second Verified Doctor",
        email="doctor2.test@example.com",
        password_hash="test-only-password-hash",
        role="doctor",
        is_active=True,
    )
    db_session.add(doc2_user)
    db_session.flush()

    doc2_profile = DoctorProfile(
        user_id=doc2_user.id,
        specialization="Pediatrics",
        qualification="MBBS, MD Pediatrics",
        license_number="TEST-DOC2-ANVAYA-999",
        years_experience=8,
        clinic_name="Pediatric Care Clinic",
        verification_status="approved",
    )
    db_session.add(doc2_profile)
    db_session.flush()

    doc2_token = create_access_token(subject=str(doc2_user.id))
    doc2_headers = {"Authorization": f"Bearer {doc2_token}"}

    doc2_appt = Appointment(
        patient_profile_id=patient_account["profile"].id,
        doctor_profile_id=doc2_profile.id,
        appointment_date=date.today() - timedelta(days=1),
        start_time=time(10, 0),
        end_time=time(10, 30),
        status="booked",
        reason="Child checkup",
    )
    db_session.add(doc2_appt)
    db_session.commit()
    db_session.refresh(doc2_appt)

    # Doctor 2 completes and prescribes
    complete_test_appointment(client, doc2_headers, doc2_appt)
    doc2_rx = create_test_prescription(client, doc2_headers, doc2_appt).json()

    # Doctor 1 tries to access Doctor 2's prescription by ID -> 404
    forbidden_detail_res = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/{doc2_rx['id']}",
        headers=doctor_headers,
    )
    assert forbidden_detail_res.status_code == 404
    assert forbidden_detail_res.json()["detail"] == "Prescription not found."

    # Doctor 1 lists own prescriptions -> Doctor 2's prescription must NOT be in the list
    doc1_list_res = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me",
        headers=doctor_headers,
    )
    assert doc1_list_res.status_code == 200
    doc1_rx_ids = [item["id"] for item in doc1_list_res.json()["items"]]
    assert doc2_rx["id"] not in doc1_rx_ids


# =====================================================
# 20. UNAPPROVED DOCTOR CANNOT ACCESS PRESCRIPTION HISTORY (403)
# =====================================================

def test_unapproved_doctor_cannot_access_prescription_history(
    client,
    db_session,
    approved_doctor,
    doctor_headers,
    past_booked_appointment,
):
    complete_test_appointment(client, doctor_headers, past_booked_appointment)
    rx = create_test_prescription(client, doctor_headers, past_booked_appointment).json()

    # Suspend / change verification status
    approved_doctor["profile"].verification_status = "pending"
    db_session.commit()

    # GET /doctor/me -> 403
    res_list = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me",
        headers=doctor_headers,
    )
    assert res_list.status_code == 403
    assert res_list.json()["detail"] == (
        "Only approved doctors can access prescription history."
    )

    # GET /doctor/{rx_id} -> 403
    res_detail = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/{rx['id']}",
        headers=doctor_headers,
    )
    assert res_detail.status_code == 403
    assert res_detail.json()["detail"] == (
        "Only approved doctors can view prescription details."
    )


# =====================================================
# 21. PATIENT CANNOT ACCESS DOCTOR PRESCRIPTION ENDPOINTS (403)
# =====================================================

def test_patient_cannot_access_doctor_prescription_endpoints(
    client,
    patient_headers,
):
    # Patient tries GET /doctor/me -> 403
    res_list = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me",
        headers=patient_headers,
    )
    assert res_list.status_code == 403

    # Patient tries GET /doctor/{some_id} -> 403
    res_detail = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/{uuid.uuid4()}",
        headers=patient_headers,
    )
    assert res_detail.status_code == 403


# =====================================================
# 22. INVALID UUID AND QUERY PARAMETER VALIDATION (422)
# =====================================================

def test_doctor_prescription_validation_and_invalid_uuid(
    client,
    doctor_headers,
):
    # Invalid UUID string
    res_invalid_uuid = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/not-a-valid-uuid",
        headers=doctor_headers,
    )
    assert res_invalid_uuid.status_code == 422

    # Query param limit < 1
    res_bad_limit = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?limit=0",
        headers=doctor_headers,
    )
    assert res_bad_limit.status_code == 422

    # Query param limit > 100
    res_overflow_limit = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?limit=101",
        headers=doctor_headers,
    )
    assert res_overflow_limit.status_code == 422

    # Query param offset < 0
    res_bad_offset = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?offset=-1",
        headers=doctor_headers,
    )
    assert res_bad_offset.status_code == 422

    # Query param search > 100 chars
    long_search = "A" * 101
    res_long_search = client.get(
        f"{PRESCRIPTION_ENDPOINT}/doctor/me?search={long_search}",
        headers=doctor_headers,
    )
    assert res_long_search.status_code == 422


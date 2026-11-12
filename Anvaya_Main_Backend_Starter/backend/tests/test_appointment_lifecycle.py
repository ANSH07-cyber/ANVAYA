from sqlalchemy import select

from app.models.health_record import HealthRecord


CONSULTATION_PAYLOAD = {
    "visit_summary": "Patient consultation completed. Symptoms assessed and treatment discussed.",
    "chief_complaint": "Recurring headache",
    "symptoms": "Headache and mild nausea",
    "diagnosis": "Clinical evaluation required",
    "clinical_notes": "Patient examined during consultation.",
    "treatment_plan": "Further evaluation advised.",
    "follow_up_instructions": "Follow up after 7 days.",
}


# =====================================================
# 1. PATIENT CAN CANCEL OWN APPOINTMENT
# =====================================================

def test_patient_can_cancel_own_appointment(
    client,
    patient_headers,
    booked_appointment,
):
    response = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/cancel",
        headers=patient_headers,
    )

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


# =====================================================
# 2. CANCELLED APPOINTMENT CANNOT BE CANCELLED AGAIN
# =====================================================

def test_patient_cannot_cancel_appointment_twice(
    client,
    patient_headers,
    booked_appointment,
):
    url = f"/api/v1/appointments/{booked_appointment.id}/cancel"

    first_response = client.patch(
        url,
        headers=patient_headers,
    )

    assert first_response.status_code == 200

    second_response = client.patch(
        url,
        headers=patient_headers,
    )

    assert second_response.status_code == 409


# =====================================================
# 3. CANCELLED SLOT BECOMES AVAILABLE AGAIN
# =====================================================

def test_cancelled_slot_becomes_available(
    client,
    patient_headers,
    booked_appointment,
    approved_doctor,
):
    cancel_response = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/cancel",
        headers=patient_headers,
    )

    assert cancel_response.status_code == 200

    response = client.get(
        f"/api/v1/doctors/{approved_doctor['profile'].id}/availability/slots",
        params={
            "appointment_date": approved_doctor["appointment_date"].isoformat()
        },
        headers=patient_headers,
    )

    assert response.status_code == 200

    available_times = [
        (slot["start_time"], slot["end_time"])
        for slot in response.json()["items"]
    ]

    assert ("10:00:00", "10:30:00") in available_times


# =====================================================
# 4. PATIENT CAN RESCHEDULE OWN APPOINTMENT
# =====================================================

def test_patient_can_reschedule_own_appointment(
    client,
    patient_headers,
    booked_appointment,
    approved_doctor,
):
    response = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/reschedule",
        json={
            "appointment_date": approved_doctor["appointment_date"].isoformat(),
            "start_time": "10:30:00",
        },
        headers=patient_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["appointment_date"] == approved_doctor["appointment_date"].isoformat()
    assert data["start_time"] == "10:30:00"
    assert data["end_time"] == "11:00:00"
    assert data["status"] == "booked"


# =====================================================
# 5. PATIENT CANNOT RESCHEDULE TO UNAVAILABLE SLOT
# =====================================================

def test_patient_cannot_reschedule_to_unavailable_slot(
    client,
    patient_headers,
    booked_appointment,
    approved_doctor,
):
    response = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/reschedule",
        json={
            "appointment_date": approved_doctor["appointment_date"].isoformat(),
            "start_time": "12:00:00",
        },
        headers=patient_headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Selected reschedule slot is unavailable."


# =====================================================
# 6. DOCTOR CAN COMPLETE PAST APPOINTMENT AND CREATE EHR
# =====================================================

def test_doctor_can_complete_past_appointment(
    client,
    db_session,
    doctor_headers,
    past_booked_appointment,
):
    response = client.patch(
        f"/api/v1/appointments/{past_booked_appointment.id}/status",
        json=CONSULTATION_PAYLOAD,
        headers=doctor_headers,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["appointment_id"] == str(past_booked_appointment.id)
    assert data["visit_summary"] == CONSULTATION_PAYLOAD["visit_summary"]

    # Verify the appointment was completed.
    db_session.refresh(past_booked_appointment)
    assert past_booked_appointment.status == "completed"

    # Verify the consultation created exactly one health record.
    saved_records = db_session.scalars(
        select(HealthRecord).where(
            HealthRecord.appointment_id == past_booked_appointment.id
        )
    ).all()

    assert len(saved_records) == 1
    assert saved_records[0].diagnosis == CONSULTATION_PAYLOAD["diagnosis"]
    assert saved_records[0].patient_profile_id == past_booked_appointment.patient_profile_id
    assert saved_records[0].doctor_profile_id == past_booked_appointment.doctor_profile_id


# =====================================================
# 7. DOCTOR CANNOT COMPLETE FUTURE APPOINTMENT
# =====================================================

def test_doctor_cannot_complete_future_appointment(
    client,
    doctor_headers,
    booked_appointment,
):
    response = client.patch(
        f"/api/v1/appointments/{booked_appointment.id}/status",
        json=CONSULTATION_PAYLOAD,
        headers=doctor_headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "A future appointment cannot be completed."


# =====================================================
# 8. PATIENT CANNOT COMPLETE AN APPOINTMENT
# =====================================================

def test_patient_cannot_complete_appointment(
    client,
    patient_headers,
    past_booked_appointment,
):
    response = client.patch(
        f"/api/v1/appointments/{past_booked_appointment.id}/status",
        json=CONSULTATION_PAYLOAD,
        headers=patient_headers,
    )

    assert response.status_code == 403

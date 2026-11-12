
def booking_payload(approved_doctor, start_time="10:00:00"):
    return {
        "doctor_profile_id": str(approved_doctor["profile"].id),
        "appointment_date": approved_doctor["appointment_date"].isoformat(),
        "start_time": start_time,
        "reason": "Routine consultation",
    }


# =====================================================
# TEST 1: SUCCESSFUL APPOINTMENT BOOKING
# =====================================================

def test_patient_can_book_available_slot(
    client,
    patient_headers,
    approved_doctor,
):
    response = client.post(
        "/api/v1/appointments",
        json=booking_payload(approved_doctor),
        headers=patient_headers,
    )

    assert response.status_code == 201

    data = response.json()

    assert data["doctor_profile_id"] == str(
        approved_doctor["profile"].id
    )

    assert data["patient_profile_id"] is not None
    assert data["appointment_date"] == (
        approved_doctor["appointment_date"].isoformat()
    )
    assert data["start_time"] == "10:00:00"
    assert data["end_time"] == "10:30:00"
    assert data["status"] == "booked"


# =====================================================
# TEST 2: REJECTED DOCTOR CANNOT BE BOOKED
# =====================================================

def test_patient_cannot_book_rejected_doctor(
    client,
    db_session,
    patient_headers,
    approved_doctor,
):
    approved_doctor["profile"].verification_status = "rejected"
    db_session.commit()

    response = client.post(
        "/api/v1/appointments",
        json=booking_payload(approved_doctor),
        headers=patient_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Approved doctor not found."


# =====================================================
# TEST 3: UNAVAILABLE SLOT CANNOT BE BOOKED
# =====================================================

def test_patient_cannot_book_outside_doctor_schedule(
    client,
    patient_headers,
    approved_doctor,
):
    # Doctor schedule ends at 12:00.
    # Therefore, a 12:00–12:30 appointment is unavailable.

    response = client.post(
        "/api/v1/appointments",
        json=booking_payload(
            approved_doctor,
            start_time="12:00:00",
        ),
        headers=patient_headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Selected slot is unavailable."


# =====================================================
# TEST 4: SAME SLOT CANNOT BE BOOKED TWICE
# =====================================================

def test_patient_cannot_book_same_slot_twice(
    client,
    patient_headers,
    approved_doctor,
):
    payload = booking_payload(approved_doctor)

    first_response = client.post(
        "/api/v1/appointments",
        json=payload,
        headers=patient_headers,
    )

    assert first_response.status_code == 201

    second_response = client.post(
        "/api/v1/appointments",
        json=payload,
        headers=patient_headers,
    )

    assert second_response.status_code == 409
    assert second_response.json()["detail"] == (
        "Selected slot is unavailable."
    )

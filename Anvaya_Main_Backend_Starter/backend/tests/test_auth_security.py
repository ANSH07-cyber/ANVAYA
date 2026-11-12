
from uuid import uuid4


# =====================================================
# 1. REQUEST WITHOUT JWT MUST BE REJECTED
# =====================================================

def test_missing_token_returns_401(client):
    response = client.get(
        "/api/v1/appointments/me"
    )

    assert response.status_code == 401


# =====================================================
# 2. INVALID JWT MUST BE REJECTED
# =====================================================

def test_invalid_token_returns_401(client):
    response = client.get(
        "/api/v1/appointments/me",
        headers={
            "Authorization": "Bearer invalid-token"
        },
    )

    assert response.status_code == 401


# =====================================================
# 3. PATIENT CANNOT ACCESS DOCTOR DASHBOARD
# =====================================================

def test_patient_cannot_access_doctor_dashboard(
    client,
    patient_headers,
):
    response = client.get(
        "/api/v1/appointments/doctor/me",
        headers=patient_headers,
    )

    assert response.status_code == 403


# =====================================================
# 4. DOCTOR CANNOT ACCESS PATIENT HISTORY
# =====================================================

def test_doctor_cannot_access_patient_history(
    client,
    doctor_headers,
):
    response = client.get(
        "/api/v1/appointments/me",
        headers=doctor_headers,
    )

    assert response.status_code == 403


# =====================================================
# 5. INACTIVE USER MUST NOT ACCESS PROTECTED API
# =====================================================

def test_inactive_patient_returns_401(
    client,
    db_session,
    patient_account,
    patient_headers,
):
    patient_account["user"].is_active = False
    db_session.commit()

    response = client.get(
        "/api/v1/appointments/me",
        headers=patient_headers,
    )

    assert response.status_code == 401


# =====================================================
# 6. DOCTOR CANNOT CANCEL PATIENT APPOINTMENT
# =====================================================

def test_doctor_cannot_cancel_patient_appointment(
    client,
    doctor_headers,
):
    response = client.patch(
        f"/api/v1/appointments/{uuid4()}/cancel",
        headers=doctor_headers,
    )

    assert response.status_code == 403


# =====================================================
# 7. UNAPPROVED DOCTOR CANNOT COMPLETE APPOINTMENT
# =====================================================

def test_unapproved_doctor_cannot_complete_appointment(
    client,
    db_session,
    approved_doctor,
    doctor_headers,
):
    approved_doctor["profile"].verification_status = "rejected"
    db_session.commit()

    response = client.patch(
        f"/api/v1/appointments/{uuid4()}/status",
        json={"status": "completed"},
        headers=doctor_headers,
    )

    assert response.status_code == 403

    assert response.json()["detail"] == (
        "Only approved doctors can update appointment status."
    )


from fastapi import APIRouter

from app.api.routes import (
    admin,
    appointments,
    auth,
    consents,
    doctor_availability,
    doctors,
    health,
    health_records,
    patients,
)


api_router = APIRouter()


# =========================================================
# 1. HEALTH CHECK
# =========================================================

api_router.include_router(health.router)


# =========================================================
# 2. AUTHENTICATION
# =========================================================

api_router.include_router(auth.router)


# =========================================================
# 3. ADMIN
# =========================================================

api_router.include_router(admin.router)


# =========================================================
# 4. PATIENT PROFILE
# =========================================================

api_router.include_router(patients.router)


# =========================================================
# 5. DOCTOR AVAILABILITY
# =========================================================

api_router.include_router(doctor_availability.router)


# =========================================================
# 6. DOCTOR DISCOVERY
# =========================================================

api_router.include_router(doctors.router)


# =========================================================
# 7. APPOINTMENTS
# =========================================================

api_router.include_router(appointments.router)


# =========================================================
# 8. HEALTH RECORDS
# =========================================================

api_router.include_router(health_records.router)


# =========================================================
# 9. PATIENT CONSENT MANAGEMENT
# =========================================================

api_router.include_router(consents.router)

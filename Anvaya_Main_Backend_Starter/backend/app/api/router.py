
from fastapi import APIRouter

from app.api.routes import (
    admin,
    appointments,
    auth,
    doctor_availability,
    doctors,
    health,
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
# Static /me route must come before dynamic doctor routes.
# =========================================================

api_router.include_router(doctor_availability.router)


# =========================================================
# 6. DOCTOR DISCOVERY AND PUBLIC AVAILABILITY
# =========================================================

api_router.include_router(doctors.router)


# =========================================================
# 7. APPOINTMENT BOOKING
# =========================================================

api_router.include_router(appointments.router)


from fastapi import APIRouter

from app.api.routes import (
    admin,
    auth,
    doctors,
    doctor_availability,
    health,
    patients,
)

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(admin.router)
api_router.include_router(patients.router)
api_router.include_router(doctors.router)
api_router.include_router(doctor_availability.router)

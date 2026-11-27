
from datetime import date, datetime, time
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)


IST = ZoneInfo("Asia/Kolkata")


class AppointmentCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    doctor_profile_id: UUID
    appointment_date: date
    start_time: time

    reason: str | None = Field(
        default=None,
        max_length=3000,
    )
    idempotency_key: str | None = Field(
        default=None,
        max_length=255,
    )

    @field_validator("appointment_date")
    @classmethod
    def validate_appointment_date(cls, value: date) -> date:
        if value < datetime.now(IST).date():
            raise ValueError("Appointment date cannot be in the past.")
        return value

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str | None) -> str | None:
        if value == "":
            return None
        return value


class AppointmentReschedule(BaseModel):
    appointment_date: date
    start_time: time
    idempotency_key: str | None = None

    @field_validator("appointment_date")
    @classmethod
    def validate_appointment_date(cls, value: date) -> date:
        if value < datetime.now(IST).date():
            raise ValueError("Appointment date cannot be in the past.")
        return value


class AppointmentStatusUpdate(BaseModel):
    status: Literal["completed"]


class DoctorAppointmentCancel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    cancellation_reason: str = Field(
        ...,
        min_length=5,
        max_length=1000,
        description="Mandatory clinical or administrative justification for appointment cancellation by doctor.",
    )
    idempotency_key: str | None = None

    @field_validator("cancellation_reason")
    @classmethod
    def validate_cancellation_reason(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 5:
            raise ValueError("Cancellation reason must be at least 5 characters.")
        return cleaned


class AppointmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    patient_profile_id: UUID
    doctor_profile_id: UUID
    appointment_date: date
    start_time: time
    end_time: time
    status: Literal["booked", "cancelled", "completed"]
    reason: str | None
    revision: int = 0
    doctor_name: str | None = None
    doctor_specialization: str | None = None
    doctor_clinic_name: str | None = None
    created_at: datetime
    updated_at: datetime


class AppointmentListResponse(BaseModel):
    items: list[AppointmentRead]
    total: int
    limit: int
    offset: int


class DoctorAppointmentRead(AppointmentRead):
    patient_name: str
    cancellation_reason: str | None = None


class DoctorAppointmentListResponse(BaseModel):
    items: list[DoctorAppointmentRead]
    total: int
    limit: int
    offset: int


class DoctorAppointmentSummaryResponse(BaseModel):
    total: int
    today_count: int
    upcoming_count: int
    past_due_count: int
    completed_count: int
    cancelled_count: int


class AvailableSlotRead(BaseModel):
    start_time: time
    end_time: time


class AvailableSlotsResponse(BaseModel):
    doctor_profile_id: UUID
    appointment_date: date
    items: list[AvailableSlotRead]
    total: int

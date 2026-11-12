
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

    @field_validator("appointment_date")
    @classmethod
    def validate_appointment_date(cls, value: date) -> date:
        if value < datetime.now(IST).date():
            raise ValueError("Appointment date cannot be in the past.")
        return value


class AppointmentStatusUpdate(BaseModel):
    status: Literal["completed"]


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
    created_at: datetime
    updated_at: datetime


class AppointmentListResponse(BaseModel):
    items: list[AppointmentRead]
    total: int
    limit: int
    offset: int


class DoctorAppointmentRead(AppointmentRead):
    patient_name: str


class DoctorAppointmentListResponse(BaseModel):
    items: list[DoctorAppointmentRead]
    total: int
    limit: int
    offset: int


class AvailableSlotRead(BaseModel):
    start_time: time
    end_time: time


class AvailableSlotsResponse(BaseModel):
    doctor_profile_id: UUID
    appointment_date: date
    items: list[AvailableSlotRead]
    total: int

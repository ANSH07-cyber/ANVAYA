
from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DoctorAvailabilityCreate(BaseModel):
    weekday: int = Field(
        ge=0,
        le=6,
        description="0 = Monday, 1 = Tuesday, ..., 6 = Sunday",
    )

    start_time: time
    end_time: time

    slot_duration_minutes: int = Field(
        default=30,
        ge=5,
        le=240,
    )

    @model_validator(mode="after")
    def validate_schedule(self):
        if self.start_time >= self.end_time:
            raise ValueError("End time must be after start time.")

        start = datetime.combine(date.min, self.start_time)
        end = datetime.combine(date.min, self.end_time)

        duration_minutes = int(
            (end - start).total_seconds() / 60
        )

        if duration_minutes < self.slot_duration_minutes:
            raise ValueError(
                "Schedule duration must be at least one appointment slot."
            )

        return self


class DoctorAvailabilityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    doctor_profile_id: UUID
    weekday: int
    start_time: time
    end_time: time
    slot_duration_minutes: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class DoctorAvailabilityListResponse(BaseModel):
    items: list[DoctorAvailabilityRead]
    total: int

class DoctorPublicAvailabilityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    weekday: int
    start_time: time
    end_time: time
    slot_duration_minutes: int


class DoctorPublicAvailabilityListResponse(BaseModel):
    items: list[DoctorPublicAvailabilityRead]
    total: int

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


class RescheduleProposalCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    proposed_date: date
    proposed_start_time: time
    doctor_message: str | None = Field(
        default=None,
        max_length=500,
        description="Optional non-sensitive note explaining the reason for the reschedule proposal.",
    )
    idempotency_key: str | None = None

    @field_validator("proposed_date")
    @classmethod
    def validate_proposed_date(cls, value: date) -> date:
        if value < datetime.now(IST).date():
            raise ValueError("Proposed appointment date cannot be in the past.")
        return value

    @field_validator("doctor_message")
    @classmethod
    def normalize_doctor_message(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned if cleaned else None


class RescheduleProposalRespond(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    action: Literal["accept", "decline"]
    idempotency_key: str | None = None


class RescheduleProposalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    appointment_id: UUID
    doctor_profile_id: UUID
    patient_profile_id: UUID
    proposed_date: date
    proposed_start_time: time
    proposed_end_time: time
    doctor_message: str | None
    status: Literal["pending", "accepted", "declined", "expired", "superseded"]
    created_at: datetime
    expires_at: datetime
    resolved_at: datetime | None
    doctor_name: str | None = None
    doctor_specialization: str | None = None
    patient_name: str | None = None
    current_appointment_date: date | None = None
    current_start_time: time | None = None
    current_end_time: time | None = None


class RescheduleProposalListResponse(BaseModel):
    items: list[RescheduleProposalRead]
    total: int
    limit: int
    offset: int

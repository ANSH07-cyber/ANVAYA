from datetime import datetime
import re
from typing import Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

from app.schemas.consent import HealthDataScope

ConsentRequestStatus = Literal[
    "pending",
    "approved",
    "partially_approved",
    "declined",
    "expired",
    "superseded",
]


class ConsentRequestCreate(BaseModel):
    """Payload submitted by a doctor to request health data scopes from an established patient."""

    model_config = ConfigDict(str_strip_whitespace=True)

    patient_profile_id: UUID
    requested_scopes: list[HealthDataScope] = Field(
        min_length=1,
        max_length=7,
        description="Health-record data scopes requested by the doctor.",
    )
    doctor_message: str | None = Field(
        default=None,
        max_length=500,
        description="Clinical administrative context or note for the request.",
    )
    idempotency_key: str | None = Field(
        default=None,
        max_length=255,
        description="Client-generated key to prevent duplicate request submissions.",
    )

    @field_validator("requested_scopes")
    @classmethod
    def validate_unique_scopes(
        cls,
        value: list[HealthDataScope],
    ) -> list[HealthDataScope]:
        if len(value) != len(set(value)):
            raise ValueError("Duplicate requested health-data scopes are not allowed.")
        return value

    @field_validator("doctor_message")
    @classmethod
    def sanitize_doctor_message(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        # Disallow non-printable control characters
        if any(ord(c) < 32 and c not in ("\n", "\r", "\t") for c in cleaned):
            raise ValueError("Doctor message cannot contain non-printable control characters.")
        # Disallow explicit HTML/script tags
        if "<" in cleaned and ">" in cleaned:
            if re.search(r"<\s*script|<[a-zA-Z/][^>]*>", cleaned, re.IGNORECASE):
                raise ValueError("Doctor message cannot contain HTML or script markup.")
        return cleaned


class ConsentRequestRespond(BaseModel):
    """Payload submitted by a patient to approve, partially approve, or decline a consent request."""

    model_config = ConfigDict(str_strip_whitespace=True)

    action: Literal["approve", "decline"]
    approved_scopes: list[HealthDataScope] | None = Field(
        default=None,
        description="Scopes granted by the patient. Required when action is 'approve'; must be a subset of requested scopes.",
    )
    idempotency_key: str | None = Field(
        default=None,
        max_length=255,
        description="Client-generated key to prevent duplicate resolution submissions.",
    )

    @field_validator("approved_scopes")
    @classmethod
    def validate_unique_approved_scopes(
        cls,
        value: list[HealthDataScope] | None,
    ) -> list[HealthDataScope] | None:
        if value is not None and len(value) != len(set(value)):
            raise ValueError("Duplicate approved health-data scopes are not allowed.")
        return value


class ConsentRequestRead(BaseModel):
    """Representation of a consent request for patients and doctors."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    doctor_profile_id: UUID
    patient_profile_id: UUID
    requested_scopes: list[HealthDataScope]
    approved_scopes: list[HealthDataScope] | None = None
    doctor_message: str | None = None
    status: ConsentRequestStatus
    created_at: datetime
    expires_at: datetime
    resolved_at: datetime | None = None
    consent_record_id: UUID | None = None

    # Contextual metadata for patient and doctor display
    doctor_name: str | None = None
    doctor_specialization: str | None = None
    clinic_name: str | None = None
    patient_name: str | None = None


class ConsentRequestListResponse(BaseModel):
    """Paginated list of consent requests."""

    items: list[ConsentRequestRead]
    total: int
    limit: int
    offset: int


class DoctorPatientConsentStatus(BaseModel):
    """Detailed consent and relationship status between a doctor and patient."""

    doctor_profile_id: UUID
    patient_profile_id: UUID
    has_active_consent: bool
    active_consent_id: UUID | None = None
    active_scopes: list[HealthDataScope] = Field(default_factory=list)
    pending_request: ConsentRequestRead | None = None
    can_request_consent: bool
    relationship_established: bool

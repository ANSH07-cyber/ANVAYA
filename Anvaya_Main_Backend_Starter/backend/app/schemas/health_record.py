
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.consent import HealthDataScope


# =====================================================
# 1. CONSULTATION COMPLETION REQUEST
# =====================================================

from pydantic import Field, field_validator


class ConsultationCompletion(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    visit_summary: str = Field(
        min_length=10,
        max_length=10000,
    )

    chief_complaint: str | None = Field(
        default=None,
        max_length=2000,
    )

    symptoms: str | None = Field(
        default=None,
        max_length=5000,
    )

    diagnosis: str | None = Field(
        default=None,
        max_length=5000,
    )

    clinical_notes: str | None = Field(
        default=None,
        max_length=10000,
    )

    treatment_plan: str | None = Field(
        default=None,
        max_length=5000,
    )

    follow_up_instructions: str | None = Field(
        default=None,
        max_length=5000,
    )

    @field_validator(
        "chief_complaint",
        "symptoms",
        "diagnosis",
        "clinical_notes",
        "treatment_plan",
        "follow_up_instructions",
    )
    @classmethod
    def normalize_empty_fields(
        cls,
        value: str | None,
    ) -> str | None:
        if value is not None and not value.strip():
            return None
        return value


# =====================================================
# 2. HEALTH RECORD RESPONSE
# =====================================================

class HealthRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    patient_profile_id: UUID
    doctor_profile_id: UUID
    appointment_id: UUID

    visit_date: date

    chief_complaint: str | None
    visit_summary: str
    symptoms: str | None
    diagnosis: str | None
    clinical_notes: str | None
    treatment_plan: str | None
    follow_up_instructions: str | None

    created_at: datetime
    updated_at: datetime


# =====================================================
# 3. PATIENT HEALTH RECORD LIST
# =====================================================

class HealthRecordListResponse(BaseModel):
    items: list[HealthRecordRead]
    total: int
    limit: int
    offset: int


# =====================================================
# 4. DOCTOR SHARED HEALTH RECORD
# Only consent-authorized information is returned.
# =====================================================

class DoctorSharedHealthRecordRead(BaseModel):
    record_id: UUID
    visit_date: date

    data: dict[HealthDataScope, str | None]


# =====================================================
# 5. DOCTOR SHARED HEALTH RECORD LIST
# =====================================================

class DoctorSharedHealthRecordListResponse(BaseModel):
    items: list[DoctorSharedHealthRecordRead]

    total: int
    limit: int
    offset: int

    requested_scopes: list[HealthDataScope]

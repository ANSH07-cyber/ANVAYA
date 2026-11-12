
from datetime import datetime
from uuid import UUID
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)


# Only these health-record fields can be shared.
HealthDataScope = Literal[
    "visit_summary",
    "chief_complaint",
    "symptoms",
    "diagnosis",
    "clinical_notes",
    "treatment_plan",
    "follow_up_instructions",
]


# =====================================================
# 1. GRANT CONSENT REQUEST
# =====================================================

class ConsentGrantRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    doctor_profile_id: UUID

    data_scopes: list[HealthDataScope] = Field(
        min_length=1,
        max_length=7,
        description="Health-record fields selected by the patient.",
    )

    @field_validator("data_scopes")
    @classmethod
    def validate_unique_scopes(
        cls,
        value: list[HealthDataScope],
    ) -> list[HealthDataScope]:

        if len(value) != len(set(value)):
            raise ValueError("Duplicate health-data scopes are not allowed.")

        return value


# =====================================================
# 2. CONSENT RESPONSE
# =====================================================

class ConsentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    patient_profile_id: UUID
    doctor_profile_id: UUID

    data_scopes: list[HealthDataScope]

    is_active: bool
    granted_at: datetime
    revoked_at: datetime | None


# =====================================================
# 3. CONSENT LIST RESPONSE
# =====================================================

class ConsentListResponse(BaseModel):
    items: list[ConsentRead]
    total: int
    limit: int
    offset: int

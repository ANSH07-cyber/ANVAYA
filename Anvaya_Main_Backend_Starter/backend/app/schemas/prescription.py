
from datetime import datetime
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)


# =====================================================
# 1. PRESCRIPTION ITEM CREATE REQUEST
# =====================================================

class PrescriptionItemCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    medicine_name: str = Field(
        min_length=1,
        max_length=200,
    )

    dosage: str = Field(
        min_length=1,
        max_length=100,
    )

    route: str | None = Field(
        default=None,
        max_length=80,
    )

    frequency: str = Field(
        min_length=1,
        max_length=100,
    )

    duration: str = Field(
        min_length=1,
        max_length=100,
    )

    quantity: str | None = Field(
        default=None,
        max_length=100,
    )

    instructions: str | None = Field(
        default=None,
        max_length=5000,
    )

    @field_validator(
        "medicine_name",
        "dosage",
        "frequency",
        "duration",
    )
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("This field cannot be empty.")
        return value

    @field_validator(
        "route",
        "quantity",
        "instructions",
    )
    @classmethod
    def normalize_optional_text(
        cls,
        value: str | None,
    ) -> str | None:
        if value is not None and not value.strip():
            return None
        return value


# =====================================================
# 2. CREATE PRESCRIPTION REQUEST - DOCTOR
# =====================================================

class PrescriptionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    appointment_id: UUID

    notes: str | None = Field(
        default=None,
        max_length=5000,
    )

    items: list[PrescriptionItemCreate] = Field(
        min_length=1,
        max_length=50,
    )

    @field_validator("notes")
    @classmethod
    def normalize_notes(
        cls,
        value: str | None,
    ) -> str | None:
        if value is not None and not value.strip():
            return None
        return value


# =====================================================
# 3. PRESCRIPTION ITEM RESPONSE
# =====================================================

class PrescriptionItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    prescription_id: UUID

    medicine_name: str
    dosage: str
    route: str | None
    frequency: str
    duration: str
    quantity: str | None
    instructions: str | None

    sort_order: int


# =====================================================
# 4. PRESCRIPTION RESPONSE
# =====================================================

class PrescriptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID

    patient_profile_id: UUID
    doctor_profile_id: UUID

    appointment_id: UUID
    health_record_id: UUID

    notes: str | None

    issued_at: datetime
    created_at: datetime
    updated_at: datetime

    items: list[PrescriptionItemRead]


# =====================================================
# 5. PATIENT PRESCRIPTION LIST RESPONSE
# =====================================================

class PrescriptionListResponse(BaseModel):
    items: list[PrescriptionRead]

    total: int
    limit: int
    offset: int

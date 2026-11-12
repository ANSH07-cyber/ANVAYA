
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class DoctorProfileUpsert(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    specialization: str = Field(min_length=2, max_length=100)
    qualification: str = Field(min_length=2, max_length=255)
    license_number: str = Field(min_length=3, max_length=100)

    years_experience: int | None = Field(
        default=None,
        ge=0,
        le=80,
    )

    clinic_name: str | None = Field(
        default=None,
        max_length=200,
    )

    consultation_fee: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=10,
        decimal_places=2,
    )

    bio: str | None = Field(
        default=None,
        max_length=5000,
    )


class DoctorProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    specialization: str
    qualification: str
    license_number: str
    years_experience: int | None
    clinic_name: str | None
    consultation_fee: Decimal | None
    bio: str | None
    verification_status: str
    created_at: datetime
    updated_at: datetime


class DoctorAccountCreate(DoctorProfileUpsert):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class DoctorVerificationUpdate(BaseModel):
    verification_status: Literal["approved", "rejected"]


class DoctorReviewItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    full_name: str
    email: EmailStr
    specialization: str
    qualification: str
    license_number: str
    years_experience: int | None
    clinic_name: str | None
    consultation_fee: Decimal | None
    bio: str | None
    verification_status: Literal["pending", "approved", "rejected"]
    created_at: datetime


class DoctorReviewListResponse(BaseModel):
    items: list[DoctorReviewItem]
    total: int
    limit: int
    offset: int
class DoctorPublicRead(BaseModel):
    id: UUID
    full_name: str
    specialization: str
    qualification: str
    years_experience: int | None
    clinic_name: str | None
    consultation_fee: Decimal | None
    bio: str | None


class DoctorPublicListResponse(BaseModel):
    items: list[DoctorPublicRead]
    total: int
    limit: int
    offset: int
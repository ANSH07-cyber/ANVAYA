
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PatientProfileUpdate(BaseModel):
    date_of_birth: date | None = None
    phone_number: str | None = Field(default=None, max_length=20)
    gender: str | None = Field(default=None, max_length=30)
    blood_group: str | None = Field(
        default=None,
        pattern=r"^(A|B|AB|O)[+-]$"
    )
    address: str | None = Field(default=None, max_length=2000)


class PatientProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    date_of_birth: date | None
    phone_number: str | None
    gender: str | None
    blood_group: str | None
    address: str | None
    created_at: datetime
    updated_at: datetime

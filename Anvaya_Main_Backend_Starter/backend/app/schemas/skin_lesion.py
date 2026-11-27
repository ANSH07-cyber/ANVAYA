import uuid
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class SkinLesionAnalyzeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_profile_id: uuid.UUID
    image_filename: str | None = None
    predicted_class: str | None
    predicted_label: str | None
    confidence: float | None  # Top softmax score, without clinical calibration.
    probabilities: dict[str, float]
    risk_level: str | None
    disclaimer: str
    education_title: str | None = None
    education_summary: str | None = None
    education_content: dict[str, Any] | None = None
    reviewed_by_doctor_id: uuid.UUID | None = None
    doctor_notes: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
    inference_mode: Literal["pytorch_efficientnet_b0", "unknown"]
    model_version: str | None = None
    checkpoint_sha256: str | None = None


class SkinLesionReviewRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    doctor_notes: str = Field(..., min_length=2, max_length=2000, description="Clinical evaluation and notes by the reviewing doctor.")


class SkinLesionListResponse(BaseModel):
    items: list[SkinLesionAnalyzeResponse]
    total: int


class SkinLesionClassesResponse(BaseModel):
    model_version: str | None
    available: bool
    classes: list[dict[str, str]]
    supported_languages: list[str]
    disclaimer: str

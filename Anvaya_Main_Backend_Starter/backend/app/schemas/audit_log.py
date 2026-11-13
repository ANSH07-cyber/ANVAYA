
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


# =====================================================
# 1. AUDIT LOG RESPONSE
# =====================================================

class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID

    actor_user_id: UUID

    patient_profile_id: UUID | None
    doctor_profile_id: UUID | None

    event_type: str
    resource_type: str
    resource_id: str

    outcome: Literal["success", "denied", "failure"]

    details: dict[str, Any]

    created_at: datetime


# =====================================================
# 2. AUDIT LOG LIST RESPONSE
# =====================================================

class AuditLogListResponse(BaseModel):

    items: list[AuditLogRead]

    total: int
    limit: int
    offset: int

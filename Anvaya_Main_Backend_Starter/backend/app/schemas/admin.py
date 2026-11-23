from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AdminDashboardStatsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    total_doctors: int
    pending_doctors: int
    approved_doctors: int
    rejected_doctors: int
    suspended_doctors: int
    total_patients: int
    total_appointments: int
    booked_appointments: int
    completed_appointments: int
    cancelled_appointments: int


# =========================================================
# PATIENT MANAGEMENT SCHEMAS
# =========================================================

class AdminPatientItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID  # PatientProfile.id
    user_id: UUID  # User.id
    full_name: str
    email: str
    date_of_birth: date | None = None
    phone_number: str | None = None
    gender: str | None = None
    blood_group: str | None = None
    address: str | None = None
    created_at: datetime


class AdminPatientListResponse(BaseModel):
    items: list[AdminPatientItem]
    total: int
    limit: int
    offset: int


# =========================================================
# APPOINTMENTS OVERSIGHT SCHEMAS
# =========================================================

class AdminAppointmentItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID  # Appointment.id
    patient_profile_id: UUID
    doctor_profile_id: UUID
    patient_name: str
    patient_email: str
    doctor_name: str
    doctor_email: str
    doctor_specialization: str
    appointment_date: date
    start_time: time
    end_time: time
    status: Literal["booked", "completed", "cancelled", "in_progress"]
    reason: str | None = None
    created_at: datetime
    updated_at: datetime


class AdminAppointmentListResponse(BaseModel):
    items: list[AdminAppointmentItem]
    total: int
    limit: int
    offset: int


# =========================================================
# USER MANAGEMENT SCHEMAS
# =========================================================

class AdminUserListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    full_name: str
    email: str
    role: str
    is_active: bool
    has_password: bool
    has_firebase: bool
    created_at: datetime


class AdminUserListResponse(BaseModel):
    items: list[AdminUserListItem]
    total: int
    limit: int
    offset: int


class AdminUserDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    full_name: str
    email: str
    role: str
    is_active: bool
    has_password: bool
    has_firebase: bool
    created_at: datetime
    active_sessions_count: int = 0
    linked_profile_type: str | None = None
    linked_profile_id: UUID | None = None
    doctor_verification_status: str | None = None
    doctor_specialization: str | None = None
    patient_profile_exists: bool = False


class AdminUserStatusUpdate(BaseModel):
    is_active: bool
    reason: str | None = None


class AdminUserStatusResponse(BaseModel):
    id: UUID
    email: str
    role: str
    is_active: bool
    updated_at: datetime
    revoked_sessions_count: int = 0


# =========================================================
# ADMIN SETTINGS SCHEMAS
# =========================================================

class AdminProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    full_name: str
    email: str
    role: str
    has_password: bool
    has_firebase: bool
    created_at: datetime


class AdminProfileUpdate(BaseModel):
    full_name: str


class AdminSystemSettingsResponse(BaseModel):
    app_name: str
    environment: str
    api_version: str = "v1"
    jwt_algorithm: str
    access_token_expire_minutes: int
    refresh_token_expire_days: int
    notification_retention_days: int = 90
    database_engine: str = "PostgreSQL"
    database_status: str = "connected"
    cors_allowed_origins_count: int


class AdminSecurityAuditEventItem(BaseModel):
    id: UUID
    event_type: str
    resource_type: str
    outcome: str
    created_at: datetime


class AdminSecuritySettingsResponse(BaseModel):
    admin_user_id: UUID
    email: str
    active_sessions_count: int
    recent_audit_events: list[AdminSecurityAuditEventItem]


class AdminNotificationSettingsResponse(BaseModel):
    total_notifications_sent: int
    unread_notifications_count: int
    supported_notification_types: list[str]


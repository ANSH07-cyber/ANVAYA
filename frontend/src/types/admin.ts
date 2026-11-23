/**
 * ANVAYA Healthcare SaaS - Admin Portal Types
 * Matches backend schemas from:
 * - app/schemas/admin.py (AdminDashboardStatsResponse)
 * - app/schemas/audit_log.py (AuditLogRead, AuditLogListResponse)
 * - app/schemas/doctor.py (DoctorReviewItem, DoctorReviewListResponse, DoctorAccountCreate, DoctorVerificationUpdate, DoctorProfileRead)
 */

export interface AdminDashboardStats {
  total_doctors: number;
  pending_doctors: number;
  approved_doctors: number;
  rejected_doctors: number;
  suspended_doctors: number;
  total_patients: number;
  total_appointments: number;
  booked_appointments: number;
  completed_appointments: number;
  cancelled_appointments: number;
}

export type AuditLogOutcome = "success" | "denied" | "failure";

export interface AdminAuditLogItem {
  id: string;
  actor_user_id: string;
  patient_profile_id: string | null;
  doctor_profile_id: string | null;
  event_type: string;
  resource_type: string;
  resource_id: string;
  outcome: AuditLogOutcome;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AdminAuditLogListResponse {
  items: AdminAuditLogItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminAuditLogFilterParams {
  event_type?: string;
  outcome?: AuditLogOutcome;
  patient_profile_id?: string;
  doctor_profile_id?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

// =========================================================
// PATIENT DIRECTORY & DEMOGRAPHICS TYPES
// =========================================================

export interface AdminPatientItem {
  id: string; // PatientProfile.id (UUID)
  user_id: string; // User.id (UUID)
  full_name: string;
  email: string;
  date_of_birth: string | null;
  phone_number: string | null;
  gender: string | null;
  blood_group: string | null;
  address: string | null;
  created_at: string;
}

export interface AdminPatientListResponse {
  items: AdminPatientItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminPatientFilterParams {
  search?: string;
  gender?: string;
  blood_group?: string;
  limit?: number;
  offset?: number;
}

// =========================================================
// APPOINTMENTS OVERSIGHT & QUEUE TYPES
// =========================================================

export type AdminAppointmentStatus =
  | "booked"
  | "completed"
  | "cancelled"
  | "in_progress";

export interface AdminAppointmentItem {
  id: string; // Appointment.id (UUID)
  patient_profile_id: string;
  doctor_profile_id: string;
  patient_name: string;
  patient_email: string;
  doctor_name: string;
  doctor_email: string;
  doctor_specialization: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: AdminAppointmentStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminAppointmentListResponse {
  items: AdminAppointmentItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminAppointmentFilterParams {
  status?: AdminAppointmentStatus;
  search?: string;
  date_from?: string;
  date_to?: string;
  doctor_profile_id?: string;
  patient_profile_id?: string;
  limit?: number;
  offset?: number;
}

// =========================================================
// DOCTOR MANAGEMENT & VERIFICATION TYPES (STAGE 3)
// =========================================================

export type DoctorVerificationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "suspended";

export interface DoctorReviewItem {
  id: string; // DoctorProfile.id (UUID)
  user_id: string; // User.id (UUID)
  full_name: string;
  email: string;
  specialization: string;
  qualification: string;
  license_number: string;
  years_experience: number | null;
  clinic_name: string | null;
  consultation_fee: string | number | null;
  bio: string | null;
  verification_status: DoctorVerificationStatus;
  created_at: string;
}

export interface DoctorReviewListResponse {
  items: DoctorReviewItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface DoctorReviewFilterParams {
  verification_status?: DoctorVerificationStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DoctorAccountCreatePayload {
  full_name: string;
  email: string;
  password: string;
  specialization: string;
  qualification: string;
  license_number: string;
  years_experience?: number | null;
  clinic_name?: string | null;
  consultation_fee?: number | string | null;
  bio?: string | null;
}

export interface DoctorVerificationUpdatePayload {
  verification_status: DoctorVerificationStatus;
  reason?: string | null;
}

export interface DoctorProfileRead {
  id: string;
  user_id: string;
  specialization: string;
  qualification: string;
  license_number: string;
  years_experience: number | null;
  clinic_name: string | null;
  consultation_fee: string | number | null;
  bio: string | null;
  verification_status: DoctorVerificationStatus;
  created_at: string;
  updated_at: string;
}

// =========================================================
// USER MANAGEMENT & SECURITY TYPES (STAGE 2C)
// =========================================================

export type AdminUserRole = "patient" | "doctor" | "admin";

export interface AdminUserListItem {
  id: string; // User.id (UUID)
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  has_password: boolean;
  has_firebase: boolean;
  created_at: string;
}

export interface AdminUserListResponse {
  items: AdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminUserFilterParams {
  role?: string;
  is_active?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AdminUserDetailResponse {
  id: string; // User.id (UUID)
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  has_password: boolean;
  has_firebase: boolean;
  created_at: string;
  active_sessions_count: number;
  linked_profile_type: string | null;
  linked_profile_id: string | null;
  doctor_verification_status: string | null;
  doctor_specialization: string | null;
  patient_profile_exists: boolean;
}

export interface AdminUserStatusUpdatePayload {
  is_active: boolean;
  reason?: string | null;
}

export interface AdminUserStatusResponse {
  id: string; // User.id (UUID)
  email: string;
  role: string;
  is_active: boolean;
  updated_at: string;
  revoked_sessions_count: number;
}

// =========================================================
// ADMIN SETTINGS TYPES (STAGE 2C PHASE 4)
// =========================================================

export interface AdminProfileResponse {
  id: string; // UUID
  full_name: string;
  email: string;
  role: string;
  has_password: boolean;
  has_firebase: boolean;
  created_at: string;
}

export interface AdminProfileUpdatePayload {
  full_name: string;
}

export interface AdminSystemSettingsResponse {
  app_name: string;
  environment: string;
  api_version: string;
  jwt_algorithm: string;
  access_token_expire_minutes: number;
  refresh_token_expire_days: number;
  notification_retention_days: number;
  database_engine: string;
  database_status: string;
  cors_allowed_origins_count: number;
}

export interface AdminSecurityAuditEventItem {
  id: string; // UUID
  event_type: string;
  resource_type: string;
  outcome: string;
  created_at: string;
}

export interface AdminSecuritySettingsResponse {
  admin_user_id: string; // UUID
  email: string;
  active_sessions_count: number;
  recent_audit_events: AdminSecurityAuditEventItem[];
}

export interface AdminNotificationSettingsResponse {
  total_notifications_sent: number;
  unread_notifications_count: number;
  supported_notification_types: string[];
}



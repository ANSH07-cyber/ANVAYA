/**
 * ANVAYA Healthcare SaaS - Admin Portal Service
 * Integrates with backend endpoints:
 * - GET /api/v1/admin/dashboard/stats
 * - GET /api/v1/admin/audit-logs
 * - GET /api/v1/admin/doctors
 * - POST /api/v1/admin/doctors
 * - PATCH /api/v1/admin/doctors/{id}/verification
 */

import api from "./api";
import type {
  AdminDashboardStats,
  AdminAuditLogFilterParams,
  AdminAuditLogListResponse,
  AdminPatientFilterParams,
  AdminPatientListResponse,
  AdminAppointmentFilterParams,
  AdminAppointmentListResponse,
  DoctorReviewFilterParams,
  DoctorReviewListResponse,
  DoctorAccountCreatePayload,
  DoctorProfileRead,
  DoctorVerificationUpdatePayload,
  AdminUserFilterParams,
  AdminUserListResponse,
  AdminUserDetailResponse,
  AdminUserStatusUpdatePayload,
  AdminUserStatusResponse,
  AdminProfileResponse,
  AdminProfileUpdatePayload,
  AdminSystemSettingsResponse,
  AdminSecuritySettingsResponse,
  AdminNotificationSettingsResponse,
} from "../types/admin";

export const adminService = {
  /**
   * Fetch aggregate platform statistics for the administrator overview.
   */
  async getDashboardStats(): Promise<AdminDashboardStats> {
    const response = await api.get<AdminDashboardStats>(
      "/admin/dashboard/stats",
    );
    return response.data;
  },

  /**
   * Fetch paginated audit log entries with optional filters.
   */
  async getAuditLogs(
    params?: AdminAuditLogFilterParams,
  ): Promise<AdminAuditLogListResponse> {
    const response = await api.get<AdminAuditLogListResponse>(
      "/admin/audit-logs",
      {
        params,
      },
    );
    return response.data;
  },

  /**
   * Fetch paginated patient directory with optional demographic and search filters.
   */
  async getPatients(
    params?: AdminPatientFilterParams,
  ): Promise<AdminPatientListResponse> {
    const response = await api.get<AdminPatientListResponse>(
      "/admin/patients",
      {
        params,
      },
    );
    return response.data;
  },

  /**
   * Fetch paginated appointments oversight directory with optional status, date, and search filters.
   */
  async getAppointments(
    params?: AdminAppointmentFilterParams,
  ): Promise<AdminAppointmentListResponse> {
    const response = await api.get<AdminAppointmentListResponse>(
      "/admin/appointments",
      {
        params,
      },
    );
    return response.data;
  },

  /**
   * Fetch paginated doctor directory with optional verification status and search filters.
   * Search queries against doctor full_name, email, and license_number.
   */
  async getDoctors(
    params?: DoctorReviewFilterParams,
  ): Promise<DoctorReviewListResponse> {
    const response = await api.get<DoctorReviewListResponse>(
      "/admin/doctors",
      {
        params,
      },
    );
    return response.data;
  },

  /**
   * Onboard a new practitioner account with atomic audit logging.
   * Returns created DoctorProfileRead with initial status "pending".
   */
  async createDoctor(
    payload: DoctorAccountCreatePayload,
  ): Promise<DoctorProfileRead> {
    const response = await api.post<DoctorProfileRead>(
      "/admin/doctors",
      payload,
    );
    return response.data;
  },

  /**
   * Update doctor verification status (approve, reject, suspend, reopen).
   * Enforces row-level concurrency locking and atomic audit logging on backend.
   */
  async reviewDoctor(
    doctorProfileId: string,
    payload: DoctorVerificationUpdatePayload,
  ): Promise<DoctorProfileRead> {
    const response = await api.patch<DoctorProfileRead>(
      `/admin/doctors/${doctorProfileId}/verification`,
      payload,
    );
    return response.data;
  },

  /**
   * Fetch paginated user accounts with optional role, is_active, and search filters.
   */
  async getUsers(
    params?: AdminUserFilterParams,
  ): Promise<AdminUserListResponse> {
    const response = await api.get<AdminUserListResponse>("/admin/users", {
      params,
    });
    return response.data;
  },

  /**
   * Fetch detailed account security, authentication, and profile metadata for a user.
   */
  async getUserDetail(userId: string): Promise<AdminUserDetailResponse> {
    const response = await api.get<AdminUserDetailResponse>(
      `/admin/users/${userId}`,
    );
    return response.data;
  },

  /**
   * Update user activation status (activate or deactivate) with mandatory reason on deactivation.
   * Invalidates active sessions automatically upon deactivation.
   */
  async updateUserStatus(
    userId: string,
    payload: AdminUserStatusUpdatePayload,
  ): Promise<AdminUserStatusResponse> {
    const response = await api.patch<AdminUserStatusResponse>(
      `/admin/users/${userId}/status`,
      payload,
    );
    return response.data;
  },

  /**
   * Fetch current administrator profile metadata.
   */
  async getAdminProfile(): Promise<AdminProfileResponse> {
    const response = await api.get<AdminProfileResponse>(
      "/admin/settings/profile",
    );
    return response.data;
  },

  /**
   * Update administrator full_name. Email and role changes are immutable.
   */
  async updateAdminProfile(
    payload: AdminProfileUpdatePayload,
  ): Promise<AdminProfileResponse> {
    const response = await api.patch<AdminProfileResponse>(
      "/admin/settings/profile",
      payload,
    );
    return response.data;
  },

  /**
   * Fetch non-secret system and runtime platform configuration parameters.
   */
  async getAdminSystemSettings(): Promise<AdminSystemSettingsResponse> {
    const response = await api.get<AdminSystemSettingsResponse>(
      "/admin/settings/system",
    );
    return response.data;
  },

  /**
   * Fetch session security metrics and recent administrator audit events.
   */
  async getAdminSecuritySettings(): Promise<AdminSecuritySettingsResponse> {
    const response = await api.get<AdminSecuritySettingsResponse>(
      "/admin/settings/security",
    );
    return response.data;
  },

  /**
   * Fetch operational notification telemetry and supported notification types.
   */
  async getAdminNotificationSettings(): Promise<AdminNotificationSettingsResponse> {
    const response = await api.get<AdminNotificationSettingsResponse>(
      "/admin/settings/notifications",
    );
    return response.data;
  },
};

export default adminService;

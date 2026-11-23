import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Globe,
  KeyRound,
  Lock,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  User,
  X,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import AdminLayout from "../../layouts/admin/AdminLayout";
import { adminService } from "../../services/adminService";
import type {
  AdminNotificationSettingsResponse,
  AdminProfileResponse,
  AdminSecuritySettingsResponse,
  AdminSystemSettingsResponse,
} from "../../types/admin";
import "./DoctorManagementPage.css";
import "./AdminSettingsPage.css";

type SettingsTab = "profile" | "system" | "security" | "notifications";

function getInitials(name: string): string {
  if (!name) return "AD";
  const clean = name.trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return isoString;
  }
}

function formatRelativeTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return "";
  } catch {
    return "";
  }
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data && typeof data === "object") {
      if ("detail" in data) {
        const detail = (data as { detail: unknown }).detail;
        if (typeof detail === "string") return detail;
        if (Array.isArray(detail)) {
          return detail
            .map((item) =>
              typeof item === "object" && item && "msg" in item
                ? String(item.msg)
                : JSON.stringify(item),
            )
            .join("; ");
        }
      }
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export default function AdminSettingsPage() {
  const { refreshUser } = useAuth();

  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Data States
  const [profile, setProfile] = useState<AdminProfileResponse | null>(null);
  const [system, setSystem] = useState<AdminSystemSettingsResponse | null>(null);
  const [security, setSecurity] = useState<AdminSecuritySettingsResponse | null>(null);
  const [notifications, setNotifications] = useState<AdminNotificationSettingsResponse | null>(null);

  // Profile Edit State
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [editFullName, setEditFullName] = useState<string>("");
  const [isSavingName, setIsSavingName] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    text: string;
    type: "success" | "error" | "info";
  } | null>(null);

  const [copiedId, setCopiedId] = useState<boolean>(false);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Load all settings in parallel
  const loadAllSettings = useCallback(async () => {
    setError(null);
    try {
      const [profileRes, systemRes, securityRes, notifRes] =
        await Promise.all([
          adminService.getAdminProfile(),
          adminService.getAdminSystemSettings(),
          adminService.getAdminSecuritySettings(),
          adminService.getAdminNotificationSettings(),
        ]);

      setProfile(profileRes);
      setSystem(systemRes);
      setSecurity(securityRes);
      setNotifications(notifRes);
      setEditFullName(profileRes.full_name);
    } catch (err) {
      setError(
        extractErrorMessage(
          err,
          "Failed to load administrative settings. Please check network connection or retry.",
        ),
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadAllSettings();
  }, [loadAllSettings]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    loadAllSettings();
  };

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Profile Name Update Handler
  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = editFullName.trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
      setProfileError("Full name must be between 2 and 120 characters.");
      return;
    }

    setIsSavingName(true);
    setProfileError(null);

    try {
      const updated = await adminService.updateAdminProfile({
        full_name: trimmed,
      });
      setProfile(updated);
      setEditFullName(updated.full_name);
      setIsEditingName(false);
      setToast({
        text: "Administrator profile display name updated successfully.",
        type: "success",
      });
      // Synchronize AuthContext so topbar/sidebar reflects new name immediately
      await refreshUser();
    } catch (err) {
      setProfileError(
        extractErrorMessage(
          err,
          "Failed to update administrator profile. Please try again.",
        ),
      );
    } finally {
      setIsSavingName(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingName(false);
    setProfileError(null);
    if (profile) {
      setEditFullName(profile.full_name);
    }
  };

  return (
    <AdminLayout
      title="System Settings"
      subtitle="Administrative profile preferences, platform configuration, authentication security, and notification telemetry."
    >
      <div className="admin-settings-container">
        {/* Toast Feedback Banner */}
        {toast && (
          <div
            className={`settings-toast-banner toast-${toast.type}`}
            role="status"
          >
            {toast.type === "success" && <CheckCircle2 size={18} />}
            {toast.type === "info" && <Shield size={18} />}
            {toast.type === "error" && <AlertCircle size={18} />}
            <span>{toast.text}</span>
            <button
              type="button"
              className="settings-toast-close"
              onClick={() => setToast(null)}
              aria-label="Dismiss message"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* Top Control Bar with Tabs and Refresh */}
        <div className="settings-header-toolbar">
          <nav
            className="settings-nav-tabs"
            role="tablist"
            aria-label="Admin settings sections"
          >
            <button
              type="button"
              role="tab"
              id="tab-profile"
              aria-selected={activeTab === "profile"}
              aria-controls="panel-profile"
              className={`settings-tab-btn ${
                activeTab === "profile" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("profile")}
            >
              <User size={16} aria-hidden="true" />
              <span>Admin Profile</span>
            </button>

            <button
              type="button"
              role="tab"
              id="tab-system"
              aria-selected={activeTab === "system"}
              aria-controls="panel-system"
              className={`settings-tab-btn ${
                activeTab === "system" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("system")}
            >
              <Server size={16} aria-hidden="true" />
              <span>Platform Config</span>
            </button>

            <button
              type="button"
              role="tab"
              id="tab-security"
              aria-selected={activeTab === "security"}
              aria-controls="panel-security"
              className={`settings-tab-btn ${
                activeTab === "security" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("security")}
            >
              <Shield size={16} aria-hidden="true" />
              <span>Security & Sessions</span>
            </button>

            <button
              type="button"
              role="tab"
              id="tab-notifications"
              aria-selected={activeTab === "notifications"}
              aria-controls="panel-notifications"
              className={`settings-tab-btn ${
                activeTab === "notifications" ? "is-active" : ""
              }`}
              onClick={() => setActiveTab("notifications")}
            >
              <Bell size={16} aria-hidden="true" />
              <span>Notifications</span>
            </button>
          </nav>

          <button
            type="button"
            className="doctor-header-btn doctor-refresh-btn"
            onClick={handleManualRefresh}
            disabled={isRefreshing || isLoading}
            title="Refresh settings telemetry"
          >
            <RefreshCw
              size={16}
              className={isRefreshing ? "spin-icon" : ""}
            />
            <span>Refresh</span>
          </button>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="doctor-error-banner" role="alert">
            <AlertCircle size={20} className="error-icon" />
            <div className="doctor-error-text">
              <strong>Error Loading Settings</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              className="doctor-error-dismiss"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {isLoading && (
          <div className="settings-loading-card">
            <RefreshCw size={28} className="spin-icon" />
            <p>Loading administrative telemetry...</p>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 1: ADMINISTRATOR PROFILE */}
        {/* ========================================================= */}
        {!isLoading && activeTab === "profile" && profile && (
          <div
            id="panel-profile"
            role="tabpanel"
            aria-labelledby="tab-profile"
            className="settings-panel-grid"
          >
            {/* Profile Overview Hero */}
            <div className="settings-card hero-card">
              <div className="settings-hero-left">
                <div
                  className="doctor-avatar-circle user-avatar-admin settings-avatar-large"
                  aria-hidden="true"
                >
                  {getInitials(profile.full_name)}
                </div>
                <div className="settings-hero-meta">
                  <div className="settings-hero-title-row">
                    <h3 className="settings-hero-title">
                      {profile.full_name}
                    </h3>
                    <span className="user-role-badge role-admin">
                      <Shield size={13} aria-hidden="true" />
                      Administrator
                    </span>
                  </div>
                  <span className="settings-hero-email">
                    {profile.email}
                  </span>
                  <div className="settings-hero-badges">
                    <span
                      className="settings-badge-pill"
                      title="Account registered in platform directory"
                    >
                      <Clock size={12} aria-hidden="true" />
                      Member since {formatDate(profile.created_at)}
                    </span>
                  </div>
                </div>
              </div>

              {!isEditingName && (
                <button
                  type="button"
                  className="settings-btn-primary"
                  onClick={() => setIsEditingName(true)}
                >
                  <Sliders size={15} />
                  <span>Edit Profile</span>
                </button>
              )}
            </div>

            {/* Edit Display Name Form */}
            {isEditingName && (
              <div className="settings-card">
                <h4 className="settings-card-title">
                  Edit Administrator Name
                </h4>
                <p className="settings-card-desc">
                  Update the human-readable display name shown across the ANVAYA
                  Admin Console and clinical oversight audit trails.
                </p>

                {profileError && (
                  <div
                    className="doctor-dialog-alert alert-rose"
                    role="alert"
                    style={{ marginBottom: "1rem" }}
                  >
                    <AlertCircle size={18} className="dialog-alert-icon" />
                    <div className="dialog-alert-text">
                      <strong>Validation Error</strong>
                      <p>{profileError}</p>
                    </div>
                  </div>
                )}

                <form onSubmit={handleSaveProfile} className="settings-edit-form">
                  <div className="doctor-dialog-field">
                    <label
                      htmlFor="admin-name-input"
                      className="doctor-dialog-label"
                    >
                      Display Full Name
                    </label>
                    <input
                      id="admin-name-input"
                      type="text"
                      className="doctor-search-input settings-text-input"
                      value={editFullName}
                      onChange={(e) => setEditFullName(e.target.value)}
                      disabled={isSavingName}
                      minLength={2}
                      maxLength={120}
                      required
                    />
                    <p className="dialog-field-hint">
                      Must be between 2 and 120 characters. Email address and role
                      are immutable for security compliance.
                    </p>
                  </div>

                  <div className="settings-form-actions">
                    <button
                      type="button"
                      className="doctor-dialog-btn-cancel"
                      onClick={handleCancelEdit}
                      disabled={isSavingName}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="settings-btn-save"
                      disabled={isSavingName}
                    >
                      {isSavingName ? (
                        <>
                          <RefreshCw size={15} className="spin-icon" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Check size={15} />
                          <span>Save Changes</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Identity & Account Telemetry */}
            <div className="settings-card">
              <h4 className="settings-card-title">Account Identity & Credentials</h4>
              <div className="settings-meta-grid">
                <div className="settings-meta-item full-width">
                  <span className="meta-label">Admin Identifier (UUID)</span>
                  <div className="user-id-copy-row">
                    <code className="user-id-code">{profile.id}</code>
                    <button
                      type="button"
                      className="user-copy-btn"
                      onClick={() => handleCopyId(profile.id)}
                      title="Copy identifier"
                    >
                      {copiedId ? (
                        <>
                          <Check size={14} className="copied-icon" />
                          <span className="copied-text">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={14} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="settings-meta-item">
                  <span className="meta-label">Email Address</span>
                  <div className="settings-readonly-field">
                    <span>{profile.email}</span>
                    <span className="settings-tag-immutable">Immutable</span>
                  </div>
                </div>

                <div className="settings-meta-item">
                  <span className="meta-label">System Role</span>
                  <div className="settings-readonly-field">
                    <span>{profile.role.toUpperCase()}</span>
                    <span className="settings-tag-immutable">Immutable</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Authentication Providers Status */}
            <div className="settings-card">
              <h4 className="settings-card-title">Authentication Methods</h4>
              <div className="user-auth-providers-list">
                <div className="user-auth-provider-row">
                  <div className="user-auth-provider-info">
                    <div className="user-auth-provider-icon key-icon">
                      <KeyRound size={16} />
                    </div>
                    <div>
                      <strong className="user-auth-provider-title">
                        Password Authentication
                      </strong>
                      <p className="user-auth-provider-desc">
                        Argon2id password hashing with bcrypt verification support
                      </p>
                    </div>
                  </div>
                  {profile.has_password ? (
                    <span className="user-auth-status-badge configured">
                      <CheckCircle2 size={14} />
                      Configured
                    </span>
                  ) : (
                    <span className="user-auth-status-badge not-configured">
                      Not Configured
                    </span>
                  )}
                </div>

                <div className="user-auth-provider-row">
                  <div className="user-auth-provider-info">
                    <div className="user-auth-provider-icon firebase-icon">
                      <ShieldCheck size={16} />
                    </div>
                    <div>
                      <strong className="user-auth-provider-title">
                        Google / Firebase Federated Identity
                      </strong>
                      <p className="user-auth-provider-desc">
                        OAuth2 cryptographic token validation via Firebase Auth
                      </p>
                    </div>
                  </div>
                  {profile.has_firebase ? (
                    <span className="user-auth-status-badge configured">
                      <CheckCircle2 size={14} />
                      Linked
                    </span>
                  ) : (
                    <span className="user-auth-status-badge not-configured">
                      Not Linked
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: PLATFORM CONFIGURATION (NON-SECRET) */}
        {/* ========================================================= */}
        {!isLoading && activeTab === "system" && system && (
          <div
            id="panel-system"
            role="tabpanel"
            aria-labelledby="tab-system"
            className="settings-panel-grid"
          >
            {/* System Overview Card */}
            <div className="settings-card">
              <div className="settings-section-header">
                <div>
                  <h4 className="settings-card-title">
                    Runtime Architecture & Platform Configuration
                  </h4>
                  <p className="settings-card-desc">
                    Active operational parameters loaded from the server
                    environment. Secret keys and credentials are never exposed.
                  </p>
                </div>
                <span className="settings-env-badge">
                  {system.environment.toUpperCase()}
                </span>
              </div>

              <div className="settings-meta-grid">
                <div className="settings-meta-item">
                  <span className="meta-label">Application Name</span>
                  <span className="settings-value-strong">
                    {system.app_name}
                  </span>
                </div>

                <div className="settings-meta-item">
                  <span className="meta-label">API Core Version</span>
                  <span className="settings-value-strong">
                    {system.api_version}
                  </span>
                </div>

                <div className="settings-meta-item">
                  <span className="meta-label">Database Engine</span>
                  <div className="settings-status-indicator-wrap">
                    <Database size={15} className="meta-inline-icon" />
                    <span>{system.database_engine}</span>
                  </div>
                </div>

                <div className="settings-meta-item">
                  <span className="meta-label">Database Connectivity</span>
                  <div className="settings-status-indicator-wrap">
                    <span
                      className="status-dot-pulse"
                      aria-hidden="true"
                    />
                    <strong className="text-emerald">
                      {system.database_status}
                    </strong>
                  </div>
                </div>

                <div className="settings-meta-item">
                  <span className="meta-label">JWT Cryptographic Algorithm</span>
                  <code className="user-id-code">{system.jwt_algorithm}</code>
                </div>

                <div className="settings-meta-item">
                  <span className="meta-label">Access Token Validity</span>
                  <span className="settings-value-strong">
                    {system.access_token_expire_minutes} minutes
                  </span>
                </div>

                <div className="settings-meta-item">
                  <span className="meta-label">Refresh Token Lifetime</span>
                  <span className="settings-value-strong">
                    {system.refresh_token_expire_days} days
                  </span>
                </div>

                <div className="settings-meta-item">
                  <span className="meta-label">Notification Retention Policy</span>
                  <span className="settings-value-strong">
                    {system.notification_retention_days} days
                  </span>
                </div>

                <div className="settings-meta-item full-width">
                  <span className="meta-label">Allowed CORS Origins Count</span>
                  <div className="settings-status-indicator-wrap">
                    <Globe size={15} className="meta-inline-icon" />
                    <span className="settings-value-strong">
                      {system.cors_allowed_origins_count}{" "}
                      {system.cors_allowed_origins_count === 1
                        ? "trusted origin configured"
                        : "trusted origins configured"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Architecture Compliance Note */}
            <div className="user-privacy-compliance-notice">
              <ShieldAlert size={18} className="compliance-icon" />
              <div>
                <strong>Non-Secret Platform Parameters</strong>
                <p>
                  System parameters reflect the live runtime environment. To
                  modify timeouts, retention cycles, or database targets, update
                  the server configuration files with appropriate authorization.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: SECURITY & SESSIONS */}
        {/* ========================================================= */}
        {!isLoading && activeTab === "security" && security && (
          <div
            id="panel-security"
            role="tabpanel"
            aria-labelledby="tab-security"
            className="settings-panel-grid"
          >
            {/* Active Sessions Overview */}
            <div className="settings-card">
              <h4 className="settings-card-title">Session Telemetry</h4>
              <p className="settings-card-desc">
                Current active sessions associated with your administrator account.
              </p>

              <div className="settings-sessions-summary-card">
                <div className="settings-session-icon-circle">
                  <Lock size={22} />
                </div>
                <div>
                  <span className="settings-session-count-heading">
                    {security.active_sessions_count}{" "}
                    {security.active_sessions_count === 1
                      ? "Active Session"
                      : "Active Sessions"}
                  </span>
                  <p className="settings-session-count-desc">
                    Active sessions reflect unexpired, unrevoked refresh token
                    families stored in secure HttpOnly cookies.
                  </p>
                </div>
              </div>

              <div className="settings-security-posture-list">
                <div className="settings-posture-item">
                  <div className="posture-icon">
                    <ShieldCheck size={16} />
                  </div>
                  <div>
                    <strong>HttpOnly Cookie Isolation</strong>
                    <p>
                      Session cookies are inaccessible to client-side scripts,
                      protecting against cross-site scripting (XSS) token theft.
                    </p>
                  </div>
                </div>

                <div className="settings-posture-item">
                  <div className="posture-icon">
                    <ShieldCheck size={16} />
                  </div>
                  <div>
                    <strong>CSRF Token & Origin Verification</strong>
                    <p>
                      State-changing PATCH, POST, and DELETE endpoints enforce
                      origin checks and custom X-CSRF-Token validation.
                    </p>
                  </div>
                </div>

                <div className="settings-posture-item">
                  <div className="posture-icon">
                    <ShieldCheck size={16} />
                  </div>
                  <div>
                    <strong>Automatic Session Invalidation</strong>
                    <p>
                      Deactivating an account or rotating credentials immediately
                      and atomically revokes all associated refresh token families.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Personal Audit Events */}
            <div className="settings-card">
              <h4 className="settings-card-title">
                Recent Personal Audit Activity
              </h4>
              <p className="settings-card-desc">
                Latest security audit records attributed to your administrator
                account (`actor_user_id`).
              </p>

              {security.recent_audit_events.length === 0 ? (
                <div className="settings-empty-audit">
                  <Clock size={24} className="empty-icon" />
                  <p>No recent audit events recorded for this account.</p>
                </div>
              ) : (
                <div className="settings-audit-table-wrap">
                  <table className="doctor-table">
                    <thead>
                      <tr>
                        <th>Event Type</th>
                        <th>Resource</th>
                        <th>Outcome</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {security.recent_audit_events.map((evt) => (
                        <tr key={evt.id}>
                          <td>
                            <code className="settings-audit-event-code">
                              {evt.event_type}
                            </code>
                          </td>
                          <td>
                            <span className="settings-audit-res">
                              {evt.resource_type}
                            </span>
                          </td>
                          <td>
                            {evt.outcome === "success" ? (
                              <span className="user-status-pill status-active">
                                <span
                                  className="status-dot-pulse"
                                  aria-hidden="true"
                                />
                                Success
                              </span>
                            ) : (
                              <span className="user-status-pill status-inactive">
                                {evt.outcome}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className="doctor-date-primary">
                              {formatDate(evt.created_at)}
                            </span>
                            <span className="doctor-date-relative">
                              {formatRelativeTime(evt.created_at)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: NOTIFICATIONS TELEMETRY */}
        {/* ========================================================= */}
        {!isLoading && activeTab === "notifications" && notifications && (
          <div
            id="panel-notifications"
            role="tabpanel"
            aria-labelledby="tab-notifications"
            className="settings-panel-grid"
          >
            {/* Operational Metrics */}
            <div className="settings-card">
              <h4 className="settings-card-title">
                Platform Notification Telemetry
              </h4>
              <p className="settings-card-desc">
                High-level operational counts for transactional event
                notifications generated across ANVAYA.
              </p>

              <div className="settings-notif-stat-cards">
                <div className="settings-notif-stat-card">
                  <span className="notif-stat-label">
                    Total Notifications Generated
                  </span>
                  <span className="notif-stat-value text-teal">
                    {notifications.total_notifications_sent}
                  </span>
                  <span className="notif-stat-hint">
                    Enforces savepoint deduplication
                  </span>
                </div>

                <div className="settings-notif-stat-card">
                  <span className="notif-stat-label">
                    Your Unread Notifications
                  </span>
                  <span className="notif-stat-value text-purple">
                    {notifications.unread_notifications_count}
                  </span>
                  <span className="notif-stat-hint">
                    Accessible via the top header bell
                  </span>
                </div>
              </div>
            </div>

            {/* Supported Event Types */}
            <div className="settings-card">
              <h4 className="settings-card-title">
                Supported Notification Event Types
              </h4>
              <p className="settings-card-desc">
                Domain events configured to automatically emit in-app notifications
                to affected patients, doctors, or administrators.
              </p>

              <div className="settings-event-types-list">
                {notifications.supported_notification_types.map((type) => (
                  <div key={type} className="settings-event-type-chip">
                    <Bell size={13} aria-hidden="true" />
                    <code>{type}</code>
                  </div>
                ))}
              </div>

              <div className="user-admin-privilege-notice" style={{ marginTop: "1.25rem" }}>
                <Bell size={18} className="notice-icon" />
                <div>
                  <strong>In-App Notification Center</strong>
                  <p>
                    Notifications are delivered directly to the in-app notification
                    drawer. Click the notification bell in the header bar above to
                    view, mark as read, or navigate to corresponding records.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

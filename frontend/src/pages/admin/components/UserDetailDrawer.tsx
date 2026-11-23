import { useEffect, useState } from "react";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  User,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { adminService } from "../../../services/adminService";
import type { AdminUserDetailResponse } from "../../../types/admin";

interface UserDetailDrawerProps {
  userId: string | null;
  currentUserId?: string;
  isOpen: boolean;
  onClose: () => void;
  onToggleStatus: (user: AdminUserDetailResponse) => void;
}

function getInitials(name: string): string {
  if (!name) return "US";
  const clean = name.replace(/^Dr\.?\s+/i, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "US";
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

export default function UserDetailDrawer({
  userId,
  currentUserId,
  isOpen,
  onClose,
  onToggleStatus,
}: UserDetailDrawerProps) {
  const [detail, setDetail] = useState<AdminUserDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);

  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Fetch detail whenever drawer opens with a valid userId
  useEffect(() => {
    if (!isOpen || !userId) {
      setDetail(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    adminService
      .getUserDetail(userId)
      .then((data) => {
        if (isMounted) {
          setDetail(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load user account metadata",
          );
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, userId]);

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Fallback or ignore
    }
  };

  if (!isOpen) return null;

  const isSelf = currentUserId && detail && detail.id === currentUserId;

  return (
    <div
      className="doctor-drawer-overlay"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="doctor-drawer-container user-drawer-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="doctor-drawer-header user-drawer-header">
          <div className="doctor-drawer-header-content">
            <span className="doctor-drawer-kicker">
              <Shield size={13} className="doctor-drawer-kicker-icon" />
              SECURITY AUDIT & ACCOUNT INSPECTION
            </span>
            <h2 id="user-drawer-title" className="doctor-drawer-title">
              Account Security Inspection
            </h2>
            <p className="user-drawer-subtitle">
              Comprehensive identity, credential methods, and active session telemetry.
            </p>
          </div>
          <button
            type="button"
            className="doctor-drawer-close-btn"
            onClick={onClose}
            aria-label="Close user details drawer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="user-drawer-loading">
            <RefreshCw size={28} className="spin-icon text-sky" />
            <p>Retrieving account telemetry...</p>
          </div>
        )}

        {/* Error State */}
        {!isLoading && error && (
          <div className="user-drawer-error-state">
            <AlertCircle size={32} className="error-icon text-rose" />
            <h4>Failed to load account details</h4>
            <p>{error}</p>
            <button
              type="button"
              className="user-drawer-retry-btn"
              onClick={() => {
                if (userId) {
                  setIsLoading(true);
                  setError(null);
                  adminService
                    .getUserDetail(userId)
                    .then((data) => {
                      setDetail(data);
                      setIsLoading(false);
                    })
                    .catch((err) => {
                      setError(err.message || "Retry failed");
                      setIsLoading(false);
                    });
                }
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Drawer Content */}
        {!isLoading && !error && detail && (
          <>
            <div className="doctor-drawer-body user-drawer-scrollable-body">
              {/* Identity Hero Banner */}
              <div className="user-drawer-hero">
                <div
                  className={`user-avatar-badge user-avatar-${detail.role} user-drawer-hero-avatar`}
                  aria-hidden="true"
                >
                  {getInitials(detail.full_name)}
                </div>
                <div className="user-drawer-hero-meta">
                  <div className="user-drawer-hero-name-row">
                    <h3 className="user-drawer-hero-name">{detail.full_name}</h3>
                    {isSelf && <span className="user-self-pill">You</span>}
                  </div>
                  <span className="user-drawer-hero-email">{detail.email}</span>
                  <div className="user-drawer-hero-badges">
                    <span className={`user-role-badge role-${detail.role}`}>
                      {detail.role === "doctor" && <Stethoscope size={13} />}
                      {detail.role === "admin" && <Shield size={13} />}
                      {detail.role === "patient" && <User size={13} />}
                      {detail.role.toUpperCase()}
                    </span>
                    {detail.is_active ? (
                      <span className="user-status-pill status-active">
                        <span className="status-dot-pulse" aria-hidden="true" />
                        Active Account
                      </span>
                    ) : (
                      <span className="user-status-pill status-inactive">
                        <Lock size={12} aria-hidden="true" />
                        Suspended / Inactive
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Account Identifier & Timestamps */}
              <div className="drawer-card user-drawer-card">
                <div className="drawer-card-label">
                  <Shield size={13} />
                  <span>Identity & Telemetry</span>
                </div>
                <div className="user-meta-stack">
                  <div className="user-meta-row">
                    <span className="user-meta-field-label">User Identifier (UUID)</span>
                    <div className="user-id-copy-row">
                      <code className="user-id-code">{detail.id}</code>
                      <button
                        type="button"
                        className="user-copy-btn"
                        onClick={() => handleCopyId(detail.id)}
                        title="Copy user ID"
                        aria-label="Copy user identifier"
                      >
                        {copiedId ? (
                          <>
                            <Check size={13} className="copied-icon" />
                            <span className="copied-text">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={13} />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="user-meta-subgrid">
                    <div className="user-meta-subitem">
                      <span className="user-meta-field-label">Account Created</span>
                      <div className="user-meta-value-row">
                        <Calendar size={14} className="user-meta-icon text-sky" />
                        <span className="user-meta-value">
                          {formatDate(detail.created_at)}
                        </span>
                      </div>
                    </div>

                    <div className="user-meta-subitem">
                      <span className="user-meta-field-label">Active Refresh Sessions</span>
                      <div className="user-meta-value-row">
                        <span
                          className={`user-session-count-pill ${
                            detail.active_sessions_count > 0 ? "has-sessions" : "no-sessions"
                          }`}
                        >
                          {detail.active_sessions_count}{" "}
                          {detail.active_sessions_count === 1
                            ? "active session"
                            : "active sessions"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Authentication Providers Card */}
              <div className="drawer-card user-drawer-card">
                <div className="drawer-card-label">
                  <KeyRound size={13} />
                  <span>Authentication Providers</span>
                </div>
                <div className="user-auth-providers-list">
                  <div className="user-auth-provider-row">
                    <div className="user-auth-provider-info">
                      <div className="user-auth-provider-icon key-icon">
                        <KeyRound size={16} />
                      </div>
                      <div className="user-auth-provider-text">
                        <strong className="user-auth-provider-title">
                          Password Authentication
                        </strong>
                        <p className="user-auth-provider-desc">
                          Argon2id password hashing with bcrypt fallback support
                        </p>
                      </div>
                    </div>
                    {detail.has_password ? (
                      <span className="user-auth-status-badge configured">
                        <CheckCircle2 size={13} />
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
                      <div className="user-auth-provider-text">
                        <strong className="user-auth-provider-title">
                          Google / Firebase Identity
                        </strong>
                        <p className="user-auth-provider-desc">
                          Federated OAuth2 JWT verification via Firebase Auth
                        </p>
                      </div>
                    </div>
                    {detail.has_firebase ? (
                      <span className="user-auth-status-badge configured">
                        <CheckCircle2 size={13} />
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

              {/* Linked Domain Profile Card */}
              <div className="drawer-card user-drawer-card">
                <div className="drawer-card-label">
                  <User size={13} />
                  <span>Domain Profile Binding</span>
                </div>
                {detail.role === "doctor" && (
                  <div className="user-meta-subgrid">
                    <div className="user-meta-subitem">
                      <span className="user-meta-field-label">Doctor Profile ID</span>
                      <code className="user-subcode">
                        {detail.linked_profile_id || "None attached"}
                      </code>
                    </div>
                    <div className="user-meta-subitem">
                      <span className="user-meta-field-label">Specialization</span>
                      <span className="user-meta-value">
                        {detail.doctor_specialization || "General Medicine"}
                      </span>
                    </div>
                    <div className="user-meta-subitem full-width">
                      <span className="user-meta-field-label">Verification Status</span>
                      <div className="user-meta-value-row">
                        <span
                          className={`doc-status-badge status-${
                            detail.doctor_verification_status || "pending"
                          }`}
                        >
                          {(detail.doctor_verification_status || "pending").toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {detail.role === "patient" && (
                  <div className="user-meta-subgrid">
                    <div className="user-meta-subitem">
                      <span className="user-meta-field-label">Patient Profile ID</span>
                      <code className="user-subcode">
                        {detail.linked_profile_id || "Pending initialization"}
                      </code>
                    </div>
                    <div className="user-meta-subitem">
                      <span className="user-meta-field-label">Profile Status</span>
                      <div className="user-meta-value-row">
                        {detail.patient_profile_exists ? (
                          <span className="user-auth-status-badge configured">
                            <CheckCircle2 size={13} />
                            Initialized
                          </span>
                        ) : (
                          <span className="user-auth-status-badge not-configured">
                            Incomplete Demographics
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {detail.role === "admin" && (
                  <div className="user-admin-privilege-notice">
                    <Shield size={18} className="notice-icon text-sky" />
                    <div>
                      <strong>System Administrator Privilege</strong>
                      <p>
                        Granted administrative authority to oversee providers, review
                        patient directories, configure security, and manage users.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Security & Privacy Guardrail Notice */}
              <div className="user-privacy-compliance-notice">
                <ShieldAlert size={18} className="compliance-icon text-amber" />
                <div>
                  <strong>Healthcare Data Security & Privacy Compliance</strong>
                  <p>
                    In accordance with DISHA and HIPAA security guidelines,
                    password hashes, session tokens, and clinical protected health
                    information (PHI) are strictly isolated and never exposed
                    through administrative inspection interfaces.
                  </p>
                </div>
              </div>
            </div>

            {/* Drawer Actions Footer */}
            <div className="doctor-drawer-footer user-drawer-footer">
              {detail.is_active ? (
                <button
                  type="button"
                  className="user-drawer-action-btn btn-deactivate"
                  onClick={() => onToggleStatus(detail)}
                  disabled={Boolean(isSelf)}
                  title={
                    isSelf
                      ? "Self-deactivation disabled for security"
                      : "Deactivate account and revoke sessions"
                  }
                >
                  <UserX size={15} />
                  <span>Deactivate Account</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="user-drawer-action-btn btn-activate"
                  onClick={() => onToggleStatus(detail)}
                >
                  <UserCheck size={15} />
                  <span>Activate Account</span>
                </button>
              )}

              <button
                type="button"
                className="doctor-drawer-btn-secondary"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

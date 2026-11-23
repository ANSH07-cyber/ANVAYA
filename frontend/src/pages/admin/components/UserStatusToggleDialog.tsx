import { useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { adminService } from "../../../services/adminService";
import type {
  AdminUserDetailResponse,
  AdminUserListItem,
  AdminUserStatusResponse,
} from "../../../types/admin";

interface UserStatusToggleDialogProps {
  user: AdminUserListItem | AdminUserDetailResponse | null;
  currentUserId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedStatus: AdminUserStatusResponse) => void;
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

export default function UserStatusToggleDialog({
  user,
  currentUserId,
  isOpen,
  onClose,
  onSuccess,
}: UserStatusToggleDialogProps) {
  const [reason, setReason] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isDeactivating = user ? user.is_active : false;
  const isSelf = user && currentUserId ? user.id === currentUserId : false;

  // Reset form on open/close
  useEffect(() => {
    if (isOpen) {
      setReason("");
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen, user]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !user) return null;

  const trimmedReason = reason.trim();
  const isReasonValid = !isDeactivating || trimmedReason.length >= 5;
  const canSubmit = !isSelf && isReasonValid && !isSubmitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await adminService.updateUserStatus(user.id, {
        is_active: !user.is_active,
        reason: trimmedReason.length > 0 ? trimmedReason : null,
      });
      setIsSubmitting(false);
      onSuccess(response);
      onClose();
    } catch (err) {
      setIsSubmitting(false);
      setError(
        extractErrorMessage(
          err,
          `Failed to ${isDeactivating ? "deactivate" : "activate"} user account. Please try again.`,
        ),
      );
    }
  };

  return (
    <div
      className="doctor-dialog-backdrop"
      onClick={isSubmitting ? undefined : onClose}
      role="presentation"
    >
      <div
        className="doctor-dialog-card user-status-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="doctor-dialog-header">
          <div className="doctor-dialog-title-wrap">
            <div
              className={`doctor-dialog-icon-circle ${
                isDeactivating ? "circle-rose" : "circle-emerald"
              }`}
              aria-hidden="true"
            >
              {isDeactivating ? (
                <UserX size={20} />
              ) : (
                <UserCheck size={20} />
              )}
            </div>
            <div>
              <h3 id="user-dialog-title" className="doctor-dialog-title">
                {isDeactivating
                  ? "Deactivate User Account"
                  : "Reactivate User Account"}
              </h3>
              <p className="doctor-dialog-subtitle">
                Target: <strong>{user.full_name}</strong> ({user.email})
              </p>
            </div>
          </div>
          <button
            type="button"
            className="doctor-dialog-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="doctor-dialog-body">
            {/* Self-deactivation Security Guardrail */}
            {isSelf && (
              <div
                className="doctor-dialog-alert alert-rose"
                role="alert"
                style={{ marginBottom: "1rem" }}
              >
                <ShieldAlert size={18} className="dialog-alert-icon" />
                <div className="dialog-alert-text">
                  <strong>Security Restriction</strong>
                  <p>
                    You cannot deactivate your own administrative account while logged in.
                    This prevents accidental platform lockout.
                  </p>
                </div>
              </div>
            )}

            {/* Context Notice */}
            {!isSelf && (
              <div
                className={`doctor-dialog-alert ${
                  isDeactivating ? "alert-amber" : "alert-emerald"
                }`}
                role="alert"
              >
                {isDeactivating ? (
                  <AlertTriangle size={18} className="dialog-alert-icon" />
                ) : (
                  <CheckCircle2 size={18} className="dialog-alert-icon" />
                )}
                <div className="dialog-alert-text">
                  <strong>
                    {isDeactivating
                      ? "Immediate Session Revocation"
                      : "Account Access Restoration"}
                  </strong>
                  <p>
                    {isDeactivating
                      ? "Deactivating this account will immediately revoke all active refresh tokens and sessions. The user will be logged out and blocked from further authentication until reactivated."
                      : "Activating this account will restore login permissions. The user will be able to log in again using their existing credentials."}
                  </p>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div
                className="doctor-dialog-alert alert-rose"
                role="alert"
                style={{ marginTop: "0.75rem" }}
              >
                <AlertCircle size={18} className="dialog-alert-icon" />
                <div className="dialog-alert-text">
                  <strong>Action Failed</strong>
                  <p>{error}</p>
                </div>
              </div>
            )}

            {/* Reason Input */}
            <div className="doctor-dialog-field" style={{ marginTop: "1rem" }}>
              <div className="doctor-dialog-label-row">
                <label htmlFor="status-reason-input" className="doctor-dialog-label">
                  {isDeactivating
                    ? "Reason for Deactivation (Required)"
                    : "Administrative Notes (Optional)"}
                </label>
                {isDeactivating && (
                  <span
                    className={`dialog-char-counter ${
                      trimmedReason.length >= 5 ? "valid" : "invalid"
                    }`}
                  >
                    {trimmedReason.length}/5 min characters
                  </span>
                )}
              </div>
              <textarea
                id="status-reason-input"
                className="doctor-dialog-textarea"
                rows={3}
                placeholder={
                  isDeactivating
                    ? "Provide a mandatory administrative reason for deactivating this user account (e.g. employee offboarding, security violation, duplicate account)..."
                    : "Optional note explaining the reactivation..."
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isSubmitting || Boolean(isSelf)}
                required={isDeactivating}
              />
              {isDeactivating && trimmedReason.length > 0 && trimmedReason.length < 5 && (
                <p className="dialog-field-hint error">
                  Reason must be at least 5 characters long for audit accountability.
                </p>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="doctor-dialog-footer">
            <button
              type="button"
              className="doctor-dialog-btn-cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`doctor-dialog-btn-submit ${
                isDeactivating ? "dialog-btn-reject" : "dialog-btn-approve"
              }`}
              disabled={!canSubmit}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={15} className="spin-icon" />
                  <span>Processing...</span>
                </>
              ) : isDeactivating ? (
                <>
                  <UserX size={15} />
                  <span>Deactivate Account</span>
                </>
              ) : (
                <>
                  <UserCheck size={15} />
                  <span>Reactivate Account</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

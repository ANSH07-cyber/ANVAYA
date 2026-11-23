import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";

import { adminService } from "../../../services/adminService";
import type {
  DoctorProfileRead,
  DoctorReviewItem,
  DoctorVerificationStatus,
  DoctorVerificationUpdatePayload,
} from "../../../types/admin";
import "./DoctorVerificationDialog.css";

interface DoctorVerificationDialogProps {
  doctor: DoctorReviewItem | null;
  targetStatus: DoctorVerificationStatus | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedProfile: DoctorProfileRead) => void;
  onConflict?: () => void;
}

interface TransitionMetadata {
  title: string;
  actionText: string;
  buttonClass: string;
  icon: typeof CheckCircle2;
  requiresReason: boolean;
  reasonPlaceholder: string;
  explanation: string;
  warningNotice?: string;
}

function getTransitionMetadata(
  currentStatus: DoctorVerificationStatus,
  targetStatus: DoctorVerificationStatus,
): TransitionMetadata {
  if (currentStatus === "pending" && targetStatus === "approved") {
    return {
      title: "Approve Practitioner Licensure",
      actionText: "Approve Practitioner",
      buttonClass: "dialog-btn-approve",
      icon: CheckCircle2,
      requiresReason: false,
      reasonPlaceholder:
        "Optional: Enter administrative notes or council verification reference...",
      explanation:
        "Approving this practitioner authorizes them to practice on ANVAYA, accept patient appointments, and issue digital prescriptions.",
    };
  }

  if (currentStatus === "pending" && targetStatus === "rejected") {
    return {
      title: "Reject Practitioner Licensure",
      actionText: "Reject Application",
      buttonClass: "dialog-btn-reject",
      icon: XCircle,
      requiresReason: true,
      reasonPlaceholder:
        "Mandatory: Document reason for declining credentials (e.g. invalid medical council registration, expired documentation)...",
      explanation:
        "State medical licensure verification has failed. The doctor will not be permitted to conduct consultations.",
    };
  }

  if (currentStatus === "approved" && targetStatus === "suspended") {
    return {
      title: "Suspend Clinical Privileges",
      actionText: "Suspend Practitioner",
      buttonClass: "dialog-btn-suspend",
      icon: ShieldAlert,
      requiresReason: true,
      reasonPlaceholder:
        "Mandatory: Document clinical justification or regulatory directive for suspension...",
      explanation:
        "Suspending a practitioner immediately halts their consultation and clinical operations across the platform.",
      warningNotice:
        "CRITICAL CLINICAL NOTICE: Suspending this medical practitioner will immediately revoke their authorization to consult patients, accept appointments, or issue digital prescriptions. Existing booked appointments will require administrative triage.",
    };
  }

  if (currentStatus === "rejected" && targetStatus === "pending") {
    return {
      title: "Reopen Licensure Review",
      actionText: "Reopen for Review",
      buttonClass: "dialog-btn-reopen",
      icon: Clock,
      requiresReason: true,
      reasonPlaceholder:
        "Mandatory: State justification for reopening rejected credentials (e.g. updated certificate received from state medical council)...",
      explanation:
        "Transitions the practitioner back to pending review status for re-evaluation by the clinical governance team.",
    };
  }

  if (currentStatus === "suspended" && targetStatus === "pending") {
    return {
      title: "Reinstate Practitioner to Review Queue",
      actionText: "Reinstate to Pending",
      buttonClass: "dialog-btn-reopen",
      icon: Clock,
      requiresReason: true,
      reasonPlaceholder:
        "Mandatory: State justification for lifting suspension to pending review (e.g. regulatory inquiry cleared, compliance rectified)...",
      explanation:
        "Restores the practitioner to pending review status. A subsequent formal approval is required before clinical privileges are fully restored.",
    };
  }

  return {
    title: `Transition to ${targetStatus}`,
    actionText: `Update to ${targetStatus}`,
    buttonClass: "dialog-btn-default",
    icon: AlertCircle,
    requiresReason: true,
    reasonPlaceholder: "Enter reason for status transition...",
    explanation: `Transition verification status from '${currentStatus}' to '${targetStatus}'.`,
  };
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

export default function DoctorVerificationDialog({
  doctor,
  targetStatus,
  isOpen,
  onClose,
  onSuccess,
  onConflict,
}: DoctorVerificationDialogProps) {
  const [reason, setReason] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isConflict, setIsConflict] = useState<boolean>(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus textarea when opened
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !doctor || !targetStatus) {
    return null;
  }

  const meta = getTransitionMetadata(doctor.verification_status, targetStatus);
  const ActionIcon = meta.icon;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setServerError(null);

    const cleanReason = reason.trim();

    // Reason validation
    if (meta.requiresReason && cleanReason.length < 5) {
      setValidationError(
        "A meaningful explanation of at least 5 characters is required for this status change.",
      );
      textareaRef.current?.focus();
      return;
    }

    const payload: DoctorVerificationUpdatePayload = {
      verification_status: targetStatus,
      reason: cleanReason.length > 0 ? cleanReason : null,
    };

    setIsSubmitting(true);

    try {
      // NOTE: doctor.id is DoctorProfile.id (UUID), NEVER doctor.user_id
      const updatedProfile = await adminService.reviewDoctor(doctor.id, payload);
      onSuccess(updatedProfile);
      onClose();
    } catch (err: unknown) {
      const isStatus409 =
        err &&
        typeof err === "object" &&
        "response" in err &&
        (err as { response?: { status?: number } }).response?.status === 409;

      if (isStatus409) {
        setIsConflict(true);
        setServerError(
          "Conflict: This practitioner's verification status or linked account was modified concurrently. The directory has been reloaded with the latest database state.",
        );
        if (onConflict) {
          onConflict();
        }
      } else {
        const errorDetail = extractErrorMessage(
          err,
          "Failed to update verification status. Please verify administrator permissions and try again.",
        );
        setServerError(errorDetail);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="verification-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-dialog-title"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="verification-dialog-container"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="verification-dialog-header">
          <div className="verification-dialog-header-left">
            <div className="verification-dialog-kicker">
              <ActionIcon size={14} className="dialog-kicker-icon" />
              <span>LIFECYCLE TRANSITION</span>
            </div>
            <h2 id="verification-dialog-title" className="verification-dialog-title">
              {meta.title}
            </h2>
          </div>
          <button
            type="button"
            className="verification-dialog-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close verification dialog"
          >
            <X size={18} />
          </button>
        </header>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="verification-dialog-form">
          <div className="verification-dialog-body">
            {/* Target Practitioner Summary Box */}
            <div className="dialog-doctor-summary-box">
              <div className="dialog-doctor-name">{doctor.full_name}</div>
              <div className="dialog-doctor-meta">
                <span>{doctor.specialization}</span>
                <span className="dialog-meta-divider">·</span>
                <span>License: {doctor.license_number}</span>
                <span className="dialog-meta-divider">·</span>
                <span className="dialog-current-status">
                  Current: <strong>{doctor.verification_status.toUpperCase()}</strong>
                </span>
              </div>
            </div>

            {/* Explanation Note */}
            <p className="dialog-explanation-text">{meta.explanation}</p>

            {/* Suspension Warning Callout */}
            {meta.warningNotice && (
              <div className="dialog-warning-callout" role="alert">
                <AlertTriangle size={18} className="dialog-warning-icon" />
                <div className="dialog-warning-content">
                  <strong>Clinical Revocation Notice</strong>
                  <p>{meta.warningNotice}</p>
                </div>
              </div>
            )}

            {/* Server Error Alert */}
            {serverError && (
              <div
                className={`dialog-error-callout ${isConflict ? "conflict" : ""}`}
                role="alert"
              >
                <AlertCircle size={18} className="dialog-error-icon" />
                <div className="dialog-error-content">
                  <strong>{isConflict ? "Concurrent Modification" : "Verification Failed"}</strong>
                  <p>{serverError}</p>
                </div>
              </div>
            )}

            {/* Reason Textarea Input */}
            <div className="dialog-field-group">
              <label
                htmlFor="verification-reason-input"
                className="dialog-field-label"
              >
                <span>Administrative Reason / Clinical Rationale</span>
                {meta.requiresReason ? (
                  <span className="dialog-badge-required">Mandatory</span>
                ) : (
                  <span className="dialog-badge-optional">Optional</span>
                )}
              </label>
              <textarea
                id="verification-reason-input"
                ref={textareaRef}
                className={`dialog-textarea ${validationError ? "has-error" : ""}`}
                rows={3}
                placeholder={meta.reasonPlaceholder}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                disabled={isSubmitting}
                maxLength={500}
              />
              <div className="dialog-field-footer">
                {validationError ? (
                  <span className="dialog-validation-error">{validationError}</span>
                ) : (
                  <span className="dialog-char-hint">
                    {meta.requiresReason
                      ? "Minimum 5 characters required for administrative audit log."
                      : "Audit log records actor, timestamp, and optional administrative notes."}
                  </span>
                )}
                <span className="dialog-char-count">{reason.length}/500</span>
              </div>
            </div>
          </div>

          {/* Dialog Action Buttons */}
          <footer className="verification-dialog-footer">
            <button
              type="button"
              className="dialog-btn-cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`dialog-btn-submit ${meta.buttonClass}`}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={15} className="spin-animation" />
                  <span>Updating Verification...</span>
                </>
              ) : (
                <>
                  <ActionIcon size={15} />
                  <span>{meta.actionText}</span>
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

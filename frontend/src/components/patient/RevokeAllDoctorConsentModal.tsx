import {
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import {
  AlertCircle,
  AlertTriangle,
  FileCheck2,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  ShieldOff,
  Stethoscope,
  X,
} from "lucide-react";

import { consentService } from "../../services/consentService";
import type {
  ConsentDoctor,
  HealthDataScope,
  PatientConsent,
} from "../../types/consent";
import "./RevokeAllDoctorConsentModal.css";

export interface RevokeAllDoctorConsentModalProps {
  isOpen: boolean;
  doctorProfileId: string;
  doctor?: ConsentDoctor | null;
  activeGrantsCount: number;
  authorizedScopesUnion: HealthDataScope[];
  isHistoryComplete?: boolean;
  onClose: () => void;
  onSuccess: (revokedConsents: PatientConsent[], message: string) => void;
  onCheckStatus?: () => void;
}

const SCOPE_LABELS: Record<HealthDataScope, string> = {
  visit_summary: "Visit summary",
  chief_complaint: "Chief complaint",
  symptoms: "Symptoms",
  diagnosis: "Diagnosis",
  clinical_notes: "Clinical notes",
  treatment_plan: "Treatment plan",
  follow_up_instructions: "Follow-up instructions",
};

function extractErrorMessage(err: unknown, fallback: string): {
  message: string;
  isNetworkOrTimeout: boolean;
} {
  if (axios.isAxiosError(err)) {
    // Check if network error or timeout
    const isTimeout =
      err.code === "ECONNABORTED" ||
      err.message.toLowerCase().includes("timeout") ||
      !err.response;

    const detail = err.response?.data?.detail;
    if (typeof detail === "string") {
      return { message: detail, isNetworkOrTimeout: isTimeout };
    }
    if (Array.isArray(detail)) {
      return {
        message: detail
          .map((item) =>
            typeof item === "object" && item && "msg" in item
              ? String(item.msg)
              : JSON.stringify(item),
          )
          .join("; "),
        isNetworkOrTimeout: isTimeout,
      };
    }
    if (err.response?.status === 401) {
      return {
        message: "Your session has expired. Please log in again to continue.",
        isNetworkOrTimeout: false,
      };
    }
    if (err.response?.status === 403) {
      return {
        message: "You are not authorized to revoke permissions for this doctor.",
        isNetworkOrTimeout: false,
      };
    }
    if (err.response?.status === 404) {
      return {
        message:
          "No active consent records were found for this doctor. Permissions may have already been revoked.",
        isNetworkOrTimeout: false,
      };
    }
    if (err.response?.status === 409) {
      return {
        message:
          "Consent records are currently being modified or have already been revoked. Please refresh your dashboard.",
        isNetworkOrTimeout: false,
      };
    }
    if (isTimeout) {
      return {
        message:
          "The network request timed out. To prevent duplicate revocations, please check your current consent status before retrying.",
        isNetworkOrTimeout: true,
      };
    }
  }
  if (err instanceof Error) {
    return { message: err.message, isNetworkOrTimeout: false };
  }
  return { message: fallback, isNetworkOrTimeout: false };
}

export default function RevokeAllDoctorConsentModal({
  isOpen,
  doctorProfileId,
  doctor,
  activeGrantsCount,
  authorizedScopesUnion,
  isHistoryComplete = true,
  onClose,
  onSuccess,
  onCheckStatus,
}: RevokeAllDoctorConsentModalProps) {
  // Two-stage confirmation experience:
  // Stage 1: "review" (review all active grants and scopes union)
  // Stage 2: "confirm_destructive" (final explicit confirmation before firing API)
  const [stage, setStage] = useState<"review" | "confirm_destructive">("review");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isNetworkTimeoutError, setIsNetworkTimeoutError] = useState<boolean>(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Focus tracking and state reset
  useEffect(() => {
    if (isOpen) {
      previousActiveElementRef.current = document.activeElement as HTMLElement;
      setStage("review");
      setErrorMessage(null);
      setIsNetworkTimeoutError(false);
      setIsSubmitting(false);
    } else if (previousActiveElementRef.current) {
      previousActiveElementRef.current.focus();
    }
  }, [isOpen, doctorProfileId]);

  // Trap focus and handle escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!isSubmitting) {
          onClose();
        }
        return;
      }

      if (event.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement.focus();
            event.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement.focus();
            event.preventDefault();
          }
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  async function handleExecuteRevokeAll() {
    if (!doctorProfileId || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setIsNetworkTimeoutError(false);

    try {
      const response = await consentService.revokeAllConsentsForDoctor(doctorProfileId);
      const doctorName = doctor?.full_name ? `Dr. ${doctor.full_name}` : "the doctor";
      const revokedCount = response.items.length;
      const successMessage = `All EHR access for ${doctorName} has been completely revoked (${revokedCount} active grant${revokedCount === 1 ? "" : "s"} closed).`;

      onSuccess(response.items, successMessage);
      onClose();
    } catch (err) {
      const { message, isNetworkOrTimeout } = extractErrorMessage(
        err,
        "Unable to complete doctor-wide consent revocation. Please check your network and try again.",
      );
      setErrorMessage(message);
      setIsNetworkTimeoutError(isNetworkOrTimeout);
      // Stay on modal so user can read message or click status check
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const doctorDisplayName = doctor?.full_name
    ? `Dr. ${doctor.full_name}`
    : "Doctor (details unavailable)";
  const doctorSpecialty =
    doctor?.specialization || "Clinical Specialist";
  const clinicName = doctor?.clinic_name || "ANVAYA Partner Clinic";

  return createPortal(
    <div
      className="revoke-all-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        className="revoke-all-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revoke-all-modal-title"
        aria-describedby="revoke-all-modal-desc"
        tabIndex={-1}
      >
        {/* Header */}
        <header className="revoke-all-header">
          <div className="revoke-all-title-group">
            <span className="revoke-all-kicker">
              <ShieldAlert size={14} />
              DOCTOR-WIDE PERMISSION REVOCATION
            </span>
            <h2 id="revoke-all-modal-title">
              {stage === "review"
                ? "Revoke All Access for Doctor"
                : "Confirm Complete Access Withdrawal"}
            </h2>
            <p id="revoke-all-modal-desc" className="revoke-all-subtitle">
              {stage === "review"
                ? `Review active EHR permissions currently held by ${doctorDisplayName}.`
                : `Final confirmation to revoke all access for ${doctorDisplayName}.`}
            </p>
          </div>

          <button
            type="button"
            className="revoke-all-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>

        {/* Body */}
        <div className="revoke-all-body">
          {/* Doctor Banner */}
          <section className="revoke-all-doctor-banner">
            <div className="revoke-all-doc-avatar">
              <Stethoscope size={24} />
            </div>
            <div className="revoke-all-doc-info">
              <strong className="revoke-all-doc-name">
                {doctorDisplayName}
              </strong>
              <span className="revoke-all-doc-meta">
                {doctorSpecialty} · {clinicName}
              </span>
              <div className="revoke-all-grant-count-pill">
                <LockKeyhole size={13} />
                <span>
                  {activeGrantsCount} Active Grant{activeGrantsCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </section>

          {/* Incomplete History Warning Banner */}
          {!isHistoryComplete && (
            <div className="revoke-all-alert warning" role="alert">
              <AlertTriangle size={20} />
              <div className="revoke-all-alert-content">
                <strong>Consent History Incomplete</strong>
                <p>
                  Your complete consent records could not be verified due to a partial load.
                  Doctor-wide revocation is disabled to prevent unintended changes until you refresh and verify all active permissions.
                </p>
                {onCheckStatus && (
                  <button
                    type="button"
                    className="revoke-all-btn-check-status"
                    onClick={() => {
                      onCheckStatus();
                      onClose();
                    }}
                    style={{ marginTop: "8px" }}
                  >
                    <RefreshCw size={14} />
                    Retry Loading Full History
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Error Alert */}
          {errorMessage && (
            <div className="revoke-all-alert error" role="alert">
              <AlertCircle size={20} />
              <div className="revoke-all-alert-content">
                <strong>Action Incomplete</strong>
                <p>{errorMessage}</p>
                {isNetworkTimeoutError && (
                  <div className="revoke-all-timeout-actions">
                    <p className="revoke-all-timeout-warning">
                      <strong>Safety Check:</strong> The server may have processed your request before the connection was lost.
                      We recommend checking the current state to avoid duplicate or conflicting updates.
                    </p>
                    {onCheckStatus && (
                      <button
                        type="button"
                        className="revoke-all-btn-check-status"
                        onClick={() => {
                          onCheckStatus();
                          onClose();
                        }}
                      >
                        <RefreshCw size={14} />
                        Check Current Consent State
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="revoke-all-alert-dismiss"
                onClick={() => setErrorMessage(null)}
                aria-label="Dismiss error"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {/* STAGE 1: REVIEW ACTIVE PERMISSIONS */}
          {stage === "review" && (
            <div className="revoke-all-stage-container">
              {/* Union of authorized scopes */}
              <section className="revoke-all-scopes-card">
                <span className="revoke-all-scopes-caption">
                  <FileCheck2 size={16} />
                  Currently Authorized Data Categories ({authorizedScopesUnion.length}):
                </span>
                {authorizedScopesUnion.length > 0 ? (
                  <div className="revoke-all-chips">
                    {authorizedScopesUnion.map((scope) => (
                      <span key={scope} className="revoke-all-chip">
                        {SCOPE_LABELS[scope] || scope}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="revoke-all-no-scopes">
                    No active scopes found for this doctor.
                  </p>
                )}
              </section>

              {/* Comprehensive Impact Disclosure */}
              <div className="revoke-all-impact-card">
                <span className="revoke-all-impact-title">
                  <ShieldOff size={16} />
                  What happens when you confirm:
                </span>
                <ul className="revoke-all-impact-list">
                  <li>
                    <strong>Immediate Access Withdrawal:</strong> All {activeGrantsCount} active
                    consent grant(s) will be marked as revoked. {doctorDisplayName} will
                    immediately lose access to all clinical records.
                  </li>
                  <li>
                    <strong>New Grant Required for Future Access:</strong> The doctor will not be
                    able to view any EHR categories unless you explicitly grant new consent or
                    approve a new request in the future.
                  </li>
                  <li>
                    <strong>Appointments & Care Preserved:</strong> Scheduled appointments and
                    consultations with this doctor remain booked. Revocation strictly governs
                    medical record viewing.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* STAGE 2: FINAL CONFIRMATION (DESTRUCTIVE) */}
          {stage === "confirm_destructive" && (
            <div className="revoke-all-stage-container">
              <div className="revoke-all-warning-banner">
                <div className="revoke-all-warning-icon">
                  <AlertTriangle size={30} />
                </div>
                <h3>Are you absolutely sure?</h3>
                <p>
                  You are about to completely withdraw all EHR access from{" "}
                  <strong>{doctorDisplayName}</strong>.
                </p>
                <div className="revoke-all-warning-details">
                  <p>
                    • Total active grants being revoked: <strong>{activeGrantsCount}</strong>
                  </p>
                  <p>
                    • Categories affected:{" "}
                    <strong>
                      {authorizedScopesUnion.map((s) => SCOPE_LABELS[s] || s).join(", ")}
                    </strong>
                  </p>
                  <p>• This action is immediate and irrevocable without a new grant.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <footer className="revoke-all-footer">
          {stage === "review" && (
            <>
              <button
                type="button"
                className="revoke-all-btn-secondary"
                disabled={isSubmitting}
                onClick={onClose}
              >
                Cancel
              </button>

              <button
                type="button"
                className="revoke-all-btn-danger"
                disabled={isSubmitting || activeGrantsCount === 0 || !isHistoryComplete}
                onClick={() => {
                  setErrorMessage(null);
                  setStage("confirm_destructive");
                }}
              >
                <ShieldOff size={16} />
                {!isHistoryComplete ? "Disabled: Incomplete History" : "Proceed to Revoke All Access"}
              </button>
            </>
          )}

          {stage === "confirm_destructive" && (
            <>
              <button
                type="button"
                className="revoke-all-btn-secondary"
                disabled={isSubmitting}
                onClick={() => {
                  setErrorMessage(null);
                  setStage("review");
                }}
              >
                Back to Review
              </button>

              <button
                type="button"
                className="revoke-all-btn-danger confirm"
                disabled={isSubmitting || !isHistoryComplete}
                onClick={() => void handleExecuteRevokeAll()}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={16} className="revoke-all-spin" />
                    Revoking All Access...
                  </>
                ) : !isHistoryComplete ? (
                  "Disabled: Incomplete History"
                ) : (
                  <>
                    <ShieldOff size={16} />
                    Confirm Revoke All Access
                  </>
                )}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  FileCheck2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Stethoscope,
  X,
} from "lucide-react";

import { consentService } from "../../services/consentService";
import type {
  ConsentRequestRead,
  ConsentRequestRespond,
  HealthDataScope,
} from "../../types/consent";
import { formatDoctorDisplayName } from "../../utils/formatters";
import "./PatientConsentResponseModal.css";

export interface PatientConsentResponseModalProps {
  isOpen: boolean;
  request: ConsentRequestRead | null;
  initialMode?: "review" | "decline";
  onClose: () => void;
  onResolved: (updatedRequest: ConsentRequestRead, message: string) => void;
}

interface ScopeMetadata {
  label: string;
  description: string;
  category: string;
}

const SCOPE_DETAILS: Record<HealthDataScope, ScopeMetadata> = {
  visit_summary: {
    label: "Visit Summary",
    description: "Summary overview of previous consultations, diagnoses, and visit milestones.",
    category: "General",
  },
  chief_complaint: {
    label: "Chief Complaint",
    description: "The primary clinical concern documented during your check-in.",
    category: "Intake",
  },
  symptoms: {
    label: "Reported Symptoms",
    description: "Documented symptoms and physiological signs reported to your providers.",
    category: "Clinical Data",
  },
  diagnosis: {
    label: "Diagnoses",
    description: "Confirmed clinical diagnoses and condition classifications.",
    category: "Clinical Data",
  },
  clinical_notes: {
    label: "Clinical Notes",
    description: "Doctor observations, encounter remarks, and progress notations.",
    category: "Provider Notes",
  },
  treatment_plan: {
    label: "Treatment Plan",
    description: "Therapeutic plans, medication orders, and scheduled clinical procedures.",
    category: "Treatment",
  },
  follow_up_instructions: {
    label: "Follow-Up Instructions",
    description: "Post-consultation directions, home monitoring, and return schedules.",
    category: "Instructions",
  },
};

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not specified";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getExpiryWarning(expiresAtStr: string): {
  isExpiringSoon: boolean;
  label: string;
} {
  const expiresAt = new Date(expiresAtStr).getTime();
  const now = Date.now();
  const diffMs = expiresAt - now;

  if (diffMs <= 0) {
    return { isExpiringSoon: true, label: "Expired" };
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 24) {
    return {
      isExpiringSoon: true,
      label: `Expires in ${hours}h ${Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))}m`,
    };
  }

  const days = Math.floor(hours / 24);
  return {
    isExpiringSoon: false,
    label: `Expires in ${days} day${days > 1 ? "s" : ""}`,
  };
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
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
    if (err.response?.status === 401) {
      return "Your session has expired. Please log in again to continue.";
    }
    if (err.response?.status === 403) {
      return "You are not authorized to respond to this consent request.";
    }
    if (err.response?.status === 404) {
      return "This consent request was not found or has already been resolved.";
    }
    if (err.response?.status === 409) {
      return "This consent request is no longer pending (it may have been resolved or expired).";
    }
    if (err.response?.status === 422) {
      return "Invalid response format. Please verify your selected permissions.";
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export default function PatientConsentResponseModal({
  isOpen,
  request,
  initialMode = "review",
  onClose,
  onResolved,
}: PatientConsentResponseModalProps) {
  // Modal view modes:
  // - "review": Patient reviews scopes and chooses checkboxes (all initially unchecked - opt-in)
  // - "confirm_approval": Confirmation screen before final approval submission
  // - "confirm_decline": Confirmation screen before final decline submission
  const [viewMode, setViewMode] = useState<
    "review" | "confirm_approval" | "confirm_decline"
  >(initialMode === "decline" ? "confirm_decline" : "review");

  // Opt-in principle: all scopes initially unchecked
  const [selectedScopes, setSelectedScopes] = useState<HealthDataScope[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Stable idempotency key per logical submission attempt
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Reset state whenever opening or changing request
  useEffect(() => {
    if (isOpen && request) {
      previousActiveElementRef.current = document.activeElement as HTMLElement;
      setSelectedScopes([]); // Strict Opt-In: always start unchecked
      setViewMode(initialMode === "decline" ? "confirm_decline" : "review");
      setErrorMessage(null);
      setIsSubmitting(false);
      idempotencyKeyRef.current = generateIdempotencyKey();
    } else {
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    }
  }, [isOpen, request, initialMode]);

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

  const requestedScopes = useMemo(
    () => request?.requested_scopes ?? [],
    [request?.requested_scopes],
  );

  const isAllSelected = useMemo(
    () =>
      requestedScopes.length > 0 &&
      requestedScopes.every((scope) => selectedScopes.includes(scope)),
    [requestedScopes, selectedScopes],
  );

  const unselectedScopes = useMemo(
    () => requestedScopes.filter((scope) => !selectedScopes.includes(scope)),
    [requestedScopes, selectedScopes],
  );

  // Toggle individual scope
  const handleToggleScope = useCallback(
    (scope: HealthDataScope) => {
      setErrorMessage(null);
      // New payload shape -> generate fresh idempotency key
      idempotencyKeyRef.current = generateIdempotencyKey();
      setSelectedScopes((current) =>
        current.includes(scope)
          ? current.filter((item) => item !== scope)
          : [...current, scope],
      );
    },
    [],
  );

  // Quick actions
  const handleSelectAll = useCallback(() => {
    setErrorMessage(null);
    idempotencyKeyRef.current = generateIdempotencyKey();
    setSelectedScopes([...requestedScopes]);
  }, [requestedScopes]);

  const handleClearAll = useCallback(() => {
    setErrorMessage(null);
    idempotencyKeyRef.current = generateIdempotencyKey();
    setSelectedScopes([]);
  }, []);

  // Submit Approval (Full or Partial)
  async function submitApproval() {
    if (!request || selectedScopes.length === 0) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const isFullApproval = selectedScopes.length === requestedScopes.length;
    const payload: ConsentRequestRespond = {
      action: "approve",
      approved_scopes: selectedScopes,
      idempotency_key: idempotencyKeyRef.current,
    };

    try {
      const result = await consentService.respondToConsentRequest(
        request.id,
        payload,
        idempotencyKeyRef.current,
      );

      const doctorName = formatDoctorDisplayName(
        request.doctor_name,
        "the requesting doctor",
      );
      const successMsg = isFullApproval
        ? `Consent request from ${doctorName} was fully approved. Authorized all ${selectedScopes.length} requested scopes.`
        : `Consent request from ${doctorName} was partially approved. Authorized ${selectedScopes.length} of ${requestedScopes.length} requested scopes.`;

      onResolved(result, successMsg);
      onClose();
    } catch (err) {
      setErrorMessage(
        extractErrorMessage(
          err,
          "Unable to approve the consent request. Please try again.",
        ),
      );
      // Stay on confirm screen so user can retry or adjust
    } finally {
      setIsSubmitting(false);
    }
  }

  // Submit Decline
  async function submitDecline() {
    if (!request) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const payload: ConsentRequestRespond = {
      action: "decline",
      approved_scopes: null,
      idempotency_key: idempotencyKeyRef.current,
    };

    try {
      const result = await consentService.respondToConsentRequest(
        request.id,
        payload,
        idempotencyKeyRef.current,
      );

      const doctorName = formatDoctorDisplayName(
        request.doctor_name,
        "the doctor",
      );
      const successMsg = `Consent request from ${doctorName} has been declined. No additional health records were shared through this request. Any pre-existing active permissions remain active and unaffected.`;

      onResolved(result, successMsg);
      onClose();
    } catch (err) {
      setErrorMessage(
        extractErrorMessage(
          err,
          "Unable to decline the consent request. Please try again.",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen || !request) return null;

  const doctorDisplayName = formatDoctorDisplayName(
    request.doctor_name,
    "Healthcare Provider",
  );
  const doctorSpecialty =
    request.doctor_specialization || "Clinical Specialist";
  const clinicName = request.clinic_name || "ANVAYA Partner Clinic";
  const expiryInfo = getExpiryWarning(request.expires_at);

  return createPortal(
    <div
      className="patient-response-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        className="patient-response-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="patient-response-modal-title"
        aria-describedby="patient-response-modal-desc"
        tabIndex={-1}
      >
        {/* Modal Header */}
        <header className="patient-response-header">
          <div className="patient-response-title-group">
            <span className="patient-response-kicker">
              <LockKeyhole size={14} />
              CLINICAL EHR ACCESS DECISION
            </span>
            <h2 id="patient-response-modal-title">
              {viewMode === "confirm_approval"
                ? "Confirm Consent Authorization"
                : viewMode === "confirm_decline"
                  ? "Confirm Request Decline"
                  : "Doctor EHR Access Request"}
            </h2>
            <p id="patient-response-modal-desc" className="patient-response-subtitle">
              {viewMode === "confirm_approval"
                ? "Verify the health-record permissions you are granting."
                : viewMode === "confirm_decline"
                  ? "Ensure you wish to decline this physician's access request."
                  : "Review requested health data scopes and decide what you want to share."}
            </p>
          </div>

          <button
            type="button"
            className="patient-response-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>

        {/* Modal Body */}
        <div className="patient-response-body">
          {/* Doctor Identity Banner */}
          <section className="patient-response-doctor-banner">
            <div className="patient-response-doc-avatar">
              <Stethoscope size={24} />
            </div>
            <div className="patient-response-doc-info">
              <div className="patient-response-doc-name-row">
                <strong className="patient-response-doc-name">
                  {doctorDisplayName}
                </strong>
                <span className="patient-response-doc-badge">Verified Doctor</span>
              </div>
              <span className="patient-response-doc-meta">
                {doctorSpecialty} · {clinicName}
              </span>
              <div className="patient-response-dates-row">
                <span className="patient-response-date-item">
                  <Clock3 size={13} />
                  Requested: {formatDateTime(request.created_at)}
                </span>
                <span
                  className={`patient-response-date-item ${
                    expiryInfo.isExpiringSoon ? "expiring" : ""
                  }`}
                >
                  <AlertCircle size={13} />
                  {expiryInfo.label}
                </span>
              </div>
            </div>
          </section>

          {/* Doctor Message Quote (if present) */}
          {request.doctor_message && (
            <section className="patient-response-message-box">
              <span className="patient-response-message-label">
                Doctor's Clinical Note:
              </span>
              <blockquote className="patient-response-message-text">
                "{request.doctor_message}"
              </blockquote>
            </section>
          )}

          {/* Inline Error Alert */}
          {errorMessage && (
            <div className="patient-response-alert error" role="alert">
              <AlertTriangle size={18} />
              <div className="patient-response-alert-content">
                <strong>Action Failed</strong>
                <p>{errorMessage}</p>
              </div>
              <button
                type="button"
                className="patient-response-alert-dismiss"
                onClick={() => setErrorMessage(null)}
                aria-label="Dismiss error"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {/* MODE 1: REVIEW & SCOPE SELECTION */}
          {viewMode === "review" && (
            <div className="patient-response-review-container">
              {/* Privacy Advisory */}
              <div className="patient-response-advisory">
                <ShieldCheck size={18} className="patient-response-advisory-icon" />
                <div>
                  <strong>Opt-in granular consent</strong>
                  <p>
                    Select only the information you are comfortable sharing. All
                    items are unchecked by default. You can revoke access at any
                    time from your dashboard.
                  </p>
                </div>
              </div>

              {/* Scopes Section Header */}
              <div className="patient-response-scopes-header">
                <div>
                  <h3 className="patient-response-section-heading">
                    Requested Health Information
                  </h3>
                  <span className="patient-response-scopes-counter">
                    <strong>{selectedScopes.length}</strong> of{" "}
                    <strong>{requestedScopes.length}</strong> permissions selected
                  </span>
                </div>

                <div className="patient-response-quick-actions">
                  <button
                    type="button"
                    className="patient-response-link-btn"
                    onClick={handleSelectAll}
                    disabled={isSubmitting || isAllSelected}
                  >
                    Select All
                  </button>
                  <span className="patient-response-btn-divider">|</span>
                  <button
                    type="button"
                    className="patient-response-link-btn"
                    onClick={handleClearAll}
                    disabled={isSubmitting || selectedScopes.length === 0}
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {/* Scope Selection Cards List */}
              <div
                className="patient-response-scope-list"
                role="group"
                aria-label="Requested health data permissions"
              >
                {requestedScopes.map((scope) => {
                  const meta = SCOPE_DETAILS[scope] || {
                    label: scope,
                    description: "Clinical health data category.",
                    category: "General",
                  };
                  const isChecked = selectedScopes.includes(scope);

                  return (
                    <label
                      key={scope}
                      className={`patient-response-scope-card ${
                        isChecked ? "checked" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isSubmitting}
                        onChange={() => handleToggleScope(scope)}
                        aria-label={`Share ${meta.label}`}
                      />
                      <div className="patient-response-checkbox-custom">
                        {isChecked ? <Check size={14} strokeWidth={3} /> : null}
                      </div>
                      <div className="patient-response-scope-copy">
                        <div className="patient-response-scope-title-row">
                          <strong className="patient-response-scope-title">
                            {meta.label}
                          </strong>
                          <span className="patient-response-scope-tag">
                            {meta.category}
                          </span>
                        </div>
                        <p className="patient-response-scope-desc">
                          {meta.description}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* MODE 2: CONFIRM APPROVAL */}
          {viewMode === "confirm_approval" && (
            <div className="patient-response-confirm-container">
              <div className="patient-response-confirm-summary-card">
                <div className="patient-response-confirm-badge-row">
                  <span className="patient-response-badge success">
                    <CheckCircle2 size={15} />
                    {selectedScopes.length === requestedScopes.length
                      ? "Full Approval"
                      : "Partial Approval"}
                  </span>
                  <span className="patient-response-confirm-count">
                    {selectedScopes.length} of {requestedScopes.length} scopes
                    authorized
                  </span>
                </div>

                <div className="patient-response-confirm-party">
                  <span>Authorized Doctor:</span>
                  <strong>{doctorDisplayName}</strong>
                </div>

                {/* Approved Scopes */}
                <div className="patient-response-confirm-section">
                  <span className="patient-response-confirm-section-title green">
                    <CheckCircle2 size={15} />
                    Information that WILL be shared:
                  </span>
                  <ul className="patient-response-confirm-list allowed">
                    {selectedScopes.map((scope) => (
                      <li key={scope}>
                        <strong>{SCOPE_DETAILS[scope]?.label || scope}</strong>
                        <small> — {SCOPE_DETAILS[scope]?.description}</small>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Unapproved Scopes (if partial) */}
                {unselectedScopes.length > 0 && (
                  <div className="patient-response-confirm-section">
                    <span className="patient-response-confirm-section-title gray">
                      <ShieldOff size={15} />
                      Information that will NOT be shared (withheld):
                    </span>
                    <ul className="patient-response-confirm-list withheld">
                      {unselectedScopes.map((scope) => (
                        <li key={scope}>
                          <span>{SCOPE_DETAILS[scope]?.label || scope}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="patient-response-confirm-legal">
                <FileCheck2 size={16} />
                <p>
                  By confirming, you grant {doctorDisplayName} view-only access
                  to the approved records. This permission remains active until
                  you revoke it.
                </p>
              </div>
            </div>
          )}

          {/* MODE 3: CONFIRM DECLINE */}
          {viewMode === "confirm_decline" && (
            <div className="patient-response-confirm-container">
              <div className="patient-response-decline-warning-card">
                <div className="patient-response-decline-icon-wrap">
                  <ShieldOff size={28} />
                </div>
                <h3>Decline EHR Access Request</h3>
                <p>
                  You are declining the request from <strong>{doctorDisplayName}</strong>{" "}
                  for clinical record permissions.
                </p>
                <div className="patient-response-decline-reassurance">
                  <ul>
                    <li>The doctor will <strong>not</strong> receive access to the new records requested in this proposal.</li>
                    <li><strong>Existing access unaffected:</strong> Any previously authorized active consents remain active until explicitly revoked.</li>
                    <li>Scheduled appointments and clinical care continue unchanged.</li>
                    <li>The doctor can submit a new request if clinical needs change.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <footer className="patient-response-footer">
          {viewMode === "review" && (
            <>
              <button
                type="button"
                className="patient-response-btn-decline-link"
                disabled={isSubmitting}
                onClick={() => {
                  setErrorMessage(null);
                  setViewMode("confirm_decline");
                }}
              >
                <ShieldOff size={16} />
                Decline Request
              </button>

              <div className="patient-response-action-buttons">
                <button
                  type="button"
                  className="patient-response-btn-secondary"
                  disabled={isSubmitting}
                  onClick={onClose}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="patient-response-btn-primary"
                  disabled={isSubmitting || selectedScopes.length === 0}
                  onClick={() => {
                    setErrorMessage(null);
                    setViewMode("confirm_approval");
                  }}
                >
                  <ShieldCheck size={17} />
                  {selectedScopes.length === 0
                    ? "Select permissions to approve"
                    : selectedScopes.length === requestedScopes.length
                      ? `Approve All (${selectedScopes.length}) Scopes`
                      : `Approve Selected (${selectedScopes.length}) Scopes`}
                </button>
              </div>
            </>
          )}

          {viewMode === "confirm_approval" && (
            <>
              <button
                type="button"
                className="patient-response-btn-secondary"
                disabled={isSubmitting}
                onClick={() => {
                  setErrorMessage(null);
                  setViewMode("review");
                }}
              >
                Back to Scope Selection
              </button>

              <button
                type="button"
                className="patient-response-btn-primary confirm"
                disabled={isSubmitting}
                onClick={() => void submitApproval()}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={17} className="patient-response-spin" />
                    Authorizing Permissions...
                  </>
                ) : (
                  <>
                    <ShieldCheck size={17} />
                    Confirm & Grant Access
                  </>
                )}
              </button>
            </>
          )}

          {viewMode === "confirm_decline" && (
            <>
              <button
                type="button"
                className="patient-response-btn-secondary"
                disabled={isSubmitting}
                onClick={() => {
                  setErrorMessage(null);
                  setViewMode("review");
                }}
              >
                Back to Review
              </button>

              <button
                type="button"
                className="patient-response-btn-danger"
                disabled={isSubmitting}
                onClick={() => void submitDecline()}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={17} className="patient-response-spin" />
                    Declining Request...
                  </>
                ) : (
                  <>
                    <ShieldOff size={17} />
                    Confirm Decline
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

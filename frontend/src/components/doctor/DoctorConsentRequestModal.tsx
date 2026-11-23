import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import {
  AlertCircle,
  CheckCircle2,
  FolderLock,
  Info,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";

import { consentService } from "../../services/consentService";
import type {
  ConsentRequestCreate,
  ConsentRequestRead,
  HealthDataScope,
} from "../../types/consent";
import "./DoctorConsentRequestModal.css";

export interface DoctorConsentRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientProfileId: string;
  patientName: string;
  activeScopes?: HealthDataScope[];
  prefillScopes?: HealthDataScope[];
  onSuccess: (request: ConsentRequestRead) => void;
}

interface ScopeDescriptor {
  scope: HealthDataScope;
  label: string;
  description: string;
}

const ALL_SCOPES_METADATA: ScopeDescriptor[] = [
  {
    scope: "visit_summary",
    label: "Visit Summary",
    description: "Summary overview of previous consultations, diagnoses and clinical outcomes.",
  },
  {
    scope: "chief_complaint",
    label: "Chief Complaint",
    description: "Primary concern and symptoms documented at initial encounter check-in.",
  },
  {
    scope: "symptoms",
    label: "Symptoms",
    description: "Documented subjective patient symptoms and clinical observations.",
  },
  {
    scope: "diagnosis",
    label: "Diagnosis",
    description: "Formal medical assessments and diagnostic codes established by providers.",
  },
  {
    scope: "clinical_notes",
    label: "Clinical Notes",
    description: "Practitioner progress notes, clinical commentary and internal observations.",
  },
  {
    scope: "treatment_plan",
    label: "Treatment Plan",
    description: "Prescribed medical care pathways, therapeutic regimens and interventions.",
  },
  {
    scope: "follow_up_instructions",
    label: "Follow-up Instructions",
    description: "Guidance for ongoing recovery milestones, medications and next visit timing.",
  },
];

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
      return "Consent can only be requested for patients with whom you have an established appointment relationship.";
    }
    if (err.response?.status === 409) {
      return "A pending consent request already exists for this patient, or the requested scopes are already active.";
    }
    if (err.response?.status === 422) {
      return "Invalid request submission. Please verify selected scopes and note format.";
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export default function DoctorConsentRequestModal({
  isOpen,
  onClose,
  patientProfileId,
  patientName,
  activeScopes = [],
  prefillScopes = [],
  onSuccess,
}: DoctorConsentRequestModalProps) {
  const [selectedScopes, setSelectedScopes] = useState<HealthDataScope[]>([]);
  const [doctorMessage, setDoctorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Stable idempotency key per logical submission attempt
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Identify available scopes (not already authorized)
  const activeScopeSet = useMemo(
    () => new Set<HealthDataScope>(activeScopes),
    [activeScopes],
  );

  const availableScopes = useMemo(
    () => ALL_SCOPES_METADATA.filter((item) => !activeScopeSet.has(item.scope)),
    [activeScopeSet],
  );

  // Initialize and reset state when opening for a patient
  useEffect(() => {
    if (!isOpen) {
      setSelectedScopes([]);
      setDoctorMessage("");
      setSubmitError(null);
      setSubmitSuccess(null);
      setIsSubmitting(false);
      return;
    }

    // Capture previous active element for focus restoration
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    // Generate a fresh stable idempotency key for this newly opened modal instance
    idempotencyKeyRef.current = generateIdempotencyKey();

    // Initialize with prefillScopes if provided and not already active
    if (prefillScopes && prefillScopes.length > 0) {
      const activeSet = new Set<HealthDataScope>(activeScopes);
      const initialValid = prefillScopes.filter(
        (s) => !activeSet.has(s) && ALL_SCOPES_METADATA.some((m) => m.scope === s),
      );
      setSelectedScopes(initialValid);
    } else {
      setSelectedScopes([]);
    }

    setDoctorMessage("");
    setSubmitError(null);
    setSubmitSuccess(null);
    setIsSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, patientProfileId]);

  // Keyboard navigation: Escape key & focus trapping
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
        return;
      }

      if (e.key === "Tab") {
        if (!modalRef.current) return;
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, isSubmitting, onClose]);

  const toggleScope = (scope: HealthDataScope) => {
    if (activeScopeSet.has(scope) || isSubmitting) return;

    setSelectedScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((item) => item !== scope)
        : [...prev, scope],
    );
    setSubmitError(null);
  };

  const handleSelectAllAvailable = () => {
    if (isSubmitting) return;
    const allAvailable = availableScopes.map((item) => item.scope);
    setSelectedScopes(allAvailable);
    setSubmitError(null);
  };

  const handleClearSelection = () => {
    if (isSubmitting) return;
    setSelectedScopes([]);
    setSubmitError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (selectedScopes.length === 0) {
      setSubmitError("Please select at least one health information scope to request.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    const payload: ConsentRequestCreate = {
      patient_profile_id: patientProfileId,
      requested_scopes: selectedScopes,
      doctor_message: doctorMessage.trim() ? doctorMessage.trim() : null,
      idempotency_key: idempotencyKeyRef.current,
    };

    try {
      // Passes the stable idempotencyKeyRef to ensure exact retry reuse upon failure
      const createdRequest = await consentService.createConsentRequest(
        payload,
        idempotencyKeyRef.current,
      );

      setSubmitSuccess(
        `EHR access request for ${selectedScopes.length} scope(s) submitted successfully. The request is now pending patient review.`,
      );

      // Brief delay to allow the doctor to see the confirmation banner before modal closure
      setTimeout(() => {
        onSuccess(createdRequest);
        onClose();
      }, 1200);
    } catch (err: unknown) {
      const errorMsg = extractErrorMessage(
        err,
        "Failed to submit consent request. Please try again.",
      );
      setSubmitError(errorMsg);
      // NOTE: idempotencyKeyRef.current is intentionally preserved so that
      // clicking 'Submit Request' again re-submits with the EXACT same idempotency key!
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="doc-consent-modal-overlay"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
      role="presentation"
    >
      <div
        className="doc-consent-modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-request-modal-title"
        aria-describedby="consent-request-modal-desc"
      >
        {/* Modal Header */}
        <header className="doc-consent-header">
          <div className="doc-consent-title-group">
            <div className="doc-consent-kicker">
              <FolderLock size={13} />
              <span>Patient Consent Governance</span>
            </div>
            <h2 id="consent-request-modal-title" className="doc-consent-title">
              Request EHR Access
            </h2>
            <p className="doc-consent-subtitle">
              Patient: <strong>{patientName}</strong> · ID: {patientProfileId.slice(0, 8)}...
            </p>
          </div>

          <button
            type="button"
            className="doc-consent-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close request modal"
          >
            <X size={18} />
          </button>
        </header>

        {/* Modal Body Form */}
        <form onSubmit={handleSubmit} className="doc-consent-body" noValidate>
          {/* Statutory Patient Sovereignty Advisory */}
          <div id="consent-request-modal-desc" className="doc-consent-advisory" role="note">
            <Info size={18} className="doc-consent-advisory-icon" aria-hidden="true" />
            <div>
              <strong>Patient-Controlled Medical Boundary:</strong> In compliance with
              DPDP and medical ethics, electronic health record permissions are granted
              solely at the patient's explicit discretion. Submitting this request notifies
              the patient, who may approve all, partially approve, or decline. Access is
              never granted automatically.
            </div>
          </div>

          {/* Scopes Selection Section */}
          <section aria-labelledby="scopes-heading">
            <div className="doc-consent-section-header">
              <h3 id="scopes-heading" className="doc-consent-section-title">
                Clinical Scopes
              </h3>
              <div className="doc-consent-quick-actions">
                {availableScopes.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="doc-consent-text-btn"
                      onClick={handleSelectAllAvailable}
                      disabled={isSubmitting || selectedScopes.length === availableScopes.length}
                    >
                      Select All Available ({availableScopes.length})
                    </button>
                    {selectedScopes.length > 0 && (
                      <button
                        type="button"
                        className="doc-consent-text-btn"
                        onClick={handleClearSelection}
                        disabled={isSubmitting}
                      >
                        Clear Selection
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="doc-consent-scope-list" role="group" aria-label="Health data scopes">
              {ALL_SCOPES_METADATA.map(({ scope, label, description }) => {
                const isAuthorized = activeScopeSet.has(scope);
                const isSelected = selectedScopes.includes(scope);
                const inputId = `scope-check-${scope}`;

                return (
                  <label
                    key={scope}
                    htmlFor={inputId}
                    className={`doc-consent-scope-item ${
                      isAuthorized
                        ? "is-authorized is-disabled"
                        : isSelected
                        ? "is-selected"
                        : ""
                    }`}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      className="doc-consent-scope-checkbox"
                      checked={isAuthorized || isSelected}
                      disabled={isAuthorized || isSubmitting}
                      onChange={() => toggleScope(scope)}
                      aria-label={`${label}: ${description}`}
                    />

                    <div className="doc-consent-scope-content">
                      <div className="doc-consent-scope-label-row">
                        <span className="doc-consent-scope-name">{label}</span>
                        {isAuthorized && (
                          <span className="doc-consent-badge-auth">
                            <ShieldCheck size={12} />
                            Already Authorized
                          </span>
                        )}
                      </div>
                      <span className="doc-consent-scope-desc">{description}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          {/* Optional Clinical Note / Message */}
          <div className="doc-consent-message-group">
            <div className="doc-consent-label-row">
              <label htmlFor="doctor-message" className="doc-consent-field-label">
                Clinical Context for Patient (Optional)
              </label>
              <span className="doc-consent-char-counter" aria-live="polite">
                {doctorMessage.length} / 500 characters
              </span>
            </div>

            <textarea
              id="doctor-message"
              className="doc-consent-textarea"
              placeholder="e.g. Needed to review previous diagnostic assessments and treatment plans prior to our upcoming clinical follow-up."
              value={doctorMessage}
              maxLength={500}
              onChange={(e) => setDoctorMessage(e.target.value)}
              disabled={isSubmitting}
              rows={3}
            />
          </div>

          {/* Selected Scopes Review Box */}
          {selectedScopes.length > 0 && (
            <div className="doc-consent-summary-box" aria-live="polite">
              <span className="doc-consent-summary-title">
                Review Scopes Being Requested ({selectedScopes.length}):
              </span>
              <div className="doc-consent-summary-chips">
                {selectedScopes.map((scope) => {
                  const meta = ALL_SCOPES_METADATA.find((m) => m.scope === scope);
                  return (
                    <span key={scope} className="doc-consent-chip-pending">
                      {meta?.label || scope}
                    </span>
                  );
                })}
              </div>
              <p className="doc-consent-summary-notice">
                Notice: The patient will be notified to review and approve these permissions.
                Access will not become available until approved.
              </p>
            </div>
          )}

          {/* Feedback Alerts */}
          {submitError && (
            <div className="doc-consent-alert error" role="alert">
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{submitError}</span>
            </div>
          )}

          {submitSuccess && (
            <div className="doc-consent-alert success" role="status">
              <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{submitSuccess}</span>
            </div>
          )}
        </form>

        {/* Modal Footer Actions */}
        <footer className="doc-consent-footer">
          <button
            type="button"
            className="doc-consent-btn doc-consent-btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>

          <button
            type="button"
            className="doc-consent-btn doc-consent-btn-primary"
            onClick={handleSubmit}
            disabled={isSubmitting || selectedScopes.length === 0}
            title={
              selectedScopes.length === 0
                ? "Select at least one scope to submit request"
                : "Submit EHR access request to patient"
            }
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={14} className="doc-consent-spin" />
                <span>Submitting Request...</span>
              </>
            ) : (
              <>
                <Send size={14} />
                <span>
                  Submit Request ({selectedScopes.length} Scope
                  {selectedScopes.length === 1 ? "" : "s"})
                </span>
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

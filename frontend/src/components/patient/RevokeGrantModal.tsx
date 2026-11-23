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
  Clock3,
  FileCheck2,
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
import "./RevokeGrantModal.css";

export interface RevokeGrantModalProps {
  isOpen: boolean;
  consent: PatientConsent | null;
  doctor?: ConsentDoctor | null;
  overlappingActiveGrantsCount?: number;
  onClose: () => void;
  onSuccess: (revokedConsent: PatientConsent, message: string) => void;
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

function formatDate(value: string | null): string {
  if (!value) return "Not available";
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
      return "You are not authorized to revoke this consent record.";
    }
    if (err.response?.status === 404) {
      return "This consent record was not found or has already been removed.";
    }
    if (err.response?.status === 409) {
      return "This consent record has already been revoked.";
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export default function RevokeGrantModal({
  isOpen,
  consent,
  doctor,
  overlappingActiveGrantsCount = 0,
  onClose,
  onSuccess,
}: RevokeGrantModalProps) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Focus tracking and reset
  useEffect(() => {
    if (isOpen && consent) {
      previousActiveElementRef.current = document.activeElement as HTMLElement;
      setErrorMessage(null);
      setIsSubmitting(false);
    } else if (!isOpen && previousActiveElementRef.current) {
      previousActiveElementRef.current.focus();
    }
  }, [isOpen, consent]);

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

  async function handleConfirmRevoke() {
    if (!consent || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const revoked = await consentService.revokeConsent(consent.id);
      const doctorName = doctor?.full_name ? `Dr. ${doctor.full_name}` : "the doctor";
      const successMessage = overlappingActiveGrantsCount > 0
        ? `Individual consent grant revoked. Notice: ${doctorName} still has ${overlappingActiveGrantsCount} other active grant(s) authorizing overlapping records.`
        : `Access for ${doctorName} through this consent grant has been successfully revoked.`;

      onSuccess(revoked, successMessage);
      onClose();
    } catch (err) {
      setErrorMessage(
        extractErrorMessage(
          err,
          "Unable to revoke this consent grant. Please try again.",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isOpen || !consent) return null;

  const doctorDisplayName = doctor?.full_name
    ? `Dr. ${doctor.full_name}`
    : "Doctor (details unavailable)";
  const doctorSpecialty =
    doctor?.specialization || "Healthcare Provider";
  const clinicName = doctor?.clinic_name || "ANVAYA Partner Clinic";

  return createPortal(
    <div
      className="revoke-grant-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        className="revoke-grant-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revoke-grant-modal-title"
        aria-describedby="revoke-grant-modal-desc"
        tabIndex={-1}
      >
        {/* Header */}
        <header className="revoke-grant-header">
          <div className="revoke-grant-title-group">
            <span className="revoke-grant-kicker">
              <ShieldAlert size={14} />
              INDIVIDUAL GRANT REVOCATION
            </span>
            <h2 id="revoke-grant-modal-title">Revoke This Consent Grant</h2>
            <p id="revoke-grant-modal-desc" className="revoke-grant-subtitle">
              You are about to revoke one specific permission record granted to {doctorDisplayName}.
            </p>
          </div>

          <button
            type="button"
            className="revoke-grant-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>

        {/* Body */}
        <div className="revoke-grant-body">
          {/* Doctor Info Card */}
          <section className="revoke-grant-doctor-banner">
            <div className="revoke-grant-doc-avatar">
              <Stethoscope size={24} />
            </div>
            <div className="revoke-grant-doc-info">
              <strong className="revoke-grant-doc-name">
                {doctorDisplayName}
              </strong>
              <span className="revoke-grant-doc-meta">
                {doctorSpecialty} · {clinicName}
              </span>
              <div className="revoke-grant-meta-row">
                <span className="revoke-grant-date-item">
                  <Clock3 size={13} />
                  Granted on: {formatDate(consent.granted_at)}
                </span>
                <span className="revoke-grant-id-badge">
                  Grant ID: {consent.id.slice(0, 8)}...
                </span>
              </div>
            </div>
          </section>

          {/* Granular Scopes in this Grant */}
          <section className="revoke-grant-scopes-box">
            <span className="revoke-grant-scopes-label">
              <FileCheck2 size={15} />
              Permissions in this specific grant ({consent.data_scopes.length}):
            </span>
            <div className="revoke-grant-chips">
              {consent.data_scopes.map((scope) => (
                <span key={scope} className="revoke-grant-chip">
                  {SCOPE_LABELS[scope] || scope}
                </span>
              ))}
            </div>
          </section>

          {/* Semantic Disclosure Advisory */}
          <div className="revoke-grant-advisory-card">
            <div className="revoke-grant-advisory-icon">
              <AlertTriangle size={18} />
            </div>
            <div className="revoke-grant-advisory-text">
              <strong>Single-Grant Revocation Semantics</strong>
              <p>
                Revoking this grant affects <em>only this individual record</em>.
              </p>
              {overlappingActiveGrantsCount > 0 ? (
                <p className="revoke-grant-overlap-notice">
                  <strong>Important:</strong> {doctorDisplayName} currently has{" "}
                  <strong>{overlappingActiveGrantsCount} other active grant(s)</strong>.
                  If any of those grants authorize the same permissions, the doctor will
                  continue to have access through those independent grants until they are
                  separately revoked or until you choose "Revoke All Doctor Access".
                </p>
              ) : (
                <p>
                  This grant will be immediately marked as Revoked in your history.
                  If this is the only active grant, the doctor will lose access to these
                  categories.
                </p>
              )}
            </div>
          </div>

          {/* Error Alert */}
          {errorMessage && (
            <div className="revoke-grant-alert error" role="alert">
              <AlertCircle size={18} />
              <div className="revoke-grant-alert-content">
                <strong>Revocation Failed</strong>
                <p>{errorMessage}</p>
              </div>
              <button
                type="button"
                className="revoke-grant-alert-dismiss"
                onClick={() => setErrorMessage(null)}
                aria-label="Dismiss error"
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="revoke-grant-footer">
          <button
            type="button"
            className="revoke-grant-btn-secondary"
            disabled={isSubmitting}
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            type="button"
            className="revoke-grant-btn-danger"
            disabled={isSubmitting}
            onClick={() => void handleConfirmRevoke()}
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={16} className="revoke-grant-spin" />
                Revoking Grant...
              </>
            ) : (
              <>
                <ShieldOff size={16} />
                Confirm Revoke Grant
              </>
            )}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Calendar,
  Clock,
  RefreshCw,
  User,
  X,
  XCircle,
} from "lucide-react";

import { doctorService } from "../../../services/doctorService";
import type {
  DoctorAppointmentCancelPayload,
  DoctorAppointmentItem,
} from "../../../types/doctor";
import "./DoctorAppointmentCancelModal.css";

interface DoctorAppointmentCancelModalProps {
  appointment: DoctorAppointmentItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedAppointment: DoctorAppointmentItem) => void;
}

const COMMON_REASONS = [
  "Doctor emergency surgery / urgent clinical call",
  "Physician acute medical illness / unplanned leave",
  "Patient schedule conflict requested via phone",
  "Clinical department unavoidable scheduling conflict",
];

function formatKolkataDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(dateObj);
  } catch {
    return dateStr;
  }
}

function formatTimeSlot(timeStr: string): string {
  try {
    const parts = timeStr.split(":");
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1] || "00";
    const ampm = hours >= 12 ? "PM" : "AM";
    const formattedHours = hours % 12 || 12;
    return `${formattedHours}:${minutes} ${ampm}`;
  } catch {
    return timeStr;
  }
}

export default function DoctorAppointmentCancelModal({
  appointment,
  isOpen,
  onClose,
  onSuccess,
}: DoctorAppointmentCancelModalProps) {
  const [cancellationReason, setCancellationReason] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Autofocus, keyboard Escape handler, focus trapping, and focus restoration
  useEffect(() => {
    if (!isOpen) {
      setCancellationReason("");
      setErrorMessage(null);
      setIsSubmitting(false);
      return;
    }

    // Save active element for focus restoration upon modal close
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
        return;
      }

      if (e.key === "Tab") {
        if (!modalRef.current) return;
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (
            document.activeElement === firstElement ||
            !modalRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (
            document.activeElement === lastElement ||
            !modalRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      // Restore focus to previous trigger element
      previousActiveElementRef.current?.focus();
    };
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !appointment) return null;

  const trimmedReason = cancellationReason.trim();
  const isReasonValid = trimmedReason.length >= 5 && trimmedReason.length <= 1000;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isReasonValid) {
      setErrorMessage(
        "Cancellation reason must be at least 5 characters (up to 1000 characters)."
      );
      textareaRef.current?.focus();
      return;
    }

    setIsSubmitting(true);

    const payload: DoctorAppointmentCancelPayload = {
      cancellation_reason: trimmedReason,
      idempotency_key: `doc_cancel_${appointment.id}_${Date.now()}`,
    };

    try {
      const updated = await doctorService.cancelDoctorAppointment(
        appointment.id,
        payload
      );
      onSuccess(updated);
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data
              ?.detail
          : null;

      if (detail) {
        setErrorMessage(detail);
      } else {
        setErrorMessage(
          "Unable to complete appointment cancellation. Please verify network connectivity and retry."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectChip = (reason: string) => {
    setCancellationReason(reason);
    textareaRef.current?.focus();
  };

  return (
    <div
      className="doc-cancel-modal-overlay"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-cancel-modal-title"
    >
      <div
        className="doc-cancel-modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="doc-cancel-header">
          <div className="doc-cancel-title-group">
            <div className="doc-cancel-kicker">
              <AlertTriangle size={13} />
              <span>CLINICAL SCHEDULE MANAGEMENT</span>
            </div>
            <h2 id="doc-cancel-modal-title" className="doc-cancel-title">
              Cancel Scheduled Consultation
            </h2>
          </div>
          <button
            type="button"
            className="doc-cancel-close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close cancellation dialog"
          >
            <X size={18} />
          </button>
        </header>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="doc-cancel-form">
          <div className="doc-cancel-body">
            {/* Warning Banner */}
            <div className="doc-cancel-warning-banner">
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>Cancellation Warning</strong>
                <span>
                  This action immediately cancels the booked consultation, releases the
                  reserved time slot for other patients, and dispatches a cancellation
                  notification to the patient. This action cannot be reversed.
                </span>
              </div>
            </div>

            {/* Appointment Context Summary */}
            <div className="doc-cancel-summary-card">
              <div className="doc-cancel-summary-row">
                <span className="doc-cancel-summary-label">
                  <User size={14} /> Patient Name
                </span>
                <span className="doc-cancel-summary-val">
                  {appointment.patient_name || "Patient Consultation"}
                </span>
              </div>
              <div className="doc-cancel-summary-row">
                <span className="doc-cancel-summary-label">
                  <Calendar size={14} /> Scheduled Date
                </span>
                <span className="doc-cancel-summary-val">
                  {formatKolkataDate(appointment.appointment_date)}
                </span>
              </div>
              <div className="doc-cancel-summary-row">
                <span className="doc-cancel-summary-label">
                  <Clock size={14} /> Time Window
                </span>
                <span className="doc-cancel-summary-val">
                  {formatTimeSlot(appointment.start_time)} –{" "}
                  {formatTimeSlot(appointment.end_time)}
                </span>
              </div>
            </div>

            {/* Quick Reason Chips */}
            <div>
              <div className="doc-cancel-chips-label">Standard Clinical Reasons:</div>
              <div className="doc-cancel-chips">
                {COMMON_REASONS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="doc-cancel-chip"
                    onClick={() => handleSelectChip(chip)}
                    disabled={isSubmitting}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* Mandatory Reason Input */}
            <div className="doc-cancel-form-group">
              <label htmlFor="cancellation-reason-input" className="doc-cancel-label">
                <span>Clinical / Administrative Reason *</span>
                <span
                  className={`doc-cancel-char-count ${
                    trimmedReason.length > 0 && !isReasonValid ? "invalid" : ""
                  }`}
                >
                  {trimmedReason.length}/1000 (min 5 chars)
                </span>
              </label>
              <textarea
                id="cancellation-reason-input"
                ref={textareaRef}
                className="doc-cancel-textarea"
                placeholder="State the clinical or operational reason for cancelling this appointment..."
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                minLength={5}
                maxLength={1000}
                disabled={isSubmitting}
                required
              />
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="doc-cancel-error" role="alert">
                <XCircle size={16} style={{ flexShrink: 0 }} />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <footer className="doc-cancel-footer">
            <button
              type="button"
              className="doc-cancel-btn doc-cancel-btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Back to Appointments
            </button>
            <button
              type="submit"
              className="doc-cancel-btn doc-cancel-btn-danger"
              disabled={isSubmitting || !isReasonValid}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={14} className="doc-cancel-spin" />
                  <span>Cancelling Consultation...</span>
                </>
              ) : (
                <>
                  <XCircle size={15} />
                  <span>Confirm Cancellation</span>
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

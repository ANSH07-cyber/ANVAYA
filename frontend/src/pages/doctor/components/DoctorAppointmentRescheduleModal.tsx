import { useEffect, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import {
  AlertCircle,
  Calendar,
  CalendarClock,
  Clock,
  Info,
  RefreshCw,
  User,
  X,
} from "lucide-react";

import { doctorService } from "../../../services/doctorService";
import type {
  AppointmentRescheduleProposal,
  DoctorAppointmentItem,
} from "../../../types/doctor";
import type { AvailableSlot } from "../../../types/patient";
import "./DoctorAppointmentRescheduleModal.css";

interface DoctorAppointmentRescheduleModalProps {
  appointment: DoctorAppointmentItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (proposal: AppointmentRescheduleProposal) => void;
}

function getTomorrowKolkataDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function getMaxKolkataDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

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

export default function DoctorAppointmentRescheduleModal({
  appointment,
  isOpen,
  onClose,
  onSuccess,
}: DoctorAppointmentRescheduleModalProps) {
  const [proposedDate, setProposedDate] = useState<string>(getTomorrowKolkataDate());
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [doctorMessage, setDoctorMessage] = useState<string>("");
  const [isLoadingSlots, setIsLoadingSlots] = useState<boolean>(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Reset state on open/close & manage focus
  useEffect(() => {
    if (!isOpen || !appointment) {
      setProposedDate(getTomorrowKolkataDate());
      setAvailableSlots([]);
      setSelectedSlot(null);
      setDoctorMessage("");
      setSlotsError(null);
      setSubmitError(null);
      setIsSubmitting(false);
      return;
    }

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
        return;
      }

      if (e.key === "Tab") {
        if (!modalRef.current) return;
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
  }, [isOpen, appointment, isSubmitting, onClose]);

  // Fetch available slots whenever proposedDate changes
  useEffect(() => {
    if (!isOpen || !appointment || !proposedDate) return;

    let active = true;
    setIsLoadingSlots(true);
    setSlotsError(null);
    setSelectedSlot(null);

    doctorService
      .getDoctorAvailabilitySlots(appointment.doctor_profile_id, proposedDate)
      .then((data) => {
        if (!active) return;
        // Filter out slots that match the current appointment on the same date
        const validSlots = data.items.filter((slot) => {
          if (
            proposedDate === appointment.appointment_date &&
            slot.start_time === appointment.start_time
          ) {
            return false;
          }
          return true;
        });
        setAvailableSlots(validSlots);
      })
      .catch((err) => {
        if (!active) return;
        if (axios.isAxiosError(err)) {
          const detail = err.response?.data?.detail;
          setSlotsError(
            typeof detail === "string"
              ? detail
              : "Unable to load available slots for this date.",
          );
        } else {
          setSlotsError("Unable to load available slots for this date.");
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingSlots(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, appointment, proposedDate]);

  if (!isOpen || !appointment) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const proposal = await doctorService.proposeAppointmentReschedule(
        appointment.id,
        {
          proposed_date: proposedDate,
          proposed_start_time: selectedSlot.start_time,
          doctor_message: doctorMessage.trim() || null,
          idempotency_key: `doc-prop-${appointment.id}-${Date.now()}`,
        },
      );
      onSuccess(proposal);
      onClose();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const detail = err.response?.data?.detail;
        if (status === 403) {
          setSubmitError(
            typeof detail === "string"
              ? detail
              : "You are not authorized to propose rescheduling for this appointment.",
          );
        } else if (status === 409) {
          setSubmitError(
            typeof detail === "string"
              ? detail
              : "This slot is no longer available or a proposal is already pending.",
          );
        } else if (status === 422) {
          setSubmitError(
            "Invalid date or slot selected. Please verify your proposed schedule.",
          );
        } else {
          setSubmitError(
            typeof detail === "string"
              ? detail
              : "Could not create reschedule proposal. Please try again.",
          );
        }
      } else {
        setSubmitError("An unexpected error occurred. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="doc-resched-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-resched-modal-title"
    >
      <div
        className="doc-resched-modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="doc-resched-header">
          <div className="doc-resched-title-group">
            <div className="doc-resched-kicker">
              <CalendarClock size={14} />
              <span>RESCHEDULE PROPOSAL</span>
            </div>
            <h2 id="doc-resched-modal-title" className="doc-resched-title">
              Propose Appointment Reschedule
            </h2>
          </div>
          <button
            type="button"
            className="doc-resched-close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </header>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="doc-resched-form">
          <div className="doc-resched-body">
            {/* Informational Guidance Box */}
            <div className="doc-resched-notice">
              <Info size={16} className="doc-resched-notice-icon" />
              <div className="doc-resched-notice-text">
                <strong>Patient Approval Required</strong>
                <span>
                  The original appointment remains booked until the patient explicitly accepts your proposed time. If declined or expired, the original consultation stays intact.
                </span>
              </div>
            </div>

            {/* Current Appointment Summary Card */}
            <div className="doc-resched-current-card">
              <span className="doc-resched-card-label">Current Consultation</span>
              <div className="doc-resched-current-details">
                <div className="doc-resched-current-item">
                  <User size={14} />
                  <span>{appointment.patient_name || "Patient"}</span>
                </div>
                <div className="doc-resched-current-item">
                  <Calendar size={14} />
                  <span>{formatKolkataDate(appointment.appointment_date)}</span>
                </div>
                <div className="doc-resched-current-item">
                  <Clock size={14} />
                  <span>
                    {formatTimeSlot(appointment.start_time)} – {formatTimeSlot(appointment.end_time)}
                  </span>
                </div>
              </div>
            </div>

            {/* Date Selection */}
            <div className="doc-resched-field-group">
              <label htmlFor="resched-proposed-date" className="doc-resched-label">
                Proposed Date <span className="doc-resched-req">*</span>
              </label>
              <input
                id="resched-proposed-date"
                type="date"
                className="doc-resched-input"
                min={getTomorrowKolkataDate()}
                max={getMaxKolkataDate()}
                value={proposedDate}
                onChange={(e) => setProposedDate(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>

            {/* Available Slots Section */}
            <div className="doc-resched-field-group">
              <label className="doc-resched-label">
                Select New Time Slot <span className="doc-resched-req">*</span>
              </label>
              {isLoadingSlots ? (
                <div className="doc-resched-slots-loading">
                  <RefreshCw size={16} className="doc-resched-spin" />
                  <span>Checking doctor availability slots...</span>
                </div>
              ) : slotsError ? (
                <div className="doc-resched-slots-error">
                  <AlertCircle size={15} />
                  <span>{slotsError}</span>
                </div>
              ) : availableSlots.length === 0 ? (
                <div className="doc-resched-slots-empty">
                  <Clock size={16} />
                  <span>No available slots found on {formatKolkataDate(proposedDate)}. Please select another date.</span>
                </div>
              ) : (
                <div className="doc-resched-slots-grid" role="radiogroup" aria-label="Available time slots">
                  {availableSlots.map((slot) => {
                    const isSelected = selectedSlot?.start_time === slot.start_time;
                    return (
                      <button
                        key={slot.start_time}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className={`doc-resched-slot-pill ${isSelected ? "selected" : ""}`}
                        onClick={() => setSelectedSlot(slot)}
                        disabled={isSubmitting}
                      >
                        <Clock size={13} />
                        <span>
                          {formatTimeSlot(slot.start_time)} – {formatTimeSlot(slot.end_time)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Optional Administrative Note */}
            <div className="doc-resched-field-group">
              <div className="doc-resched-label-row">
                <label htmlFor="resched-doctor-message" className="doc-resched-label">
                  Note for Patient <span className="doc-resched-opt">(Optional)</span>
                </label>
                <span className="doc-resched-char-count">
                  {doctorMessage.length} / 500
                </span>
              </div>
              <textarea
                id="resched-doctor-message"
                className="doc-resched-textarea"
                rows={3}
                maxLength={500}
                placeholder="Brief administrative reason (e.g. Schedule shift due to emergency ward rounds)..."
                value={doctorMessage}
                onChange={(e) => setDoctorMessage(e.target.value)}
                disabled={isSubmitting}
              />
              <span className="doc-resched-helper">
                Only non-sensitive administrative notes are permitted. Do not enter confidential medical diagnoses or health records.
              </span>
            </div>

            {/* Error Message */}
            {submitError && (
              <div className="doc-resched-error-alert" role="alert">
                <AlertCircle size={16} />
                <span>{submitError}</span>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <footer className="doc-resched-footer">
            <button
              type="button"
              className="doc-resched-btn doc-resched-btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="doc-resched-btn doc-resched-btn-primary"
              disabled={!selectedSlot || isSubmitting || doctorMessage.length > 500}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={15} className="doc-resched-spin" />
                  <span>Submitting Proposal...</span>
                </>
              ) : (
                <>
                  <CalendarClock size={15} />
                  <span>Send Reschedule Proposal</span>
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

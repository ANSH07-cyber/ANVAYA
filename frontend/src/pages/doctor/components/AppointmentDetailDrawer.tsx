import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Info,
  ShieldAlert,
  User,
  X,
  XCircle,
} from "lucide-react";

import { doctorService } from "../../../services/doctorService";
import type {
  AppointmentRescheduleProposal,
  DoctorAppointmentItem,
} from "../../../types/doctor";
import "./AppointmentDetailDrawer.css";

interface AppointmentDetailDrawerProps {
  appointment: DoctorAppointmentItem | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenCompleteModal: (appointment: DoctorAppointmentItem) => void;
  onOpenCancelModal?: (appointment: DoctorAppointmentItem) => void;
  onOpenRescheduleModal?: (appointment: DoctorAppointmentItem) => void;
  completedHealthRecordId?: string | null;
}

function formatKolkataDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      day: "numeric",
      month: "long",
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

function isAppointmentStarted(appointmentDate: string, startTime: string): boolean {
  try {
    const parts = startTime.split(":");
    const hours = (parts[0] || "00").padStart(2, "0");
    const minutes = (parts[1] || "00").padStart(2, "0");
    const seconds = (parts[2] || "00").padStart(2, "0");
    const isoString = `${appointmentDate}T${hours}:${minutes}:${seconds}+05:30`;
    const startEpoch = new Date(isoString).getTime();
    if (isNaN(startEpoch)) return false;
    return Date.now() >= startEpoch;
  } catch {
    return false;
  }
}

function canProposeReschedule(appointmentDate: string, startTime: string): boolean {
  try {
    const parts = startTime.split(":");
    const hours = (parts[0] || "00").padStart(2, "0");
    const minutes = (parts[1] || "00").padStart(2, "0");
    const seconds = (parts[2] || "00").padStart(2, "0");
    const isoString = `${appointmentDate}T${hours}:${minutes}:${seconds}+05:30`;
    const startEpoch = new Date(isoString).getTime();
    if (isNaN(startEpoch)) return false;
    // Lead time requirement: at least 3 hours before start time
    const minLeadEpoch = Date.now() + 3 * 60 * 60 * 1000;
    return startEpoch >= minLeadEpoch;
  } catch {
    return false;
  }
}

export default function AppointmentDetailDrawer({
  appointment,
  isOpen,
  onClose,
  onOpenCompleteModal,
  onOpenCancelModal,
  onOpenRescheduleModal,
  completedHealthRecordId,
}: AppointmentDetailDrawerProps) {
  const [activeProposal, setActiveProposal] = useState<AppointmentRescheduleProposal | null>(null);

  useEffect(() => {
    if (!isOpen || !appointment) {
      setActiveProposal(null);
      return;
    }

    let active = true;
    doctorService
      .getAppointmentProposals(appointment.id)
      .then((res) => {
        if (!active) return;
        const pending = res.items.find((p) => p.status === "pending") || null;
        setActiveProposal(pending);
      })
      .catch(() => {
        if (!active) return;
        setActiveProposal(null);
      });

    return () => {
      active = false;
    };
  }, [isOpen, appointment]);

  if (!isOpen || !appointment) return null;

  const isBooked = appointment.status === "booked";
  const isCompleted = appointment.status === "completed";
  const isCancelled = appointment.status === "cancelled";
  const hasStarted = isAppointmentStarted(appointment.appointment_date, appointment.start_time);
  const isRescheduleEligible = isBooked && !hasStarted && canProposeReschedule(appointment.appointment_date, appointment.start_time);

  return (
    <div className="doc-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="doc-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="doc-drawer-header">
          <div className="doc-drawer-header-left">
            <div className="doc-drawer-kicker">
              <User size={13} />
              <span>CONSULTATION DETAILS</span>
            </div>
            <h2 className="doc-drawer-title">
              {appointment.patient_name || "Patient Consultation"}
            </h2>
          </div>
          <button
            type="button"
            className="doc-drawer-close-btn"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
        </header>

        {/* Body */}
        <div className="doc-drawer-body">
          {/* Status & Timing Section */}
          <section className="doc-drawer-section">
            <span className="doc-drawer-label">Appointment Schedule</span>
            <div className="doc-drawer-card">
              <div className="doc-drawer-row">
                <span className="doc-drawer-key">
                  <Calendar size={14} /> Date
                </span>
                <span className="doc-drawer-val">
                  {formatKolkataDate(appointment.appointment_date)}
                </span>
              </div>
              <div className="doc-drawer-row">
                <span className="doc-drawer-key">
                  <Clock size={14} /> Time Window
                </span>
                <span className="doc-drawer-val">
                  {formatTimeSlot(appointment.start_time)} – {formatTimeSlot(appointment.end_time)}
                </span>
              </div>
              <div className="doc-drawer-row">
                <span className="doc-drawer-key">Status</span>
                <span className={`doc-status-tag ${appointment.status}`}>
                  {appointment.status}
                </span>
              </div>
            </div>
          </section>

          {/* Active Reschedule Proposal Notice */}
          {activeProposal && (
            <div className="doc-drawer-notice doc-drawer-notice-pending-reschedule">
              <CalendarClock size={16} color="#38bdf8" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: "#ffffff", display: "block" }}>
                  Reschedule Proposal Pending Patient Response
                </strong>
                <span style={{ display: "block", color: "#38bdf8", fontWeight: 600, marginTop: 2 }}>
                  Proposed: {formatKolkataDate(activeProposal.proposed_date)} at {formatTimeSlot(activeProposal.proposed_start_time)} – {formatTimeSlot(activeProposal.proposed_end_time)}
                </span>
                <span style={{ display: "block", marginTop: 4, fontSize: "0.76rem", color: "#94a3b8" }}>
                  Original appointment remains booked at current time until the patient accepts.
                </span>
              </div>
            </div>
          )}

          {/* Patient Context */}
          <section className="doc-drawer-section">
            <span className="doc-drawer-label">Patient Information</span>
            <div className="doc-drawer-card">
              <div className="doc-drawer-row">
                <span className="doc-drawer-key">
                  <User size={14} /> Patient Name
                </span>
                <span className="doc-drawer-val">
                  {appointment.patient_name || "Patient"}
                </span>
              </div>
              <div className="doc-drawer-row">
                <span className="doc-drawer-key">Reference ID</span>
                <span
                  className="doc-drawer-val"
                  style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#94a3b8" }}
                >
                  ...{appointment.id.slice(-8)}
                </span>
              </div>
            </div>
          </section>

          {/* Reason for Visit */}
          <section className="doc-drawer-section">
            <span className="doc-drawer-label">Chief Clinical Purpose / Reason</span>
            <p className="doc-drawer-reason-text">
              {appointment.reason || "Routine Consultation / Follow-up Examination"}
            </p>
          </section>

          {/* Completed Record Notification (only displayed if returned from completion API) */}
          {completedHealthRecordId && (
            <div className="doc-drawer-notice">
              <CheckCircle2 size={16} color="#34d399" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: "#ffffff", display: "block" }}>
                  Clinical Record Created
                </strong>
                <span>
                  Health Record Reference:{" "}
                  <code style={{ color: "#38bdf8" }}>...{completedHealthRecordId.slice(-8)}</code>
                </span>
              </div>
            </div>
          )}

          {/* Privacy & EHR Consent Guidance */}
          <div className="doc-drawer-notice">
            <Info size={16} color="#0ea5e9" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ color: "#ffffff", display: "block" }}>
                Patient Consent Protected
              </strong>
              <span>
                Historical EHR records are accessible during active consultation strictly under patient-granted consent scopes.
              </span>
            </div>
          </div>

          {/* Completed Notice if Completed */}
          {isCompleted && (
            <div className="doc-drawer-notice">
              <CheckCircle2 size={16} color="#34d399" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: "#ffffff", display: "block" }}>
                  Consultation Completed
                </strong>
                <span>
                  This clinical encounter has been concluded and documented.
                </span>
              </div>
            </div>
          )}

          {/* Scheduled Future Visit Warning */}
          {isBooked && !hasStarted && (
            <div className="doc-drawer-notice doc-drawer-notice-warn">
              <Clock size={16} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: "#ffffff", display: "block" }}>
                  Scheduled Future Visit
                </strong>
                <span>
                  Available after scheduled appointment start time.
                </span>
              </div>
            </div>
          )}

          {/* Cancellation Notice if Cancelled */}
          {isCancelled && (
            <div className="doc-drawer-notice doc-drawer-notice-warn">
              <AlertCircle size={16} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: "#ffffff", display: "block" }}>
                  Cancelled Appointment
                </strong>
                <span>
                  This consultation was cancelled. Booked slots are released for other patients.
                </span>
              </div>
            </div>
          )}

          {/* Doctor Schedule Governance Notice */}
          <div className="doc-drawer-card" style={{ background: "transparent", borderStyle: "dashed" }}>
            <span style={{ fontSize: "0.75rem", color: "#64748b", lineHeight: 1.45 }}>
              <ShieldAlert size={12} style={{ display: "inline", marginRight: 5, verticalAlign: -1 }} />
              Doctors may cancel upcoming consultations for clinical emergencies. Time slots are immediately released for patient scheduling.
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <footer className="doc-drawer-footer">
          {isBooked && (
            hasStarted ? (
              <button
                type="button"
                className="doc-drawer-btn doc-drawer-btn-primary"
                onClick={() => onOpenCompleteModal(appointment)}
              >
                <FileText size={15} />
                <span>Complete Consultation</span>
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                <button
                  type="button"
                  className="doc-drawer-btn doc-drawer-btn-secondary"
                  disabled
                  title="Available after scheduled appointment start time."
                >
                  <FileText size={15} />
                  <span>Complete Consultation</span>
                </button>
                <span style={{ fontSize: "0.74rem", color: "#94a3b8", textAlign: "center" }}>
                  Available after scheduled appointment start time.
                </span>
              </div>
            )
          )}

          {isBooked && !hasStarted && onOpenRescheduleModal && (
            activeProposal ? (
              <button
                type="button"
                className="doc-drawer-btn doc-drawer-btn-secondary"
                disabled
                title="A reschedule proposal is already pending for this appointment."
              >
                <CalendarClock size={15} />
                <span>Proposal Pending</span>
              </button>
            ) : isRescheduleEligible ? (
              <button
                type="button"
                className="doc-drawer-btn doc-drawer-btn-reschedule"
                onClick={() => onOpenRescheduleModal(appointment)}
              >
                <CalendarClock size={15} />
                <span>Propose Reschedule</span>
              </button>
            ) : (
              <button
                type="button"
                className="doc-drawer-btn doc-drawer-btn-secondary"
                disabled
                title="Rescheduling proposals require at least 3 hours advance notice."
              >
                <CalendarClock size={15} />
                <span>Propose Reschedule (&lt;3h notice)</span>
              </button>
            )
          )}

          {isBooked && !hasStarted && onOpenCancelModal && (
            <button
              type="button"
              className="doc-drawer-btn doc-drawer-btn-danger"
              onClick={() => onOpenCancelModal(appointment)}
            >
              <XCircle size={15} />
              <span>Cancel Consultation</span>
            </button>
          )}

          <Link
            to={`/doctor/consultation/${appointment.id}`}
            className="doc-drawer-btn doc-drawer-btn-secondary"
          >
            <span>Launch Consultation Room</span>
            <ExternalLink size={14} />
          </Link>
        </footer>
      </div>
    </div>
  );
}

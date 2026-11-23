import { useEffect, useState } from "react";
import {
  Calendar,
  CalendarClock,
  Check,
  Clock,
  Copy,
  Shield,
  Stethoscope,
  X,
} from "lucide-react";
import type { AdminAppointmentItem } from "../../../types/admin";
import "./DoctorProfileDrawer.css";

interface AppointmentDetailDrawerProps {
  appointment: AdminAppointmentItem | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string): string {
  try {
    const [h, m] = timeStr.split(":");
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const formattedHour = hour % 12 || 12;
    return `${formattedHour}:${m} ${ampm}`;
  } catch {
    return timeStr;
  }
}

function formatTimestamp(isoString: string): string {
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

export default function AppointmentDetailDrawer({
  appointment,
  isOpen,
  onClose,
}: AppointmentDetailDrawerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !appointment) {
    return null;
  }

  const handleCopy = (idValue: string, label: string) => {
    navigator.clipboard.writeText(idValue);
    setCopiedId(label);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div
      className="doctor-drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="appt-drawer-title"
    >
      <div
        className="doctor-drawer-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="doctor-drawer-header">
          <div className="doctor-drawer-header-content">
            <span className="doctor-drawer-kicker">
              <CalendarClock size={14} className="doctor-drawer-kicker-icon" />
              CONSULTATION & QUEUE OVERSIGHT
            </span>
            <div className="doctor-drawer-title-row">
              <div>
                <h2 id="appt-drawer-title" className="doctor-drawer-name">
                  {formatDate(appointment.appointment_date)}
                </h2>
                <span className="doctor-drawer-email">
                  <Clock size={13} className="inline-cell-icon text-cyan" />
                  {formatTime(appointment.start_time)} – {formatTime(appointment.end_time)}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="doctor-drawer-close-btn"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="doctor-drawer-body">
          {/* Section 1: System Identifiers */}
          <div className="doctor-drawer-section">
            <h4 className="doctor-section-title">
              <Shield size={14} className="doctor-section-icon" />
              Appointment & Profile Identifiers
            </h4>
            <div className="doctor-id-cards-grid">
              <div className="doctor-id-card">
                <div className="doctor-id-label">Appointment ID</div>
                <div className="doctor-id-value-row">
                  <span className="doctor-id-value" title={appointment.id}>
                    {appointment.id}
                  </span>
                  <button
                    type="button"
                    className="doctor-id-copy-btn"
                    onClick={() => handleCopy(appointment.id, "appt")}
                    title="Copy Appointment ID"
                  >
                    {copiedId === "appt" ? (
                      <Check size={14} className="text-emerald" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>

              <div className="doctor-id-card">
                <div className="doctor-id-label">DoctorProfile ID</div>
                <div className="doctor-id-value-row">
                  <span className="doctor-id-value" title={appointment.doctor_profile_id}>
                    {appointment.doctor_profile_id}
                  </span>
                  <button
                    type="button"
                    className="doctor-id-copy-btn"
                    onClick={() => handleCopy(appointment.doctor_profile_id, "doc")}
                    title="Copy DoctorProfile ID"
                  >
                    {copiedId === "doc" ? (
                      <Check size={14} className="text-emerald" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>

              <div className="doctor-id-card">
                <div className="doctor-id-label">PatientProfile ID</div>
                <div className="doctor-id-value-row">
                  <span className="doctor-id-value" title={appointment.patient_profile_id}>
                    {appointment.patient_profile_id}
                  </span>
                  <button
                    type="button"
                    className="doctor-id-copy-btn"
                    onClick={() => handleCopy(appointment.patient_profile_id, "pat")}
                    title="Copy PatientProfile ID"
                  >
                    {copiedId === "pat" ? (
                      <Check size={14} className="text-emerald" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Clinical Parties */}
          <div className="doctor-drawer-section">
            <h4 className="doctor-section-title">
              <Stethoscope size={14} className="doctor-section-icon" />
              Clinical Consultation Parties
            </h4>
            <div className="doctor-meta-grid">
              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Doctor</span>
                <span className="doctor-meta-value font-semibold">
                  {appointment.doctor_name}
                </span>
                <span className="doctor-email text-xs">{appointment.doctor_email}</span>
              </div>

              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Specialization</span>
                <span className="doctor-meta-value text-cyan">
                  {appointment.doctor_specialization}
                </span>
              </div>

              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Patient</span>
                <span className="doctor-meta-value font-semibold">
                  {appointment.patient_name}
                </span>
                <span className="doctor-email text-xs">{appointment.patient_email}</span>
              </div>

              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Lifecycle Status</span>
                <span className="doctor-meta-value">
                  <span className="status-pill status-pill-cyan uppercase text-xs">
                    {appointment.status}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Reason & Clinical Purpose */}
          <div className="doctor-drawer-section">
            <h4 className="doctor-section-title">
              <Calendar size={14} className="doctor-section-icon" />
              Chief Complaint & Reason
            </h4>
            <div className="doctor-bio-box">
              <p className="doctor-bio-text">
                {appointment.reason || "No clinical reason specified by patient at booking."}
              </p>
            </div>
          </div>

          {/* Section 4: Timestamps */}
          <div className="doctor-drawer-section">
            <h4 className="doctor-section-title">
              <Clock size={14} className="doctor-section-icon" />
              Audit & Record Timestamps
            </h4>
            <div className="doctor-meta-grid">
              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Booked At</span>
                <span className="doctor-meta-value">
                  {formatTimestamp(appointment.created_at)}
                </span>
              </div>
              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Last Updated</span>
                <span className="doctor-meta-value">
                  {formatTimestamp(appointment.updated_at)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

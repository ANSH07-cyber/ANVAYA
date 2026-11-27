import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  Clock,
  FileText,
  User,
} from "lucide-react";
import type { DoctorAppointmentItem } from "../../../types/doctor";
import "./ConsultationHeader.css";

interface ConsultationHeaderProps {
  appointment: DoctorAppointmentItem;
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

export default function ConsultationHeader({ appointment }: ConsultationHeaderProps) {
  return (
    <header className="doc-consult-header">
      <div className="doc-consult-header-top">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link to="/doctor/appointments" className="doc-consult-back-link">
            <ArrowLeft size={14} />
            <span>Queue</span>
          </Link>
          <h1 className="doc-consult-header-title">
            Clinical Consultation: {appointment.patient_name || "Patient Encounter"}
          </h1>
        </div>

        <div className="doc-consult-header-meta">
          <div className="doc-consult-patient-chip">
            <User size={13} />
            <span>Patient: <strong>{appointment.patient_name || "Patient Consultation"}</strong></span>
            <code className="doc-consult-ref-code">...{appointment.id.slice(-8)}</code>
          </div>

          <div className="doc-consult-schedule-chip">
            <Calendar size={13} />
            <span>{formatKolkataDate(appointment.appointment_date)}</span>
            <Clock size={13} style={{ marginLeft: 6 }} />
            <span>{formatTimeSlot(appointment.start_time)} – {formatTimeSlot(appointment.end_time)}</span>
          </div>

          <span className={`doc-status-tag ${appointment.status}`}>
            {appointment.status}
          </span>
        </div>
      </div>

      <div className="doc-consult-purpose-bar">
        <div className="doc-consult-purpose-label">
          <FileText size={13} />
          <span>Chief Purpose:</span>
        </div>
        <p className="doc-consult-purpose-text">
          {appointment.reason || "Routine Clinical Consultation / Follow-up Examination"}
        </p>
      </div>
    </header>
  );
}


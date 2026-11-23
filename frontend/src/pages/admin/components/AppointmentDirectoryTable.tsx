import {
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  Mail,
  SearchX,
  Stethoscope,
  XCircle,
} from "lucide-react";
import type {
  AdminAppointmentItem,
  AdminAppointmentStatus,
} from "../../../types/admin";

interface AppointmentDirectoryTableProps {
  appointments: AdminAppointmentItem[];
  isLoading: boolean;
  hasFilters: boolean;
  onResetFilters: () => void;
  onSelectAppointment: (appointment: AdminAppointmentItem) => void;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
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

function getStatusBadge(status: AdminAppointmentStatus) {
  switch (status) {
    case "booked":
      return {
        label: "Booked",
        pillClass: "status-pill-cyan",
        icon: Clock,
      };
    case "in_progress":
      return {
        label: "In Progress",
        pillClass: "status-pill-amber",
        icon: Calendar,
      };
    case "completed":
      return {
        label: "Completed",
        pillClass: "status-pill-emerald",
        icon: CheckCircle2,
      };
    case "cancelled":
      return {
        label: "Cancelled",
        pillClass: "status-pill-rose",
        icon: XCircle,
      };
    default:
      return {
        label: status,
        pillClass: "status-pill-amber",
        icon: Clock,
      };
  }
}

export default function AppointmentDirectoryTable({
  appointments,
  isLoading,
  hasFilters,
  onResetFilters,
  onSelectAppointment,
}: AppointmentDirectoryTableProps) {
  if (isLoading && appointments.length === 0) {
    return (
      <div className="doctor-table-card">
        <div className="doctor-table-wrap">
          <table className="doctor-table" aria-busy="true">
            <thead>
              <tr>
                <th>Schedule Window</th>
                <th>Practitioner</th>
                <th>Patient</th>
                <th>Status</th>
                <th>Clinical Reason</th>
                <th className="th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} className="skeleton-row">
                  <td>
                    <div className="skeleton skeleton-text" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-avatar-name" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-avatar-name" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-badge" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-text" />
                  </td>
                  <td className="td-actions">
                    <div className="skeleton skeleton-btn" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (appointments.length === 0) {
    return (
      <div className="doctor-empty-state">
        <div className="doctor-empty-icon-wrap" aria-hidden="true">
          <SearchX size={36} />
        </div>
        <h3 className="doctor-empty-title">No appointments found</h3>
        <p className="doctor-empty-desc">
          {hasFilters
            ? "No consultations match your search query or status filters. Try clearing your filters."
            : "No appointments have been scheduled on the platform yet."}
        </p>
        {hasFilters && (
          <button
            type="button"
            className="doctor-empty-reset-btn"
            onClick={onResetFilters}
          >
            Clear Search & Filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="doctor-table-card">
      <div className="doctor-table-wrap">
        <table className="doctor-table" aria-label="Appointments Oversight Table">
          <thead>
            <tr>
              <th scope="col">Schedule Window</th>
              <th scope="col">Practitioner</th>
              <th scope="col">Patient</th>
              <th scope="col">Status</th>
              <th scope="col">Clinical Reason</th>
              <th scope="col" className="th-actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {appointments.map((appt) => {
              const statusMeta = getStatusBadge(appt.status);
              const StatusIcon = statusMeta.icon;

              return (
                <tr
                  key={appt.id}
                  className="doctor-table-row clickable-row"
                  onClick={() => onSelectAppointment(appt)}
                >
                  {/* Schedule Window */}
                  <td>
                    <div className="appointment-schedule-cell">
                      <span className="appointment-date-text">
                        <Calendar size={13} className="inline-cell-icon text-cyan" />
                        {formatDate(appt.appointment_date)}
                      </span>
                      <span className="appointment-time-text">
                        <Clock size={12} className="inline-cell-icon" />
                        {formatTime(appt.start_time)} – {formatTime(appt.end_time)}
                      </span>
                    </div>
                  </td>

                  {/* Doctor Info */}
                  <td>
                    <div className="doctor-cell-profile">
                      <div className="doctor-avatar" aria-hidden="true">
                        DR
                      </div>
                      <div className="doctor-profile-text">
                        <span className="doctor-name">{appt.doctor_name}</span>
                        <span className="doctor-spec-pill">
                          <Stethoscope size={11} className="inline-cell-icon" />
                          {appt.doctor_specialization}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Patient Info */}
                  <td>
                    <div className="doctor-cell-profile">
                      <div className="doctor-avatar patient-avatar" aria-hidden="true">
                        PT
                      </div>
                      <div className="doctor-profile-text">
                        <span className="doctor-name">{appt.patient_name}</span>
                        <span className="doctor-email">
                          <Mail size={12} className="inline-cell-icon" />
                          {appt.patient_email}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Status Pill */}
                  <td>
                    <span className={`status-pill ${statusMeta.pillClass}`}>
                      <StatusIcon size={12} />
                      <span>{statusMeta.label}</span>
                    </span>
                  </td>

                  {/* Clinical Reason */}
                  <td>
                    <span className="appointment-reason-preview">
                      {appt.reason || "General Consultation"}
                    </span>
                  </td>

                  {/* Actions */}
                  <td
                    className="td-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="doctor-view-btn"
                      onClick={() => onSelectAppointment(appt)}
                      title="Inspect consultation oversight"
                      aria-label={`Inspect appointment ${appt.id}`}
                    >
                      <Eye size={15} />
                      <span>Inspect</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import {
  Calendar,
  Droplet,
  Eye,
  Mail,
  Phone,
  SearchX,
  User,
} from "lucide-react";
import type { AdminPatientItem } from "../../../types/admin";

interface PatientDirectoryTableProps {
  patients: AdminPatientItem[];
  isLoading: boolean;
  hasFilters: boolean;
  onResetFilters: () => void;
  onSelectPatient: (patient: AdminPatientItem) => void;
}

function getInitials(name: string): string {
  if (!name) return "PT";
  const clean = name.trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(isoString: string | null): string {
  if (!isoString) return "Not recorded";
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return isoString;
  }
}

function calculateAge(dobString: string | null): string {
  if (!dobString) return "";
  try {
    const dob = new Date(dobString);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
      age--;
    }
    return age > 0 ? `${age}y` : "";
  } catch {
    return "";
  }
}

export default function PatientDirectoryTable({
  patients,
  isLoading,
  hasFilters,
  onResetFilters,
  onSelectPatient,
}: PatientDirectoryTableProps) {
  if (isLoading && patients.length === 0) {
    return (
      <div className="doctor-table-card">
        <div className="doctor-table-wrap">
          <table className="doctor-table" aria-busy="true">
            <thead>
              <tr>
                <th>Patient Details</th>
                <th>Contact Info</th>
                <th>Demographics</th>
                <th>Blood Group</th>
                <th>Registration Date</th>
                <th className="th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} className="skeleton-row">
                  <td>
                    <div className="skeleton skeleton-avatar-name" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-text" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-badge" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-badge" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-text-short" />
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

  if (patients.length === 0) {
    return (
      <div className="doctor-empty-state">
        <div className="doctor-empty-icon-wrap" aria-hidden="true">
          <SearchX size={36} />
        </div>
        <h3 className="doctor-empty-title">No patient records found</h3>
        <p className="doctor-empty-desc">
          {hasFilters
            ? "No patient accounts match your search query or filter criteria. Try broadening your terms."
            : "No registered patient profiles currently exist in the database."}
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
        <table className="doctor-table" aria-label="Patient Directory Table">
          <thead>
            <tr>
              <th scope="col">Patient Details</th>
              <th scope="col">Contact Info</th>
              <th scope="col">Demographics</th>
              <th scope="col">Blood Group</th>
              <th scope="col">Registered</th>
              <th scope="col" className="th-actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {patients.map((patient) => {
              const initials = getInitials(patient.full_name);
              const age = calculateAge(patient.date_of_birth);

              return (
                <tr
                  key={patient.id}
                  className="doctor-table-row clickable-row"
                  onClick={() => onSelectPatient(patient)}
                >
                  {/* Patient Name & Avatar */}
                  <td>
                    <div className="doctor-cell-profile">
                      <div className="doctor-avatar" aria-hidden="true">
                        {initials}
                      </div>
                      <div className="doctor-profile-text">
                        <span className="doctor-name">{patient.full_name}</span>
                        <span className="doctor-email">
                          <Mail size={12} className="inline-cell-icon" />
                          {patient.email}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Contact Info */}
                  <td>
                    <div className="doctor-clinic-cell">
                      {patient.phone_number ? (
                        <span className="doctor-clinic-name">
                          <Phone size={13} className="inline-cell-icon text-cyan" />
                          {patient.phone_number}
                        </span>
                      ) : (
                        <span className="doctor-clinic-fee text-muted">
                          Phone not set
                        </span>
                      )}
                      {patient.address && (
                        <span className="patient-table-address" title={patient.address}>
                          {patient.address}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Demographics (DOB & Gender) */}
                  <td>
                    <div className="patient-demographics-cell">
                      <span className="patient-gender-badge">
                        <User size={12} className="inline-cell-icon" />
                        {patient.gender ? patient.gender.toUpperCase() : "UNSPECIFIED"}
                      </span>
                      {patient.date_of_birth && (
                        <span className="patient-dob-text">
                          <Calendar size={12} className="inline-cell-icon" />
                          {formatDate(patient.date_of_birth)} {age && `(${age})`}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Blood Group */}
                  <td>
                    {patient.blood_group ? (
                      <span className="patient-bg-badge">
                        <Droplet size={12} className="inline-cell-icon text-rose" />
                        {patient.blood_group}
                      </span>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>

                  {/* Registered Date */}
                  <td>
                    <span className="doctor-date-cell">
                      {formatDate(patient.created_at)}
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
                      onClick={() => onSelectPatient(patient)}
                      title="Inspect patient profile"
                      aria-label={`Inspect ${patient.full_name} details`}
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

import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  FileBadge,
  GraduationCap,
  IndianRupee,
  SearchX,
  Stethoscope,
  UserMinus,
  Users,
  XCircle,
} from "lucide-react";
import type {
  DoctorReviewItem,
  DoctorVerificationStatus,
} from "../../../types/admin";

interface DoctorDirectoryTableProps {
  doctors: DoctorReviewItem[];
  isLoading: boolean;
  hasFilters: boolean;
  onResetFilters: () => void;
  onSelectDoctor: (doctor: DoctorReviewItem) => void;
}

function getInitials(name: string): string {
  if (!name) return "DR";
  const clean = name.replace(/^Dr\.?\s+/i, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(isoString: string): string {
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

function formatRelativeTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return "";
  } catch {
    return "";
  }
}

function formatFee(fee: string | number | null): string {
  if (fee === null || fee === undefined || fee === "") {
    return "Not set";
  }
  const num = typeof fee === "number" ? fee : parseFloat(String(fee));
  if (isNaN(num)) return "Not set";
  return `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

interface StatusMeta {
  label: string;
  icon: typeof CheckCircle2;
  pillClass: string;
  hint: string;
}

function getStatusMeta(status: DoctorVerificationStatus): StatusMeta {
  switch (status) {
    case "pending":
      return {
        label: "Pending Review",
        icon: Clock,
        pillClass: "status-pill-amber",
        hint: "Awaiting administrative credential review",
      };
    case "approved":
      return {
        label: "Approved & Active",
        icon: CheckCircle2,
        pillClass: "status-pill-emerald",
        hint: "Authorized for clinical consultations",
      };
    case "suspended":
      return {
        label: "Suspended",
        icon: UserMinus,
        pillClass: "status-pill-purple",
        hint: "Consultation & clinical privileges revoked",
      };
    case "rejected":
      return {
        label: "Rejected",
        icon: XCircle,
        pillClass: "status-pill-rose",
        hint: "Licensure or credentials declined",
      };
    default:
      return {
        label: status,
        icon: AlertTriangle,
        pillClass: "status-pill-slate",
        hint: "Status unclassified",
      };
  }
}

export default function DoctorDirectoryTable({
  doctors,
  isLoading,
  hasFilters,
  onResetFilters,
  onSelectDoctor,
}: DoctorDirectoryTableProps) {
  // Loading Skeleton State
  if (isLoading) {
    return (
      <div className="doctor-table-container">
        <div className="doctor-skeleton-list" aria-busy="true" aria-label="Loading practitioner records">
          {[1, 2, 3, 4, 5].map((idx) => (
            <div key={idx} className="doctor-skeleton-row">
              <div className="doctor-skeleton-avatar shimmer" />
              <div className="doctor-skeleton-info">
                <div className="doctor-skeleton-line title shimmer" />
                <div className="doctor-skeleton-line subtitle shimmer" />
              </div>
              <div className="doctor-skeleton-cell shimmer" />
              <div className="doctor-skeleton-cell shimmer" />
              <div className="doctor-skeleton-pill shimmer" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty State: No results match search/filter
  if (doctors.length === 0) {
    return (
      <div className="doctor-table-container">
        <div className="doctor-empty-state">
          {hasFilters ? (
            <>
              <div className="doctor-empty-icon-wrap amber-glow" aria-hidden="true">
                <SearchX size={36} />
              </div>
              <h3 className="doctor-empty-title">No Matching Practitioners</h3>
              <p className="doctor-empty-desc">
                No practitioners match your current search terms or verification filter.
              </p>
              <button
                type="button"
                className="doctor-empty-reset-btn"
                onClick={onResetFilters}
              >
                Clear Search & Filters
              </button>
            </>
          ) : (
            <>
              <div className="doctor-empty-icon-wrap sky-glow" aria-hidden="true">
                <Users size={36} />
              </div>
              <h3 className="doctor-empty-title">No Practitioners Registered</h3>
              <p className="doctor-empty-desc">
                There are currently no doctor accounts in the system database.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Active Directory Table
  return (
    <div className="doctor-table-container">
      <div className="doctor-table-scroll">
        <table className="doctor-directory-table" role="table">
          <thead>
            <tr>
              <th scope="col" className="th-practitioner">
                Practitioner Identity
              </th>
              <th scope="col" className="th-credentials">
                Specialization & Experience
              </th>
              <th scope="col" className="th-licensure">
                Medical Licensure & Clinic
              </th>
              <th scope="col" className="th-fee">
                Consultation Fee
              </th>
              <th scope="col" className="th-status">
                Verification Status
              </th>
              <th scope="col" className="th-date">
                Registration Date
              </th>
              <th scope="col" className="th-actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {doctors.map((doctor) => {
              const statusMeta = getStatusMeta(doctor.verification_status);
              const StatusIcon = statusMeta.icon;
              const initials = getInitials(doctor.full_name);
              const relTime = formatRelativeTime(doctor.created_at);

              return (
                <tr
                  key={doctor.id}
                  className="doctor-table-row clickable"
                  onClick={() => onSelectDoctor(doctor)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectDoctor(doctor);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Inspect credentials for ${doctor.full_name}`}
                >
                  {/* Column 1: Practitioner Identity */}
                  <td className="cell-practitioner">
                    <div className="doctor-identity-card">
                      <div className="doctor-avatar-badge" aria-hidden="true">
                        <span>{initials}</span>
                      </div>
                      <div className="doctor-identity-details">
                        <div className="doctor-name-row">
                          <span className="doctor-full-name" title={doctor.full_name}>
                            {doctor.full_name}
                          </span>
                        </div>
                        <span className="doctor-email" title={doctor.email}>
                          {doctor.email}
                        </span>
                        <span className="doctor-profile-uuid" title={`Doctor Profile ID: ${doctor.id}`}>
                          ID: {doctor.id.slice(0, 8)}…
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Column 2: Specialization & Experience */}
                  <td className="cell-credentials">
                    <div className="doctor-credentials-card">
                      <div className="doctor-specialization-chip">
                        <Stethoscope size={13} className="doctor-spec-icon" />
                        <span>{doctor.specialization}</span>
                      </div>
                      <div className="doctor-qualification" title={doctor.qualification}>
                        <GraduationCap size={13} className="doctor-sub-icon" />
                        <span>{doctor.qualification}</span>
                      </div>
                      <div className="doctor-experience-tag">
                        {doctor.years_experience !== null && doctor.years_experience !== undefined ? (
                          <span>{doctor.years_experience} yrs clinical experience</span>
                        ) : (
                          <span className="text-muted">Experience unspecified</span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Column 3: Medical Licensure & Clinic */}
                  <td className="cell-licensure">
                    <div className="doctor-licensure-card">
                      <div className="doctor-license-number" title={`License: ${doctor.license_number}`}>
                        <FileBadge size={13} className="doctor-lic-icon" />
                        <span>{doctor.license_number}</span>
                      </div>
                      <div className="doctor-clinic-name">
                        <Building2 size={13} className="doctor-sub-icon" />
                        <span>{doctor.clinic_name || "Private Practice"}</span>
                      </div>
                    </div>
                  </td>

                  {/* Column 4: Consultation Fee */}
                  <td className="cell-fee">
                    <div className="doctor-fee-display">
                      <IndianRupee size={13} className="doctor-fee-icon" />
                      <span className="doctor-fee-value">{formatFee(doctor.consultation_fee)}</span>
                    </div>
                  </td>

                  {/* Column 5: Verification Status */}
                  <td className="cell-status">
                    <div className="doctor-status-wrap">
                      <span
                        className={`doctor-status-badge ${statusMeta.pillClass}`}
                        title={statusMeta.hint}
                      >
                        <StatusIcon size={13} className="doctor-status-icon" />
                        <span>{statusMeta.label}</span>
                      </span>
                    </div>
                  </td>

                  {/* Column 6: Registration Date */}
                  <td className="cell-date">
                    <div className="doctor-date-card">
                      <div className="doctor-date-main">
                        <Calendar size={13} className="doctor-sub-icon" />
                        <span>{formatDate(doctor.created_at)}</span>
                      </div>
                      {relTime && (
                        <span className="doctor-date-rel">{relTime}</span>
                      )}
                    </div>
                  </td>

                  {/* Column 7: Actions */}
                  <td
                    className="cell-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="doctor-review-btn"
                      onClick={() => onSelectDoctor(doctor)}
                      title={`Review credentials for ${doctor.full_name}`}
                      aria-label={`Review credentials for ${doctor.full_name}`}
                    >
                      <Eye size={13} />
                      <span>Review</span>
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

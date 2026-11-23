import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileBadge,
  FileText,
  GraduationCap,
  IndianRupee,
  KeyRound,
  Mail,
  Shield,
  ShieldAlert,
  Stethoscope,
  User,
  UserMinus,
  X,
  XCircle,
} from "lucide-react";

import type {
  DoctorReviewItem,
  DoctorVerificationStatus,
} from "../../../types/admin";
import "./DoctorProfileDrawer.css";

interface DoctorProfileDrawerProps {
  doctor: DoctorReviewItem | null;
  isOpen: boolean;
  onClose: () => void;
  onActionSelect: (targetStatus: DoctorVerificationStatus) => void;
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
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return isoString;
  }
}

function formatFee(fee: string | number | null): string {
  if (fee === null || fee === undefined || fee === "") {
    return "Not configured";
  }
  const num = typeof fee === "number" ? fee : parseFloat(String(fee));
  if (isNaN(num)) return "Not configured";
  return `₹${num.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

interface StatusBadgeMeta {
  label: string;
  icon: typeof CheckCircle2;
  className: string;
  summary: string;
}

function getStatusBadgeMeta(status: DoctorVerificationStatus): StatusBadgeMeta {
  switch (status) {
    case "pending":
      return {
        label: "Pending Review",
        icon: Clock,
        className: "badge-pending",
        summary: "Awaiting administrative credential review and medical council verification.",
      };
    case "approved":
      return {
        label: "Approved & Active",
        icon: CheckCircle2,
        className: "badge-approved",
        summary: "Authorized for clinical consultations, patient care, and digital prescriptions.",
      };
    case "suspended":
      return {
        label: "Suspended",
        icon: UserMinus,
        className: "badge-suspended",
        summary: "Clinical practice and consultation privileges revoked. Telehealth sessions disabled.",
      };
    case "rejected":
      return {
        label: "Rejected",
        icon: XCircle,
        className: "badge-rejected",
        summary: "Licensure or credential application declined. Not authorized to consult.",
      };
    default:
      return {
        label: status,
        icon: AlertTriangle,
        className: "badge-default",
        summary: "Verification status is unclassified.",
      };
  }
}

export default function DoctorProfileDrawer({
  doctor,
  isOpen,
  onClose,
  onActionSelect,
}: DoctorProfileDrawerProps) {
  const [copiedProfileId, setCopiedProfileId] = useState<boolean>(false);
  const [copiedUserId, setCopiedUserId] = useState<boolean>(false);

  // Manage Escape key and body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !doctor) {
    return null;
  }

  const statusMeta = getStatusBadgeMeta(doctor.verification_status);
  const StatusIcon = statusMeta.icon;
  const initials = getInitials(doctor.full_name);

  const copyToClipboard = async (text: string, type: "profile" | "user") => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === "profile") {
        setCopiedProfileId(true);
        setTimeout(() => setCopiedProfileId(false), 2000);
      } else {
        setCopiedUserId(true);
        setTimeout(() => setCopiedUserId(false), 2000);
      }
    } catch {
      // Fallback if clipboard API is restricted
    }
  };

  return (
    <div
      className="doctor-drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="doctor-drawer-title"
      onClick={onClose}
    >
      <div
        className="doctor-drawer-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <header className="doctor-drawer-header">
          <div className="doctor-drawer-header-content">
            <div className="doctor-drawer-kicker">
              <Shield size={13} className="doctor-drawer-kicker-icon" />
              <span>PRACTITIONER CREDENTIAL REVIEW</span>
            </div>
            <div className="doctor-drawer-identity">
              <div className="doctor-drawer-avatar" aria-hidden="true">
                <span>{initials}</span>
              </div>
              <div className="doctor-drawer-identity-info">
                <h2 id="doctor-drawer-title" className="doctor-drawer-title">
                  {doctor.full_name}
                </h2>
                <div className="doctor-drawer-meta-line">
                  <span className="doctor-drawer-spec">{doctor.specialization}</span>
                  <span className="doctor-drawer-bullet">·</span>
                  <span className="doctor-drawer-qual">{doctor.qualification}</span>
                </div>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="doctor-drawer-close-btn"
            onClick={onClose}
            aria-label="Close credential inspection drawer"
            title="Close drawer"
          >
            <X size={20} />
          </button>
        </header>

        {/* Drawer Scrollable Body */}
        <div className="doctor-drawer-body">
          {/* Status & Governance Card */}
          <section className="drawer-card status-card">
            <div className="status-card-header">
              <span className="drawer-card-label">Verification Governance</span>
              <span className={`drawer-status-pill ${statusMeta.className}`}>
                <StatusIcon size={14} />
                <span>{statusMeta.label}</span>
              </span>
            </div>
            <p className="status-card-desc">{statusMeta.summary}</p>
          </section>

          {/* Identifier Separation Section */}
          <section className="drawer-card id-card">
            <span className="drawer-card-label">System Identifiers & Registry Mapping</span>
            <p className="id-card-note">
              ANVAYA maintains separation between the clinical practitioner profile and the underlying authentication principal.
            </p>

            <div className="id-boxes-grid">
              {/* Box 1: Doctor Profile ID */}
              <div className="id-box profile-id-box">
                <div className="id-box-header">
                  <div className="id-box-title-wrap">
                    <FileBadge size={14} className="id-box-icon text-sky" />
                    <span className="id-box-title">Doctor Profile ID</span>
                  </div>
                  <button
                    type="button"
                    className="id-copy-btn"
                    onClick={() => copyToClipboard(doctor.id, "profile")}
                    title="Copy Doctor Profile ID"
                  >
                    {copiedProfileId ? (
                      <>
                        <Check size={12} className="text-emerald" />
                        <span className="copied-text">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <code className="id-box-code" title={doctor.id}>
                  {doctor.id}
                </code>
                <span className="id-box-subtitle">
                  Primary key for verification transitions, licensure audits, and clinical endpoints.
                </span>
              </div>

              {/* Box 2: User Account ID */}
              <div className="id-box user-id-box">
                <div className="id-box-header">
                  <div className="id-box-title-wrap">
                    <KeyRound size={14} className="id-box-icon text-amber" />
                    <span className="id-box-title">User Account ID</span>
                  </div>
                  <button
                    type="button"
                    className="id-copy-btn"
                    onClick={() => copyToClipboard(doctor.user_id, "user")}
                    title="Copy User Account ID"
                  >
                    {copiedUserId ? (
                      <>
                        <Check size={12} className="text-emerald" />
                        <span className="copied-text">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <code className="id-box-code" title={doctor.user_id}>
                  {doctor.user_id}
                </code>
                <span className="id-box-subtitle">
                  Underlying authentication principal for credentials, sessions, and security roles.
                </span>
              </div>
            </div>
          </section>

          {/* Clinical Credentials & Licensure */}
          <section className="drawer-card">
            <span className="drawer-card-label">Medical Licensure & Credentials</span>
            <div className="drawer-data-grid">
              <div className="data-field">
                <span className="field-label">
                  <FileBadge size={13} /> Medical Council License Number
                </span>
                <span className="field-value font-mono highlight-license">
                  {doctor.license_number}
                </span>
              </div>

              <div className="data-field">
                <span className="field-label">
                  <Stethoscope size={13} /> Specialization
                </span>
                <span className="field-value">{doctor.specialization}</span>
              </div>

              <div className="data-field">
                <span className="field-label">
                  <GraduationCap size={13} /> Qualification
                </span>
                <span className="field-value">{doctor.qualification}</span>
              </div>

              <div className="data-field">
                <span className="field-label">
                  <User size={13} /> Clinical Experience
                </span>
                <span className="field-value">
                  {doctor.years_experience !== null && doctor.years_experience !== undefined
                    ? `${doctor.years_experience} Years Practice`
                    : "Experience unspecified"}
                </span>
              </div>
            </div>
          </section>

          {/* Practice & Clinic Operations */}
          <section className="drawer-card">
            <span className="drawer-card-label">Practice Location & Consultation Operations</span>
            <div className="drawer-data-grid">
              <div className="data-field">
                <span className="field-label">
                  <Building2 size={13} /> Clinic or Hospital Affiliation
                </span>
                <span className="field-value">
                  {doctor.clinic_name || "Private Practice (Independent)"}
                </span>
              </div>

              <div className="data-field">
                <span className="field-label">
                  <IndianRupee size={13} /> Standard Consultation Fee
                </span>
                <span className="field-value text-emerald font-semibold">
                  {formatFee(doctor.consultation_fee)}
                </span>
              </div>

              <div className="data-field">
                <span className="field-label">
                  <Mail size={13} /> Practitioner Contact Email
                </span>
                <span className="field-value font-mono">{doctor.email}</span>
              </div>

              <div className="data-field">
                <span className="field-label">
                  <Calendar size={13} /> Registry Enrolment Date
                </span>
                <span className="field-value">{formatDate(doctor.created_at)}</span>
              </div>
            </div>
          </section>

          {/* Professional Biography */}
          <section className="drawer-card">
            <span className="drawer-card-label">
              <FileText size={13} /> Professional Biography & Clinical Statement
            </span>
            <div className="drawer-bio-content">
              {doctor.bio ? (
                <p className="bio-text">{doctor.bio}</p>
              ) : (
                <p className="bio-placeholder">
                  No professional biography or clinical summary provided by the practitioner.
                </p>
              )}
            </div>
          </section>
        </div>

        {/* Drawer Action Bar */}
        <footer className="doctor-drawer-footer">
          <div className="drawer-action-controls">
            {/* Status: Pending -> Can Approve or Reject */}
            {doctor.verification_status === "pending" && (
              <>
                <button
                  type="button"
                  className="drawer-action-btn btn-approve"
                  onClick={() => onActionSelect("approved")}
                >
                  <CheckCircle2 size={16} />
                  <span>Approve Practitioner</span>
                </button>
                <button
                  type="button"
                  className="drawer-action-btn btn-reject"
                  onClick={() => onActionSelect("rejected")}
                >
                  <XCircle size={16} />
                  <span>Reject Application</span>
                </button>
              </>
            )}

            {/* Status: Approved -> Can Suspend */}
            {doctor.verification_status === "approved" && (
              <button
                type="button"
                className="drawer-action-btn btn-suspend"
                onClick={() => onActionSelect("suspended")}
              >
                <ShieldAlert size={16} />
                <span>Suspend Practitioner</span>
              </button>
            )}

            {/* Status: Rejected -> Can Reopen to Pending */}
            {doctor.verification_status === "rejected" && (
              <button
                type="button"
                className="drawer-action-btn btn-reopen"
                onClick={() => onActionSelect("pending")}
              >
                <Clock size={16} />
                <span>Reopen Application (Pending)</span>
              </button>
            )}

            {/* Status: Suspended -> Can Reinstate to Pending */}
            {doctor.verification_status === "suspended" && (
              <button
                type="button"
                className="drawer-action-btn btn-reopen"
                onClick={() => onActionSelect("pending")}
              >
                <Clock size={16} />
                <span>Reinstate to Pending Review</span>
              </button>
            )}

            <button
              type="button"
              className="drawer-action-btn btn-dismiss"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

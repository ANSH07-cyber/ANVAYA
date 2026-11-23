import { useEffect, useState } from "react";
import {
  Calendar,
  Check,
  Clock,
  Copy,
  Droplet,
  HeartHandshake,
  Mail,
  MapPin,
  Phone,
  Shield,
  User,
  X,
} from "lucide-react";
import type { AdminPatientItem } from "../../../types/admin";
import "./DoctorProfileDrawer.css";

interface PatientProfileDrawerProps {
  patient: AdminPatientItem | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatDate(isoString: string | null): string {
  if (!isoString) return "Not recorded";
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

function calculateAge(dobString: string | null): string {
  if (!dobString) return "Not specified";
  try {
    const dob = new Date(dobString);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
      age--;
    }
    return age > 0 ? `${age} years old` : "Under 1 year";
  } catch {
    return "Not specified";
  }
}

export default function PatientProfileDrawer({
  patient,
  isOpen,
  onClose,
}: PatientProfileDrawerProps) {
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

  if (!isOpen || !patient) {
    return null;
  }

  const handleCopy = (idValue: string, label: string) => {
    navigator.clipboard.writeText(idValue);
    setCopiedId(label);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const initials = patient.full_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("") || "PT";

  return (
    <div
      className="doctor-drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="patient-drawer-title"
    >
      <div
        className="doctor-drawer-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="doctor-drawer-header">
          <div className="doctor-drawer-header-content">
            <span className="doctor-drawer-kicker">
              <Shield size={14} className="doctor-drawer-kicker-icon" />
              PATIENT REGISTRY & CLINICAL PROFILE
            </span>
            <div className="doctor-drawer-title-row">
              <div className="doctor-drawer-avatar" aria-hidden="true">
                {initials}
              </div>
              <div>
                <h2 id="patient-drawer-title" className="doctor-drawer-name">
                  {patient.full_name}
                </h2>
                <span className="doctor-drawer-email">
                  <Mail size={13} className="inline-cell-icon" />
                  {patient.email}
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
          {/* Section 1: Unique System Identifiers */}
          <div className="doctor-drawer-section">
            <h4 className="doctor-section-title">
              <Shield size={14} className="doctor-section-icon" />
              ABDM & System Identifiers
            </h4>
            <div className="doctor-id-cards-grid">
              {/* PatientProfile ID */}
              <div className="doctor-id-card">
                <div className="doctor-id-label">PatientProfile ID</div>
                <div className="doctor-id-value-row">
                  <span className="doctor-id-value" title={patient.id}>
                    {patient.id}
                  </span>
                  <button
                    type="button"
                    className="doctor-id-copy-btn"
                    onClick={() => handleCopy(patient.id, "profile")}
                    title="Copy PatientProfile ID"
                  >
                    {copiedId === "profile" ? (
                      <Check size={14} className="text-emerald" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>

              {/* User Account ID */}
              <div className="doctor-id-card">
                <div className="doctor-id-label">User Account ID (Auth)</div>
                <div className="doctor-id-value-row">
                  <span className="doctor-id-value" title={patient.user_id}>
                    {patient.user_id}
                  </span>
                  <button
                    type="button"
                    className="doctor-id-copy-btn"
                    onClick={() => handleCopy(patient.user_id, "user")}
                    title="Copy User ID"
                  >
                    {copiedId === "user" ? (
                      <Check size={14} className="text-emerald" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Clinical Demographics */}
          <div className="doctor-drawer-section">
            <h4 className="doctor-section-title">
              <User size={14} className="doctor-section-icon" />
              Demographic Profile
            </h4>
            <div className="doctor-meta-grid">
              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Date of Birth</span>
                <span className="doctor-meta-value">
                  <Calendar size={14} className="inline-cell-icon text-cyan" />
                  {formatDate(patient.date_of_birth)}
                </span>
              </div>

              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Calculated Age</span>
                <span className="doctor-meta-value">
                  {calculateAge(patient.date_of_birth)}
                </span>
              </div>

              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Gender</span>
                <span className="doctor-meta-value">
                  {patient.gender ? patient.gender.toUpperCase() : "Not specified"}
                </span>
              </div>

              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Blood Group</span>
                <span className="doctor-meta-value">
                  {patient.blood_group ? (
                    <span className="patient-bg-badge">
                      <Droplet size={13} className="inline-cell-icon text-rose" />
                      {patient.blood_group}
                    </span>
                  ) : (
                    "Not specified"
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Contact & Residence */}
          <div className="doctor-drawer-section">
            <h4 className="doctor-section-title">
              <MapPin size={14} className="doctor-section-icon" />
              Contact & Address
            </h4>
            <div className="doctor-meta-grid">
              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Primary Phone</span>
                <span className="doctor-meta-value">
                  <Phone size={14} className="inline-cell-icon text-cyan" />
                  {patient.phone_number || "Not specified"}
                </span>
              </div>

              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Verified Email</span>
                <span className="doctor-meta-value">
                  <Mail size={14} className="inline-cell-icon" />
                  {patient.email}
                </span>
              </div>
            </div>

            {patient.address && (
              <div className="doctor-bio-box" style={{ marginTop: 14 }}>
                <span className="doctor-bio-label">Residential Address</span>
                <p className="doctor-bio-text">{patient.address}</p>
              </div>
            )}
          </div>

          {/* Section 4: Record Timeline */}
          <div className="doctor-drawer-section">
            <h4 className="doctor-section-title">
              <Clock size={14} className="doctor-section-icon" />
              Account Governance & Timestamps
            </h4>
            <div className="doctor-meta-grid">
              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Registered On</span>
                <span className="doctor-meta-value">
                  {formatDate(patient.created_at)}
                </span>
              </div>
              <div className="doctor-meta-item">
                <span className="doctor-meta-label">ABDM Consent Role</span>
                <span className="doctor-meta-value">
                  <HeartHandshake size={14} className="inline-cell-icon text-emerald" />
                  Active Data Principal
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

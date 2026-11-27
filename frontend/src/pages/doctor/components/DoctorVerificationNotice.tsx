import { Link } from "react-router-dom";
import {
  AlertCircle,
  Clock,
  FileCheck2,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  UserCheck,
} from "lucide-react";
import type { DoctorVerificationStatus } from "../../../types/doctor";
import "./DoctorVerificationNotice.css";

interface DoctorVerificationNoticeProps {
  status: DoctorVerificationStatus | "suspended";
  licenseNumber?: string | null;
  specialization?: string | null;
  qualification?: string | null;
  moduleName?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export default function DoctorVerificationNotice({
  status,
  licenseNumber,
  specialization,
  qualification,
  moduleName = "Clinical Services",
  onRefresh,
  isRefreshing = false,
}: DoctorVerificationNoticeProps) {
  if (status === "approved") {
    return null;
  }

  if (status === "pending") {
    return (
      <div className="doc-verify-notice-wrapper" role="region" aria-label="Verification Pending Notice">
        <div className="doc-verify-notice doc-verify-notice-pending">
          <div className="doc-verify-notice-hero">
            <div className="doc-verify-icon-bubble pending" aria-hidden="true">
              <Clock size={32} />
            </div>
            <div className="doc-verify-copy">
              <div className="doc-verify-kicker">
                <Stethoscope size={13} />
                <span>ANVAYA MEDICAL GOVERNANCE</span>
              </div>
              <h2 className="doc-verify-title">Credential Verification Under Review</h2>
              <p className="doc-verify-desc">
                Thank you for joining the ANVAYA clinical network. Your medical practitioner license, qualifications, and clinical credentials are currently under administrative review by our medical governance committee.
              </p>
              <p className="doc-verify-subnote">
                Access to <strong>{moduleName}</strong>, patient consultation queues, and public scheduling availability will unlock automatically once your registration is approved.
              </p>
            </div>
          </div>

          {(licenseNumber || specialization || qualification) && (
            <div className="doc-verify-credentials-card">
              <h3 className="doc-verify-card-heading">
                <FileCheck2 size={15} />
                <span>Submitted Registration Profile</span>
              </h3>
              <div className="doc-verify-details-grid">
                {licenseNumber && (
                  <div className="doc-verify-field">
                    <span className="doc-verify-field-label">Medical Registration / License</span>
                    <span className="doc-verify-field-value doc-mono">{licenseNumber}</span>
                  </div>
                )}
                {specialization && (
                  <div className="doc-verify-field">
                    <span className="doc-verify-field-label">Clinical Specialization</span>
                    <span className="doc-verify-field-value">{specialization}</span>
                  </div>
                )}
                {qualification && (
                  <div className="doc-verify-field">
                    <span className="doc-verify-field-label">Medical Qualification</span>
                    <span className="doc-verify-field-value">{qualification}</span>
                  </div>
                )}
                <div className="doc-verify-field">
                  <span className="doc-verify-field-label">Regulatory Status</span>
                  <span className="doc-verify-field-value">
                    <span className="doc-status-tag pending">Verification Pending</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="doc-verify-actions">
            <Link to="/doctor/profile" className="doc-btn doc-btn-primary">
              <UserCheck size={15} />
              <span>Review Practice Profile</span>
            </Link>
            {onRefresh && (
              <button
                type="button"
                className="doc-btn doc-btn-secondary"
                onClick={onRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw size={14} className={isRefreshing ? "doc-spin" : ""} />
                <span>{isRefreshing ? "Checking Status..." : "Check Status"}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="doc-verify-notice-wrapper" role="alert" aria-label="Verification Not Approved Notice">
        <div className="doc-verify-notice doc-verify-notice-rejected">
          <div className="doc-verify-notice-hero">
            <div className="doc-verify-icon-bubble rejected" aria-hidden="true">
              <AlertCircle size={32} />
            </div>
            <div className="doc-verify-copy">
              <div className="doc-verify-kicker rejected">
                <ShieldAlert size={13} />
                <span>CLINICAL VERIFICATION NOTICE</span>
              </div>
              <h2 className="doc-verify-title">Registration Verification Not Approved</h2>
              <p className="doc-verify-desc">
                Your medical registration credentials could not be verified by ANVAYA Clinical Administration. Access to patient consultations, clinical queues, and availability configuration is restricted.
              </p>
              <p className="doc-verify-subnote">
                If you believe this is an error or wish to update your registration information, please review your practice profile or contact support at <strong>support@anvaya.health</strong>.
              </p>
            </div>
          </div>

          <div className="doc-verify-actions">
            <Link to="/doctor/profile" className="doc-btn doc-btn-secondary">
              <UserCheck size={15} />
              <span>Review Practice Profile</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Suspended or inactive account
  return (
    <div className="doc-verify-notice-wrapper" role="alert" aria-label="Account Suspended Notice">
      <div className="doc-verify-notice doc-verify-notice-suspended">
        <div className="doc-verify-notice-hero">
          <div className="doc-verify-icon-bubble suspended" aria-hidden="true">
            <ShieldAlert size={32} />
          </div>
          <div className="doc-verify-copy">
            <div className="doc-verify-kicker suspended">
              <ShieldAlert size={13} />
              <span>ACCOUNT STATUS NOTICE</span>
            </div>
            <h2 className="doc-verify-title">Practitioner Account Suspended</h2>
            <p className="doc-verify-desc">
              Your clinical practitioner account has been deactivated or suspended by healthcare administrative governance. Clinical queues, availability management, and patient record access are currently suspended.
            </p>
            <p className="doc-verify-subnote">
              Please contact the clinical administrative office for assistance and account reinstatement procedures.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

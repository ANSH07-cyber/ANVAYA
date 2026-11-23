import { useEffect, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  FileCode2,
  Lock,
  Shield,
  X,
} from "lucide-react";
import type { AdminAuditLogItem } from "../../../types/admin";
import "./DoctorProfileDrawer.css";

interface AuditLogDetailDrawerProps {
  log: AdminAuditLogItem | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(d);
  } catch {
    return isoString;
  }
}

export default function AuditLogDetailDrawer({
  log,
  isOpen,
  onClose,
}: AuditLogDetailDrawerProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  if (!isOpen || !log) {
    return null;
  }

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const formattedJson = JSON.stringify(log.details, null, 2);

  return (
    <div
      className="doctor-drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-drawer-title"
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
              FORENSIC AUDIT RECORD & EVIDENCE
            </span>
            <div className="doctor-drawer-title-row">
              <div>
                <h2 id="audit-drawer-title" className="doctor-drawer-name">
                  {log.event_type}
                </h2>
                <span className="doctor-drawer-email">
                  <Clock size={13} className="inline-cell-icon text-cyan" />
                  {formatTimestamp(log.created_at)}
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
          {/* Section 1: Core Identifiers */}
          <div className="doctor-drawer-section">
            <h4 className="doctor-section-title">
              <Shield size={14} className="doctor-section-icon" />
              Event & Actor Coordinates
            </h4>
            <div className="doctor-id-cards-grid">
              <div className="doctor-id-card">
                <div className="doctor-id-label">Audit Log ID</div>
                <div className="doctor-id-value-row">
                  <span className="doctor-id-value" title={log.id}>
                    {log.id}
                  </span>
                  <button
                    type="button"
                    className="doctor-id-copy-btn"
                    onClick={() => handleCopy(log.id, "log-id")}
                    title="Copy Log ID"
                  >
                    {copiedKey === "log-id" ? (
                      <Check size={14} className="text-emerald" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>

              <div className="doctor-id-card">
                <div className="doctor-id-label">Actor User ID</div>
                <div className="doctor-id-value-row">
                  <span className="doctor-id-value" title={log.actor_user_id}>
                    {log.actor_user_id}
                  </span>
                  <button
                    type="button"
                    className="doctor-id-copy-btn"
                    onClick={() => handleCopy(log.actor_user_id, "actor")}
                    title="Copy Actor User ID"
                  >
                    {copiedKey === "actor" ? (
                      <Check size={14} className="text-emerald" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Target Resource Information */}
          <div className="doctor-drawer-section">
            <h4 className="doctor-section-title">
              <Lock size={14} className="doctor-section-icon" />
              Resource Target & Outcome
            </h4>
            <div className="doctor-meta-grid">
              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Resource Type</span>
                <span className="doctor-meta-value text-cyan">
                  {log.resource_type}
                </span>
              </div>

              <div className="doctor-meta-item">
                <span className="doctor-meta-label">Outcome</span>
                <span className="doctor-meta-value">
                  <span
                    className={`status-pill ${
                      log.outcome === "success"
                        ? "status-pill-emerald"
                        : log.outcome === "denied"
                          ? "status-pill-amber"
                          : "status-pill-rose"
                    }`}
                  >
                    {log.outcome.toUpperCase()}
                  </span>
                </span>
              </div>

              <div className="doctor-meta-item" style={{ gridColumn: "span 2" }}>
                <span className="doctor-meta-label">Target Resource ID</span>
                <span className="doctor-meta-value font-mono text-xs">
                  {log.resource_id}
                </span>
              </div>

              {log.patient_profile_id && (
                <div className="doctor-meta-item">
                  <span className="doctor-meta-label">Linked PatientProfile</span>
                  <span className="doctor-meta-value font-mono text-xs">
                    {log.patient_profile_id}
                  </span>
                </div>
              )}

              {log.doctor_profile_id && (
                <div className="doctor-meta-item">
                  <span className="doctor-meta-label">Linked DoctorProfile</span>
                  <span className="doctor-meta-value font-mono text-xs">
                    {log.doctor_profile_id}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Forensic Details JSON Payload */}
          <div className="doctor-drawer-section">
            <div className="audit-json-header">
              <h4 className="doctor-section-title" style={{ margin: 0 }}>
                <FileCode2 size={14} className="doctor-section-icon" />
                Forensic Payload (`details`)
              </h4>
              <button
                type="button"
                className="audit-copy-json-btn"
                onClick={() => handleCopy(formattedJson, "json")}
                title="Copy JSON Payload"
              >
                {copiedKey === "json" ? (
                  <>
                    <Check size={13} className="text-emerald" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>
            <pre className="audit-json-viewer">
              <code>{formattedJson}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

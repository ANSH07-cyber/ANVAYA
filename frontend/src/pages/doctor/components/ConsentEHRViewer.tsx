import { useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderLock,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { doctorService } from "../../../services/doctorService";
import type {
  DoctorSharedHealthRecordRead,
  HealthDataScope,
} from "../../../types/doctor";
import "./ConsentEHRViewer.css";

interface ConsentEHRViewerProps {
  patientProfileId: string;
  patientName?: string;
  onRequestAccess?: (missingScopes: HealthDataScope[]) => void;
}

const ALL_CLINICAL_SCOPES: { id: HealthDataScope; label: string }[] = [
  { id: "visit_summary", label: "Visit Summary" },
  { id: "diagnosis", label: "Diagnosis" },
  { id: "chief_complaint", label: "Chief Complaint" },
  { id: "symptoms", label: "Symptoms" },
  { id: "clinical_notes", label: "Clinical Notes" },
  { id: "treatment_plan", label: "Treatment Plan" },
  { id: "follow_up_instructions", label: "Follow-up" },
];

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

export default function ConsentEHRViewer({
  patientProfileId,
  onRequestAccess,
}: ConsentEHRViewerProps) {
  const [records, setRecords] = useState<DoctorSharedHealthRecordRead[]>([]);
  const [authorizedScopes, setAuthorizedScopes] = useState<HealthDataScope[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [consentStatus, setConsentStatus] = useState<"idle" | "authorized" | "restricted">("idle");
  const [restrictionDetail, setRestrictionDetail] = useState<string | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<HealthDataScope[]>([
    "visit_summary",
    "diagnosis",
    "chief_complaint",
    "symptoms",
    "clinical_notes",
    "treatment_plan",
    "follow_up_instructions",
  ]);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

  const missingScopes = ALL_CLINICAL_SCOPES.map((s) => s.id).filter(
    (s) => !authorizedScopes.includes(s)
  );

  const fetchRecords = async (scopesToRequest: HealthDataScope[] = selectedScopes) => {
    if (scopesToRequest.length === 0) return;
    setIsLoading(true);
    setRestrictionDetail(null);

    try {
      const response = await doctorService.getPatientHealthRecords(
        patientProfileId,
        scopesToRequest,
        20,
        0
      );
      setRecords(response.items);
      setAuthorizedScopes(response.requested_scopes);
      setConsentStatus("authorized");
      if (response.items.length > 0) {
        setExpandedRecordId(response.items[0].record_id);
      }
    } catch (err: unknown) {
      setConsentStatus("restricted");
      setRecords([]);
      setAuthorizedScopes([]);

      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string }; status?: number } }).response?.data?.detail
          : null;

      if (detail) {
        setRestrictionDetail(detail);
      } else {
        setRestrictionDetail("Patient health record access restricted. Consent could not be verified.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toggleScope = (scopeId: HealthDataScope) => {
    setSelectedScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId]
    );
  };

  return (
    <section className="doc-ehr-panel">
      {/* Panel Header */}
      <header className="doc-ehr-header">
        <div className="doc-ehr-title-group">
          <div className="doc-ehr-kicker">
            <FolderLock size={13} />
            <span>ELECTRONIC HEALTH RECORDS</span>
          </div>
          <h2 className="doc-ehr-title">Patient Medical History</h2>
        </div>

        {/* Consent Status Badge */}
        {consentStatus === "authorized" && (
          <span className="doc-consent-badge doc-consent-badge-active">
            <ShieldCheck size={13} />
            <span>Authorized for requested scopes</span>
          </span>
        )}
        {consentStatus === "restricted" && (
          <span className="doc-consent-badge doc-consent-badge-restricted">
            <ShieldAlert size={13} />
            <span>Access restricted</span>
          </span>
        )}
        {consentStatus === "idle" && (
          <span className="doc-consent-badge doc-consent-badge-idle">
            <Lock size={13} />
            <span>Consent check required</span>
          </span>
        )}
      </header>

      {/* Scope Selector Controls */}
      <div className="doc-ehr-scope-selector">
        <span className="doc-ehr-scope-label">Requested Information Scopes:</span>
        <div className="doc-ehr-scope-chips">
          {ALL_CLINICAL_SCOPES.map(({ id, label }) => {
            const isSelected = selectedScopes.includes(id);
            return (
              <button
                key={id}
                type="button"
                className={`doc-ehr-scope-chip ${isSelected ? "doc-ehr-scope-chip-selected" : ""}`}
                onClick={() => toggleScope(id)}
                disabled={isLoading}
              >
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button
            type="button"
            className="doc-btn doc-btn-secondary doc-btn-sm"
            onClick={() => void fetchRecords(selectedScopes)}
            disabled={isLoading || selectedScopes.length === 0}
          >
            <RefreshCw size={12} className={isLoading ? "doc-spin" : ""} />
            <span>{isLoading ? "Querying Consent & Records..." : "Query Patient Records"}</span>
          </button>
        </div>

        {consentStatus === "authorized" && missingScopes.length > 0 && onRequestAccess && (
          <div className="doc-ehr-partial-notice">
            <span>
              {missingScopes.length} scope{missingScopes.length > 1 ? "s are" : " is"} not authorized in the current patient consent.
            </span>
            <button
              type="button"
              className="doc-ehr-link-btn"
              onClick={() => onRequestAccess(missingScopes)}
            >
              Request Additional Scopes
            </button>
          </div>
        )}
      </div>

      {/* Body / Record Timeline */}
      <div className="doc-ehr-body">
        {/* Loading State */}
        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
            <div className="doc-skeleton-box" style={{ height: 40 }} />
            <div className="doc-skeleton-box" style={{ height: 60 }} />
            <div className="doc-skeleton-box" style={{ height: 60 }} />
          </div>
        )}

        {/* Access Restricted State */}
        {!isLoading && consentStatus === "restricted" && (
          <div className="doc-ehr-restricted-box">
            <AlertCircle size={20} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ color: "#ffffff", display: "block", marginBottom: 4 }}>
                Clinical Records Access Restricted
              </strong>
              <p style={{ margin: 0, color: "#cbd5e1", fontSize: "0.82rem", lineHeight: 1.5 }}>
                {restrictionDetail || "Access to patient medical history is protected under patient consent."}
              </p>
              <span className="doc-ehr-restricted-hint">
                In strict compliance with DPDP and medical privacy standards, historical records are withheld without verified patient consent. Clinical documentation for today's encounter remains fully accessible.
              </span>
              {onRequestAccess && (
                <button
                  type="button"
                  className="doc-ehr-request-btn"
                  onClick={() => onRequestAccess(selectedScopes)}
                >
                  <FolderLock size={14} />
                  <span>Request Patient EHR Access</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Idle Initial State */}
        {!isLoading && consentStatus === "idle" && (
          <div className="doc-ehr-idle-box">
            <Lock size={22} color="#0ea5e9" />
            <strong style={{ color: "#ffffff", fontSize: "0.9rem" }}>Consent-Gated Clinical Workspace</strong>
            <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.82rem", maxWidth: 380, textAlign: "center" }}>
              Click <strong>Query Patient Records</strong> to evaluate active patient consent and securely retrieve authorized historical records.
            </p>
          </div>
        )}

        {/* Authorized Records View */}
        {!isLoading && consentStatus === "authorized" && (
          records.length > 0 ? (
            <div className="doc-ehr-records-list">
              <span style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
                {records.length} Previous Encounter{records.length > 1 ? "s" : ""} on Record
              </span>

              {records.map((record) => {
                const isExpanded = expandedRecordId === record.record_id;
                return (
                  <article key={record.record_id} className="doc-ehr-record-card">
                    <header
                      className="doc-ehr-record-header"
                      onClick={() => setExpandedRecordId(isExpanded ? null : record.record_id)}
                    >
                      <div className="doc-ehr-record-header-left">
                        <Calendar size={13} color="#0ea5e9" />
                        <span className="doc-ehr-record-date">
                          {formatKolkataDate(record.visit_date)}
                        </span>
                        {record.data.diagnosis && (
                          <span className="doc-ehr-record-dx">
                            {record.data.diagnosis}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="doc-ehr-expand-btn"
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </header>

                    {isExpanded && (
                      <div className="doc-ehr-record-content">
                        {/* Visit Summary */}
                        {authorizedScopes.includes("visit_summary") && (
                          <div className="doc-ehr-field">
                            <span className="doc-ehr-field-title">Visit Summary</span>
                            <p className="doc-ehr-field-val">
                              {record.data.visit_summary || "No summary recorded"}
                            </p>
                          </div>
                        )}

                        {/* Chief Complaint */}
                        {authorizedScopes.includes("chief_complaint") && record.data.chief_complaint && (
                          <div className="doc-ehr-field">
                            <span className="doc-ehr-field-title">Chief Complaint</span>
                            <p className="doc-ehr-field-val">{record.data.chief_complaint}</p>
                          </div>
                        )}

                        {/* Symptoms */}
                        {authorizedScopes.includes("symptoms") && record.data.symptoms && (
                          <div className="doc-ehr-field">
                            <span className="doc-ehr-field-title">Symptoms</span>
                            <p className="doc-ehr-field-val">{record.data.symptoms}</p>
                          </div>
                        )}

                        {/* Clinical Notes */}
                        {authorizedScopes.includes("clinical_notes") && record.data.clinical_notes && (
                          <div className="doc-ehr-field">
                            <span className="doc-ehr-field-title">Clinical Notes</span>
                            <p className="doc-ehr-field-val">{record.data.clinical_notes}</p>
                          </div>
                        )}

                        {/* Treatment Plan */}
                        {authorizedScopes.includes("treatment_plan") && record.data.treatment_plan && (
                          <div className="doc-ehr-field">
                            <span className="doc-ehr-field-title">Treatment Plan</span>
                            <p className="doc-ehr-field-val">{record.data.treatment_plan}</p>
                          </div>
                        )}

                        {/* Follow Up */}
                        {authorizedScopes.includes("follow_up_instructions") && record.data.follow_up_instructions && (
                          <div className="doc-ehr-field">
                            <span className="doc-ehr-field-title">Follow-up</span>
                            <p className="doc-ehr-field-val">{record.data.follow_up_instructions}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="doc-ehr-idle-box">
              <CheckCircle2 size={22} color="#34d399" />
              <strong style={{ color: "#ffffff" }}>Consent Active · No Prior Encounters</strong>
              <p style={{ margin: 0, color: "#94a3b8", fontSize: "0.82rem", textAlign: "center" }}>
                Patient has granted consent for the requested scopes, but no historical clinical records have been documented yet.
              </p>
            </div>
          )
        )}
      </div>
    </section>
  );
}


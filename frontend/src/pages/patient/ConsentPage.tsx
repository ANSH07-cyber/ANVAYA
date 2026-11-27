import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileCheck2,
  Layers,
  ListFilter,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Stethoscope,
  UserRound,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import PortalLayout from "../../layouts/PortalLayout";
import { patientNavigation } from "./patientNavigation";
import { consentService } from "../../services/consentService";
import { fetchCompleteConsentHistory } from "../../services/consentPagination";
import PatientPendingRequestsSection from "../../components/patient/PatientPendingRequestsSection";
import RevokeGrantModal from "../../components/patient/RevokeGrantModal";
import RevokeAllDoctorConsentModal from "../../components/patient/RevokeAllDoctorConsentModal";
import { formatDoctorDisplayName } from "../../utils/formatters";

import type {
  ConsentDoctor,
  HealthDataScope,
  PatientConsent,
} from "../../types/consent";

import "./ConsentPage.css";

const scopeOptions: {
  value: HealthDataScope;
  label: string;
  description: string;
}[] = [
  {
    value: "visit_summary",
    label: "Visit summary",
    description: "Summary of your previous medical consultations.",
  },
  {
    value: "chief_complaint",
    label: "Chief complaint",
    description: "The primary concern recorded during a visit.",
  },
  {
    value: "symptoms",
    label: "Symptoms",
    description: "Symptoms documented in your health records.",
  },
  {
    value: "diagnosis",
    label: "Diagnosis",
    description: "Diagnoses recorded by your healthcare provider.",
  },
  {
    value: "clinical_notes",
    label: "Clinical notes",
    description: "Additional clinical observations and notes.",
  },
  {
    value: "treatment_plan",
    label: "Treatment plan",
    description: "Recommended treatment and care information.",
  },
  {
    value: "follow_up_instructions",
    label: "Follow-up instructions",
    description: "Instructions and recommendations for future care.",
  },
];

function formatDate(value: string | null) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error
  ) {
    const response = error.response as {
      data?: { detail?: string };
    };

    if (response.data?.detail) return response.data.detail;
  }

  return fallback;
}

interface DoctorConsentGroup {
  doctorId: string;
  doctor: ConsentDoctor | undefined;
  activeGrants: PatientConsent[];
  revokedGrants: PatientConsent[];
  allGrants: PatientConsent[];
  activeScopesUnion: HealthDataScope[];
  hasActiveAccess: boolean;
}

export default function ConsentPage() {
  const { user } = useAuth();
  const displayName = user?.full_name?.trim() || "Patient";

  const [doctors, setDoctors] = useState<ConsentDoctor[]>([]);
  const [consents, setConsents] = useState<PatientConsent[]>([]);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [loadingPending, setLoadingPending] = useState<boolean>(true);

  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<HealthDataScope[]>([]);

  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [loadingConsents, setLoadingConsents] = useState(true);

  const [doctorError, setDoctorError] = useState("");
  const [consentError, setConsentError] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [granting, setGranting] = useState(false);

  // Pagination completeness tracking
  const [isHistoryComplete, setIsHistoryComplete] = useState<boolean>(true);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [serverReportedTotal, setServerReportedTotal] = useState<number>(0);

  // History presentation mode and expansion
  const [historyViewMode, setHistoryViewMode] = useState<"grouped" | "chronological">("grouped");
  const [expandedDoctorIds, setExpandedDoctorIds] = useState<Set<string>>(new Set());

  // Modal states for Step 4
  const [singleRevokeConsent, setSingleRevokeConsent] = useState<PatientConsent | null>(null);
  const [singleRevokeDoctor, setSingleRevokeDoctor] = useState<ConsentDoctor | null>(null);
  const [singleRevokeOverlapCount, setSingleRevokeOverlapCount] = useState<number>(0);

  const [revokeAllDoctorId, setRevokeAllDoctorId] = useState<string | null>(null);
  const [revokeAllDoctor, setRevokeAllDoctor] = useState<ConsentDoctor | null>(null);
  const [revokeAllActiveCount, setRevokeAllActiveCount] = useState<number>(0);
  const [revokeAllScopesUnion, setRevokeAllScopesUnion] = useState<HealthDataScope[]>([]);

  const activeCount = useMemo(
    () => consents.filter((consent) => consent.is_active).length,
    [consents],
  );

  const revokedCount = useMemo(
    () => consents.filter((consent) => !consent.is_active).length,
    [consents],
  );

  const doctorMap = useMemo(
    () => new Map(doctors.map((doctor) => [doctor.id, doctor])),
    [doctors],
  );

  // Memoized Doctor Groups for "Group by Doctor" presentation
  const doctorGroups = useMemo<DoctorConsentGroup[]>(() => {
    const groupMap = new Map<string, PatientConsent[]>();

    for (const consent of consents) {
      const list = groupMap.get(consent.doctor_profile_id) || [];
      list.push(consent);
      groupMap.set(consent.doctor_profile_id, list);
    }

    const groups: DoctorConsentGroup[] = [];

    for (const [doctorId, doctorGrants] of groupMap.entries()) {
      const activeGrants = doctorGrants.filter((c) => c.is_active);
      const revokedGrants = doctorGrants.filter((c) => !c.is_active);
      const activeScopesSet = new Set<HealthDataScope>();
      for (const g of activeGrants) {
        for (const s of g.data_scopes) {
          activeScopesSet.add(s);
        }
      }

      groups.push({
        doctorId,
        doctor: doctorMap.get(doctorId),
        activeGrants,
        revokedGrants,
        allGrants: doctorGrants,
        activeScopesUnion: Array.from(activeScopesSet),
        hasActiveAccess: activeGrants.length > 0,
      });
    }

    // Sort: Doctors with active access first (newest active grant first), then inactive
    groups.sort((a, b) => {
      if (a.hasActiveAccess && !b.hasActiveAccess) return -1;
      if (!a.hasActiveAccess && b.hasActiveAccess) return 1;
      const aDate = a.allGrants[0]?.granted_at || "";
      const bDate = b.allGrants[0]?.granted_at || "";
      return bDate.localeCompare(aDate);
    });

    return groups;
  }, [consents, doctorMap]);

  function toggleDoctorExpanded(doctorId: string) {
    setExpandedDoctorIds((prev) => {
      const next = new Set(prev);
      if (next.has(doctorId)) {
        next.delete(doctorId);
      } else {
        next.add(doctorId);
      }
      return next;
    });
  }

  const loadDoctors = useCallback(async () => {
    setLoadingDoctors(true);
    setDoctorError("");

    try {
      const response = await consentService.getDoctors();
      setDoctors(response.items);
    } catch (error) {
      setDoctorError(
        getErrorMessage(error, "Unable to load approved doctors."),
      );
    } finally {
      setLoadingDoctors(false);
    }
  }, []);

  // Bounded safe pagination loader: fetches complete consent history without truncation
  const loadConsents = useCallback(async () => {
    setLoadingConsents(true);
    setConsentError("");
    setHistoryWarning(null);

    const result = await fetchCompleteConsentHistory(consentService.getMyConsents, {
      pageSize: 100,
      maxPages: 100,
    });

    setConsents(result.items);
    setServerReportedTotal(result.serverTotal);
    setIsHistoryComplete(result.isComplete);

    if (result.hasPartialError && result.errorMessage) {
      setHistoryWarning(result.errorMessage);
      if (result.items.length === 0) {
        setConsentError(result.errorMessage);
      }
    } else {
      setHistoryWarning(null);
    }

    setLoadingConsents(false);
  }, []);

  useEffect(() => {
    void loadDoctors();
    void loadConsents();
  }, [loadDoctors, loadConsents]);

  function toggleScope(scope: HealthDataScope) {
    setSelectedScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  async function handleGrantConsent() {
    if (!selectedDoctor || selectedScopes.length === 0) return;

    setGranting(true);
    setActionError("");
    setSuccessMessage("");

    try {
      await consentService.grantConsent({
        doctor_profile_id: selectedDoctor,
        data_scopes: selectedScopes,
      });

      setSelectedDoctor("");
      setSelectedScopes([]);

      setSuccessMessage(
        "Consent granted successfully. Your selected health information can now be accessed by the doctor.",
      );

      await loadConsents();
    } catch (error) {
      setActionError(
        getErrorMessage(error, "Unable to grant consent. Please try again."),
      );
    } finally {
      setGranting(false);
    }
  }

  // Open individual grant revocation modal
  function handleOpenSingleRevoke(consent: PatientConsent) {
    const doctor = doctorMap.get(consent.doctor_profile_id) || null;
    const otherActiveCount = consents.filter(
      (c) =>
        c.doctor_profile_id === consent.doctor_profile_id &&
        c.is_active &&
        c.id !== consent.id,
    ).length;
    setSingleRevokeConsent(consent);
    setSingleRevokeDoctor(doctor);
    setSingleRevokeOverlapCount(otherActiveCount);
  }

  // Open doctor-wide revoke all modal
  function handleOpenRevokeAll(doctorId: string) {
    const doctor = doctorMap.get(doctorId) || null;
    const activeForDoctor = consents.filter(
      (c) => c.doctor_profile_id === doctorId && c.is_active,
    );
    const unionScopes = Array.from(
      new Set(activeForDoctor.flatMap((c) => c.data_scopes)),
    );
    setRevokeAllDoctorId(doctorId);
    setRevokeAllDoctor(doctor);
    setRevokeAllActiveCount(activeForDoctor.length);
    setRevokeAllScopesUnion(unionScopes);
  }

  return (
    <PortalLayout
      roleLabel="Patient"
      userName={displayName}
      userMeta="Patient workspace"
      navItems={patientNavigation}
    >
      <main className="consent-page">
        <section className="consent-heading">
          <div>
            <span className="consent-eyebrow">
              PRIVACY & DATA CONTROL
            </span>

            <h1>Consent & Privacy</h1>

            <p>
              Your health information belongs to you. Choose what you share,
              decide who can access it, and manage your permissions whenever
              you need.
            </p>
          </div>

          <div className="consent-heading-icon">
            <ShieldCheck size={29} strokeWidth={1.8} />
          </div>
        </section>

        <section className="consent-trust-banner">
          <div className="consent-trust-icon">
            <LockKeyhole size={23} />
          </div>

          <div>
            <strong>Your health data. Your decision.</strong>
            <p>
              Access is based on the specific permissions you grant. You can
              revoke an active consent at any time.
            </p>
          </div>
        </section>

        <section className="consent-stats">
          <article className="consent-stat-card">
            <div className="consent-stat-icon teal">
              <FileCheck2 size={21} />
            </div>
            <div>
              <small>Total consent records</small>
              <strong>
                {loadingConsents
                  ? "—"
                  : isHistoryComplete
                    ? consents.length
                    : `${consents.length} / ${serverReportedTotal} (Partial)`}
              </strong>
            </div>
          </article>

          <article className="consent-stat-card">
            <div className="consent-stat-icon green">
              <ShieldCheck size={21} />
            </div>
            <div>
              <small>Active access</small>
              <strong>
                {loadingConsents
                  ? "—"
                  : isHistoryComplete
                    ? activeCount
                    : `${activeCount}+ (Unverified)`}
              </strong>
            </div>
          </article>

          <article className="consent-stat-card">
            <div className="consent-stat-icon gray">
              <ShieldOff size={21} />
            </div>
            <div>
              <small>Revoked access</small>
              <strong>
                {loadingConsents ? "—" : revokedCount}
              </strong>
            </div>
          </article>

          <article className="consent-stat-card">
            <div className="consent-stat-icon amber">
              <Clock3 size={21} />
            </div>
            <div>
              <small>Pending requests</small>
              <strong>
                {loadingPending ? "—" : pendingCount}
              </strong>
            </div>
          </article>
        </section>

        {successMessage && (
          <div className="consent-alert success" role="status">
            <CheckCircle2 size={19} />
            <span>{successMessage}</span>
            <button
              type="button"
              aria-label="Dismiss success message"
              onClick={() => setSuccessMessage("")}
            >
              ×
            </button>
          </div>
        )}

        {actionError && (
          <div className="consent-alert error" role="alert">
            <AlertCircle size={19} />
            <span>{actionError}</span>
            <button
              type="button"
              aria-label="Dismiss error message"
              onClick={() => setActionError("")}
            >
              ×
            </button>
          </div>
        )}

        <PatientPendingRequestsSection
          onResolved={(message) => {
            if (message) {
              setSuccessMessage(message);
            }
            void loadConsents();
          }}
          onPendingCountChange={(count) => {
            setPendingCount(count);
            setLoadingPending(false);
          }}
        />

        <section className="consent-grant-section">
          <div className="consent-section-heading">
            <div>
              <span className="consent-section-kicker">
                MANAGE ACCESS
              </span>
              <h2>Grant doctor access</h2>
              <p>
                Select a verified doctor and choose the health information
                they are allowed to access.
              </p>
            </div>

            <div className="consent-section-icon">
              <UserRound size={23} />
            </div>
          </div>

          <div className="consent-form-card">
            <label className="consent-field-label" htmlFor="consent-doctor">
              Select doctor
            </label>

            <div className="consent-doctor-select-wrap">
              <Stethoscope size={19} />

              <select
                id="consent-doctor"
                value={selectedDoctor}
                onChange={(event) => setSelectedDoctor(event.target.value)}
                disabled={loadingDoctors || granting}
              >
                <option value="">
                  {loadingDoctors
                    ? "Loading approved doctors..."
                    : "Choose a doctor"}
                </option>

                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {formatDoctorDisplayName(doctor.full_name)} — {doctor.specialization}
                  </option>
                ))}
              </select>
            </div>

            {doctorError && (
              <div className="consent-inline-error">
                <span>{doctorError}</span>
                <button type="button" onClick={() => void loadDoctors()}>
                  Retry
                </button>
              </div>
            )}

            {!loadingDoctors && !doctorError && doctors.length === 0 && (
              <p className="consent-field-hint">
                No approved doctors are currently available.
              </p>
            )}

            {selectedDoctor && doctorMap.get(selectedDoctor) && (
              <div className="consent-selected-doctor">
                <div className="consent-doctor-avatar">
                  <Stethoscope size={21} />
                </div>

                <div>
                  <strong>
                    {formatDoctorDisplayName(doctorMap.get(selectedDoctor)?.full_name)}
                  </strong>
                  <span>
                    {doctorMap.get(selectedDoctor)?.qualification} ·{" "}
                    {doctorMap.get(selectedDoctor)?.specialization}
                  </span>
                </div>

                <CheckCircle2 size={19} />
              </div>
            )}

            <div className="consent-permissions-heading">
              <div>
                <label className="consent-field-label">
                  Choose health-data permissions
                </label>
                <p>
                  Select only the information you want to share.
                </p>
              </div>

              <span className="consent-selection-count">
                {selectedScopes.length} / 7 selected
              </span>
            </div>

            <div className="consent-scope-list">
              {scopeOptions.map((scope) => (
                <label
                  className={`consent-scope-option ${
                    selectedScopes.includes(scope.value) ? "selected" : ""
                  }`}
                  key={scope.value}
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope.value)}
                    disabled={granting}
                    onChange={() => toggleScope(scope.value)}
                  />

                  <span className="consent-custom-checkbox">
                    <CheckCircle2 size={16} />
                  </span>

                  <span className="consent-scope-copy">
                    <strong>{scope.label}</strong>
                    <small>{scope.description}</small>
                  </span>
                </label>
              ))}
            </div>

            <div className="consent-form-footer">
              <p>
                <LockKeyhole size={15} />
                At least one permission is required.
              </p>

              <button
                type="button"
                className="consent-grant-button"
                disabled={
                  !selectedDoctor ||
                  selectedScopes.length === 0 ||
                  granting ||
                  loadingDoctors
                }
                onClick={() => void handleGrantConsent()}
              >
                {granting ? (
                  <>
                    <RefreshCw size={17} className="consent-spin" />
                    Granting access...
                  </>
                ) : (
                  <>
                    <ShieldCheck size={17} />
                    Grant consent
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        <section className="consent-history-section">
          <div className="consent-section-heading">
            <div>
              <span className="consent-section-kicker">
                TRANSPARENCY & CONTROL
              </span>
              <h2>Your consent history</h2>
              <p>
                Review which doctors have access to your health information and manage
                individual or doctor-wide permissions.
              </p>
            </div>

            <div className="consent-history-controls">
              {/* View Switcher: Group by Doctor vs Chronological */}
              <div className="consent-view-toggle" role="tablist" aria-label="Consent history presentation">
                <button
                  type="button"
                  role="tab"
                  aria-selected={historyViewMode === "grouped"}
                  className={`consent-view-toggle-btn ${historyViewMode === "grouped" ? "active" : ""}`}
                  onClick={() => setHistoryViewMode("grouped")}
                >
                  <Layers size={15} />
                  Group by Doctor
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={historyViewMode === "chronological"}
                  className={`consent-view-toggle-btn ${historyViewMode === "chronological" ? "active" : ""}`}
                  onClick={() => setHistoryViewMode("chronological")}
                >
                  <ListFilter size={15} />
                  Chronological
                </button>
              </div>

              <button
                type="button"
                className="consent-refresh-button"
                onClick={() => void loadConsents()}
                disabled={loadingConsents}
                aria-label="Refresh consent history"
              >
                <RefreshCw
                  size={16}
                  className={loadingConsents ? "consent-spin" : ""}
                />
                Refresh
              </button>
            </div>
          </div>

          {!isHistoryComplete && !loadingConsents && (
            <div className="consent-partial-warning" role="alert">
              <AlertCircle size={20} />
              <div className="consent-partial-warning-copy">
                <strong>Incomplete Consent History Loaded</strong>
                <p>
                  Loaded {consents.length} of {serverReportedTotal} records.{" "}
                  {historyWarning || "Some historical or active records could not be retrieved."}{" "}
                  Doctor active-grant totals and Revoke-All actions are disabled until all records are verified.
                </p>
              </div>
              <button
                type="button"
                className="consent-partial-retry-btn"
                onClick={() => void loadConsents()}
              >
                Retry Full Load
              </button>
            </div>
          )}

          {consentError && (
            <div className="consent-history-error" role="alert">
              <AlertCircle size={20} />
              <span>{consentError}</span>
              <button type="button" onClick={() => void loadConsents()}>
                Try again
              </button>
            </div>
          )}

          {loadingConsents ? (
            <div className="consent-empty-state">
              <RefreshCw size={25} className="consent-spin" />
              <strong>Loading consent records</strong>
              <span>Please wait while we retrieve your permissions securely.</span>
            </div>
          ) : !consentError && consents.length === 0 ? (
            <div className="consent-empty-state">
              <div className="consent-empty-icon">
                <ShieldCheck size={27} />
              </div>
              <strong>No consent records yet</strong>
              <span>
                When you grant a doctor access or approve an access request,
                your active and historical consent records will appear here.
              </span>
            </div>
          ) : (
            !consentError && (
              <>
                {/* VIEW 1: GROUPED BY DOCTOR */}
                {historyViewMode === "grouped" ? (
                  <div className="consent-doctor-groups-list">
                    {doctorGroups.map((group) => {
                      const doctorDisplayName = formatDoctorDisplayName(
                        group.doctor?.full_name,
                        "Doctor information unavailable",
                      );
                      const doctorSpecialty =
                        group.doctor?.specialization || "Clinical Provider";
                      const clinicName =
                        group.doctor?.clinic_name || "ANVAYA Partner Clinic";
                      const isExpanded = expandedDoctorIds.has(group.doctorId);

                      return (
                        <article
                          className="consent-doctor-group-card"
                          key={group.doctorId}
                        >
                          {/* Doctor Group Top */}
                          <div className="consent-doctor-group-header">
                            <div className="consent-history-doctor">
                              <div className="consent-doctor-avatar">
                                <Stethoscope size={22} />
                              </div>
                              <div>
                                <strong className="consent-group-doc-name">
                                  {doctorDisplayName}
                                </strong>
                                <span className="consent-group-doc-meta">
                                  {doctorSpecialty} · {clinicName}
                                </span>
                              </div>
                            </div>

                            <span
                              className={`consent-status ${
                                group.hasActiveAccess ? "active" : "revoked"
                              }`}
                            >
                              {group.hasActiveAccess ? (
                                <CheckCircle2 size={14} />
                              ) : (
                                <ShieldOff size={14} />
                              )}
                              {group.hasActiveAccess
                                ? isHistoryComplete
                                  ? `Active Access (${group.activeGrants.length} active grant${group.activeGrants.length === 1 ? "" : "s"})`
                                  : `Active Access (${group.activeGrants.length}+ unverified)`
                                : "All Grants Revoked"}
                            </span>
                          </div>

                          {/* Active Permissions Summary Banner */}
                          {group.hasActiveAccess && (
                            <div className="consent-group-active-summary">
                              <div className="consent-group-active-info">
                                <span className="consent-group-summary-title">
                                  <ShieldCheck size={16} />
                                  Currently Authorized Health Records ({group.activeScopesUnion.length}):
                                </span>
                                <div className="consent-scope-tags">
                                  {group.activeScopesUnion.map((scope) => {
                                    const option = scopeOptions.find(
                                      (item) => item.value === scope,
                                    );
                                    return (
                                      <span key={scope} className="consent-scope-active-chip">
                                        {option?.label || scope}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>

                              <button
                                type="button"
                                className="consent-doctor-revoke-all-btn"
                                disabled={!isHistoryComplete}
                                title={!isHistoryComplete ? "Revoke-all is disabled because complete consent history could not be verified." : undefined}
                                onClick={() => handleOpenRevokeAll(group.doctorId)}
                                aria-label={`Revoke all access for ${doctorDisplayName}`}
                              >
                                <ShieldAlert size={15} />
                                {!isHistoryComplete ? "Revoke All (Disabled: Incomplete History)" : "Revoke All Doctor Access"}
                              </button>
                            </div>
                          )}

                          {/* Toggle Individual Grants Accordion */}
                          <div className="consent-group-toggle-wrap">
                            <button
                              type="button"
                              className="consent-group-toggle-btn"
                              onClick={() => toggleDoctorExpanded(group.doctorId)}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? (
                                <ChevronUp size={16} />
                              ) : (
                                <ChevronDown size={16} />
                              )}
                              <span>
                                {isExpanded ? "Hide" : "Show"} Grant Details (
                                {group.allGrants.length} historical record
                                {group.allGrants.length === 1 ? "" : "s"})
                              </span>
                            </button>
                          </div>

                          {/* Expanded Individual Grant Cards */}
                          {isExpanded && (
                            <div className="consent-group-grants-list">
                              {group.allGrants.map((grant) => (
                                <div
                                  key={grant.id}
                                  className={`consent-group-grant-item ${
                                    grant.is_active ? "grant-active" : "grant-revoked"
                                  }`}
                                >
                                  <div className="consent-grant-item-top">
                                    <div className="consent-grant-item-meta">
                                      <span className="consent-grant-id-badge">
                                        Grant #{grant.id.slice(0, 8)}
                                      </span>
                                      <span className="consent-grant-date-badge">
                                        <Clock3 size={13} />
                                        Granted: {formatDate(grant.granted_at)}
                                      </span>
                                      {grant.revoked_at && (
                                        <span className="consent-grant-revoked-badge">
                                          <ShieldOff size={13} />
                                          Revoked: {formatDate(grant.revoked_at)}
                                        </span>
                                      )}
                                    </div>

                                    <span
                                      className={`consent-status small ${
                                        grant.is_active ? "active" : "revoked"
                                      }`}
                                    >
                                      {grant.is_active ? "Active Grant" : "Revoked"}
                                    </span>
                                  </div>

                                  <div className="consent-grant-item-scopes">
                                    <span className="consent-grant-scopes-label">
                                      Authorized Scopes ({grant.data_scopes.length}):
                                    </span>
                                    <div className="consent-scope-tags">
                                      {grant.data_scopes.map((scope) => {
                                        const option = scopeOptions.find(
                                          (item) => item.value === scope,
                                        );
                                        return (
                                          <span key={scope}>
                                            {option?.label || scope}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {grant.is_active && (
                                    <div className="consent-grant-item-footer">
                                      <span className="consent-grant-notice">
                                        Revoking this grant affects only this specific record.
                                      </span>
                                      <button
                                        type="button"
                                        className="consent-revoke-button"
                                        onClick={() => handleOpenSingleRevoke(grant)}
                                      >
                                        <ShieldOff size={15} />
                                        Revoke This Grant
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  /* VIEW 2: FLAT CHRONOLOGICAL STREAM */
                  <div className="consent-history-list">
                    {consents.map((consent) => {
                      const doctor = doctorMap.get(consent.doctor_profile_id);
                      const otherActiveCount = consents.filter(
                        (c) =>
                          c.doctor_profile_id === consent.doctor_profile_id &&
                          c.is_active &&
                          c.id !== consent.id,
                      ).length;

                      return (
                        <article
                          className="consent-history-card"
                          key={consent.id}
                        >
                          <div className="consent-history-top">
                            <div className="consent-history-doctor">
                              <div className="consent-doctor-avatar">
                                <Stethoscope size={21} />
                              </div>

                              <div>
                                <strong>
                                  {formatDoctorDisplayName(
                                    doctor?.full_name,
                                    "Doctor information unavailable",
                                  )}
                                </strong>
                                <span>
                                  {doctor?.specialization ||
                                    "Doctor profile details unavailable"}
                                </span>
                              </div>
                            </div>

                            <span
                              className={`consent-status ${
                                consent.is_active ? "active" : "revoked"
                              }`}
                            >
                              {consent.is_active ? (
                                <CheckCircle2 size={14} />
                              ) : (
                                <ShieldOff size={14} />
                              )}
                              {consent.is_active ? "Active" : "Revoked"}
                            </span>
                          </div>

                          <div className="consent-history-dates">
                            <div>
                              <Clock3 size={15} />
                              <span>
                                Granted: {formatDate(consent.granted_at)}
                              </span>
                            </div>

                            {consent.revoked_at && (
                              <div>
                                <ShieldOff size={15} />
                                <span>
                                  Revoked: {formatDate(consent.revoked_at)}
                                </span>
                              </div>
                            )}

                            <div>
                              <span className="consent-grant-id-badge">
                                ID: #{consent.id.slice(0, 8)}
                              </span>
                            </div>
                          </div>

                          <div className="consent-history-permissions">
                            <strong>Shared information ({consent.data_scopes.length})</strong>
                            <div className="consent-scope-tags">
                              {consent.data_scopes.map((scope) => {
                                const option = scopeOptions.find(
                                  (item) => item.value === scope,
                                );

                                return (
                                  <span key={scope}>
                                    {option?.label || scope}
                                  </span>
                                );
                              })}
                            </div>
                          </div>

                          {consent.is_active && (
                            <div className="consent-history-footer">
                              <span>
                                {otherActiveCount > 0
                                  ? `Doctor has ${otherActiveCount} other active grant(s).`
                                  : "You can revoke this doctor's access at any time."}
                              </span>

                              <div className="consent-history-action-group">
                                {otherActiveCount > 0 && (
                                  <button
                                    type="button"
                                    className="consent-btn-revoke-all-link"
                                    onClick={() => handleOpenRevokeAll(consent.doctor_profile_id)}
                                  >
                                    <ShieldAlert size={14} />
                                    Revoke All for {formatDoctorDisplayName(doctor?.full_name, "Doctor")}
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="consent-revoke-button"
                                  onClick={() => handleOpenSingleRevoke(consent)}
                                >
                                  <ShieldOff size={15} />
                                  Revoke This Grant
                                </button>
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </>
            )
          )}
        </section>

        {/* Individual Grant Revocation Modal */}
        {singleRevokeConsent && (
          <RevokeGrantModal
            isOpen={Boolean(singleRevokeConsent)}
            consent={singleRevokeConsent}
            doctor={singleRevokeDoctor}
            overlappingActiveGrantsCount={singleRevokeOverlapCount}
            onClose={() => setSingleRevokeConsent(null)}
            onSuccess={(_revoked, message) => {
              setSuccessMessage(message);
              void loadConsents();
            }}
          />
        )}

        {/* Doctor-Wide Revoke-All Modal */}
        {revokeAllDoctorId && (
          <RevokeAllDoctorConsentModal
            isOpen={Boolean(revokeAllDoctorId)}
            doctorProfileId={revokeAllDoctorId}
            doctor={revokeAllDoctor}
            activeGrantsCount={revokeAllActiveCount}
            authorizedScopesUnion={revokeAllScopesUnion}
            isHistoryComplete={isHistoryComplete}
            onClose={() => setRevokeAllDoctorId(null)}
            onSuccess={(_revokedList, message) => {
              setSuccessMessage(message);
              void loadConsents();
            }}
            onCheckStatus={() => void loadConsents()}
          />
        )}
      </main>
    </PortalLayout>
  );
}
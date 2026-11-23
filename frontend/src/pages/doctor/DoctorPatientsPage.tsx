import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FolderHeart,
  FolderLock,
  Info,
  Lock,
  Phone,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  User,
  Users,
  X,
} from "lucide-react";

import DoctorLayout from "../../layouts/DoctorLayout";
import { doctorService } from "../../services/doctorService";
import { consentService } from "../../services/consentService";
import DoctorConsentRequestModal from "../../components/doctor/DoctorConsentRequestModal";
import type {
  DoctorPatientDirectoryFilterParams,
  DoctorPatientDirectoryItem,
  DoctorPatientDirectoryResponse,
} from "../../types/doctor";
import type {
  ConsentRequestRead,
  DoctorPatientConsentStatus,
  HealthDataScope,
} from "../../types/consent";
import ConsentEHRViewer from "./components/ConsentEHRViewer";
import "./DoctorPatientsPage.css";

const PAGE_SIZE = 20;

type ConsentFilterType = "all" | "active" | "inactive";

function formatDisplayDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
    }).format(dateObj);
  } catch {
    return dateStr;
  }
}

function getPatientInitials(name: string): string {
  if (!name) return "PT";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data && typeof data === "object") {
      if ("detail" in data) {
        const detail = (data as { detail: unknown }).detail;
        if (typeof detail === "string") return detail;
        if (Array.isArray(detail)) {
          return detail
            .map((item) =>
              typeof item === "object" && item && "msg" in item
                ? String(item.msg)
                : JSON.stringify(item),
            )
            .join("; ");
        }
      }
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export default function DoctorPatientsPage() {
  const [patients, setPatients] = useState<DoctorPatientDirectoryItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter State
  const [searchInput, setSearchInput] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [consentFilter, setConsentFilter] = useState<ConsentFilterType>("all");

  // Pagination State
  const [offset, setOffset] = useState<number>(0);

  // Selected patient for Consent-Gated EHR Drawer
  const [selectedPatientForEHR, setSelectedPatientForEHR] =
    useState<DoctorPatientDirectoryItem | null>(null);

  // Request race-condition tracking
  const latestRequestIdRef = useRef<number>(0);

  // On-demand Consent Status Cache
  const [consentStatusMap, setConsentStatusMap] = useState<
    Record<string, DoctorPatientConsentStatus>
  >({});
  const [loadingStatusId, setLoadingStatusId] = useState<string | null>(null);

  // Consent Request Modal State
  const [consentModalPatient, setConsentModalPatient] =
    useState<DoctorPatientDirectoryItem | null>(null);
  const [modalActiveScopes, setModalActiveScopes] = useState<HealthDataScope[]>([]);
  const [modalPrefillScopes, setModalPrefillScopes] = useState<HealthDataScope[]>([]);

  // Action feedback banner
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const handleInitiateConsentRequest = async (
    patient: DoctorPatientDirectoryItem,
    prefillScopes?: HealthDataScope[],
  ) => {
    setActionFeedback(null);
    const cachedStatus = consentStatusMap[patient.patient_profile_id];

    if (cachedStatus) {
      if (cachedStatus.pending_request) {
        setActionFeedback({
          type: "info",
          message: `A consent request sent on ${new Date(cachedStatus.pending_request.created_at).toLocaleDateString()} is already awaiting patient review.`,
        });
        return;
      }
      if (cachedStatus.active_scopes.length === 7) {
        setActionFeedback({
          type: "info",
          message: `All 7 clinical scopes are already authorized for ${patient.full_name}.`,
        });
        setSelectedPatientForEHR(patient);
        return;
      }
      if (!cachedStatus.can_request_consent) {
        setActionFeedback({
          type: "error",
          message: `Cannot request consent. An established appointment relationship is required.`,
        });
        return;
      }

      setModalActiveScopes(cachedStatus.active_scopes);
      setModalPrefillScopes(prefillScopes || []);
      setConsentModalPatient(patient);
      return;
    }

    setLoadingStatusId(patient.patient_profile_id);
    try {
      const status = await consentService.getDoctorPatientConsentStatus(
        patient.patient_profile_id,
      );
      setConsentStatusMap((prev) => ({
        ...prev,
        [patient.patient_profile_id]: status,
      }));

      if (status.pending_request) {
        setActionFeedback({
          type: "info",
          message: `A consent request sent on ${new Date(status.pending_request.created_at).toLocaleDateString()} is already awaiting patient review.`,
        });
        return;
      }
      if (status.active_scopes.length === 7) {
        setActionFeedback({
          type: "info",
          message: `All 7 clinical scopes are already authorized for ${patient.full_name}.`,
        });
        setSelectedPatientForEHR(patient);
        return;
      }
      if (!status.can_request_consent) {
        setActionFeedback({
          type: "error",
          message: `Cannot request consent. An established appointment relationship is required.`,
        });
        return;
      }

      setModalActiveScopes(status.active_scopes);
      setModalPrefillScopes(prefillScopes || []);
      setConsentModalPatient(patient);
    } catch (err: unknown) {
      setActionFeedback({
        type: "error",
        message: extractErrorMessage(
          err,
          "Unable to verify consent status. Please try again.",
        ),
      });
    } finally {
      setLoadingStatusId(null);
    }
  };

  const handleConsentRequestSuccess = (newRequest: ConsentRequestRead) => {
    setConsentStatusMap((prev) => {
      const existing = prev[newRequest.patient_profile_id];
      return {
        ...prev,
        [newRequest.patient_profile_id]: {
          doctor_profile_id: newRequest.doctor_profile_id,
          patient_profile_id: newRequest.patient_profile_id,
          has_active_consent: existing?.has_active_consent ?? false,
          active_consent_id: existing?.active_consent_id ?? null,
          active_scopes: existing?.active_scopes ?? [],
          pending_request: newRequest,
          can_request_consent: false,
          relationship_established: true,
        },
      };
    });

    setActionFeedback({
      type: "success",
      message: `Consent request submitted successfully for ${newRequest.patient_name || "patient"}. The request is now awaiting patient review.`,
    });
  };

  // Debounce search input (350ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setOffset(0); // Reset page on new search
    }, 350);

    return () => clearTimeout(handler);
  }, [searchInput]);

  // Handle drawer escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedPatientForEHR) {
        setSelectedPatientForEHR(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPatientForEHR]);

  // Fetch when search, filter, or offset changes
  useEffect(() => {
    let isMounted = true;
    const reqId = ++latestRequestIdRef.current;

    const load = async () => {
      const params: DoctorPatientDirectoryFilterParams = {
        limit: PAGE_SIZE,
        offset,
      };

      if (debouncedSearch) {
        params.search = debouncedSearch;
      }

      if (consentFilter === "active") {
        params.has_consent = true;
      } else if (consentFilter === "inactive") {
        params.has_consent = false;
      }

      try {
        const response: DoctorPatientDirectoryResponse =
          await doctorService.getDoctorPatients(params);

        if (isMounted && reqId === latestRequestIdRef.current) {
          setError(null);
          setPatients(response.items);
          setTotalCount(response.total);
        }
      } catch (err: unknown) {
        if (isMounted && reqId === latestRequestIdRef.current) {
          setError(
            extractErrorMessage(
              err,
              "Unable to load patient directory from clinical service.",
            ),
          );
          setPatients([]);
          setTotalCount(0);
        }
      } finally {
        if (isMounted && reqId === latestRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      isMounted = false;
    };
  }, [debouncedSearch, consentFilter, offset]);

  const handleManualRefresh = async () => {
    setIsLoading(true);
    setError(null);
    const reqId = ++latestRequestIdRef.current;

    const params: DoctorPatientDirectoryFilterParams = {
      limit: PAGE_SIZE,
      offset,
    };

    if (debouncedSearch) {
      params.search = debouncedSearch;
    }

    if (consentFilter === "active") {
      params.has_consent = true;
    } else if (consentFilter === "inactive") {
      params.has_consent = false;
    }

    try {
      const response = await doctorService.getDoctorPatients(params);
      if (reqId === latestRequestIdRef.current) {
        setPatients(response.items);
        setTotalCount(response.total);
      }
    } catch (err: unknown) {
      if (reqId === latestRequestIdRef.current) {
        setError(
          extractErrorMessage(
            err,
            "Unable to load patient directory from clinical service.",
          ),
        );
      }
    } finally {
      if (reqId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleFilterChange = (newFilter: ConsentFilterType) => {
    if (newFilter === consentFilter) return;
    setConsentFilter(newFilter);
    setOffset(0);
    setIsLoading(true);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setOffset(0);
  };

  const handlePrevPage = () => {
    if (offset > 0) {
      setOffset(Math.max(0, offset - PAGE_SIZE));
      setIsLoading(true);
    }
  };

  const handleNextPage = () => {
    if (offset + PAGE_SIZE < totalCount) {
      setOffset(offset + PAGE_SIZE);
      setIsLoading(true);
    }
  };

  // Pagination calculations
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < totalCount;
  const showingStart = totalCount === 0 ? 0 : offset + 1;
  const showingEnd = Math.min(offset + PAGE_SIZE, totalCount);

  // Active consent count in current view
  const activeConsentCountInView = useMemo(
    () => patients.filter((p) => p.has_active_consent).length,
    [patients],
  );

  return (
    <DoctorLayout title="Patient Directory">
      <div className="doc-pat-container">
        {/* Header & Clinical Context Card */}
        <section className="doc-pat-header-card">
          <div className="doc-pat-header-top">
            <div className="doc-pat-header-text">
              <span className="doc-pat-kicker">
                <Users size={14} />
                Clinical Registry & Consent
              </span>
              <h1 className="doc-pat-title">Patient Directory</h1>
              <p className="doc-pat-subtitle">
                Directory of patients who have established consultation appointments with your
                clinical practice. Access to comprehensive electronic health records (EHR) is
                governed strictly by patient-granted consent scopes.
              </p>
            </div>

            <div className="doc-pat-header-actions">
              <button
                type="button"
                className="doc-pat-refresh-btn"
                onClick={handleManualRefresh}
                disabled={isLoading}
                title="Refresh patient directory"
              >
                <RefreshCw size={14} className={isLoading ? "spinner" : ""} />
                <span>Sync Directory</span>
              </button>
            </div>
          </div>

          {/* Metrics Row */}
          <div className="doc-pat-metrics-grid">
            <div className="doc-pat-metric-box">
              <div className="doc-pat-metric-icon blue">
                <Users size={20} />
              </div>
              <div className="doc-pat-metric-info">
                <span className="doc-pat-metric-value">{totalCount}</span>
                <span className="doc-pat-metric-label">Total Patients on Record</span>
              </div>
            </div>

            <div className="doc-pat-metric-box">
              <div className="doc-pat-metric-icon green">
                <ShieldCheck size={20} />
              </div>
              <div className="doc-pat-metric-info">
                <span className="doc-pat-metric-value">
                  {consentFilter === "active" ? totalCount : activeConsentCountInView}
                </span>
                <span className="doc-pat-metric-label">Active Consent Grants</span>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy & Compliance Advisory Banner */}
        <div className="doc-pat-advisory-banner" role="note">
          <div className="doc-pat-advisory-icon-wrapper" aria-hidden="true">
            <FolderLock size={20} className="doc-pat-advisory-icon" />
          </div>
          <div className="doc-pat-advisory-content">
            <h4 className="doc-pat-advisory-heading">Consent-Gated Clinical Boundary</h4>
            <p className="doc-pat-advisory-text">
              ANVAYA enforces strict patient medical data protection. In accordance with healthcare
              standards, the directory provides consultation metadata only. Diagnoses, clinical
              notes, and prescriptions remain inaccessible without an active patient consent grant.
            </p>
          </div>
        </div>

        {/* Action Feedback Banner */}
        {actionFeedback && (
          <div className={`doc-pat-feedback-banner ${actionFeedback.type}`} role="status">
            <div className="doc-pat-feedback-content">
              {actionFeedback.type === "success" && <CheckCircle2 size={16} />}
              {actionFeedback.type === "error" && <AlertCircle size={16} />}
              {actionFeedback.type === "info" && <Info size={16} />}
              <span>{actionFeedback.message}</span>
            </div>
            <button
              type="button"
              className="doc-pat-feedback-close"
              onClick={() => setActionFeedback(null)}
              aria-label="Dismiss feedback message"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Search & Filter Controls */}
        <section className="doc-pat-filter-card" aria-label="Directory Filters">
          <div className="doc-pat-search-group">
            <Search size={16} className="doc-pat-search-icon" />
            <input
              type="text"
              className="doc-pat-search-input"
              placeholder="Search patients by name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search patients by name"
            />
            {searchInput && (
              <button
                type="button"
                className="doc-pat-search-clear"
                onClick={handleClearSearch}
                aria-label="Clear search query"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Consent Filter Segmented Tabs */}
          <div className="doc-pat-filter-tabs" role="tablist" aria-label="Consent Filter">
            <button
              type="button"
              role="tab"
              aria-selected={consentFilter === "all"}
              className={`doc-pat-tab-btn ${consentFilter === "all" ? "active" : ""}`}
              onClick={() => handleFilterChange("all")}
            >
              All Patients
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={consentFilter === "active"}
              className={`doc-pat-tab-btn consent-true ${
                consentFilter === "active" ? "active" : ""
              }`}
              onClick={() => handleFilterChange("active")}
            >
              <ShieldCheck size={13} />
              Active Consent
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={consentFilter === "inactive"}
              className={`doc-pat-tab-btn consent-false ${
                consentFilter === "inactive" ? "active" : ""
              }`}
              onClick={() => handleFilterChange("inactive")}
            >
              <Lock size={13} />
              No Active Consent
            </button>
          </div>
        </section>

        {/* Error State */}
        {error && !isLoading && (
          <div className="doc-pat-error-card" role="alert">
            <AlertCircle size={36} className="doc-pat-error-icon" />
            <h2 className="doc-pat-error-title">Unable to Load Patient Directory</h2>
            <p className="doc-pat-error-desc">{error}</p>
            <button
              type="button"
              className="doc-pat-clear-btn"
              onClick={handleManualRefresh}
            >
              <RefreshCw size={14} />
              Retry Connection
            </button>
          </div>
        )}

        {/* Table & Patient Records View */}
        {!error && (
          <div className="doc-pat-table-container">
            <table className="doc-pat-table" aria-label="Patients list">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Contact & Demographics</th>
                  <th scope="col">Appointments</th>
                  <th scope="col">Last Consultation</th>
                  <th scope="col">EHR Consent Status</th>
                  <th scope="col" className="doc-pat-th-action">Clinical Records Access</th>
                </tr>
              </thead>
              <tbody>
                {/* Loading Skeleton */}
                {isLoading && (
                  <>
                    <tr className="doc-skeleton-row">
                      <td colSpan={6} />
                    </tr>
                    <tr className="doc-skeleton-row">
                      <td colSpan={6} />
                    </tr>
                    <tr className="doc-skeleton-row">
                      <td colSpan={6} />
                    </tr>
                    <tr className="doc-skeleton-row">
                      <td colSpan={6} />
                    </tr>
                  </>
                )}

                {/* Empty State: No Patients Found */}
                {!isLoading && patients.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <div className="doc-pat-empty-container">
                        <div className="doc-pat-empty-icon" aria-hidden="true">
                          {debouncedSearch ? <Search size={28} /> : <Users size={28} />}
                        </div>
                        <h3 className="doc-pat-empty-title">
                          {debouncedSearch
                            ? "No Matching Patients Found"
                            : consentFilter !== "all"
                            ? "No Patients Matching Filter"
                            : "No Patients in Directory"}
                        </h3>
                        <p className="doc-pat-empty-desc">
                          {debouncedSearch
                            ? `No patient records matched "${debouncedSearch}". Check for spelling differences or clear your search query.`
                            : consentFilter !== "all"
                            ? `There are no patients currently categorized under "${
                                consentFilter === "active" ? "Active Consent" : "No Active Consent"
                              }".`
                            : "Patients will appear here once they book or complete an appointment with you."}
                        </p>
                        {debouncedSearch ? (
                          <button
                            type="button"
                            className="doc-pat-clear-btn"
                            onClick={handleClearSearch}
                          >
                            <X size={14} />
                            <span>Clear Search Query</span>
                          </button>
                        ) : consentFilter !== "all" ? (
                          <button
                            type="button"
                            className="doc-pat-clear-btn"
                            onClick={() => handleFilterChange("all")}
                          >
                            <Users size={14} />
                            <span>View All Patients</span>
                          </button>
                        ) : (
                          <div className="doc-pat-empty-guidance">
                            <p className="doc-pat-empty-subtext">
                              Appointments scheduled with your clinical practice will automatically
                              synchronize patient profiles and active consent scopes here.
                            </p>
                            <Link to="/doctor/appointments" className="doc-pat-guide-link">
                              <Calendar size={15} />
                              <span>View Appointments Schedule</span>
                            </Link>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Populated Patient Rows */}
                {!isLoading &&
                  patients.map((patient) => {
                    const initials = getPatientInitials(patient.full_name);
                    const formattedDate = formatDisplayDate(patient.last_appointment_date);
                    const statusClass =
                      patient.last_appointment_status.toLowerCase() === "completed"
                        ? "completed"
                        : patient.last_appointment_status.toLowerCase() === "booked"
                        ? "booked"
                        : "cancelled";

                    return (
                      <tr key={patient.patient_profile_id}>
                        {/* 1. Patient Identity */}
                        <td>
                          <div className="doc-pat-identity-cell">
                            <div className="doc-pat-avatar" aria-hidden="true">
                              {initials}
                            </div>
                            <div className="doc-pat-name-group">
                              <span className="doc-pat-name">{patient.full_name}</span>
                              <span className="doc-pat-id-sub">
                                ID: {patient.patient_profile_id.slice(0, 8)}...
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* 2. Contact & Demographics */}
                        <td>
                          <div className="doc-pat-demographics">
                            <span className="doc-pat-phone">
                              <Phone size={12} color="#64748b" />
                              {patient.phone_number || "Not provided"}
                            </span>
                            <span className="doc-pat-gender-chip">
                              <User size={11} color="#64748b" style={{ marginRight: 4 }} />
                              {patient.gender ? patient.gender : "Not specified"}
                            </span>
                          </div>
                        </td>

                        {/* 3. Total Appointments */}
                        <td>
                          <span className="doc-pat-appt-count">
                            <CalendarCheck size={12} />
                            {patient.total_appointments}{" "}
                            {patient.total_appointments === 1 ? "visit" : "visits"}
                          </span>
                        </td>

                        {/* 4. Last Consultation */}
                        <td>
                          <div className="doc-pat-last-appt">
                            <span className="doc-pat-last-date">
                              <Calendar size={12} color="#64748b" />
                              {formattedDate}
                            </span>
                            <span className={`doc-pat-status-pill ${statusClass}`}>
                              {patient.last_appointment_status}
                            </span>
                          </div>
                        </td>

                        {/* 5. Consent Status */}
                        <td>
                          {(() => {
                            const cached = consentStatusMap[patient.patient_profile_id];
                            if (cached?.pending_request) {
                              return (
                                <span
                                  className="doc-pat-consent-badge pending"
                                  title={`Request pending. Expires on ${new Date(cached.pending_request.expires_at).toLocaleDateString()}`}
                                >
                                  <Clock size={13} />
                                  Awaiting Approval
                                </span>
                              );
                            }
                            if (patient.has_active_consent) {
                              return (
                                <span className="doc-pat-consent-badge active">
                                  <ShieldCheck size={13} />
                                  Active Consent
                                </span>
                              );
                            }
                            return (
                              <span className="doc-pat-consent-badge inactive">
                                <ShieldAlert size={13} />
                                No Active Consent
                              </span>
                            );
                          })()}
                        </td>

                        {/* 6. Clinical Records Access Action */}
                        <td className="doc-pat-action-cell">
                          {(() => {
                            const cached = consentStatusMap[patient.patient_profile_id];
                            const isResolving = loadingStatusId === patient.patient_profile_id;
                            const isPending = Boolean(cached?.pending_request);
                            const hasActive = patient.has_active_consent || Boolean(cached?.has_active_consent);
                            const allAuthorized = cached ? cached.active_scopes.length === 7 : false;

                            if (isPending) {
                              return (
                                <div className="doc-pat-action-stack">
                                  {hasActive && (
                                    <button
                                      type="button"
                                      className="doc-pat-action-btn active-consent"
                                      onClick={() => setSelectedPatientForEHR(patient)}
                                      title="Access patient-authorized health records"
                                    >
                                      <FolderHeart size={14} />
                                      <span>View Consent EHR</span>
                                    </button>
                                  )}
                                  <span
                                    className="doc-pat-pending-pill"
                                    title={`Request sent on ${new Date(cached!.pending_request!.created_at).toLocaleDateString()}. Valid until ${new Date(cached!.pending_request!.expires_at).toLocaleDateString()}`}
                                  >
                                    <Clock size={12} />
                                    <span>Awaiting Patient Approval</span>
                                  </span>
                                </div>
                              );
                            }

                            if (hasActive) {
                              return (
                                <div className="doc-pat-action-stack">
                                  <button
                                    type="button"
                                    className="doc-pat-action-btn active-consent"
                                    onClick={() => setSelectedPatientForEHR(patient)}
                                    title="Access patient-authorized health records"
                                  >
                                    <FolderHeart size={14} />
                                    <span>View Consent EHR</span>
                                  </button>
                                  {!allAuthorized && (
                                    <button
                                      type="button"
                                      className="doc-pat-action-link"
                                      onClick={() => handleInitiateConsentRequest(patient)}
                                      disabled={isResolving}
                                      title="Request additional health data scopes"
                                    >
                                      {isResolving ? (
                                        <>
                                          <RefreshCw size={11} className="doc-spin" />
                                          <span>Checking...</span>
                                        </>
                                      ) : (
                                        <span>+ Request More Scopes</span>
                                      )}
                                    </button>
                                  )}
                                </div>
                              );
                            }

                            return (
                              <button
                                type="button"
                                className="doc-pat-action-btn request-consent"
                                onClick={() => handleInitiateConsentRequest(patient)}
                                disabled={isResolving}
                                title="Request EHR access permissions from patient"
                              >
                                {isResolving ? (
                                  <>
                                    <RefreshCw size={13} className="doc-spin" />
                                    <span>Checking Status...</span>
                                  </>
                                ) : (
                                  <>
                                    <FolderLock size={14} />
                                    <span>Request EHR Access</span>
                                  </>
                                )}
                              </button>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {!isLoading && totalCount > 0 && (
              <footer className="doc-pat-pagination-bar">
                <span className="doc-pat-pagination-info">
                  Showing <strong>{showingStart}</strong>–<strong>{showingEnd}</strong> of{" "}
                  <strong>{totalCount}</strong> patients
                </span>

                <div className="doc-pat-pagination-controls">
                  <button
                    type="button"
                    className="doc-pat-page-btn"
                    onClick={handlePrevPage}
                    disabled={!hasPrev || isLoading}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} />
                    <span>Previous</span>
                  </button>

                  <span className="doc-pat-pagination-info" style={{ margin: "0 8px" }}>
                    Page {currentPage} of {totalPages}
                  </span>

                  <button
                    type="button"
                    className="doc-pat-page-btn"
                    onClick={handleNextPage}
                    disabled={!hasNext || isLoading}
                    aria-label="Next page"
                  >
                    <span>Next</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </footer>
            )}
          </div>
        )}

        {/* ================================================================
            CONSENT-GATED EHR SLIDE-OVER DRAWER MODAL
            ================================================================ */}
        {selectedPatientForEHR && (
          <div
            className="doc-ehr-drawer-overlay"
            onClick={() => setSelectedPatientForEHR(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ehr-drawer-title"
          >
            <div
              className="doc-ehr-drawer"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="doc-ehr-drawer-header">
                <div className="doc-ehr-drawer-title-group">
                  <span className="doc-ehr-drawer-kicker">
                    <ShieldCheck size={12} />
                    Patient-Authorized EHR Access
                  </span>
                  <h2 id="ehr-drawer-title" className="doc-ehr-drawer-title">
                    {selectedPatientForEHR.full_name}
                  </h2>
                </div>

                <button
                  type="button"
                  className="doc-ehr-drawer-close"
                  onClick={() => setSelectedPatientForEHR(null)}
                  aria-label="Close EHR drawer"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="doc-ehr-drawer-body">
                {/* Embed canonical ConsentEHRViewer component */}
                <ConsentEHRViewer
                  patientProfileId={selectedPatientForEHR.patient_profile_id}
                  patientName={selectedPatientForEHR.full_name}
                  onRequestAccess={(missingScopes) => {
                    handleInitiateConsentRequest(selectedPatientForEHR, missingScopes);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Doctor Consent Request Modal */}
        {consentModalPatient && (
          <DoctorConsentRequestModal
            isOpen={Boolean(consentModalPatient)}
            patientProfileId={consentModalPatient.patient_profile_id}
            patientName={consentModalPatient.full_name}
            activeScopes={modalActiveScopes}
            prefillScopes={modalPrefillScopes}
            onClose={() => setConsentModalPatient(null)}
            onSuccess={handleConsentRequestSuccess}
          />
        )}
      </div>
    </DoctorLayout>
  );
}


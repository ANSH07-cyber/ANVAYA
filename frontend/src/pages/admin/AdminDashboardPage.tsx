import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  UserCheck,
  UserMinus,
  Users,
  UserX,
  XCircle,
} from "lucide-react";

import AdminLayout from "../../layouts/admin/AdminLayout";
import adminService from "../../services/adminService";
import type {
  AdminDashboardStats,
  AdminAuditLogItem,
  AuditLogOutcome,
} from "../../types/admin";
import "./AdminDashboardPage.css";

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return isoString;
  }
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function formatSafeDetails(item: AdminAuditLogItem): string {
  const details = item.details || {};
  const parts: string[] = [];

  if (details.action) {
    const actionStr = String(details.action).replace(/_/g, " ");
    parts.push(actionStr.charAt(0).toUpperCase() + actionStr.slice(1));
  }

  if (details.previous_status && details.new_status) {
    parts.push(`${details.previous_status} → ${details.new_status}`);
  }

  if (details.license_number) {
    parts.push(`Lic: ${details.license_number}`);
  }

  if (details.reason) {
    const rawReason = String(details.reason).trim();
    const truncated =
      rawReason.length > 45 ? `${rawReason.slice(0, 45)}…` : rawReason;
    parts.push(`"${truncated}"`);
  }

  if (parts.length === 0) {
    const safeKeys = Object.keys(details).filter(
      (k) =>
        !k.toLowerCase().includes("password") &&
        !k.toLowerCase().includes("token") &&
        !k.toLowerCase().includes("hash") &&
        !k.toLowerCase().includes("secret"),
    );
    if (safeKeys.length > 0) {
      return safeKeys
        .slice(0, 2)
        .map((k) => `${k}: ${String(details[k])}`)
        .join(" · ");
    }
    return "Administrative operation";
  }

  return parts.join(" · ");
}

function getEventDisplay(eventType: string) {
  if (eventType.includes("approved")) {
    return { label: "Doctor Approved", icon: CheckCircle2, tagClass: "tag-emerald" };
  }
  if (eventType.includes("rejected")) {
    return { label: "Doctor Rejected", icon: XCircle, tagClass: "tag-rose" };
  }
  if (eventType.includes("suspended")) {
    return { label: "Doctor Suspended", icon: AlertTriangle, tagClass: "tag-amber" };
  }
  if (eventType.includes("created")) {
    return { label: "Doctor Onboarded", icon: UserCheck, tagClass: "tag-sky" };
  }
  if (eventType.startsWith("doctor.")) {
    return { label: "Doctor Ops", icon: Stethoscope, tagClass: "tag-sky" };
  }
  if (eventType.startsWith("auth.")) {
    return { label: "Auth Event", icon: ShieldCheck, tagClass: "tag-purple" };
  }
  return {
    label: eventType.replace(/[._]/g, " "),
    icon: Activity,
    tagClass: "tag-slate",
  };
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogItem[]>([]);
  const [auditTotal, setAuditTotal] = useState<number>(0);

  const [isLoadingStats, setIsLoadingStats] = useState<boolean>(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(true);

  const [errorStats, setErrorStats] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<string | null>(null);

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedOutcome, setSelectedOutcome] = useState<string>("all");
  const [logPage, setLogPage] = useState<number>(0);
  const pageSize = 10;

  const [refreshKey, setRefreshKey] = useState<number>(0);

  // Fetch dashboard stats
  useEffect(() => {
    let isMounted = true;

    adminService
      .getDashboardStats()
      .then((data) => {
        if (isMounted) {
          setStats(data);
          setErrorStats(null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setErrorStats(
            "Unable to retrieve platform health metrics. Please verify network connectivity or backend authorization.",
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingStats(false);
          setIsRefreshing(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [refreshKey]);

  // Fetch audit logs
  useEffect(() => {
    let isMounted = true;
    const outcomeParam =
      selectedOutcome === "all"
        ? undefined
        : (selectedOutcome as AuditLogOutcome);

    adminService
      .getAuditLogs({
        limit: pageSize,
        offset: logPage * pageSize,
        outcome: outcomeParam,
      })
      .then((data) => {
        if (isMounted) {
          setAuditLogs(data.items || []);
          setAuditTotal(data.total || 0);
          setErrorLogs(null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setErrorLogs(
            "Failed to load recent administrative audit entries. Please check security permissions.",
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingLogs(false);
          setIsRefreshing(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedOutcome, logPage, refreshKey]);

  const handleRefreshAll = () => {
    setIsRefreshing(true);
    setIsLoadingStats(true);
    setIsLoadingLogs(true);
    setRefreshKey((k) => k + 1);
  };

  const handleRetryStats = () => {
    setIsLoadingStats(true);
    setErrorStats(null);
    setRefreshKey((k) => k + 1);
  };

  const handleRetryLogs = () => {
    setIsLoadingLogs(true);
    setErrorLogs(null);
    setRefreshKey((k) => k + 1);
  };

  const handleOutcomeChange = (newOutcome: string) => {
    setSelectedOutcome(newOutcome);
    setLogPage(0);
  };

  // Compute calculated metrics
  const totalDoctors = stats?.total_doctors ?? 0;
  const pendingDoctors = stats?.pending_doctors ?? 0;
  const approvedDoctors = stats?.approved_doctors ?? 0;
  const rejectedDoctors = stats?.rejected_doctors ?? 0;
  const suspendedDoctors = stats?.suspended_doctors ?? 0;

  const totalAppointments = stats?.total_appointments ?? 0;
  const bookedAppointments = stats?.booked_appointments ?? 0;
  const completedAppointments = stats?.completed_appointments ?? 0;
  const cancelledAppointments = stats?.cancelled_appointments ?? 0;

  const totalPatients = stats?.total_patients ?? 0;

  const doctorActivePct =
    totalDoctors > 0 ? Math.round((approvedDoctors / totalDoctors) * 100) : 0;
  const apptCompletedPct =
    totalAppointments > 0
      ? Math.round((completedAppointments / totalAppointments) * 100)
      : 0;

  const totalLogPages = Math.ceil(auditTotal / pageSize);

  return (
    <AdminLayout
      title="System Overview"
      subtitle="Healthcare operations control, practitioner verification, and immutable security audit stream"
    >
      <div className="admin-dashboard-container">
        {/* Banner / Control Strip */}
        <section className="admin-banner-strip">
          <div className="admin-banner-info">
            <div className="admin-banner-badge">
              <Shield className="admin-badge-icon" size={14} />
              <span>PLATFORM ADMINISTRATIVE OPS</span>
            </div>
            <h1 className="admin-banner-title">Operational Health Dashboard</h1>
            <p className="admin-banner-desc">
              Real-time platform telemetry across certified clinical
              practitioners, registered patients, and immutable administrative
              actions.
            </p>
          </div>

          <div className="admin-banner-actions">
            <button
              type="button"
              className="admin-refresh-button"
              onClick={handleRefreshAll}
              disabled={isRefreshing || isLoadingStats}
              title="Refresh all metrics from live backend"
              aria-label="Refresh platform statistics"
            >
              <RefreshCw
                size={16}
                className={isRefreshing ? "spin-animation" : ""}
              />
              <span>{isRefreshing ? "Refreshing..." : "Sync Live Data"}</span>
            </button>
          </div>
        </section>

        {/* Global Error Notice if stats failed */}
        {errorStats && (
          <div className="admin-error-banner" role="alert">
            <AlertCircle size={20} className="admin-error-icon" />
            <div className="admin-error-copy">
              <strong>Telemetry Offline</strong>
              <p>{errorStats}</p>
            </div>
            <button
              type="button"
              className="admin-retry-btn"
              onClick={handleRetryStats}
            >
              Retry
            </button>
          </div>
        )}

        {/* SECTION 1: TOP KEY PLATFORM METRICS */}
        <section
          className="admin-section"
          aria-label="Core platform metrics summary"
        >
          <div className="admin-section-header">
            <div className="admin-section-title-wrap">
              <h2 className="admin-section-heading">Core Platform Capacity</h2>
              <span className="admin-section-subtitle">
                System-wide registered entities across clinical domains
              </span>
            </div>
          </div>

          <div className="admin-kpi-grid">
            {/* KPI Card 1: Total Doctors */}
            <div className="admin-kpi-card doctor-kpi-theme">
              <div className="admin-kpi-header">
                <span className="admin-kpi-eyebrow">CLINICAL PROVIDERS</span>
                <div className="admin-kpi-icon-wrap" aria-hidden="true">
                  <Stethoscope size={20} />
                </div>
              </div>

              {isLoadingStats ? (
                <div className="admin-skeleton skeleton-number" />
              ) : (
                <div className="admin-kpi-value-row">
                  <span className="admin-kpi-number">{totalDoctors}</span>
                  <span className="admin-kpi-unit">Registered</span>
                </div>
              )}

              <div className="admin-kpi-footer">
                {pendingDoctors > 0 ? (
                  <span className="admin-kpi-pill pill-amber">
                    <Clock size={12} />
                    {pendingDoctors} Pending Review
                  </span>
                ) : (
                  <span className="admin-kpi-pill pill-emerald">
                    <CheckCircle2 size={12} />
                    Queue Clear
                  </span>
                )}
                <span className="admin-kpi-stat-meta">
                  {doctorActivePct}% Approved
                </span>
              </div>
            </div>

            {/* KPI Card 2: Total Patients */}
            <div className="admin-kpi-card patient-kpi-theme">
              <div className="admin-kpi-header">
                <span className="admin-kpi-eyebrow">PATIENT POPULATION</span>
                <div className="admin-kpi-icon-wrap" aria-hidden="true">
                  <Users size={20} />
                </div>
              </div>

              {isLoadingStats ? (
                <div className="admin-skeleton skeleton-number" />
              ) : (
                <div className="admin-kpi-value-row">
                  <span className="admin-kpi-number">{totalPatients}</span>
                  <span className="admin-kpi-unit">Active Profiles</span>
                </div>
              )}

              <div className="admin-kpi-footer">
                <span className="admin-kpi-pill pill-cyan">
                  <Activity size={12} />
                  Live Registry
                </span>
                <span className="admin-kpi-stat-meta">Patient Registry</span>
              </div>
            </div>

            {/* KPI Card 3: Total Appointments */}
            <div className="admin-kpi-card appt-kpi-theme">
              <div className="admin-kpi-header">
                <span className="admin-kpi-eyebrow">CONSULTATION SESSIONS</span>
                <div className="admin-kpi-icon-wrap" aria-hidden="true">
                  <CalendarClock size={20} />
                </div>
              </div>

              {isLoadingStats ? (
                <div className="admin-skeleton skeleton-number" />
              ) : (
                <div className="admin-kpi-value-row">
                  <span className="admin-kpi-number">{totalAppointments}</span>
                  <span className="admin-kpi-unit">Recorded</span>
                </div>
              )}

              <div className="admin-kpi-footer">
                <span className="admin-kpi-pill pill-sky">
                  <Calendar size={12} />
                  {bookedAppointments} Upcoming
                </span>
                <span className="admin-kpi-stat-meta">
                  {apptCompletedPct}% Completed
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2 & 3: DETAILED BREAKDOWNS (TWO-COLUMN GRID) */}
        <div className="admin-breakdown-row">
          {/* Column 1: Doctor Verification Status Breakdown */}
          <section
            className="admin-breakdown-card"
            aria-label="Doctor Credential Verification Status"
          >
            <div className="admin-card-head">
              <div className="admin-card-head-left">
                <div className="admin-card-head-icon doctor-icon-bg">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h3 className="admin-card-title">
                    Practitioner Credential Status
                  </h3>
                  <span className="admin-card-desc">
                    Licensure verification and practice authorizations
                  </span>
                </div>
              </div>
              <Link
                to="/admin/doctors"
                className="admin-card-action-link"
                title="Manage doctor accounts and verifications"
              >
                <span>Manage</span>
                <ArrowRight size={14} />
              </Link>
            </div>

            {isLoadingStats ? (
              <div className="admin-breakdown-skeletons">
                <div className="admin-skeleton skeleton-bar" />
                <div className="admin-skeleton skeleton-bar" />
                <div className="admin-skeleton skeleton-bar" />
                <div className="admin-skeleton skeleton-bar" />
              </div>
            ) : (
              <div className="admin-status-grid">
                {/* Pending */}
                <div
                  className={`admin-status-item status-pending ${pendingDoctors > 0 ? "highlight-action" : ""}`}
                >
                  <div className="admin-status-top">
                    <span className="admin-status-label">
                      <Clock size={14} className="status-icon-amber" />
                      Pending Approval
                    </span>
                    <span className="admin-status-count amber-count">
                      {pendingDoctors}
                    </span>
                  </div>
                  <div className="admin-meter-track">
                    <div
                      className="admin-meter-fill fill-amber"
                      style={{
                        width: `${totalDoctors > 0 ? (pendingDoctors / totalDoctors) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="admin-status-hint">
                    {pendingDoctors > 0
                      ? "Requires administrative review"
                      : "No outstanding applications"}
                  </span>
                </div>

                {/* Approved */}
                <div className="admin-status-item status-approved">
                  <div className="admin-status-top">
                    <span className="admin-status-label">
                      <CheckCircle2 size={14} className="status-icon-emerald" />
                      Approved & Active
                    </span>
                    <span className="admin-status-count emerald-count">
                      {approvedDoctors}
                    </span>
                  </div>
                  <div className="admin-meter-track">
                    <div
                      className="admin-meter-fill fill-emerald"
                      style={{
                        width: `${totalDoctors > 0 ? (approvedDoctors / totalDoctors) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="admin-status-hint">
                    Full clinical consultation privileges
                  </span>
                </div>

                {/* Rejected */}
                <div className="admin-status-item status-rejected">
                  <div className="admin-status-top">
                    <span className="admin-status-label">
                      <UserX size={14} className="status-icon-rose" />
                      Rejected
                    </span>
                    <span className="admin-status-count rose-count">
                      {rejectedDoctors}
                    </span>
                  </div>
                  <div className="admin-meter-track">
                    <div
                      className="admin-meter-fill fill-rose"
                      style={{
                        width: `${totalDoctors > 0 ? (rejectedDoctors / totalDoctors) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="admin-status-hint">
                    Credentials declined by compliance
                  </span>
                </div>

                {/* Suspended */}
                <div className="admin-status-item status-suspended">
                  <div className="admin-status-top">
                    <span className="admin-status-label">
                      <UserMinus size={14} className="status-icon-purple" />
                      Suspended
                    </span>
                    <span className="admin-status-count purple-count">
                      {suspendedDoctors}
                    </span>
                  </div>
                  <div className="admin-meter-track">
                    <div
                      className="admin-meter-fill fill-purple"
                      style={{
                        width: `${totalDoctors > 0 ? (suspendedDoctors / totalDoctors) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="admin-status-hint">
                    Clinical and appointment access revoked
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* Column 2: Appointment Status Breakdown */}
          <section
            className="admin-breakdown-card"
            aria-label="Appointment Queue Distribution"
          >
            <div className="admin-card-head">
              <div className="admin-card-head-left">
                <div className="admin-card-head-icon appt-icon-bg">
                  <CalendarClock size={18} />
                </div>
                <div>
                  <h3 className="admin-card-title">Consultation Queue Health</h3>
                  <span className="admin-card-desc">
                    Clinical appointment lifecycles and completion ratios
                  </span>
                </div>
              </div>
              <Link
                to="/admin/appointments"
                className="admin-card-action-link"
                title="View full appointments queue"
              >
                <span>View</span>
                <ArrowRight size={14} />
              </Link>
            </div>

            {isLoadingStats ? (
              <div className="admin-breakdown-skeletons">
                <div className="admin-skeleton skeleton-bar" />
                <div className="admin-skeleton skeleton-bar" />
                <div className="admin-skeleton skeleton-bar" />
              </div>
            ) : (
              <div className="admin-status-grid three-items">
                {/* Booked */}
                <div className="admin-status-item status-booked">
                  <div className="admin-status-top">
                    <span className="admin-status-label">
                      <Calendar size={14} className="status-icon-sky" />
                      Booked (Pending)
                    </span>
                    <span className="admin-status-count sky-count">
                      {bookedAppointments}
                    </span>
                  </div>
                  <div className="admin-meter-track">
                    <div
                      className="admin-meter-fill fill-sky"
                      style={{
                        width: `${totalAppointments > 0 ? (bookedAppointments / totalAppointments) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="admin-status-hint">
                    Scheduled future or awaiting check-in
                  </span>
                </div>

                {/* Completed */}
                <div className="admin-status-item status-completed">
                  <div className="admin-status-top">
                    <span className="admin-status-label">
                      <CheckCircle2 size={14} className="status-icon-emerald" />
                      Completed Consultations
                    </span>
                    <span className="admin-status-count emerald-count">
                      {completedAppointments}
                    </span>
                  </div>
                  <div className="admin-meter-track">
                    <div
                      className="admin-meter-fill fill-emerald"
                      style={{
                        width: `${totalAppointments > 0 ? (completedAppointments / totalAppointments) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="admin-status-hint">
                    Successfully finalized with clinical note
                  </span>
                </div>

                {/* Cancelled */}
                <div className="admin-status-item status-cancelled">
                  <div className="admin-status-top">
                    <span className="admin-status-label">
                      <XCircle size={14} className="status-icon-slate" />
                      Cancelled Appointments
                    </span>
                    <span className="admin-status-count slate-count">
                      {cancelledAppointments}
                    </span>
                  </div>
                  <div className="admin-meter-track">
                    <div
                      className="admin-meter-fill fill-slate"
                      style={{
                        width: `${totalAppointments > 0 ? (cancelledAppointments / totalAppointments) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="admin-status-hint">
                    Cancelled by doctor or patient
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* SECTION 4: RECENT ADMINISTRATIVE ACTIVITY (AUDIT LOG STREAM) */}
        <section
          className="admin-section"
          aria-label="Recent administrative activity stream"
        >
          <div className="admin-section-header">
            <div className="admin-section-title-wrap">
              <div className="admin-title-row">
                <FileText size={20} className="admin-title-icon" />
                <h2 className="admin-section-heading">
                  Recent Administrative Activity
                </h2>
              </div>
              <span className="admin-section-subtitle">
                Immutable administrative audit log tracking operational and
                credential decisions
              </span>
            </div>

            <div className="admin-audit-filters">
              <div className="admin-filter-group" role="radiogroup" aria-label="Filter audit logs by outcome">
                <button
                  type="button"
                  className={`admin-filter-chip ${selectedOutcome === "all" ? "active" : ""}`}
                  onClick={() => handleOutcomeChange("all")}
                >
                  All ({auditTotal})
                </button>
                <button
                  type="button"
                  className={`admin-filter-chip ${selectedOutcome === "success" ? "active" : ""}`}
                  onClick={() => handleOutcomeChange("success")}
                >
                  Success
                </button>
                <button
                  type="button"
                  className={`admin-filter-chip ${selectedOutcome === "denied" ? "active" : ""}`}
                  onClick={() => handleOutcomeChange("denied")}
                >
                  Denied
                </button>
                <button
                  type="button"
                  className={`admin-filter-chip ${selectedOutcome === "failure" ? "active" : ""}`}
                  onClick={() => handleOutcomeChange("failure")}
                >
                  Failure
                </button>
              </div>
            </div>
          </div>

          {/* Audit Error Notice */}
          {errorLogs && (
            <div className="admin-error-banner" role="alert">
              <AlertCircle size={18} className="admin-error-icon" />
              <div className="admin-error-copy">
                <span>{errorLogs}</span>
              </div>
              <button
                type="button"
                className="admin-retry-btn"
                onClick={handleRetryLogs}
              >
                Retry
              </button>
            </div>
          )}

          {/* Table Container */}
          <div className="admin-table-container">
            {isLoadingLogs ? (
              <div className="admin-table-loading">
                <div className="admin-skeleton skeleton-row" />
                <div className="admin-skeleton skeleton-row" />
                <div className="admin-skeleton skeleton-row" />
                <div className="admin-skeleton skeleton-row" />
              </div>
            ) : auditLogs.length === 0 ? (
              <div className="admin-empty-state">
                <ShieldAlert size={36} className="admin-empty-icon" />
                <h4 className="admin-empty-title">No Administrative Records</h4>
                <p className="admin-empty-desc">
                  No audit log events match the currently selected criteria.
                  Security actions are logged automatically upon mutation.
                </p>
              </div>
            ) : (
              <div className="admin-table-scroll">
                <table className="admin-activity-table">
                  <thead>
                    <tr>
                      <th scope="col">Event / Action</th>
                      <th scope="col">Target Resource</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Safe Event Details</th>
                      <th scope="col">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => {
                      const eventMeta = getEventDisplay(log.event_type);
                      const EventIcon = eventMeta.icon;
                      return (
                        <tr key={log.id} className="admin-table-row">
                          {/* Event */}
                          <td className="cell-event">
                            <div className="admin-event-cell">
                              <div
                                className={`admin-event-icon-badge ${eventMeta.tagClass}`}
                              >
                                <EventIcon size={14} />
                              </div>
                              <div className="admin-event-meta">
                                <span className="admin-event-label">
                                  {eventMeta.label}
                                </span>
                                <span className="admin-event-code">
                                  {log.event_type}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Resource */}
                          <td className="cell-resource">
                            <div className="admin-resource-tag">
                              <span className="admin-resource-type">
                                {log.resource_type}
                              </span>
                              <span
                                className="admin-resource-id"
                                title={log.resource_id}
                              >
                                #{log.resource_id.slice(0, 8)}…
                              </span>
                            </div>
                          </td>

                          {/* Outcome */}
                          <td className="cell-outcome">
                            {log.outcome === "success" && (
                              <span className="admin-outcome-pill outcome-success">
                                <CheckCircle2 size={12} />
                                SUCCESS
                              </span>
                            )}
                            {log.outcome === "denied" && (
                              <span className="admin-outcome-pill outcome-denied">
                                <AlertTriangle size={12} />
                                DENIED
                              </span>
                            )}
                            {log.outcome === "failure" && (
                              <span className="admin-outcome-pill outcome-failure">
                                <XCircle size={12} />
                                FAILURE
                              </span>
                            )}
                          </td>

                          {/* Details */}
                          <td className="cell-details">
                            <span
                              className="admin-details-text"
                              title={formatSafeDetails(log)}
                            >
                              {formatSafeDetails(log)}
                            </span>
                          </td>

                          {/* Timestamp */}
                          <td className="cell-time">
                            <div className="admin-time-wrap">
                              <span className="admin-time-formatted">
                                {formatTimestamp(log.created_at)}
                              </span>
                              <span className="admin-time-relative">
                                {formatRelativeTime(log.created_at)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {!isLoadingLogs && auditTotal > pageSize && (
              <div className="admin-pagination-bar">
                <span className="admin-pagination-info">
                  Showing {logPage * pageSize + 1}–
                  {Math.min((logPage + 1) * pageSize, auditTotal)} of{" "}
                  {auditTotal} events
                </span>

                <div className="admin-pagination-buttons">
                  <button
                    type="button"
                    className="admin-page-btn"
                    disabled={logPage === 0}
                    onClick={() => setLogPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </button>
                  <span className="admin-page-indicator">
                    Page {logPage + 1} of {totalLogPages || 1}
                  </span>
                  <button
                    type="button"
                    className="admin-page-btn"
                    disabled={logPage >= totalLogPages - 1}
                    onClick={() =>
                      setLogPage((p) => Math.min(totalLogPages - 1, p + 1))
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}

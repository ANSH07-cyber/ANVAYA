import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  FolderHeart,
  Pill,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  UserCheck,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import DoctorLayout from "../../layouts/DoctorLayout";
import { doctorService } from "../../services/doctorService";
import type {
  DoctorAppointmentItem,
  DoctorAppointmentSummaryResponse,
  DoctorAvailabilityItem,
} from "../../types/doctor";
import { useDoctorProfileStatus } from "./useDoctorProfileStatus";
import DoctorVerificationNotice from "./components/DoctorVerificationNotice";
import "./DoctorDashboardPage.css";

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function getTodayKolkataDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getFormattedHeaderDate(): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function formatKolkataDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(dateObj);
  } catch {
    return dateStr;
  }
}

function formatTimeSlot(timeStr: string): string {
  try {
    const parts = timeStr.split(":");
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1] || "00";
    const ampm = hours >= 12 ? "PM" : "AM";
    const formattedHours = hours % 12 || 12;
    return `${formattedHours}:${minutes} ${ampm}`;
  } catch {
    return timeStr;
  }
}

export default function DoctorDashboardPage() {
  const { user } = useAuth();
  const {
    profile,
    verificationStatus,
    isApproved,
    isLoading: isProfileLoading,
    refetch: refetchProfile,
  } = useDoctorProfileStatus();

  const [appointments, setAppointments] = useState<DoctorAppointmentItem[]>([]);
  const [summary, setSummary] = useState<DoctorAppointmentSummaryResponse | null>(null);
  const [totalAppointmentsOnRecord, setTotalAppointmentsOnRecord] = useState<number>(0);
  const [isPartialDataset, setIsPartialDataset] = useState<boolean>(false);
  const [availabilityList, setAvailabilityList] = useState<DoctorAvailabilityItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const displayName = user?.full_name
    ? user.full_name.trim().toLowerCase().startsWith("dr.") ||
      user.full_name.trim().toLowerCase().startsWith("dr ")
      ? user.full_name.trim()
      : `Dr. ${user.full_name.trim()}`
    : "Doctor";

  const fetchDashboardData = useCallback(async () => {
    // Only authorized doctors can access clinical appointments and availability
    if (!isApproved) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch server-backed summary for accurate counts (not capped at 500)
      try {
        const sum = await doctorService.getDoctorAppointmentSummary();
        setSummary(sum);
      } catch {
        // Graceful fallback to client counts if summary endpoint is unavailable
      }

      // 2. Fetch appointments with complete pagination handling
      const firstPage = await doctorService.getDoctorAppointments(100, 0);
      let loadedItems: DoctorAppointmentItem[] = [...firstPage.items];
      const totalCount = firstPage.total;

      // If dataset exceeds 100 items, fetch subsequent pages up to 500 items max
      if (totalCount > 100) {
        const pagesNeeded = Math.ceil(totalCount / 100);
        const maxPagesToFetch = Math.min(pagesNeeded, 5);

        for (let page = 1; page < maxPagesToFetch; page++) {
          const nextPage = await doctorService.getDoctorAppointments(100, page * 100);
          loadedItems = loadedItems.concat(nextPage.items);
        }
      }

      setAppointments(loadedItems);
      setTotalAppointmentsOnRecord(totalCount);
      setIsPartialDataset(loadedItems.length < totalCount);

      // 3. Fetch configured doctor availability
      const availabilityResponse = await doctorService.getDoctorAvailability();
      setAvailabilityList(availabilityResponse.items);
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setError(message || "Unable to synchronize dashboard data with clinical services.");
    } finally {
      setIsLoading(false);
    }
  }, [isApproved]);

  useEffect(() => {
    if (!isProfileLoading && isApproved) {
      void fetchDashboardData();
    } else if (!isProfileLoading && !isApproved) {
      setIsLoading(false);
    }
  }, [fetchDashboardData, isApproved, isProfileLoading]);

  // Derived real data strictly using Asia/Kolkata date
  const todayKolkata = getTodayKolkataDate();

  const todayAppointments = appointments
    .filter(
      (appt) => appt.appointment_date === todayKolkata && appt.status === "booked"
    )
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const upcomingAppointments = appointments
    .filter(
      (appt) => appt.appointment_date > todayKolkata && appt.status === "booked"
    )
    .sort((a, b) => {
      const dateCmp = a.appointment_date.localeCompare(b.appointment_date);
      if (dateCmp !== 0) return dateCmp;
      return a.start_time.localeCompare(b.start_time);
    });

  const pastDueAppointments = appointments
    .filter(
      (appt) => appt.appointment_date < todayKolkata && appt.status === "booked"
    )
    .sort((a, b) => {
      const dateCmp = a.appointment_date.localeCompare(b.appointment_date);
      if (dateCmp !== 0) return dateCmp;
      return a.start_time.localeCompare(b.start_time);
    });

  const completedAppointments = appointments.filter(
    (appt) => appt.status === "completed"
  );

  const activeWeeklyShifts = availabilityList.filter((s) => s.is_active);

  // Group availability by day for summary rail
  const activeDaysSet = new Set(activeWeeklyShifts.map((s) => s.weekday));

  // If profile is loading, render layout with loading skeleton
  if (isProfileLoading) {
    return (
      <DoctorLayout title="Clinical Command Center">
        <div className="doc-dashboard" style={{ padding: "2rem 0" }}>
          <div className="doc-skeleton-box" style={{ height: 80, marginBottom: 24 }} />
          <div className="doc-skeleton-box" style={{ height: 140, marginBottom: 24 }} />
          <div className="doc-skeleton-box" style={{ height: 320 }} />
        </div>
      </DoctorLayout>
    );
  }

  // If doctor is NOT approved (pending, rejected, or suspended)
  if (!isApproved && verificationStatus) {
    return (
      <DoctorLayout title="Clinical Command Center">
        <div className="doc-dashboard">
          <header className="doc-command-bar">
            <div className="doc-command-left">
              <div className="doc-command-kicker">
                <Stethoscope size={13} />
                <span>PRACTICE WORKSPACE</span>
              </div>
              <h1 className="doc-command-title">Welcome, {displayName}</h1>
              <p className="doc-command-meta">
                <span>{getFormattedHeaderDate()}</span> · Asia/Kolkata (IST)
              </p>
            </div>
            <div className="doc-command-actions">
              <Link to="/doctor/profile" className="doc-btn doc-btn-primary">
                <UserCheck size={15} />
                <span>Practice Profile</span>
              </Link>
            </div>
          </header>

          <DoctorVerificationNotice
            status={verificationStatus}
            licenseNumber={profile?.license_number}
            specialization={profile?.specialization}
            qualification={profile?.qualification}
            moduleName="Clinical Command Center & Appointments"
            onRefresh={refetchProfile}
            isRefreshing={isProfileLoading}
          />
        </div>
      </DoctorLayout>
    );
  }

  return (
    <DoctorLayout title="Clinical Command Center">
      <div className="doc-dashboard">
        {/* Top Command Bar */}
        <header className="doc-command-bar">
          <div className="doc-command-left">
            <div className="doc-command-kicker">
              <Stethoscope size={13} />
              <span>PRACTICE WORKSPACE</span>
            </div>
            <h1 className="doc-command-title">Welcome, {displayName}</h1>
            <p className="doc-command-meta">
              <span>{getFormattedHeaderDate()}</span> · Asia/Kolkata (IST)
            </p>
          </div>

          <div className="doc-command-actions">
            <Link to="/doctor/availability" className="doc-btn doc-btn-secondary">
              <Clock size={15} />
              <span>Manage Availability</span>
            </Link>
            <Link to="/doctor/appointments" className="doc-btn doc-btn-primary">
              <CalendarDays size={15} />
              <span>Consultation Queue</span>
            </Link>
          </div>
        </header>

        {/* Actionable Error Banner if synchronization fails */}
        {error && (
          <div className="doc-error-banner" role="alert">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
            <button
              type="button"
              className="doc-btn doc-btn-secondary doc-btn-sm"
              onClick={fetchDashboardData}
            >
              <RefreshCw size={13} />
              <span>Retry Sync</span>
            </button>
          </div>
        )}

        {/* Clinical Metrics Row */}
        <section className="doc-metrics-row" aria-label="Clinical metrics summary">
          <div className="doc-metric-card">
            <div className="doc-metric-header">
              <span className="doc-metric-label">Today's Queue</span>
              <div className="doc-metric-icon">
                <CalendarCheck size={18} />
              </div>
            </div>
            <div className="doc-metric-val">
              {isLoading ? "—" : summary?.today_count ?? todayAppointments.length}
            </div>
            <div className="doc-metric-sub">
              <span>Patients booked for today ({todayKolkata})</span>
              {isPartialDataset && !summary && (
                <span
                  className="doc-partial-pill"
                  title={`Derived from ${appointments.length} loaded records of ${totalAppointmentsOnRecord} total on record`}
                >
                  Partial ({appointments.length}/{totalAppointmentsOnRecord})
                </span>
              )}
            </div>
          </div>

          <div className="doc-metric-card">
            <div className="doc-metric-header">
              <span className="doc-metric-label">Upcoming Queue</span>
              <div className="doc-metric-icon">
                <CalendarDays size={18} />
              </div>
            </div>
            <div className="doc-metric-val">
              {isLoading ? "—" : summary?.upcoming_count ?? upcomingAppointments.length}
            </div>
            <div className="doc-metric-sub">
              <span>Future scheduled visits</span>
              {isPartialDataset && !summary && (
                <span
                  className="doc-partial-pill"
                  title={`Derived from ${appointments.length} loaded records of ${totalAppointmentsOnRecord} total on record`}
                >
                  Partial ({appointments.length}/{totalAppointmentsOnRecord})
                </span>
              )}
            </div>
          </div>

          <div className={`doc-metric-card ${pastDueAppointments.length > 0 ? "doc-metric-card-warning" : ""}`} style={pastDueAppointments.length > 0 ? { borderColor: "rgba(245, 158, 11, 0.4)", background: "rgba(245, 158, 11, 0.04)" } : undefined}>
            <div className="doc-metric-header">
              <span className="doc-metric-label" style={pastDueAppointments.length > 0 ? { color: "#fbbf24" } : undefined}>
                Past-Due Bookings
              </span>
              <div className="doc-metric-icon" style={pastDueAppointments.length > 0 ? { background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b" } : undefined}>
                <AlertTriangle size={18} />
              </div>
            </div>
            <div className="doc-metric-val" style={pastDueAppointments.length > 0 ? { color: "#fbbf24" } : undefined}>
              {isLoading ? "—" : summary?.past_due_count ?? pastDueAppointments.length}
            </div>
            <div className="doc-metric-sub">
              <span>{pastDueAppointments.length > 0 ? "Requires documentation or reschedule" : "Zero overdue visits"}</span>
            </div>
          </div>

          <div className="doc-metric-card">
            <div className="doc-metric-header">
              <span className="doc-metric-label">Completed Visits</span>
              <div className="doc-metric-icon">
                <CheckCircle2 size={18} />
              </div>
            </div>
            <div className="doc-metric-val">
              {isLoading ? "—" : summary?.completed_count ?? completedAppointments.length}
            </div>
            <div className="doc-metric-sub">
              <span>Conducted consultations</span>
              {isPartialDataset && !summary && (
                <span
                  className="doc-partial-pill"
                  title={`Derived from ${appointments.length} loaded records of ${totalAppointmentsOnRecord} total on record`}
                >
                  Partial ({appointments.length}/{totalAppointmentsOnRecord})
                </span>
              )}
            </div>
          </div>

          <div className="doc-metric-card">
            <div className="doc-metric-header">
              <span className="doc-metric-label">Active Shifts</span>
              <div className="doc-metric-icon">
                <Activity size={18} />
              </div>
            </div>
            <div className="doc-metric-val">
              {isLoading ? "—" : activeWeeklyShifts.length}
            </div>
            <div className="doc-metric-sub">
              <span>
                {activeDaysSet.size} of 7 weekly days configured
              </span>
            </div>
          </div>
        </section>

        {/* 68:32 Two-Column Main Workspace */}
        <div className="doc-dashboard-grid">
          {/* Primary Clinical Panel (Left 68%) */}
          <main className="doc-main-panel">
            {/* Overdue Past-Due Consultations Alert Card */}
            {pastDueAppointments.length > 0 && (
              <section
                className="doc-section-card doc-past-due-alert-card"
                style={{
                  border: "1px solid rgba(245, 158, 11, 0.4)",
                  background: "rgba(245, 158, 11, 0.05)",
                  marginBottom: "1.5rem",
                }}
              >
                <header
                  className="doc-section-header"
                  style={{ borderBottomColor: "rgba(245, 158, 11, 0.2)" }}
                >
                  <div className="doc-section-title-group">
                    <div
                      className="doc-section-icon"
                      style={{
                        background: "rgba(245, 158, 11, 0.15)",
                        color: "#f59e0b",
                      }}
                    >
                      <AlertTriangle size={18} />
                    </div>
                    <h2
                      className="doc-section-title"
                      style={{ color: "#fbbf24" }}
                    >
                      Action Needed: Past-Due Booked Consultations
                    </h2>
                  </div>
                  <span
                    className="doc-section-badge"
                    style={{
                      background: "rgba(245, 158, 11, 0.2)",
                      color: "#fcd34d",
                    }}
                  >
                    {pastDueAppointments.length} Overdue
                  </span>
                </header>
                <div className="doc-section-body">
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "#d1d5db",
                      marginBottom: "1rem",
                      lineHeight: 1.5,
                    }}
                  >
                    The following consultations were scheduled for a past date but
                    remain marked as booked. Please review, complete documentation, or
                    reschedule with the patient.
                  </p>
                  <div className="doc-queue-list">
                    {pastDueAppointments.map((appt) => (
                      <div
                        key={appt.id}
                        className="doc-queue-item"
                        style={{ borderColor: "rgba(245, 158, 11, 0.25)" }}
                      >
                        <div className="doc-queue-item-left">
                          <div
                            className="doc-queue-time-badge"
                            style={{
                              background: "rgba(245, 158, 11, 0.12)",
                              color: "#fbbf24",
                            }}
                          >
                            <span>{formatKolkataDate(appt.appointment_date)}</span>
                            <span style={{ fontSize: 10, color: "#d97706" }}>
                              {formatTimeSlot(appt.start_time)}
                            </span>
                          </div>

                          <div className="doc-queue-patient-info">
                            <span className="doc-queue-patient-name">
                              {appt.patient_name || "Patient Consultation"}
                            </span>
                            <span className="doc-queue-patient-reason">
                              {appt.reason || "Routine Consultation / Follow-up"}
                            </span>
                          </div>
                        </div>

                        <div className="doc-queue-item-right">
                          <span
                            className="doc-status-tag booked"
                            style={{
                              borderColor: "#f59e0b",
                              color: "#fbbf24",
                              background: "rgba(245, 158, 11, 0.12)",
                            }}
                          >
                            Overdue
                          </span>
                          <Link
                            to={`/doctor/consultation/${appt.id}`}
                            className="doc-btn doc-btn-primary doc-btn-sm"
                          >
                            <span>Open Room</span>
                            <ArrowRight size={13} />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Today's Schedule Card */}
            <section className="doc-section-card">
              <header className="doc-section-header">
                <div className="doc-section-title-group">
                  <div className="doc-section-icon">
                    <CalendarCheck size={18} />
                  </div>
                  <h2 className="doc-section-title">Today's Consultation Schedule</h2>
                </div>
                <span className="doc-section-badge">
                  {isLoading
                    ? "Syncing..."
                    : `${todayAppointments.length} Patient${
                        todayAppointments.length === 1 ? "" : "s"
                      }`}
                </span>
              </header>

              <div className="doc-section-body">
                {isLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className="doc-skeleton-box" style={{ height: 64 }} />
                    <div className="doc-skeleton-box" style={{ height: 64 }} />
                  </div>
                ) : todayAppointments.length > 0 ? (
                  <div className="doc-queue-list">
                    {todayAppointments.map((appt) => (
                      <div key={appt.id} className="doc-queue-item">
                        <div className="doc-queue-item-left">
                          <div className="doc-queue-time-badge">
                            <span>{formatTimeSlot(appt.start_time)}</span>
                            <span style={{ fontSize: 10, color: "#637e78" }}>
                              {formatTimeSlot(appt.end_time)}
                            </span>
                          </div>

                          <div className="doc-queue-patient-info">
                            <span className="doc-queue-patient-name">
                              {appt.patient_name || "Patient Consultation"}
                            </span>
                            <span className="doc-queue-patient-reason">
                              {appt.reason || "Routine Consultation / Follow-up"}
                            </span>
                          </div>
                        </div>

                        <div className="doc-queue-item-right">
                          <span className={`doc-status-tag ${appt.status}`}>
                            {appt.status}
                          </span>
                          <Link
                            to={`/doctor/consultation/${appt.id}`}
                            className="doc-btn doc-btn-primary doc-btn-sm"
                          >
                            <span>Launch Room</span>
                            <ArrowRight size={13} />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="doc-empty-state">
                    <div className="doc-empty-icon">
                      <CalendarCheck size={24} />
                    </div>
                    <h3 className="doc-empty-title">No Consultations Scheduled Today</h3>
                    <p className="doc-empty-text">
                      You have 0 patient appointments booked for today ({todayKolkata}).
                      When patients book appointments through the portal, they will appear in your queue in real time.
                    </p>
                    <Link
                      to="/doctor/availability"
                      className="doc-btn doc-btn-secondary doc-btn-sm"
                      style={{ marginTop: 4 }}
                    >
                      <Clock size={13} />
                      <span>Review Consulting Hours</span>
                    </Link>
                  </div>
                )}
              </div>
            </section>

            {/* Upcoming Consultations Card */}
            <section className="doc-section-card">
              <header className="doc-section-header">
                <div className="doc-section-title-group">
                  <div className="doc-section-icon">
                    <CalendarDays size={18} />
                  </div>
                  <h2 className="doc-section-title">Upcoming Patient Bookings</h2>
                </div>
                <span className="doc-section-badge">
                  {isLoading
                    ? "Syncing..."
                    : `${upcomingAppointments.length} Upcoming`}
                </span>
              </header>

              <div className="doc-section-body">
                {isLoading ? (
                  <div className="doc-skeleton-box" style={{ height: 110 }} />
                ) : upcomingAppointments.length > 0 ? (
                  <div style={{ overflowX: "auto" }}>
                    <table className="doc-upcoming-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Time</th>
                          <th>Patient Name</th>
                          <th>Reason</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {upcomingAppointments.slice(0, 6).map((appt) => (
                          <tr key={appt.id}>
                            <td className="doc-upcoming-date">
                              {formatKolkataDate(appt.appointment_date)}
                            </td>
                            <td className="doc-upcoming-time">
                              {formatTimeSlot(appt.start_time)}
                            </td>
                            <td style={{ fontWeight: 700, color: "#0c191f" }}>
                              {appt.patient_name || "Patient"}
                            </td>
                            <td style={{ color: "#55756d", maxWidth: 220 }}>
                              {appt.reason || "General visit"}
                            </td>
                            <td>
                              <span className={`doc-status-tag ${appt.status}`}>
                                {appt.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="doc-empty-state" style={{ padding: "30px 20px" }}>
                    <p className="doc-empty-text">
                      No future patient bookings in queue. Ensure your weekly availability shifts are active to allow patient booking.
                    </p>
                  </div>
                )}
              </div>
            </section>
          </main>

          {/* Side Context Rail (Right 32%) */}
          <aside className="doc-side-panel">
            {/* Weekly Schedule Summary */}
            <section className="doc-section-card">
              <header className="doc-section-header">
                <div className="doc-section-title-group">
                  <div className="doc-section-icon">
                    <Clock size={17} />
                  </div>
                  <h3 className="doc-section-title" style={{ fontSize: 14 }}>
                    Weekly Schedule Summary
                  </h3>
                </div>
              </header>

              <div className="doc-section-body" style={{ gap: 14 }}>
                {activeWeeklyShifts.length > 0 ? (
                  <>
                    <div className="doc-schedule-summary-list">
                      {WEEKDAY_NAMES.map((dayName, idx) => {
                        const dayShifts = activeWeeklyShifts.filter(
                          (s) => s.weekday === idx
                        );
                        if (dayShifts.length === 0) return null;

                        return (
                          <div key={dayName} className="doc-schedule-summary-row">
                            <span className="doc-schedule-summary-day">{dayName}</span>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                              {dayShifts.map((shift) => (
                                <span key={shift.id} className="doc-schedule-summary-times">
                                  {formatTimeSlot(shift.start_time)} - {formatTimeSlot(shift.end_time)}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <Link
                      to="/doctor/availability"
                      className="doc-btn doc-btn-secondary doc-btn-sm"
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      <span>Configure Shifts</span>
                      <ArrowRight size={13} />
                    </Link>
                  </>
                ) : (
                  <div className="doc-alert-box">
                    <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <strong style={{ color: "#92400e" }}>No Active Shifts Configured</strong>
                      <span>
                        Patients cannot discover or book consultation slots until you set your consulting hours.
                      </span>
                      <Link
                        to="/doctor/availability"
                        className="doc-btn doc-btn-primary doc-btn-sm"
                        style={{ marginTop: 4, width: "fit-content" }}
                      >
                        <Clock size={13} />
                        <span>Add Availability</span>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Quick Navigation Card */}
            <section className="doc-section-card">
              <header className="doc-section-header">
                <div className="doc-section-title-group">
                  <div className="doc-section-icon">
                    <UserCheck size={17} />
                  </div>
                  <h3 className="doc-section-title" style={{ fontSize: 14 }}>
                    Practice Suite
                  </h3>
                </div>
              </header>

              <div className="doc-section-body" style={{ gap: 10 }}>
                <Link
                  to="/doctor/appointments"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    borderRadius: 9,
                    background: "#f7faf9",
                    border: "1px solid #e1ece8",
                    color: "#162a31",
                    fontSize: 12.5,
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <CalendarDays size={16} color="#0c8b82" />
                    <span>Appointment Queue</span>
                  </div>
                  <ArrowRight size={14} color="#8fa8a1" />
                </Link>

                <Link
                  to="/doctor/patients"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    borderRadius: 9,
                    background: "#f7faf9",
                    border: "1px solid #e1ece8",
                    color: "#162a31",
                    fontSize: 12.5,
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <FolderHeart size={16} color="#0c8b82" />
                    <span>Patient Health Records</span>
                  </div>
                  <ArrowRight size={14} color="#8fa8a1" />
                </Link>

                <Link
                  to="/doctor/prescriptions"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    borderRadius: 9,
                    background: "#f7faf9",
                    border: "1px solid #e1ece8",
                    color: "#162a31",
                    fontSize: 12.5,
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <Pill size={16} color="#0c8b82" />
                    <span>Prescription Studio</span>
                  </div>
                  <ArrowRight size={14} color="#8fa8a1" />
                </Link>

                <Link
                  to="/doctor/profile"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    borderRadius: 9,
                    background: "#f7faf9",
                    border: "1px solid #e1ece8",
                    color: "#162a31",
                    fontSize: 12.5,
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <UserCheck size={16} color="#0c8b82" />
                    <span>Doctor Practice Profile</span>
                  </div>
                  <ArrowRight size={14} color="#8fa8a1" />
                </Link>
              </div>
            </section>

            {/* Clinical Consent Advisory */}
            <section className="doc-section-card">
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: 18,
                  fontSize: 12,
                  color: "#3d5c55",
                  lineHeight: 1.5,
                }}
              >
                <ShieldCheck size={18} color="#0c8b82" style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  <strong>Consent-Gated Clinical Records:</strong> In compliance with clinical privacy standards, patient medical records are accessible strictly during active consultations under patient authorization.
                </span>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </DoctorLayout>
  );
}

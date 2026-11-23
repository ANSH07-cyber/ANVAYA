import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  RefreshCw,
  Search,
  Stethoscope,
  X,
  XCircle,
} from "lucide-react";

import DoctorLayout from "../../layouts/DoctorLayout";
import { doctorService } from "../../services/doctorService";
import type {
  DoctorAppointmentItem,
  HealthRecordRead,
} from "../../types/doctor";
import AppointmentDetailDrawer from "./components/AppointmentDetailDrawer";
import ConsultationCompletionModal from "./components/ConsultationCompletionModal";
import DoctorAppointmentCancelModal from "./components/DoctorAppointmentCancelModal";
import DoctorAppointmentRescheduleModal from "./components/DoctorAppointmentRescheduleModal";
import "./DoctorAppointmentsPage.css";

type QueueFilterTab = "all" | "today" | "upcoming" | "completed" | "cancelled";

function getTodayKolkataDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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

function isAppointmentStarted(appointmentDate: string, startTime: string): boolean {
  try {
    const parts = startTime.split(":");
    const hours = (parts[0] || "00").padStart(2, "0");
    const minutes = (parts[1] || "00").padStart(2, "0");
    const seconds = (parts[2] || "00").padStart(2, "0");
    const isoString = `${appointmentDate}T${hours}:${minutes}:${seconds}+05:30`;
    const startEpoch = new Date(isoString).getTime();
    if (isNaN(startEpoch)) return false;
    return Date.now() >= startEpoch;
  } catch {
    return false;
  }
}

export default function DoctorAppointmentsPage() {
  const [appointments, setAppointments] = useState<DoctorAppointmentItem[]>([]);
  const [totalAppointmentsOnRecord, setTotalAppointmentsOnRecord] = useState<number>(0);
  const [isPartialDataset, setIsPartialDataset] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [activeTab, setActiveTab] = useState<QueueFilterTab>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<string>("");

  // Modals & Drawers
  const [selectedAppointment, setSelectedAppointment] = useState<DoctorAppointmentItem | null>(null);
  const [completingAppointment, setCompletingAppointment] = useState<DoctorAppointmentItem | null>(null);
  const [cancellingAppointment, setCancellingAppointment] = useState<DoctorAppointmentItem | null>(null);
  const [reschedulingAppointment, setReschedulingAppointment] = useState<DoctorAppointmentItem | null>(null);
  const [recentHealthRecordMap, setRecentHealthRecordMap] = useState<Record<string, string>>({});
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const todayKolkata = getTodayKolkataDate();

  const fetchAppointments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const firstPage = await doctorService.getDoctorAppointments(100, 0);
      let loadedItems: DoctorAppointmentItem[] = [...firstPage.items];
      const totalCount = firstPage.total;

      // Handle pagination up to 500 records max
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
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setError(detail || "Unable to synchronize appointment queue from clinical service.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAppointments();
  }, [fetchAppointments]);

  // Derived counts from loaded dataset
  const todayCount = appointments.filter(
    (a) => a.appointment_date === todayKolkata && a.status === "booked"
  ).length;

  const upcomingCount = appointments.filter(
    (a) => a.appointment_date > todayKolkata && a.status === "booked"
  ).length;

  const completedCount = appointments.filter((a) => a.status === "completed").length;
  const cancelledCount = appointments.filter((a) => a.status === "cancelled").length;

  // Filter application
  const filteredAppointments = appointments.filter((appt) => {
    // 1. Tab filter
    if (activeTab === "today") {
      if (appt.appointment_date !== todayKolkata || appt.status !== "booked") return false;
    } else if (activeTab === "upcoming") {
      if (appt.appointment_date <= todayKolkata || appt.status !== "booked") return false;
    } else if (activeTab === "completed") {
      if (appt.status !== "completed") return false;
    } else if (activeTab === "cancelled") {
      if (appt.status !== "cancelled") return false;
    }

    // 2. Specific Date Filter
    if (dateFilter && appt.appointment_date !== dateFilter) {
      return false;
    }

    // 3. Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const patientMatch = (appt.patient_name || "").toLowerCase().includes(q);
      const reasonMatch = (appt.reason || "").toLowerCase().includes(q);
      if (!patientMatch && !reasonMatch) return false;
    }

    return true;
  });

  // Handle successful completion
  const handleCompletionSuccess = (appointmentId: string, healthRecord: HealthRecordRead) => {
    // 1. Update appointment status in local state
    setAppointments((prev) =>
      prev.map((item) =>
        item.id === appointmentId ? { ...item, status: "completed" } : item
      )
    );

    // 2. Record returned Health Record ID for this session
    setRecentHealthRecordMap((prev) => ({
      ...prev,
      [appointmentId]: healthRecord.id,
    }));

    // 3. If selected appointment in drawer is this one, update it
    if (selectedAppointment && selectedAppointment.id === appointmentId) {
      setSelectedAppointment((prev) => (prev ? { ...prev, status: "completed" } : null));
    }
  };

  // Handle successful doctor cancellation
  const handleCancelSuccess = (updatedAppointment: DoctorAppointmentItem) => {
    setCancellingAppointment(null);
    setSelectedAppointment(null);

    // Update appointment in local state
    setAppointments((prev) =>
      prev.map((item) =>
        item.id === updatedAppointment.id
          ? { ...item, status: "cancelled", reason: updatedAppointment.reason }
          : item
      )
    );

    setSuccessBanner(
      `Consultation with ${updatedAppointment.patient_name || "Patient"} on ${formatKolkataDate(
        updatedAppointment.appointment_date
      )} (${formatTimeSlot(updatedAppointment.start_time)}) has been cancelled.`
    );

    // Re-fetch in background to ensure total counts and metrics stay in sync
    void fetchAppointments();
  };

  const hasActiveFilters = Boolean(searchQuery.trim() || dateFilter || activeTab !== "all");

  return (
    <DoctorLayout title="Consultation Queue & Appointments">
      <div className="doc-queue-container">
        {/* Header Bar */}
        <header className="doc-queue-header">
          <div className="doc-queue-header-left">
            <div className="doc-queue-kicker">
              <Stethoscope size={13} />
              <span>CONSULTATION QUEUE</span>
            </div>
            <h1 className="doc-queue-title">Patient Appointment Management</h1>
            <p className="doc-queue-subtitle">
              Manage clinical consultations, access patient examination context, and record consultation completions.
            </p>
          </div>

          <div className="doc-queue-header-actions">
            <button
              type="button"
              className="doc-btn doc-btn-secondary"
              onClick={fetchAppointments}
              disabled={isLoading}
            >
              <RefreshCw size={14} className={isLoading ? "doc-spin" : ""} />
              <span>{isLoading ? "Syncing..." : "Refresh Queue"}</span>
            </button>
          </div>
        </header>

        {/* Actionable Error Banner */}
        {error && (
          <div className="doc-error-banner" role="alert">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
            <button
              type="button"
              className="doc-btn doc-btn-secondary doc-btn-sm"
              onClick={fetchAppointments}
            >
              <RefreshCw size={13} />
              <span>Retry Sync</span>
            </button>
          </div>
        )}

        {/* Success Feedback Banner */}
        {successBanner && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 18px",
              background: "rgba(16, 185, 129, 0.12)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              borderRadius: 12,
              color: "#34d399",
              fontSize: "0.88rem",
              fontWeight: 500,
            }}
            role="status"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <CheckCircle2 size={18} color="#34d399" />
              <span>{successBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "#34d399",
                cursor: "pointer",
                padding: 4,
                display: "grid",
                placeItems: "center",
              }}
              aria-label="Dismiss message"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Queue Metrics Row */}
        <section className="doc-queue-metrics" aria-label="Appointment metrics summary">
          <div
            className={`doc-queue-metric-card ${activeTab === "all" ? "doc-queue-metric-card-active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            <div className="doc-queue-metric-header">
              <span className="doc-queue-metric-label">All Consultations</span>
              <CalendarDays size={16} color="#0ea5e9" />
            </div>
            <div className="doc-queue-metric-val">{isLoading ? "—" : appointments.length}</div>
            <div className="doc-queue-metric-sub">
              <span>Total loaded records</span>
              {isPartialDataset && (
                <span className="doc-partial-pill" title={`Derived from ${appointments.length} of ${totalAppointmentsOnRecord} on record`}>
                  Partial ({appointments.length}/{totalAppointmentsOnRecord})
                </span>
              )}
            </div>
          </div>

          <div
            className={`doc-queue-metric-card ${activeTab === "today" ? "doc-queue-metric-card-active" : ""}`}
            onClick={() => setActiveTab("today")}
          >
            <div className="doc-queue-metric-header">
              <span className="doc-queue-metric-label">Today's Queue</span>
              <CalendarCheck size={16} color="#34d399" />
            </div>
            <div className="doc-queue-metric-val">{isLoading ? "—" : todayCount}</div>
            <div className="doc-queue-metric-sub">
              <span>Booked today ({todayKolkata})</span>
              {isPartialDataset && (
                <span className="doc-partial-pill" title={`Derived from ${appointments.length} of ${totalAppointmentsOnRecord} on record`}>
                  Partial ({appointments.length}/{totalAppointmentsOnRecord})
                </span>
              )}
            </div>
          </div>

          <div
            className={`doc-queue-metric-card ${activeTab === "upcoming" ? "doc-queue-metric-card-active" : ""}`}
            onClick={() => setActiveTab("upcoming")}
          >
            <div className="doc-queue-metric-header">
              <span className="doc-queue-metric-label">Upcoming</span>
              <Clock size={16} color="#38bdf8" />
            </div>
            <div className="doc-queue-metric-val">{isLoading ? "—" : upcomingCount}</div>
            <div className="doc-queue-metric-sub">
              <span>Future booked visits</span>
              {isPartialDataset && (
                <span className="doc-partial-pill" title={`Derived from ${appointments.length} of ${totalAppointmentsOnRecord} on record`}>
                  Partial ({appointments.length}/{totalAppointmentsOnRecord})
                </span>
              )}
            </div>
          </div>

          <div
            className={`doc-queue-metric-card ${activeTab === "completed" ? "doc-queue-metric-card-active" : ""}`}
            onClick={() => setActiveTab("completed")}
          >
            <div className="doc-queue-metric-header">
              <span className="doc-queue-metric-label">Completed</span>
              <CheckCircle2 size={16} color="#94a3b8" />
            </div>
            <div className="doc-queue-metric-val">{isLoading ? "—" : completedCount}</div>
            <div className="doc-queue-metric-sub">
              <span>Finished consultations</span>
              {isPartialDataset && (
                <span className="doc-partial-pill" title={`Derived from ${appointments.length} of ${totalAppointmentsOnRecord} on record`}>
                  Partial ({appointments.length}/{totalAppointmentsOnRecord})
                </span>
              )}
            </div>
          </div>

          <div
            className={`doc-queue-metric-card ${activeTab === "cancelled" ? "doc-queue-metric-card-active" : ""}`}
            onClick={() => setActiveTab("cancelled")}
          >
            <div className="doc-queue-metric-header">
              <span className="doc-queue-metric-label">Cancelled</span>
              <XCircle size={16} color="#f87171" />
            </div>
            <div className="doc-queue-metric-val">{isLoading ? "—" : cancelledCount}</div>
            <div className="doc-queue-metric-sub">
              <span>Patient cancelled</span>
              {isPartialDataset && (
                <span className="doc-partial-pill" title={`Derived from ${appointments.length} of ${totalAppointmentsOnRecord} on record`}>
                  Partial ({appointments.length}/{totalAppointmentsOnRecord})
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Filter & Search Bar */}
        <div className="doc-queue-controls">
          <div className="doc-queue-tabs" role="tablist" aria-label="Queue status filter tabs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "all"}
              className={`doc-queue-tab ${activeTab === "all" ? "doc-queue-tab-active" : ""}`}
              onClick={() => setActiveTab("all")}
            >
              <span>All</span>
              <span className="doc-queue-tab-count">{appointments.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "today"}
              className={`doc-queue-tab ${activeTab === "today" ? "doc-queue-tab-active" : ""}`}
              onClick={() => setActiveTab("today")}
            >
              <span>Today</span>
              <span className="doc-queue-tab-count">{todayCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "upcoming"}
              className={`doc-queue-tab ${activeTab === "upcoming" ? "doc-queue-tab-active" : ""}`}
              onClick={() => setActiveTab("upcoming")}
            >
              <span>Upcoming</span>
              <span className="doc-queue-tab-count">{upcomingCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "completed"}
              className={`doc-queue-tab ${activeTab === "completed" ? "doc-queue-tab-active" : ""}`}
              onClick={() => setActiveTab("completed")}
            >
              <span>Completed</span>
              <span className="doc-queue-tab-count">{completedCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "cancelled"}
              className={`doc-queue-tab ${activeTab === "cancelled" ? "doc-queue-tab-active" : ""}`}
              onClick={() => setActiveTab("cancelled")}
            >
              <span>Cancelled</span>
              <span className="doc-queue-tab-count">{cancelledCount}</span>
            </button>
          </div>

          <div className="doc-queue-search-group">
            <div className="doc-search-box">
              <Search size={15} color="#64748b" />
              <input
                type="text"
                className="doc-search-input"
                placeholder="Search by patient name or reason..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", display: "grid", placeItems: "center" }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <input
              type="date"
              className="doc-date-input"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              title="Filter by specific consultation date"
            />

            {hasActiveFilters && (
              <button
                type="button"
                className="doc-btn doc-btn-secondary doc-btn-sm"
                onClick={() => {
                  setActiveTab("all");
                  setSearchQuery("");
                  setDateFilter("");
                }}
              >
                <Filter size={12} />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Queue Table */}
        <div className="doc-queue-table-card">
          <div style={{ overflowX: "auto" }}>
            <table className="doc-queue-table">
              <thead>
                <tr>
                  <th>Schedule</th>
                  <th>Patient</th>
                  <th>Clinical Reason</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 32, textAlign: "center" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <div className="doc-skeleton-box" style={{ height: 48 }} />
                        <div className="doc-skeleton-box" style={{ height: 48 }} />
                        <div className="doc-skeleton-box" style={{ height: 48 }} />
                      </div>
                    </td>
                  </tr>
                ) : filteredAppointments.length > 0 ? (
                  filteredAppointments.map((appt) => {
                    const isBooked = appt.status === "booked";
                    const hasStarted = isAppointmentStarted(appt.appointment_date, appt.start_time);
                    const hasRecentRecord = Boolean(recentHealthRecordMap[appt.id]);

                    return (
                      <tr key={appt.id}>
                        {/* Time & Date */}
                        <td>
                          <div className="doc-time-cell">
                            <span className="doc-time-date">{formatKolkataDate(appt.appointment_date)}</span>
                            <span className="doc-time-slot">
                              {formatTimeSlot(appt.start_time)} – {formatTimeSlot(appt.end_time)}
                            </span>
                          </div>
                        </td>

                        {/* Patient */}
                        <td>
                          <div className="doc-patient-cell">
                            <div className="doc-patient-avatar">
                              {(appt.patient_name || "P").charAt(0).toUpperCase()}
                            </div>
                            <span className="doc-patient-name">
                              {appt.patient_name || "Patient Consultation"}
                            </span>
                          </div>
                        </td>

                        {/* Reason */}
                        <td>
                          <div className="doc-reason-cell" title={appt.reason || "Routine Consultation"}>
                            {appt.reason || "Routine Consultation / Follow-up"}
                          </div>
                        </td>

                        {/* Status */}
                        <td>
                          <span className={`doc-status-tag ${appt.status}`}>
                            {appt.status}
                          </span>
                        </td>

                        {/* Actions */}
                        <td>
                          <div className="doc-actions-cell">
                            <button
                              type="button"
                              className="doc-btn doc-btn-secondary doc-btn-sm"
                              onClick={() => setSelectedAppointment(appt)}
                            >
                              <span>Inspect</span>
                            </button>

                            {isBooked && (
                              hasStarted ? (
                                <button
                                  type="button"
                                  className="doc-btn doc-btn-primary doc-btn-sm"
                                  onClick={() => setCompletingAppointment(appt)}
                                  title="Record clinical encounter summary and complete visit"
                                >
                                  <FileText size={12} />
                                  <span>Complete</span>
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="doc-btn doc-btn-secondary doc-btn-sm"
                                    disabled
                                    style={{ opacity: 0.55, cursor: "not-allowed" }}
                                    title="Available after scheduled appointment start time."
                                  >
                                    <FileText size={12} />
                                    <span>Complete</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="doc-btn doc-btn-danger doc-btn-sm"
                                    onClick={() => setCancellingAppointment(appt)}
                                    title="Cancel scheduled consultation"
                                  >
                                    <XCircle size={12} />
                                    <span>Cancel</span>
                                  </button>
                                </>
                              )
                            )}

                            <Link
                              to={`/doctor/consultation/${appt.id}`}
                              className="doc-btn doc-btn-secondary doc-btn-sm"
                              title="Enter consultation workspace"
                            >
                              <span>Room</span>
                              <ExternalLink size={12} />
                            </Link>

                            {hasRecentRecord && (
                              <span
                                style={{
                                  fontSize: "0.7rem",
                                  padding: "3px 6px",
                                  borderRadius: 4,
                                  background: "rgba(16, 185, 129, 0.12)",
                                  color: "#34d399",
                                  fontWeight: 700,
                                }}
                              >
                                Saved
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} style={{ padding: 48, textAlign: "center" }}>
                      <div className="doc-empty-state" style={{ background: "transparent", border: "none" }}>
                        <div className="doc-empty-icon">
                          <CalendarCheck size={24} />
                        </div>
                        <h3 className="doc-empty-title">
                          {hasActiveFilters ? "No matching appointments found" : "No appointments scheduled"}
                        </h3>
                        <p className="doc-empty-text">
                          {hasActiveFilters
                            ? "Try adjusting search terms, clearing date filters, or switching status tabs."
                            : "When patients schedule consultations via the ANVAYA portal, they will appear here in real time."}
                        </p>
                        {hasActiveFilters && (
                          <button
                            type="button"
                            className="doc-btn doc-btn-secondary doc-btn-sm"
                            onClick={() => {
                              setActiveTab("all");
                              setSearchQuery("");
                              setDateFilter("");
                            }}
                          >
                            <span>Clear Filter Criteria</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Appointment Details Side Drawer */}
        <AppointmentDetailDrawer
          appointment={selectedAppointment}
          isOpen={Boolean(selectedAppointment)}
          onClose={() => setSelectedAppointment(null)}
          onOpenCompleteModal={(appt) => {
            setSelectedAppointment(null);
            setCompletingAppointment(appt);
          }}
          onOpenCancelModal={(appt) => {
            setSelectedAppointment(null);
            setCancellingAppointment(appt);
          }}
          onOpenRescheduleModal={(appt) => {
            setSelectedAppointment(null);
            setReschedulingAppointment(appt);
          }}
          completedHealthRecordId={selectedAppointment ? recentHealthRecordMap[selectedAppointment.id] : null}
        />

        {/* Consultation Completion Modal */}
        <ConsultationCompletionModal
          appointment={completingAppointment}
          isOpen={Boolean(completingAppointment)}
          onClose={() => setCompletingAppointment(null)}
          onSuccess={handleCompletionSuccess}
        />

        {/* Consultation Cancellation Modal */}
        <DoctorAppointmentCancelModal
          appointment={cancellingAppointment}
          isOpen={Boolean(cancellingAppointment)}
          onClose={() => setCancellingAppointment(null)}
          onSuccess={handleCancelSuccess}
        />

        {/* Doctor Appointment Reschedule Modal */}
        <DoctorAppointmentRescheduleModal
          appointment={reschedulingAppointment}
          isOpen={Boolean(reschedulingAppointment)}
          onClose={() => setReschedulingAppointment(null)}
          onSuccess={(proposal) => {
            setReschedulingAppointment(null);
            setSuccessBanner(
              `Reschedule proposal sent to patient for ${formatKolkataDate(proposal.proposed_date)} at ${formatTimeSlot(proposal.proposed_start_time)}. Original appointment remains booked until patient accepts.`
            );
            void fetchAppointments();
          }}
        />
      </div>
    </DoctorLayout>
  );
}

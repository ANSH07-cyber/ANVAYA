import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Info,
  PauseCircle,
  Pencil,
  PlayCircle,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  X,
} from "lucide-react";

import DoctorLayout from "../../layouts/DoctorLayout";
import { doctorService } from "../../services/doctorService";
import type {
  DoctorAvailabilityCreatePayload,
  DoctorAvailabilityItem,
  DoctorAvailabilityUpdatePayload,
} from "../../types/doctor";
import "./DoctorAvailabilityPage.css";

interface WeekdayDef {
  id: number;
  label: string;
  full: string;
}

const WEEKDAYS: WeekdayDef[] = [
  { id: 0, label: "Mon", full: "Monday" },
  { id: 1, label: "Tue", full: "Tuesday" },
  { id: 2, label: "Wed", full: "Wednesday" },
  { id: 3, label: "Thu", full: "Thursday" },
  { id: 4, label: "Fri", full: "Friday" },
  { id: 5, label: "Sat", full: "Saturday" },
  { id: 6, label: "Sun", full: "Sunday" },
];

const DURATION_OPTIONS = [15, 20, 30, 45, 60];

function formatTimeAMPM(timeStr: string): string {
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

function calculateShiftCapacity(startStr: string, endStr: string, durationMins: number): number {
  try {
    const [startH, startM] = startStr.split(":").map(Number);
    const [endH, endM] = endStr.split(":").map(Number);
    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;
    const diff = endTotal - startTotal;
    if (diff <= 0 || durationMins <= 0) return 0;
    return Math.floor(diff / durationMins);
  } catch {
    return 0;
  }
}

export default function DoctorAvailabilityPage() {
  const [availabilities, setAvailabilities] = useState<DoctorAvailabilityItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Top action alert banner
  const [actionAlert, setActionAlert] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Add Shift Form State
  const [selectedWeekday, setSelectedWeekday] = useState<number>(0);
  const [startTime, setStartTime] = useState<string>("09:00");
  const [endTime, setEndTime] = useState<string>("13:00");
  const [slotDuration, setSlotDuration] = useState<number>(30);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Edit Shift Modal State
  const [editingShift, setEditingShift] = useState<DoctorAvailabilityItem | null>(null);
  const [editWeekday, setEditWeekday] = useState<number>(0);
  const [editStartTime, setEditStartTime] = useState<string>("09:00");
  const [editEndTime, setEditEndTime] = useState<string>("13:00");
  const [editSlotDuration, setEditSlotDuration] = useState<number>(30);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Pause / Resume Toggle Modal State
  const [confirmToggleShift, setConfirmToggleShift] = useState<DoctorAvailabilityItem | null>(null);
  const [isTogglingStatus, setIsTogglingStatus] = useState<boolean>(false);
  const [toggleStatusError, setToggleStatusError] = useState<string | null>(null);

  // Archive (Soft-Deactivation) Modal State
  const [confirmArchiveShift, setConfirmArchiveShift] = useState<DoctorAvailabilityItem | null>(null);
  const [isArchiving, setIsArchiving] = useState<boolean>(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const fetchAvailability = useCallback(async () => {
    setGeneralError(null);
    try {
      const response = await doctorService.getDoctorAvailability();
      setAvailabilities(response.items || []);
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setGeneralError(
        detail || "Unable to synchronize weekly consulting shifts from clinical scheduling service."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const response = await doctorService.getDoctorAvailability();
        if (isMounted) {
          setAvailabilities(response.items || []);
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        const detail =
          err && typeof err === "object" && "response" in err
            ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
            : null;
        setGeneralError(
          detail || "Unable to synchronize weekly consulting shifts from clinical scheduling service."
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      isMounted = false;
    };
  }, []);

  // Handle Add Shift Submission
  const handleAddShift = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setActionAlert(null);

    if (!startTime || !endTime) {
      setFormError("Both start time and end time are required.");
      return;
    }

    if (startTime >= endTime) {
      setFormError("Consulting shift start time must be strictly earlier than end time.");
      return;
    }

    const [sH, sM] = startTime.split(":").map(Number);
    const [eH, eM] = endTime.split(":").map(Number);
    const totalMinutes = eH * 60 + eM - (sH * 60 + sM);

    if (totalMinutes < slotDuration) {
      setFormError(
        `Total shift span (${totalMinutes} mins) cannot be smaller than the selected slot duration (${slotDuration} mins).`
      );
      return;
    }

    const payload: DoctorAvailabilityCreatePayload = {
      weekday: selectedWeekday,
      start_time: startTime.length === 5 ? `${startTime}:00` : startTime,
      end_time: endTime.length === 5 ? `${endTime}:00` : endTime,
      slot_duration_minutes: slotDuration,
    };

    setIsSubmitting(true);

    try {
      await doctorService.createDoctorAvailability(payload);

      const dayName = WEEKDAYS.find((d) => d.id === selectedWeekday)?.full || `Day ${selectedWeekday}`;
      setFormSuccess(
        `Successfully registered ${dayName} shift (${formatTimeAMPM(startTime)} – ${formatTimeAMPM(
          endTime
        )}, ${slotDuration}m slots).`
      );

      await fetchAvailability();
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;

      if (detail) {
        setFormError(`Scheduling Conflict: ${detail}`);
      } else {
        setFormError("Failed to register consulting shift. Please verify shift parameters and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (shift: DoctorAvailabilityItem) => {
    setEditingShift(shift);
    setEditWeekday(shift.weekday);
    setEditStartTime(shift.start_time.slice(0, 5));
    setEditEndTime(shift.end_time.slice(0, 5));
    setEditSlotDuration(shift.slot_duration_minutes);
    setEditError(null);
    setActionAlert(null);
  };

  // Handle Edit Shift Submission
  const handleUpdateShift = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingShift) return;
    setEditError(null);

    if (!editStartTime || !editEndTime) {
      setEditError("Both start time and end time are required.");
      return;
    }

    if (editStartTime >= editEndTime) {
      setEditError("Consulting shift start time must be strictly earlier than end time.");
      return;
    }

    const [sH, sM] = editStartTime.split(":").map(Number);
    const [eH, eM] = editEndTime.split(":").map(Number);
    const totalMinutes = eH * 60 + eM - (sH * 60 + sM);

    if (totalMinutes < editSlotDuration) {
      setEditError(
        `Total shift span (${totalMinutes} mins) cannot be smaller than the selected slot duration (${editSlotDuration} mins).`
      );
      return;
    }

    const payload: DoctorAvailabilityUpdatePayload = {
      weekday: editWeekday,
      start_time: editStartTime.length === 5 ? `${editStartTime}:00` : editStartTime,
      end_time: editEndTime.length === 5 ? `${editEndTime}:00` : editEndTime,
      slot_duration_minutes: editSlotDuration,
    };

    setIsUpdating(true);

    try {
      await doctorService.updateDoctorAvailability(editingShift.id, payload);
      setEditingShift(null);
      setActionAlert({
        type: "success",
        message: "Consulting shift schedule updated successfully.",
      });
      await fetchAvailability();
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setEditError(detail || "Failed to update consulting shift. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle Pause / Resume Toggle
  const handleToggleStatus = async () => {
    if (!confirmToggleShift) return;
    setIsTogglingStatus(true);
    setToggleStatusError(null);

    try {
      const newStatus = !confirmToggleShift.is_active;
      await doctorService.updateDoctorAvailabilityStatus(confirmToggleShift.id, {
        is_active: newStatus,
      });

      const wasActive = confirmToggleShift.is_active;
      setConfirmToggleShift(null);
      setActionAlert({
        type: "success",
        message: wasActive
          ? "Consulting shift paused. Existing booked appointments remain preserved."
          : "Consulting shift resumed. Patient booking slots are now active.",
      });
      await fetchAvailability();
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setToggleStatusError(detail || "Failed to update shift status. Please try again.");
    } finally {
      setIsTogglingStatus(false);
    }
  };

  // Handle Archive Shift (Soft Deactivation)
  const handleArchiveShift = async () => {
    if (!confirmArchiveShift) return;
    setIsArchiving(true);
    setArchiveError(null);

    try {
      await doctorService.deleteDoctorAvailability(confirmArchiveShift.id);
      setConfirmArchiveShift(null);
      setActionAlert({
        type: "success",
        message:
          "Consulting shift safely archived (soft-deactivated). Clinical appointments and historical records are preserved.",
      });
      await fetchAvailability();
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setArchiveError(detail || "Failed to archive consulting shift. Please try again.");
    } finally {
      setIsArchiving(false);
    }
  };

  // Group shifts by weekday
  const shiftsByWeekday: Record<number, DoctorAvailabilityItem[]> = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  };

  availabilities.forEach((item) => {
    if (shiftsByWeekday[item.weekday]) {
      shiftsByWeekday[item.weekday].push(item);
    }
  });

  // Sort shifts by start_time within each day
  Object.keys(shiftsByWeekday).forEach((dayKey) => {
    const key = Number(dayKey);
    shiftsByWeekday[key].sort((a, b) => a.start_time.localeCompare(b.start_time));
  });

  // Capacity and metrics computed ONLY on active shifts
  const activeShiftsCount = availabilities.filter((s) => s.is_active).length;
  const pausedShiftsCount = availabilities.filter((s) => !s.is_active).length;

  const activeDaysCount = Object.values(shiftsByWeekday).filter((shifts) =>
    shifts.some((s) => s.is_active)
  ).length;

  const totalWeeklyCapacity = availabilities
    .filter((s) => s.is_active)
    .reduce((acc, shift) => {
      return acc + calculateShiftCapacity(shift.start_time, shift.end_time, shift.slot_duration_minutes);
    }, 0);

  return (
    <DoctorLayout title="Consulting Availability & Schedule">
      <div className="doc-avail-container">
        {/* Header Bar */}
        <header className="doc-avail-header">
          <div className="doc-avail-title-group">
            <div className="doc-avail-kicker">
              <Stethoscope size={13} />
              <span>CLINICAL SCHEDULING ENGINE</span>
            </div>
            <h1 className="doc-avail-title">Practice Availability Management</h1>
            <p className="doc-avail-subtitle">
              Configure consulting windows and recurring patient appointment slots synchronized with the ANVAYA booking service.
            </p>
          </div>

          <div className="doc-avail-quick-metrics">
            <div className="doc-avail-metric-pill">
              <span className="doc-avail-metric-val">{isLoading ? "—" : activeShiftsCount}</span>
              <span className="doc-avail-metric-lbl">Active Shifts</span>
            </div>
            {pausedShiftsCount > 0 && (
              <div className="doc-avail-metric-pill" style={{ borderColor: "rgba(245, 158, 11, 0.3)" }}>
                <span className="doc-avail-metric-val" style={{ color: "#fbbf24" }}>
                  {isLoading ? "—" : pausedShiftsCount}
                </span>
                <span className="doc-avail-metric-lbl" style={{ color: "#fcd34d" }}>
                  Paused
                </span>
              </div>
            )}
            <div className="doc-avail-metric-pill">
              <span className="doc-avail-metric-val">{isLoading ? "—" : `${activeDaysCount}/7`}</span>
              <span className="doc-avail-metric-lbl">Days Active</span>
            </div>
            <div className="doc-avail-metric-pill">
              <span className="doc-avail-metric-val">{isLoading ? "—" : `~${totalWeeklyCapacity}`}</span>
              <span className="doc-avail-metric-lbl">Est. Weekly Slots</span>
            </div>
          </div>
        </header>

        {/* Global Feedback Alert Banner */}
        {actionAlert && (
          <div
            className={`doc-avail-alert ${
              actionAlert.type === "success" ? "doc-avail-alert-success" : "doc-avail-alert-error"
            }`}
            role="status"
          >
            {actionAlert.type === "success" ? (
              <CheckCircle2 size={18} className="doc-avail-alert-icon" />
            ) : (
              <AlertCircle size={18} className="doc-avail-alert-icon" />
            )}
            <div style={{ flex: 1 }}>{actionAlert.message}</div>
            <button
              type="button"
              className="doc-modal-close-btn"
              onClick={() => setActionAlert(null)}
              aria-label="Dismiss message"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* General Synchronization Error */}
        {generalError && (
          <div className="doc-avail-alert doc-avail-alert-error" role="alert">
            <AlertCircle size={18} className="doc-avail-alert-icon" />
            <div style={{ flex: 1 }}>{generalError}</div>
            <button
              type="button"
              className="doc-btn doc-btn-secondary doc-btn-sm"
              onClick={fetchAvailability}
              style={{ padding: "4px 10px", fontSize: "0.8rem" }}
            >
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Main Grid: Weekly Matrix (Left) + Add Shift Form (Right) */}
        <div className="doc-avail-grid">
          {/* Left Panel: 7-Day Matrix */}
          <section className="doc-weekly-matrix-card" aria-label="Weekly consulting schedule">
            <header className="doc-matrix-header">
              <div className="doc-matrix-title-wrap">
                <CalendarCheck size={18} color="#0ea5e9" />
                <h2 className="doc-matrix-title">7-Day Recurring Schedule Matrix</h2>
              </div>
              <span className="doc-matrix-badge">
                {isLoading ? "Syncing..." : `${availabilities.length} Shifts Registered`}
              </span>
            </header>

            <div className="doc-days-list">
              {WEEKDAYS.map((day) => {
                const dayShifts = shiftsByWeekday[day.id] || [];
                const isConfigured = dayShifts.length > 0;
                const activeOnDay = dayShifts.filter((s) => s.is_active).length;

                return (
                  <div
                    key={day.id}
                    className={`doc-day-row ${isConfigured ? "doc-day-row-active" : ""}`}
                  >
                    <div className="doc-day-indicator">
                      <span className="doc-day-name">{day.full}</span>
                      <span
                        className={`doc-day-status-pill ${
                          activeOnDay > 0
                            ? "doc-day-status-configured"
                            : isConfigured
                            ? "doc-shift-status-paused"
                            : "doc-day-status-off"
                        }`}
                      >
                        {activeOnDay > 0
                          ? `${activeOnDay} active`
                          : isConfigured
                          ? "All paused"
                          : "Not Active"}
                      </span>
                    </div>

                    <div className="doc-day-content">
                      {dayShifts.length === 0 ? (
                        <span className="doc-no-shifts-text">
                          No consulting hours scheduled for {day.full}. Patients cannot book on this day.
                        </span>
                      ) : (
                        <div className="doc-shifts-grid">
                          {dayShifts.map((shift) => (
                            <div
                              key={shift.id}
                              className={`doc-shift-chip ${!shift.is_active ? "doc-shift-chip-inactive" : ""}`}
                              title={`Shift ID: ${shift.id}`}
                            >
                              <span
                                className={
                                  shift.is_active
                                    ? "doc-shift-chip-active-dot"
                                    : "doc-shift-chip-inactive-dot"
                                }
                              />
                              <span className="doc-shift-chip-time">
                                <Clock size={13} color={shift.is_active ? "#0ea5e9" : "#f59e0b"} />
                                {formatTimeAMPM(shift.start_time)} – {formatTimeAMPM(shift.end_time)}
                              </span>
                              <span className="doc-shift-chip-duration">
                                {shift.slot_duration_minutes}m
                              </span>
                              <span
                                className={`doc-shift-status-badge ${
                                  shift.is_active ? "doc-shift-status-active" : "doc-shift-status-paused"
                                }`}
                              >
                                {shift.is_active ? "Active" : "Paused"}
                              </span>

                              {/* Shift Lifecycle Controls */}
                              <div className="doc-shift-chip-actions">
                                <button
                                  type="button"
                                  className="doc-shift-action-btn"
                                  onClick={() => openEditModal(shift)}
                                  title="Edit Shift Hours or Duration"
                                  aria-label="Edit shift"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="doc-shift-action-btn"
                                  onClick={() => {
                                    setConfirmToggleShift(shift);
                                    setToggleStatusError(null);
                                  }}
                                  title={shift.is_active ? "Pause Shift (hold bookings)" : "Resume Shift"}
                                  aria-label={shift.is_active ? "Pause shift" : "Resume shift"}
                                >
                                  {shift.is_active ? (
                                    <PauseCircle size={13} color="#f59e0b" />
                                  ) : (
                                    <PlayCircle size={13} color="#10b981" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="doc-shift-action-btn doc-shift-action-btn-danger"
                                  onClick={() => {
                                    setConfirmArchiveShift(shift);
                                    setArchiveError(null);
                                  }}
                                  title="Archive Shift (soft-deactivate)"
                                  aria-label="Archive shift"
                                >
                                  <Archive size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right Panel: Add Shift Form Card */}
          <aside className="doc-avail-form-card" aria-label="Add consulting shift form">
            <header className="doc-form-header">
              <h2 className="doc-form-title">
                <PlusCircle size={18} color="#0ea5e9" />
                <span>Add Consulting Shift</span>
              </h2>
              <p className="doc-form-desc">
                Define a new recurring shift. Slot capacity will be generated automatically for patient booking.
              </p>
            </header>

            {/* Form Success Alert */}
            {formSuccess && (
              <div className="doc-avail-alert doc-avail-alert-success" role="status">
                <CheckCircle2 size={16} className="doc-avail-alert-icon" />
                <span>{formSuccess}</span>
              </div>
            )}

            {/* Form Error / 409 Conflict Alert */}
            {formError && (
              <div className="doc-avail-alert doc-avail-alert-error" role="alert">
                <AlertCircle size={16} className="doc-avail-alert-icon" />
                <span>{formError}</span>
              </div>
            )}

            <form className="doc-avail-form" onSubmit={handleAddShift}>
              {/* Day of Week Selector */}
              <div className="doc-form-group">
                <label className="doc-form-label">
                  <span>Day of the Week</span>
                  <span className="doc-form-hint">{WEEKDAYS[selectedWeekday].full}</span>
                </label>
                <div className="doc-weekday-pills" role="radiogroup" aria-label="Weekday selector">
                  {WEEKDAYS.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      role="radio"
                      aria-checked={selectedWeekday === d.id}
                      disabled={isSubmitting}
                      className={`doc-weekday-pill ${
                        selectedWeekday === d.id ? "doc-weekday-pill-active" : ""
                      }`}
                      onClick={() => {
                        setSelectedWeekday(d.id);
                        setFormError(null);
                        setFormSuccess(null);
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shift Hours */}
              <div className="doc-form-group">
                <label className="doc-form-label">
                  <span>Shift Timing</span>
                  <span className="doc-form-hint">24-hour format</span>
                </label>
                <div className="doc-time-inputs-row">
                  <div className="doc-input-wrapper">
                    <span className="doc-input-sublabel">Start Time</span>
                    <input
                      type="time"
                      className="doc-time-input"
                      value={startTime}
                      disabled={isSubmitting}
                      onChange={(e) => {
                        setStartTime(e.target.value);
                        setFormError(null);
                      }}
                      required
                    />
                  </div>
                  <div className="doc-input-wrapper">
                    <span className="doc-input-sublabel">End Time</span>
                    <input
                      type="time"
                      className="doc-time-input"
                      value={endTime}
                      disabled={isSubmitting}
                      onChange={(e) => {
                        setEndTime(e.target.value);
                        setFormError(null);
                      }}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Slot Duration */}
              <div className="doc-form-group">
                <label className="doc-form-label">
                  <span>Slot Duration</span>
                  <span className="doc-form-hint">{slotDuration} minutes / patient</span>
                </label>
                <div className="doc-duration-pills" role="radiogroup" aria-label="Slot duration selector">
                  {DURATION_OPTIONS.map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      role="radio"
                      aria-checked={slotDuration === mins}
                      disabled={isSubmitting}
                      className={`doc-duration-pill ${
                        slotDuration === mins ? "doc-duration-pill-active" : ""
                      }`}
                      onClick={() => {
                        setSlotDuration(mins);
                        setFormError(null);
                      }}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit CTA */}
              <button
                type="submit"
                className="doc-btn-submit"
                disabled={isSubmitting || isLoading}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={16} className="doc-spin" />
                    <span>Registering Shift...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    <span>Publish Consulting Shift</span>
                  </>
                )}
              </button>
            </form>

            {/* Comprehensive Availability Lifecycle Policy Notice */}
            <div className="doc-arch-notice">
              <div className="doc-arch-notice-header">
                <Info size={13} color="#94a3b8" />
                <span>Clinical Schedule Lifecycle Controls</span>
              </div>
              <p className="doc-arch-notice-body">
                You can adjust consulting hours, pause/resume shifts, or archive shifts anytime. When modifying shift times, existing confirmed appointments are strictly protected. Archiving a shift performs a safe soft-deactivation so clinical audit history and patient bookings are never deleted.
              </p>
            </div>
          </aside>
        </div>

        {/* ================================================================= */}
        {/* EDIT SHIFT MODAL DIALOG                                           */}
        {/* ================================================================= */}
        {editingShift && (
          <div
            className="doc-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-shift-modal-title"
          >
            <div className="doc-modal-card">
              <header className="doc-modal-header">
                <h3 id="edit-shift-modal-title" className="doc-modal-title">
                  <Pencil size={18} color="#0ea5e9" />
                  <span>Edit Consulting Shift</span>
                </h3>
                <button
                  type="button"
                  className="doc-modal-close-btn"
                  onClick={() => setEditingShift(null)}
                  disabled={isUpdating}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </header>

              <form onSubmit={handleUpdateShift}>
                <div className="doc-modal-body">
                  <div className="doc-callout-box">
                    <Info size={16} color="#0ea5e9" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>
                      Modifying shift parameters will validate that no future confirmed appointment falls outside the updated consulting hours.
                    </span>
                  </div>

                  {editError && (
                    <div className="doc-avail-alert doc-avail-alert-error" role="alert">
                      <AlertCircle size={16} className="doc-avail-alert-icon" />
                      <span>{editError}</span>
                    </div>
                  )}

                  {/* Day of Week */}
                  <div className="doc-form-group">
                    <label className="doc-form-label">
                      <span>Day of the Week</span>
                      <span className="doc-form-hint">{WEEKDAYS[editWeekday].full}</span>
                    </label>
                    <div className="doc-weekday-pills" role="radiogroup" aria-label="Edit weekday selector">
                      {WEEKDAYS.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          role="radio"
                          aria-checked={editWeekday === d.id}
                          disabled={isUpdating}
                          className={`doc-weekday-pill ${
                            editWeekday === d.id ? "doc-weekday-pill-active" : ""
                          }`}
                          onClick={() => setEditWeekday(d.id)}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Times */}
                  <div className="doc-form-group">
                    <label className="doc-form-label">
                      <span>Consulting Hours</span>
                      <span className="doc-form-hint">24-hour format</span>
                    </label>
                    <div className="doc-time-inputs-row">
                      <div className="doc-input-wrapper">
                        <span className="doc-input-sublabel">Start Time</span>
                        <input
                          type="time"
                          className="doc-time-input"
                          value={editStartTime}
                          disabled={isUpdating}
                          onChange={(e) => setEditStartTime(e.target.value)}
                          required
                        />
                      </div>
                      <div className="doc-input-wrapper">
                        <span className="doc-input-sublabel">End Time</span>
                        <input
                          type="time"
                          className="doc-time-input"
                          value={editEndTime}
                          disabled={isUpdating}
                          onChange={(e) => setEditEndTime(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Slot Duration */}
                  <div className="doc-form-group">
                    <label className="doc-form-label">
                      <span>Slot Duration</span>
                      <span className="doc-form-hint">{editSlotDuration} minutes / patient</span>
                    </label>
                    <div className="doc-duration-pills" role="radiogroup" aria-label="Edit duration selector">
                      {DURATION_OPTIONS.map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          role="radio"
                          aria-checked={editSlotDuration === mins}
                          disabled={isUpdating}
                          className={`doc-duration-pill ${
                            editSlotDuration === mins ? "doc-duration-pill-active" : ""
                          }`}
                          onClick={() => setEditSlotDuration(mins)}
                        >
                          {mins}m
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <footer className="doc-modal-footer">
                  <button
                    type="button"
                    className="doc-btn-secondary"
                    onClick={() => setEditingShift(null)}
                    disabled={isUpdating}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="doc-btn-primary"
                    disabled={isUpdating}
                  >
                    {isUpdating ? (
                      <>
                        <RefreshCw size={14} className="doc-spin" />
                        <span>Saving Changes...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={14} />
                        <span>Save Shift Changes</span>
                      </>
                    )}
                  </button>
                </footer>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* PAUSE / RESUME CONFIRMATION MODAL                                 */}
        {/* ================================================================= */}
        {confirmToggleShift && (
          <div
            className="doc-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pause-modal-title"
          >
            <div className="doc-modal-card">
              <header className="doc-modal-header">
                <h3 id="pause-modal-title" className="doc-modal-title">
                  {confirmToggleShift.is_active ? (
                    <>
                      <PauseCircle size={18} color="#f59e0b" />
                      <span>Pause Consulting Shift</span>
                    </>
                  ) : (
                    <>
                      <PlayCircle size={18} color="#10b981" />
                      <span>Resume Consulting Shift</span>
                    </>
                  )}
                </h3>
                <button
                  type="button"
                  className="doc-modal-close-btn"
                  onClick={() => setConfirmToggleShift(null)}
                  disabled={isTogglingStatus}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="doc-modal-body">
                {toggleStatusError && (
                  <div className="doc-avail-alert doc-avail-alert-error" role="alert">
                    <AlertCircle size={16} className="doc-avail-alert-icon" />
                    <span>{toggleStatusError}</span>
                  </div>
                )}

                {confirmToggleShift.is_active ? (
                  <>
                    <p>
                      Are you sure you want to pause your recurring{" "}
                      <strong>{WEEKDAYS[confirmToggleShift.weekday].full}</strong> consulting shift (
                      {formatTimeAMPM(confirmToggleShift.start_time)} – {formatTimeAMPM(confirmToggleShift.end_time)})?
                    </p>
                    <div className="doc-callout-box doc-callout-warning">
                      <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>
                        <strong>Clinical Safeguard:</strong> Pausing this shift temporarily prevents patients from booking future appointments in this window. Any existing booked appointments are completely unaffected and remain confirmed.
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <p>
                      Resume recurring consulting hours on{" "}
                      <strong>{WEEKDAYS[confirmToggleShift.weekday].full}</strong> (
                      {formatTimeAMPM(confirmToggleShift.start_time)} – {formatTimeAMPM(confirmToggleShift.end_time)})?
                    </p>
                    <div className="doc-callout-box">
                      <Info size={16} color="#0ea5e9" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>
                        Resuming this shift will generate patient booking slots for upcoming {WEEKDAYS[confirmToggleShift.weekday].full}s. The system will verify that this shift does not overlap any other active shift.
                      </span>
                    </div>
                  </>
                )}
              </div>

              <footer className="doc-modal-footer">
                <button
                  type="button"
                  className="doc-btn-secondary"
                  onClick={() => setConfirmToggleShift(null)}
                  disabled={isTogglingStatus}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={confirmToggleShift.is_active ? "doc-btn-warning" : "doc-btn-primary"}
                  onClick={handleToggleStatus}
                  disabled={isTogglingStatus}
                >
                  {isTogglingStatus ? (
                    <>
                      <RefreshCw size={14} className="doc-spin" />
                      <span>Updating...</span>
                    </>
                  ) : confirmToggleShift.is_active ? (
                    <>
                      <PauseCircle size={14} />
                      <span>Confirm Pause</span>
                    </>
                  ) : (
                    <>
                      <PlayCircle size={14} />
                      <span>Confirm Resume</span>
                    </>
                  )}
                </button>
              </footer>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* ARCHIVE CONFIRMATION MODAL                                        */}
        {/* ================================================================= */}
        {confirmArchiveShift && (
          <div
            className="doc-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-modal-title"
          >
            <div className="doc-modal-card">
              <header className="doc-modal-header">
                <h3 id="archive-modal-title" className="doc-modal-title">
                  <Archive size={18} color="#ef4444" />
                  <span>Archive Consulting Shift</span>
                </h3>
                <button
                  type="button"
                  className="doc-modal-close-btn"
                  onClick={() => setConfirmArchiveShift(null)}
                  disabled={isArchiving}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="doc-modal-body">
                {archiveError && (
                  <div className="doc-avail-alert doc-avail-alert-error" role="alert">
                    <AlertCircle size={16} className="doc-avail-alert-icon" />
                    <span>{archiveError}</span>
                  </div>
                )}

                <p>
                  Are you sure you want to archive your recurring{" "}
                  <strong>{WEEKDAYS[confirmArchiveShift.weekday].full}</strong> shift (
                  {formatTimeAMPM(confirmArchiveShift.start_time)} – {formatTimeAMPM(confirmArchiveShift.end_time)})?
                </p>

                <div className="doc-callout-box doc-callout-warning">
                  <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Zero Data Loss Policy:</strong> In compliance with ANVAYA healthcare compliance rules, schedule records are never hard-deleted. This shift will be safely soft-deactivated and stop generating slots. All existing booked appointments remain fully preserved.
                  </div>
                </div>
              </div>

              <footer className="doc-modal-footer">
                <button
                  type="button"
                  className="doc-btn-secondary"
                  onClick={() => setConfirmArchiveShift(null)}
                  disabled={isArchiving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="doc-btn-danger"
                  onClick={handleArchiveShift}
                  disabled={isArchiving}
                >
                  {isArchiving ? (
                    <>
                      <RefreshCw size={14} className="doc-spin" />
                      <span>Archiving Shift...</span>
                    </>
                  ) : (
                    <>
                      <Archive size={14} />
                      <span>Confirm Archive</span>
                    </>
                  )}
                </button>
              </footer>
            </div>
          </div>
        )}
      </div>
    </DoctorLayout>
  );
}

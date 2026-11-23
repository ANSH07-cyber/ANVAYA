import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
  X,
  XCircle,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import PortalLayout from "../../layouts/PortalLayout";
import { patientNavigation } from "./patientNavigation";
import api from "../../services/api";
import { patientService } from "../../services/patientService";
import type {
  AvailableSlot,
  PatientAppointment,
  AppointmentRescheduleProposal,
} from "../../types/patient";
import "./AppointmentsPage.css";

type FilterStatus = "all" | "upcoming" | "completed" | "cancelled";

interface DoctorMeta {
  id: string;
  full_name: string;
  specialization: string;
  qualification?: string;
  clinic_name?: string | null;
  consultation_fee?: string | null;
}

interface DoctorListResponse {
  items: DoctorMeta[];
  total: number;
}

function getAppointmentDateTime(appointment: PatientAppointment): Date {
  return new Date(`${appointment.appointment_date}T${appointment.start_time}`);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;

  const date = new Date();
  date.setHours(hours, minutes, 0, 0);

  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function isUpcoming(appointment: PatientAppointment): boolean {
  return (
    appointment.status === "booked" &&
    getAppointmentDateTime(appointment) > new Date()
  );
}

function getStatusLabel(appointment: PatientAppointment): string {
  if (appointment.status === "completed") return "Completed";
  if (appointment.status === "cancelled") return "Cancelled";
  return isUpcoming(appointment) ? "Upcoming" : "Past appointment";
}

function getTomorrowString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMaxDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function extractErrorMessage(error: unknown, defaultMessage: string): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429) {
      return "Too many requests. Please wait a moment and try again.";
    }
    if (error.response?.status === 401) {
      return "Your session has expired. Please sign in again.";
    }
    if (error.response?.status === 403) {
      return "You do not have permission to modify this appointment.";
    }
    if (error.response?.status === 404) {
      return "Appointment or practitioner record not found.";
    }

    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item: { msg?: string }) => item.msg ?? "Validation error")
        .join(". ");
    }
  }
  return defaultMessage;
}

function formatExpirationNotice(expiresAtStr: string): string {
  try {
    const expiresAt = new Date(expiresAtStr);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    if (diffMs <= 0) return "Expired";
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (diffHrs >= 24) {
      const days = Math.floor(diffHrs / 24);
      return `Expires in ${days}d ${diffHrs % 24}h`;
    }
    if (diffHrs > 0) {
      return `Expires in ${diffHrs}h ${diffMins}m`;
    }
    return `Expires in ${diffMins}m`;
  } catch {
    return "Time-limited";
  }
}

export default function AppointmentsPage() {
  const { user } = useAuth();
  const displayName = user?.full_name?.trim() || "Patient";

  const [appointments, setAppointments] = useState<PatientAppointment[]>([]);
  const [doctorsMap, setDoctorsMap] = useState<Record<string, DoctorMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");

  // Alert feedback banners
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Pending doctor reschedule proposals state
  const [pendingProposals, setPendingProposals] = useState<AppointmentRescheduleProposal[]>([]);
  const [acceptingProposal, setAcceptingProposal] = useState<AppointmentRescheduleProposal | null>(null);
  const [isRespondingProposal, setIsRespondingProposal] = useState(false);
  const [respondingProposalId, setRespondingProposalId] = useState<string | null>(null);
  const [proposalResponseError, setProposalResponseError] = useState<string | null>(null);
  const acceptModalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Cancellation dialog state
  const [cancellingAppointment, setCancellingAppointment] =
    useState<PatientAppointment | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Rescheduling modal state
  const [reschedulingAppointment, setReschedulingAppointment] =
    useState<PatientAppointment | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string>(getTomorrowString());
  const [rescheduleSlots, setRescheduleSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  // Auto-dismiss success alert
  useEffect(() => {
    if (!actionSuccess) return;
    const timer = setTimeout(() => {
      setActionSuccess(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [actionSuccess]);

  // Load appointments, proposals and doctor directory on mount
  useEffect(() => {
    let active = true;

    async function initialFetch() {
      try {
        const [apptRes, docsRes, proposalsRes] = await Promise.all([
          patientService.getMyAppointments(),
          api.get<DoctorListResponse>("/doctors").catch(() => null),
          patientService.getMyPendingProposals().catch(() => null),
        ]);

        if (active) {
          setAppointments(apptRes.items);
          if (proposalsRes?.items) {
            setPendingProposals(proposalsRes.items);
          }
          if (docsRes?.data?.items) {
            const mapping: Record<string, DoctorMeta> = {};
            for (const doc of docsRes.data.items) {
              mapping[doc.id] = doc;
            }
            setDoctorsMap(mapping);
          }
        }
      } catch (err) {
        if (active) {
          setError(
            extractErrorMessage(
              err,
              "We couldn't load your appointments. Please try again.",
            ),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void initialFetch();

    return () => {
      active = false;
    };
  }, []);

  // Reload appointments after user actions or retry
  const refreshAppointments = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [apptRes, docsRes, proposalsRes] = await Promise.all([
        patientService.getMyAppointments(),
        api.get<DoctorListResponse>("/doctors").catch(() => null),
        patientService.getMyPendingProposals().catch(() => null),
      ]);

      setAppointments(apptRes.items);
      if (proposalsRes?.items) {
        setPendingProposals(proposalsRes.items);
      } else {
        setPendingProposals([]);
      }

      if (docsRes?.data?.items) {
        const mapping: Record<string, DoctorMeta> = {};
        for (const doc of docsRes.data.items) {
          mapping[doc.id] = doc;
        }
        setDoctorsMap(mapping);
      }
    } catch (err) {
      setError(
        extractErrorMessage(
          err,
          "We couldn't load your appointments. Please try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handleConfirmAcceptProposal = async () => {
    if (!acceptingProposal || isRespondingProposal) return;
    setIsRespondingProposal(true);
    setRespondingProposalId(acceptingProposal.id);
    setProposalResponseError(null);

    try {
      const updated = await patientService.respondToRescheduleProposal(
        acceptingProposal.id,
        {
          action: "accept",
          idempotency_key: `pat-acc-${acceptingProposal.id}`,
        },
      );
      setAcceptingProposal(null);
      setActionSuccess(
        `Consultation successfully rescheduled to ${formatDate(updated.proposed_date)} at ${formatTime(updated.proposed_start_time)}!`,
      );
      void refreshAppointments();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail;
        const msg = typeof detail === "string" ? detail : "Could not accept reschedule proposal.";
        setProposalResponseError(msg);
        void refreshAppointments();
      } else {
        setProposalResponseError("Could not accept reschedule proposal. Please try again.");
      }
    } finally {
      setIsRespondingProposal(false);
      setRespondingProposalId(null);
    }
  };

  const handleDeclineProposal = async (proposal: AppointmentRescheduleProposal) => {
    if (isRespondingProposal) return;
    setIsRespondingProposal(true);
    setRespondingProposalId(proposal.id);
    setActionError(null);

    try {
      await patientService.respondToRescheduleProposal(
        proposal.id,
        {
          action: "decline",
          idempotency_key: `pat-dec-${proposal.id}`,
        },
      );
      setActionSuccess(
        `Reschedule proposal declined. Your original consultation remains scheduled for ${formatDate(proposal.current_appointment_date || "")} at ${formatTime(proposal.current_start_time || "")}.`,
      );
      void refreshAppointments();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail;
        const msg = typeof detail === "string" ? detail : "Could not decline reschedule proposal.";
        setActionError(msg);
      } else {
        setActionError("Could not decline reschedule proposal. Please try again.");
      }
      void refreshAppointments();
    } finally {
      setIsRespondingProposal(false);
      setRespondingProposalId(null);
    }
  };

  // Focus trap, initial focus, and focus restoration for Accept Reschedule Modal
  useEffect(() => {
    if (!acceptingProposal) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const focusTimer = setTimeout(() => {
      if (acceptModalRef.current) {
        const focusable = acceptModalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length > 0) {
          focusable[0].focus();
        }
      }
    }, 50);

    const handleModalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        if (!acceptModalRef.current) return;
        const focusable = acceptModalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleModalKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleModalKeyDown);
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [acceptingProposal]);

  // Keyboard accessibility: Escape closes open modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (acceptingProposal && !isRespondingProposal) {
          setAcceptingProposal(null);
          setProposalResponseError(null);
        }
        if (cancellingAppointment && !isCancelling) {
          setCancellingAppointment(null);
          setCancelError(null);
        }
        if (reschedulingAppointment && !isRescheduling) {
          setReschedulingAppointment(null);
          setRescheduleError(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    acceptingProposal,
    isRespondingProposal,
    cancellingAppointment,
    reschedulingAppointment,
    isCancelling,
    isRescheduling,
  ]);

  // Fetch slots for rescheduling
  const loadSlotsForDate = useCallback(
    async (doctorProfileId: string, dateStr: string) => {
      setLoadingSlots(true);
      setSlotsError(null);
      setSelectedSlot(null);

      try {
        const response = await patientService.getDoctorAvailabilitySlots(
          doctorProfileId,
          dateStr,
        );
        setRescheduleSlots(response.items || []);
      } catch (err) {
        setSlotsError(
          extractErrorMessage(
            err,
            "Failed to load available slots for the selected date.",
          ),
        );
        setRescheduleSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    },
    [],
  );

  // Trigger cancellation modal
  const handleOpenCancel = (appointment: PatientAppointment) => {
    if (!isUpcoming(appointment)) return;
    setCancelError(null);
    setCancellingAppointment(appointment);
  };

  const handleCloseCancel = () => {
    if (isCancelling) return;
    setCancellingAppointment(null);
    setCancelError(null);
  };

  // Submit cancellation
  const handleConfirmCancel = async () => {
    if (!cancellingAppointment || isCancelling) return;

    setIsCancelling(true);
    setCancelError(null);

    try {
      const updated = await patientService.cancelAppointment(
        cancellingAppointment.id,
      );

      // Update state locally & refresh
      setAppointments((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );

      setActionSuccess(
        `Consultation appointment for ${formatDate(
          cancellingAppointment.appointment_date,
        )} has been cancelled. The slot has been released.`,
      );
      setActionError(null);
      setCancellingAppointment(null);
    } catch (err) {
      setCancelError(
        extractErrorMessage(
          err,
          "Failed to cancel appointment. Please try again.",
        ),
      );
    } finally {
      setIsCancelling(false);
    }
  };

  // Trigger reschedule modal
  const handleOpenReschedule = (appointment: PatientAppointment) => {
    if (!isUpcoming(appointment)) return;

    const defaultDate = getTomorrowString();
    setReschedulingAppointment(appointment);
    setRescheduleDate(defaultDate);
    setRescheduleError(null);
    setSelectedSlot(null);

    void loadSlotsForDate(appointment.doctor_profile_id, defaultDate);
  };

  const handleCloseReschedule = () => {
    if (isRescheduling) return;
    setReschedulingAppointment(null);
    setRescheduleError(null);
    setSelectedSlot(null);
  };

  const handleDateChange = (newDate: string) => {
    setRescheduleDate(newDate);
    if (reschedulingAppointment) {
      void loadSlotsForDate(
        reschedulingAppointment.doctor_profile_id,
        newDate,
      );
    }
  };

  // Submit reschedule
  const handleSubmitReschedule = async (e: FormEvent) => {
    e.preventDefault();
    if (!reschedulingAppointment || !selectedSlot || isRescheduling) return;

    setIsRescheduling(true);
    setRescheduleError(null);

    try {
      const updated = await patientService.rescheduleAppointment(
        reschedulingAppointment.id,
        {
          appointment_date: rescheduleDate,
          start_time: selectedSlot.start_time,
        },
      );

      // Update state and refresh schedule
      setAppointments((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );

      setActionSuccess(
        `Appointment rescheduled successfully for ${formatDate(
          updated.appointment_date,
        )} at ${formatTime(updated.start_time)} – ${formatTime(
          updated.end_time,
        )}.`,
      );
      setActionError(null);
      setReschedulingAppointment(null);
      setSelectedSlot(null);
    } catch (err) {
      setRescheduleError(
        extractErrorMessage(
          err,
          "Failed to reschedule appointment. Please try again.",
        ),
      );
    } finally {
      setIsRescheduling(false);
    }
  };

  // Summary counts
  const counts = useMemo(() => {
    return {
      all: appointments.length,
      upcoming: appointments.filter(isUpcoming).length,
      completed: appointments.filter((item) => item.status === "completed").length,
      cancelled: appointments.filter((item) => item.status === "cancelled").length,
    };
  }, [appointments]);

  // Filtered & sorted appointments
  const filteredAppointments = useMemo(() => {
    const query = search.trim().toLowerCase();

    return appointments
      .filter((appointment) => {
        if (filter === "upcoming") return isUpcoming(appointment);
        if (filter === "completed") return appointment.status === "completed";
        if (filter === "cancelled") return appointment.status === "cancelled";
        return true;
      })
      .filter((appointment) => {
        if (!query) return true;
        const doctor = doctorsMap[appointment.doctor_profile_id];
        return [
          appointment.appointment_date,
          appointment.status,
          appointment.reason ?? "",
          appointment.id,
          doctor?.full_name ?? "",
          doctor?.specialization ?? "",
          doctor?.clinic_name ?? "",
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort(
        (a, b) =>
          getAppointmentDateTime(b).getTime() -
          getAppointmentDateTime(a).getTime(),
      );
  }, [appointments, filter, search, doctorsMap]);

  const filters: {
    value: FilterStatus;
    label: string;
    count: number;
  }[] = [
    { value: "all", label: "All appointments", count: counts.all },
    { value: "upcoming", label: "Upcoming", count: counts.upcoming },
    { value: "completed", label: "Completed", count: counts.completed },
    { value: "cancelled", label: "Cancelled", count: counts.cancelled },
  ];

  return (
    <PortalLayout
      roleLabel="Patient"
      userName={displayName}
      userMeta="Patient account"
      navItems={patientNavigation}
    >
      <main className="appointments-page">
        {/* PAGE HEADING */}
        <section className="appointments-heading">
          <div>
            <span className="appointments-eyebrow">YOUR HEALTHCARE SCHEDULE</span>
            <h1>My appointments</h1>
            <p>Keep track of your consultations, reschedule slots, or cancel visits.</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link
              to="/patient/doctors"
              className="appointments-book-btn"
            >
              <CalendarDays size={16} />
              Book consultation
            </Link>

            <div className="appointments-heading-icon">
              <CalendarDays size={27} />
            </div>
          </div>
        </section>

        {/* ALERT NOTIFICATIONS */}
        {actionSuccess && (
          <div className="appointments-alert-banner success" role="alert">
            <CheckCircle2 size={18} />
            <span>{actionSuccess}</span>
            <button
              type="button"
              className="alert-dismiss-btn"
              onClick={() => setActionSuccess(null)}
              aria-label="Dismiss alert"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {actionError && (
          <div className="appointments-alert-banner error" role="alert">
            <AlertCircle size={18} />
            <span>{actionError}</span>
            <button
              type="button"
              className="alert-dismiss-btn"
              onClick={() => setActionError(null)}
              aria-label="Dismiss alert"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* PENDING RESCHEDULE PROPOSALS FROM DOCTOR */}
        {pendingProposals.length > 0 && (
          <section className="appointments-proposals-section" aria-label="Reschedule proposals requiring your action">
            <div className="appointments-proposals-header">
              <div className="proposals-header-title">
                <span className="proposals-badge">Action Required</span>
                <h2>Doctor Reschedule Proposals ({pendingProposals.length})</h2>
              </div>
              <p className="proposals-header-desc">
                Your practitioner has proposed a new consultation time. Please review and choose whether to accept or decline.
              </p>
            </div>

            <div className="appointments-proposals-list">
              {pendingProposals.map((proposal) => {
                const doctor = doctorsMap[proposal.doctor_profile_id];
                const doctorName = doctor?.full_name ? `Dr. ${doctor.full_name}` : "Healthcare Practitioner";
                const spec = doctor?.specialization;

                return (
                  <article key={proposal.id} className="appointment-proposal-card">
                    <div className="proposal-card-top">
                      <div className="proposal-doctor-info">
                        <div className="proposal-doctor-avatar">
                          <Stethoscope size={20} />
                        </div>
                        <div>
                          <div className="proposal-doctor-name">{doctorName}</div>
                          {spec && <div className="proposal-doctor-spec">{spec}</div>}
                        </div>
                      </div>
                      <div className="proposal-expiry-badge">
                        <Clock3 size={13} />
                        <span>{formatExpirationNotice(proposal.expires_at)}</span>
                      </div>
                    </div>

                    <div className="appointment-proposal-comparison">
                      <div className="proposal-slot-box original">
                        <span className="slot-box-label">Current Slot</span>
                        <div className="slot-box-date">{formatDate(proposal.current_appointment_date || "")}</div>
                        <div className="slot-box-time">
                          {formatTime(proposal.current_start_time || "")} – {formatTime(proposal.current_end_time || "")}
                        </div>
                      </div>

                      <div className="proposal-slot-arrow" aria-hidden="true">
                        <ArrowRight size={20} />
                      </div>

                      <div className="proposal-slot-box proposed">
                        <span className="slot-box-label">Proposed New Slot</span>
                        <div className="slot-box-date">{formatDate(proposal.proposed_date)}</div>
                        <div className="slot-box-time">
                          {formatTime(proposal.proposed_start_time)} – {formatTime(proposal.proposed_end_time)}
                        </div>
                      </div>
                    </div>

                    {proposal.doctor_message && (
                      <div className="proposal-doctor-note">
                        <span className="note-label">Doctor's Note:</span>
                        <p className="note-text">{proposal.doctor_message}</p>
                      </div>
                    )}

                    <div className="appointment-proposal-guarantee">
                      <ShieldCheck size={14} />
                      <span>If you decline, your current appointment slot is preserved.</span>
                    </div>

                    <div className="appointment-proposal-actions">
                      <button
                        type="button"
                        className="proposal-btn-decline"
                        onClick={() => void handleDeclineProposal(proposal)}
                        disabled={isRespondingProposal}
                        aria-label={`Decline reschedule proposal from ${doctorName}`}
                      >
                        {isRespondingProposal && respondingProposalId === proposal.id ? (
                          <>
                            <Loader2 size={15} className="spinner" />
                            Declining...
                          </>
                        ) : (
                          <>
                            <XCircle size={15} />
                            Decline
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="proposal-btn-accept"
                        onClick={() => {
                          setProposalResponseError(null);
                          setAcceptingProposal(proposal);
                        }}
                        disabled={isRespondingProposal}
                        aria-label={`Review and accept reschedule proposal from ${doctorName}`}
                      >
                        <CalendarCheck size={15} />
                        Accept Reschedule
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* SUMMARY STATS */}
        <section className="appointments-stats">
          <article className="appointments-stat-card">
            <span className="appointments-stat-icon teal">
              <CalendarDays size={20} />
            </span>
            <div>
              <small>Total appointments</small>
              <strong>{loading ? "—" : error ? "—" : counts.all}</strong>
            </div>
          </article>

          <article className="appointments-stat-card">
            <span className="appointments-stat-icon blue">
              <CalendarCheck size={20} />
            </span>
            <div>
              <small>Upcoming</small>
              <strong>{loading ? "—" : error ? "—" : counts.upcoming}</strong>
            </div>
          </article>

          <article className="appointments-stat-card">
            <span className="appointments-stat-icon green">
              <CheckCircle2 size={20} />
            </span>
            <div>
              <small>Completed</small>
              <strong>{loading ? "—" : error ? "—" : counts.completed}</strong>
            </div>
          </article>

          <article className="appointments-stat-card">
            <span className="appointments-stat-icon red">
              <XCircle size={20} />
            </span>
            <div>
              <small>Cancelled</small>
              <strong>{loading ? "—" : error ? "—" : counts.cancelled}</strong>
            </div>
          </article>
        </section>

        {/* MAIN CONTENT CARD */}
        <section className="appointments-content-card">
          <div className="appointments-content-heading">
            <div>
              <span className="appointments-section-kicker">YOUR CONSULTATIONS</span>
              <h2>Appointment history</h2>
              <p>Manage your upcoming and previous healthcare consultations.</p>
            </div>
            <ShieldCheck size={22} />
          </div>

          <div className="appointments-toolbar">
            <div className="appointments-filters">
              {filters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`appointments-filter ${
                    filter === item.value ? "active" : ""
                  }`}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                  <span>{loading || error ? "—" : item.count}</span>
                </button>
              ))}
            </div>

            <label className="appointments-search">
              <Search size={17} />
              <input
                type="search"
                placeholder="Search appointments by doctor, date, or reason..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {loading ? (
            <div className="appointments-state">
              <div className="appointments-spinner" />
              <h3>Loading your appointments</h3>
              <p>Retrieving your consultation schedule securely.</p>
            </div>
          ) : error ? (
            <div className="appointments-state">
              <span className="appointments-state-icon error">
                <Activity size={25} />
              </span>
              <h3>Unable to load appointments</h3>
              <p>{error}</p>
              <button
                type="button"
                className="appointments-retry-button"
                onClick={() => void refreshAppointments()}
              >
                Try again
              </button>
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div className="appointments-state">
              <span className="appointments-state-icon">
                <CalendarDays size={26} />
              </span>
              <h3>
                {search
                  ? "No matching appointments"
                  : filter === "all"
                    ? "No appointments yet"
                    : `No ${filter} appointments`}
              </h3>
              <p>
                {search
                  ? "Try a different search term."
                  : "Your appointment details will appear here once booked."}
              </p>

              {(search || filter !== "all") && (
                <button
                  type="button"
                  className="appointments-reset-button"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="appointments-list">
              {filteredAppointments.map((appointment) => {
                const upcoming = isUpcoming(appointment);
                const canModify = appointment.status === "booked" && upcoming;
                const doctor = doctorsMap[appointment.doctor_profile_id];
                const pendingProposal = pendingProposals.find(
                  (p) => p.appointment_id === appointment.id,
                );

                return (
                  <article
                    className="appointment-list-card"
                    key={appointment.id}
                  >
                    <div className="appointment-list-icon">
                      <Stethoscope size={21} />
                    </div>

                    <div className="appointment-list-main">
                      <div className="appointment-list-top">
                        <div className="appointment-type-row">
                          <span className="appointment-list-type">
                            {doctor?.specialization
                              ? doctor.specialization.toUpperCase()
                              : "DOCTOR CONSULTATION"}
                          </span>
                          {doctor?.clinic_name && (
                            <span className="appointment-clinic-name">
                              · {doctor.clinic_name}
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {pendingProposal && (
                            <span className="appointment-proposal-pending-pill">
                              <CalendarClock size={12} />
                              Reschedule Proposed
                            </span>
                          )}
                          <span
                            className={`appointment-status ${
                              appointment.status
                            } ${upcoming ? "upcoming" : ""}`}
                          >
                            {getStatusLabel(appointment)}
                          </span>
                        </div>
                      </div>

                      <h3>
                        {doctor
                          ? `Dr. ${doctor.full_name}`
                          : "Consultation appointment"}
                      </h3>

                      <div className="appointment-list-details">
                        <span>
                          <CalendarDays size={15} />
                          {formatDate(appointment.appointment_date)}
                        </span>
                        <span>
                          <Clock3 size={15} />
                          {formatTime(appointment.start_time)} –{" "}
                          {formatTime(appointment.end_time)}
                        </span>
                      </div>

                      {appointment.reason && (
                        <p className="appointment-reason">
                          <strong>Reason:</strong> {appointment.reason}
                        </p>
                      )}

                      {pendingProposal && (
                        <div className="appointment-card-proposal-notice">
                          <CalendarClock size={14} />
                          <span>
                            Doctor proposed rescheduling to{" "}
                            <strong>
                              {formatDate(pendingProposal.proposed_date)} at{" "}
                              {formatTime(pendingProposal.proposed_start_time)}
                            </strong>
                            . Review action above.
                          </span>
                        </div>
                      )}

                      <div className="appointment-card-bottom">
                        <span className="appointment-reference">
                          ID: {appointment.id}
                        </span>

                        {canModify && (
                          <div className="appointment-card-actions">
                            <button
                              type="button"
                              className="appointment-action-btn reschedule"
                              onClick={() => handleOpenReschedule(appointment)}
                              disabled={Boolean(pendingProposal)}
                              title={
                                pendingProposal
                                  ? "Cannot directly reschedule while a doctor proposal is pending. Please accept or decline the proposal above."
                                  : undefined
                              }
                              aria-label={`Reschedule appointment on ${formatDate(
                                appointment.appointment_date,
                              )}`}
                            >
                              <CalendarClock size={14} />
                              Reschedule
                            </button>

                            <button
                              type="button"
                              className="appointment-action-btn cancel"
                              onClick={() => handleOpenCancel(appointment)}
                              aria-label={`Cancel appointment on ${formatDate(
                                appointment.appointment_date,
                              )}`}
                            >
                              <XCircle size={14} />
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* SECURITY & PRIVACY FOOTER NOTE */}
        <section className="appointments-help-note">
          <ShieldCheck size={19} />
          <div>
            <strong>Your healthcare information stays protected</strong>
            <p>
              Your appointments and consultations are governed by secure role-based access
              and end-to-end data validation.
            </p>
          </div>
          <Link to="/patient">
            Back to overview <ArrowRight size={15} />
          </Link>
        </section>

        {/* CANCEL APPOINTMENT CONFIRMATION DIALOG */}
        {cancellingAppointment && (
          <div
            className="appointment-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-dialog-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isCancelling) {
                handleCloseCancel();
              }
            }}
          >
            <div className="appointment-modal-dialog cancel-modal">
              <button
                type="button"
                className="appointment-modal-close"
                onClick={handleCloseCancel}
                disabled={isCancelling}
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>

              <div className="cancel-dialog-icon">
                <AlertTriangle size={36} />
              </div>

              <span className="appointment-modal-kicker">CANCELLATION CONFIRMATION</span>
              <h2 id="cancel-dialog-title">Cancel consultation appointment?</h2>

              <p className="cancel-dialog-desc">
                Are you sure you want to cancel your upcoming consultation? Once cancelled,
                your appointment slot will be released immediately for other patients.
              </p>

              {/* APPOINTMENT SUMMARY CARD */}
              <div className="cancel-details-card">
                <div>
                  <span>Practitioner</span>
                  <strong>
                    {doctorsMap[cancellingAppointment.doctor_profile_id]
                      ? `Dr. ${doctorsMap[cancellingAppointment.doctor_profile_id].full_name}`
                      : "Healthcare Practitioner"}
                  </strong>
                </div>
                <div>
                  <span>Scheduled Date & Time</span>
                  <strong>
                    {formatDate(cancellingAppointment.appointment_date)} ·{" "}
                    {formatTime(cancellingAppointment.start_time)} –{" "}
                    {formatTime(cancellingAppointment.end_time)}
                  </strong>
                </div>
                {cancellingAppointment.reason && (
                  <div>
                    <span>Reason on Record</span>
                    <strong className="cancel-reason-text">
                      {cancellingAppointment.reason}
                    </strong>
                  </div>
                )}
                <div>
                  <span>Appointment Reference</span>
                  <small>{cancellingAppointment.id}</small>
                </div>
              </div>

              {cancelError && (
                <div className="appointment-modal-error" role="alert">
                  <AlertCircle size={16} />
                  <span>{cancelError}</span>
                </div>
              )}

              <div className="appointment-modal-actions">
                <button
                  type="button"
                  className="appointment-btn-secondary"
                  onClick={handleCloseCancel}
                  disabled={isCancelling}
                >
                  Keep appointment
                </button>

                <button
                  type="button"
                  className="appointment-btn-danger"
                  onClick={() => void handleConfirmCancel()}
                  disabled={isCancelling}
                >
                  {isCancelling ? (
                    <>
                      <Loader2 size={16} className="spinner" />
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <XCircle size={16} />
                      Confirm cancellation
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* RESCHEDULE APPOINTMENT MODAL */}
        {reschedulingAppointment && (
          <div
            className="appointment-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reschedule-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isRescheduling) {
                handleCloseReschedule();
              }
            }}
          >
            <div className="appointment-modal-dialog reschedule-modal">
              <button
                type="button"
                className="appointment-modal-close"
                onClick={handleCloseReschedule}
                disabled={isRescheduling}
                aria-label="Close reschedule modal"
              >
                <X size={20} />
              </button>

              <div className="appointment-modal-header">
                <span className="appointment-modal-kicker">CHANGE APPOINTMENT SCHEDULE</span>
                <h2 id="reschedule-modal-title">Reschedule consultation</h2>
                <p>Select a new consultation date and choose an available time slot.</p>
              </div>

              {/* CURRENT APPOINTMENT BRIEF */}
              <div className="reschedule-current-brief">
                <div className="reschedule-brief-icon">
                  <Stethoscope size={22} />
                </div>
                <div className="reschedule-brief-meta">
                  <h3>
                    {doctorsMap[reschedulingAppointment.doctor_profile_id]
                      ? `Dr. ${doctorsMap[reschedulingAppointment.doctor_profile_id].full_name}`
                      : "Doctor Consultation"}
                  </h3>
                  <span>
                    Current: {formatDate(reschedulingAppointment.appointment_date)} at{" "}
                    {formatTime(reschedulingAppointment.start_time)} –{" "}
                    {formatTime(reschedulingAppointment.end_time)}
                  </span>
                </div>
              </div>

              {rescheduleError && (
                <div className="appointment-modal-error" role="alert">
                  <AlertCircle size={16} />
                  <span>{rescheduleError}</span>
                </div>
              )}

              <form onSubmit={handleSubmitReschedule} className="reschedule-form">
                {/* 1. DATE SELECTION */}
                <div className="reschedule-field-group">
                  <label htmlFor="reschedule-date-input" className="reschedule-label">
                    <span>1. Select new consultation date</span>
                    <small>Tomorrow onwards (Asia/Kolkata)</small>
                  </label>
                  <input
                    id="reschedule-date-input"
                    type="date"
                    className="reschedule-date-input"
                    value={rescheduleDate}
                    min={getTomorrowString()}
                    max={getMaxDateString()}
                    disabled={isRescheduling}
                    onChange={(e) => handleDateChange(e.target.value)}
                    required
                  />
                </div>

                {/* 2. AVAILABLE SLOTS */}
                <div className="reschedule-field-group">
                  <div className="reschedule-slots-header">
                    <label className="reschedule-label">
                      <span>2. Select new available time slot</span>
                      {rescheduleSlots.length > 0 && (
                        <span className="reschedule-slots-badge">
                          {rescheduleSlots.length} available
                        </span>
                      )}
                    </label>

                    <button
                      type="button"
                      className="reschedule-refresh-btn"
                      onClick={() =>
                        loadSlotsForDate(
                          reschedulingAppointment.doctor_profile_id,
                          rescheduleDate,
                        )
                      }
                      disabled={loadingSlots || isRescheduling}
                      title="Refresh slots"
                    >
                      <RefreshCw
                        size={12}
                        className={loadingSlots ? "spinner" : ""}
                      />
                      <span>Refresh</span>
                    </button>
                  </div>

                  {loadingSlots ? (
                    <div className="reschedule-slots-loading">
                      <Loader2 size={20} className="spinner" />
                      <span>Checking doctor availability in Asia/Kolkata...</span>
                    </div>
                  ) : slotsError ? (
                    <div className="reschedule-slots-error">
                      <AlertCircle size={16} />
                      <span>{slotsError}</span>
                    </div>
                  ) : rescheduleSlots.length === 0 ? (
                    <div className="reschedule-slots-empty">
                      <CalendarDays size={22} />
                      <p>No available slots found on {formatDate(rescheduleDate)}.</p>
                      <span>Please choose another date when the doctor has active shifts.</span>
                    </div>
                  ) : (
                    <div className="reschedule-slots-grid">
                      {rescheduleSlots.map((slot) => {
                        const isSelected =
                          selectedSlot?.start_time === slot.start_time;

                        // Check if it matches current appointment slot
                        const isSameAsCurrent =
                          reschedulingAppointment.appointment_date === rescheduleDate &&
                          reschedulingAppointment.start_time === slot.start_time;

                        return (
                          <button
                            type="button"
                            key={slot.start_time}
                            className={`reschedule-slot-chip ${
                              isSelected ? "selected" : ""
                            } ${isSameAsCurrent ? "disabled-current" : ""}`}
                            onClick={() => {
                              if (!isSameAsCurrent) setSelectedSlot(slot);
                            }}
                            disabled={isRescheduling || isSameAsCurrent}
                            title={
                              isSameAsCurrent
                                ? "Already your current appointment slot"
                                : `${formatTime(slot.start_time)} to ${formatTime(
                                    slot.end_time,
                                  )}`
                            }
                          >
                            <Clock3 size={13} />
                            <span>
                              {formatTime(slot.start_time)} –{" "}
                              {formatTime(slot.end_time)}
                            </span>
                            {isSameAsCurrent && (
                              <small className="slot-current-tag">Current</small>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* SELECTED SUMMARY NOTICE */}
                {selectedSlot && (
                  <div className="reschedule-selection-summary">
                    <CheckCircle2 size={16} />
                    <div>
                      <strong>New consultation schedule:</strong>
                      <span>
                        {formatDate(rescheduleDate)} from{" "}
                        {formatTime(selectedSlot.start_time)} to{" "}
                        {formatTime(selectedSlot.end_time)}
                      </span>
                    </div>
                  </div>
                )}

                {/* MODAL ACTIONS */}
                <div className="appointment-modal-actions">
                  <button
                    type="button"
                    className="appointment-btn-secondary"
                    onClick={handleCloseReschedule}
                    disabled={isRescheduling}
                  >
                    Keep current
                  </button>

                  <button
                    type="submit"
                    className="appointment-btn-primary"
                    disabled={isRescheduling || !selectedSlot}
                  >
                    {isRescheduling ? (
                      <>
                        <Loader2 size={16} className="spinner" />
                        Rescheduling...
                      </>
                    ) : (
                      <>
                        <CalendarClock size={16} />
                        Confirm reschedule
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ACCEPT RESCHEDULE CONFIRMATION MODAL */}
        {acceptingProposal && (
          <div
            className="appointment-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="accept-proposal-dialog-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isRespondingProposal) {
                setAcceptingProposal(null);
                setProposalResponseError(null);
              }
            }}
          >
            <div
              className="appointment-modal-dialog accept-proposal-modal"
              ref={acceptModalRef}
              tabIndex={-1}
            >
              <button
                type="button"
                className="appointment-modal-close"
                onClick={() => {
                  if (!isRespondingProposal) {
                    setAcceptingProposal(null);
                    setProposalResponseError(null);
                  }
                }}
                disabled={isRespondingProposal}
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>

              <div className="accept-dialog-icon">
                <CalendarCheck size={32} />
              </div>

              <span className="appointment-modal-kicker">RESCHEDULE CONFIRMATION</span>
              <h2 id="accept-proposal-dialog-title">Accept practitioner's new schedule?</h2>

              <p className="accept-dialog-desc">
                Your consultation will be moved immediately to the practitioner's proposed time slot. Your current appointment slot will be released for other patients.
              </p>

              {/* DETAILS CARD */}
              <div className="accept-details-card">
                <div className="accept-details-row">
                  <span className="accept-details-label">Practitioner</span>
                  <strong className="accept-details-doctor">
                    {doctorsMap[acceptingProposal.doctor_profile_id]
                      ? `Dr. ${doctorsMap[acceptingProposal.doctor_profile_id].full_name}`
                      : "Healthcare Practitioner"}
                    {doctorsMap[acceptingProposal.doctor_profile_id]?.specialization && (
                      <span className="accept-details-doctor-spec">
                        {" "}· {doctorsMap[acceptingProposal.doctor_profile_id].specialization}
                      </span>
                    )}
                  </strong>
                </div>

                <div className="accept-details-row">
                  <span className="accept-details-label">Current Slot (To be released)</span>
                  <div className="accept-slot-pill original">
                    <span className="accept-details-original">
                      {formatDate(acceptingProposal.current_appointment_date || "")} ·{" "}
                      {formatTime(acceptingProposal.current_start_time || "")} –{" "}
                      {formatTime(acceptingProposal.current_end_time || "")}
                    </span>
                    <span className="accept-slot-tag release">Released</span>
                  </div>
                </div>

                <div className="accept-details-row highlight">
                  <span className="accept-details-label">New Confirmed Slot</span>
                  <div className="accept-slot-pill proposed">
                    <strong className="accept-details-new">
                      {formatDate(acceptingProposal.proposed_date)} ·{" "}
                      {formatTime(acceptingProposal.proposed_start_time)} –{" "}
                      {formatTime(acceptingProposal.proposed_end_time)}
                    </strong>
                    <span className="accept-slot-tag confirmed">Confirmed</span>
                  </div>
                </div>

                {acceptingProposal.doctor_message && (
                  <div className="accept-details-row note">
                    <span className="accept-details-label">Practitioner Note</span>
                    <div className="accept-reason-box">
                      <p className="accept-reason-text">
                        "{acceptingProposal.doctor_message}"
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="accept-modal-guarantee">
                <ShieldCheck size={16} />
                <span>
                  Atomic update: your new appointment slot is locked immediately upon confirmation.
                </span>
              </div>

              {proposalResponseError && (
                <div className="appointment-modal-error" role="alert">
                  <AlertCircle size={16} />
                  <span>{proposalResponseError}</span>
                </div>
              )}

              <div className="appointment-modal-actions">
                <button
                  type="button"
                  className="appointment-btn-secondary"
                  onClick={() => {
                    setAcceptingProposal(null);
                    setProposalResponseError(null);
                  }}
                  disabled={isRespondingProposal}
                >
                  Keep Reviewing
                </button>

                <button
                  type="button"
                  className="appointment-btn-primary"
                  onClick={() => void handleConfirmAcceptProposal()}
                  disabled={isRespondingProposal}
                >
                  {isRespondingProposal ? (
                    <>
                      <Loader2 size={16} className="spinner" />
                      Confirming...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      Confirm New Time
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </PortalLayout>
  );
}

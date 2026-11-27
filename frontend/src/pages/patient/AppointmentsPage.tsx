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
import { patientService } from "../../services/patientService";
import {
  appointmentInstant,
  classifyBookingFailure,
  clinicDateAfter,
  createIdempotencyManager,
  createSlotRequests,
  filterUpcomingSlots,
  formatAppointmentTime,
  formatClinicDate,
  formatWeeklyScheduleSummary,
  isUpcomingAppointment as isUpcoming,
  isUpcomingSlot,
  resolveAppointmentDoctorMeta,
  scanPatientPages,
  validBookingDate,
  type WeeklyScheduleEntry,
} from "../../services/patientReliability";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import PatientHistoryControls from "./PatientHistoryControls";
import { usePatientHistoryPage } from "./usePatientHistoryPage";
import type {
  ApprovedDoctorSummary,
  AvailableSlot,
  PatientAppointment,
  AppointmentRescheduleProposal,
} from "../../types/patient";
import "./AppointmentsPage.css";

type FilterStatus = "all" | "upcoming" | "completed" | "cancelled";

type DoctorMeta = Pick<
  ApprovedDoctorSummary,
  "id" | "full_name" | "specialization" | "qualification" | "clinic_name" | "consultation_fee"
>;

const formatDate = formatClinicDate;

function getStatusLabel(appointment: PatientAppointment): string {
  if (appointment.status === "completed") return "Completed";
  if (appointment.status === "cancelled") return "Cancelled";
  return isUpcoming(appointment) ? "Upcoming" : "Past appointment";
}

const getTodayString = () => clinicDateAfter(0);
const getMaxDateString = () => clinicDateAfter(60);

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

  const history = usePatientHistoryPage(user?.id, patientService.getMyAppointments, "your appointments");
  const { items: appointments, loading, error, reload } = history;
  const [doctorsMap, setDoctorsMap] = useState<Record<string, DoctorMeta>>({});
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

  // Cancellation dialog state
  const [cancellingAppointment, setCancellingAppointment] =
    useState<PatientAppointment | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancelModalRef = useRef<HTMLDivElement>(null);

  // Rescheduling modal state
  const [reschedulingAppointment, setReschedulingAppointment] =
    useState<PatientAppointment | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string>(getTodayString());
  const [rescheduleWeeklySchedule, setRescheduleWeeklySchedule] = useState<WeeklyScheduleEntry[]>([]);
  const [loadingRescheduleSchedule, setLoadingRescheduleSchedule] = useState(false);
  const [rescheduleScheduleNote, setRescheduleScheduleNote] = useState<string | null>(null);
  const [rescheduleSlots, setRescheduleSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const rescheduleModalRef = useRef<HTMLDivElement>(null);
  const rescheduleScheduleReqRef = useRef<AbortController | null>(null);
  const rescheduleIdempotency = useRef(createIdempotencyManager());

  // Auto-dismiss success alert
  useEffect(() => {
    if (!actionSuccess) return;
    const timer = setTimeout(() => {
      setActionSuccess(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [actionSuccess]);

  // Metadata is optional for rendering appointment history. Keep its paginated refresh independent.
  const [metadataRevision, setMetadataRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      scanPatientPages(patientService.getApprovedDoctorsDirectory, controller.signal).catch(() => null),
      patientService.getMyPendingProposals().catch(() => null),
    ]).then(([docsResult, proposalsRes]) => {
      if (controller.signal.aborted) return;
      setPendingProposals(proposalsRes?.items ?? []);
      if (docsResult) {
        setDoctorsMap(Object.fromEntries(docsResult.items.map((doctor) => [doctor.id, doctor])));
      }
    });
    return () => controller.abort();
  }, [metadataRevision, user?.id]);

  function refreshAppointments() {
    reload();
    setMetadataRevision((value) => value + 1);
  }

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
        `Consultation successfully rescheduled to ${formatDate(updated.proposed_date)} at ${formatAppointmentTime(updated.proposed_start_time)}!`,
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
        `Reschedule proposal declined. Your original consultation remains scheduled for ${formatDate(proposal.current_appointment_date || "")} at ${formatAppointmentTime(proposal.current_start_time || "")}.`,
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

  useDialogFocusTrap(Boolean(acceptingProposal), acceptModalRef);
  useDialogFocusTrap(Boolean(cancellingAppointment), cancelModalRef);
  useDialogFocusTrap(Boolean(reschedulingAppointment), rescheduleModalRef);

  const [rescheduleRequests] = useState(createSlotRequests);
  useEffect(() => () => {
    rescheduleRequests.invalidate();
    rescheduleScheduleReqRef.current?.abort();
  }, [rescheduleRequests]);

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
          rescheduleRequests.invalidate();
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
    rescheduleRequests,
  ]);

  const loadRescheduleWeeklySchedule = useCallback(async (doctorProfileId: string) => {
    rescheduleScheduleReqRef.current?.abort();
    const controller = new AbortController();
    rescheduleScheduleReqRef.current = controller;
    setRescheduleWeeklySchedule([]);
    setRescheduleScheduleNote(null);
    setLoadingRescheduleSchedule(true);

    try {
      const response = await patientService.getDoctorPublicAvailability(doctorProfileId, controller.signal);
      if (rescheduleScheduleReqRef.current !== controller || controller.signal.aborted) return;
      setRescheduleWeeklySchedule(formatWeeklyScheduleSummary(response.items));
    } catch (err) {
      if (rescheduleScheduleReqRef.current !== controller || controller.signal.aborted) return;
      setRescheduleScheduleNote(
        axios.isAxiosError(err) && err.response?.status === 404
          ? "This practitioner is not currently accepting public schedule changes."
          : "Recurring weekly hours could not be loaded.",
      );
    } finally {
      if (rescheduleScheduleReqRef.current === controller) {
        setLoadingRescheduleSchedule(false);
      }
    }
  }, []);

  const loadSlotsForDate = useCallback(async (doctorProfileId: string, date: string) => {
    const request = rescheduleRequests.begin(doctorProfileId, date);
    setRescheduleSlots([]);
    setSelectedSlot(null);
    setSlotsError(null);
    if (!validBookingDate(date)) {
      setLoadingSlots(false);
      setSlotsError("Choose today or a date within the next 60 days (Asia/Kolkata).");
      return;
    }

    setLoadingSlots(true);
    try {
      const response = await patientService.getDoctorAvailabilitySlots(doctorProfileId, date, request.signal);
      if (!request.isCurrent()) return;
      if (!request.matches(response)) {
        setSlotsError("The response did not match the selected date and doctor. Refresh availability.");
        return;
      }
      setRescheduleSlots(filterUpcomingSlots(date, response.items));
    } catch (error) {
      if (request.isCurrent()) {
        setSlotsError(extractErrorMessage(error, "Failed to load available slots for the selected date."));
      }
    } finally {
      if (request.isCurrent()) setLoadingSlots(false);
    }
  }, [rescheduleRequests]);

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
      history.updateItem(updated);

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

    const defaultDate = getTodayString();
    rescheduleIdempotency.current.clear();
    setReschedulingAppointment(appointment);
    setRescheduleDate(defaultDate);
    setRescheduleError(null);
    setSelectedSlot(null);

    void loadRescheduleWeeklySchedule(appointment.doctor_profile_id);
    void loadSlotsForDate(appointment.doctor_profile_id, defaultDate);
  };

  const handleCloseReschedule = () => {
    if (isRescheduling) return;
    rescheduleRequests.invalidate();
    rescheduleScheduleReqRef.current?.abort();
    rescheduleScheduleReqRef.current = null;
    rescheduleIdempotency.current.clear();
    setReschedulingAppointment(null);
    setRescheduleWeeklySchedule([]);
    setRescheduleScheduleNote(null);
    setRescheduleError(null);
    setSelectedSlot(null);
  };

  const handleDateChange = (newDate: string) => {
    setRescheduleDate(newDate);
    setRescheduleError(null);
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
    if (!reschedulingAppointment || !selectedSlot || isRescheduling || loadingSlots ||
        !validBookingDate(rescheduleDate) ||
        !rescheduleSlots.some((slot) => slot.start_time === selectedSlot.start_time)) return;

    if (!isUpcomingSlot(rescheduleDate, selectedSlot.start_time)) {
      setSelectedSlot(null);
      rescheduleIdempotency.current.clear();
      setRescheduleError("That slot has just passed in Asia/Kolkata. Please choose another available time.");
      await loadSlotsForDate(reschedulingAppointment.doctor_profile_id, rescheduleDate);
      return;
    }

    const fingerprint = JSON.stringify({
      appointment_id: reschedulingAppointment.id,
      appointment_date: rescheduleDate,
      start_time: selectedSlot.start_time,
    });
    const idempotencyKey = rescheduleIdempotency.current.getKey(fingerprint);

    setIsRescheduling(true);
    setRescheduleError(null);

    try {
      const updated = await patientService.rescheduleAppointment(
        reschedulingAppointment.id,
        {
          appointment_date: rescheduleDate,
          start_time: selectedSlot.start_time,
          idempotency_key: idempotencyKey,
        },
      );

      // Update state and refresh schedule
      rescheduleIdempotency.current.clear();
      refreshAppointments();

      setActionSuccess(
        `Appointment rescheduled successfully for ${formatDate(
          updated.appointment_date,
        )} at ${formatAppointmentTime(updated.start_time)} – ${formatAppointmentTime(
          updated.end_time,
        )}.`,
      );
      setActionError(null);
      setReschedulingAppointment(null);
      setSelectedSlot(null);
    } catch (err) {
      const outcome = classifyBookingFailure(err);
      if (outcome === "conflict") {
        rescheduleIdempotency.current.clear();
        setSelectedSlot(null);
        setRescheduleError(
          `${extractErrorMessage(err, "Selected reschedule slot is no longer available.")} Live availability has been refreshed below.`,
        );
        await loadSlotsForDate(reschedulingAppointment.doctor_profile_id, rescheduleDate);
      } else {
        setRescheduleError(
          extractErrorMessage(
            err,
            "Failed to reschedule appointment. Please try again.",
          ),
        );
      }
    } finally {
      setIsRescheduling(false);
    }
  };

  // Summary counts
  const counts = useMemo(() => {
    return {
      all: appointments.length,
      upcoming: appointments.filter((appointment) => isUpcoming(appointment)).length,
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
        const doctorMeta = resolveAppointmentDoctorMeta(appointment, doctorsMap);
        return [
          appointment.appointment_date,
          appointment.status,
          appointment.reason ?? "",
          appointment.id,
          ...doctorMeta.searchTerms,
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort(
        (a, b) =>
          appointmentInstant(b.appointment_date, b.start_time) -
          appointmentInstant(a.appointment_date, a.start_time),
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
                          {formatAppointmentTime(proposal.current_start_time || "")} – {formatAppointmentTime(proposal.current_end_time || "")}
                        </div>
                      </div>

                      <div className="proposal-slot-arrow" aria-hidden="true">
                        <ArrowRight size={20} />
                      </div>

                      <div className="proposal-slot-box proposed">
                        <span className="slot-box-label">Proposed New Slot</span>
                        <div className="slot-box-date">{formatDate(proposal.proposed_date)}</div>
                        <div className="slot-box-time">
                          {formatAppointmentTime(proposal.proposed_start_time)} – {formatAppointmentTime(proposal.proposed_end_time)}
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

          <PatientHistoryControls page={history.page} offset={history.offset}
            loadedCount={appointments.length} setOffset={history.setOffset} />

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
                  ? "No matching appointments on this page"
                  : filter === "all"
                    ? history.offset > 0 ? "No appointments on this page" : "No appointments yet"
                    : `No ${filter} appointments on this page`}
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
                const doctorMeta = resolveAppointmentDoctorMeta(appointment, doctorsMap);
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
                            {doctorMeta.specializationLabel}
                          </span>
                          {doctorMeta.clinicName && (
                            <span className="appointment-clinic-name">
                              · {doctorMeta.clinicName}
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

                      <h3>{doctorMeta.heading}</h3>

                      <div className="appointment-list-details">
                        <span>
                          <CalendarDays size={15} />
                          {formatDate(appointment.appointment_date)}
                        </span>
                        <span>
                          <Clock3 size={15} />
                          {formatAppointmentTime(appointment.start_time)} –{" "}
                          {formatAppointmentTime(appointment.end_time)}
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
                              {formatAppointmentTime(pendingProposal.proposed_start_time)}
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
            <div className="appointment-modal-dialog cancel-modal" ref={cancelModalRef} tabIndex={-1}>
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
                    {resolveAppointmentDoctorMeta(cancellingAppointment, doctorsMap).modalName}
                  </strong>
                </div>
                <div>
                  <span>Scheduled Date & Time</span>
                  <strong>
                    {formatDate(cancellingAppointment.appointment_date)} ·{" "}
                    {formatAppointmentTime(cancellingAppointment.start_time)} –{" "}
                    {formatAppointmentTime(cancellingAppointment.end_time)}
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
            <div className="appointment-modal-dialog reschedule-modal" ref={rescheduleModalRef} tabIndex={-1}>
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
                    {resolveAppointmentDoctorMeta(reschedulingAppointment, doctorsMap).modalName}
                  </h3>
                  <span>
                    Current: {formatDate(reschedulingAppointment.appointment_date)} at{" "}
                    {formatAppointmentTime(reschedulingAppointment.start_time)} –{" "}
                    {formatAppointmentTime(reschedulingAppointment.end_time)}
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
                <div className="reschedule-weekly-schedule">
                  <div className="reschedule-weekly-header">
                    <span>Weekly consulting hours</span>
                    <small>Recurring schedule (IST)</small>
                  </div>
                  {loadingRescheduleSchedule ? (
                    <div className="reschedule-weekly-loading">
                      <Loader2 size={14} className="spinner" />
                      <span>Loading weekly consulting hours...</span>
                    </div>
                  ) : rescheduleScheduleNote ? (
                    <p className="reschedule-weekly-note">{rescheduleScheduleNote}</p>
                  ) : rescheduleWeeklySchedule.length === 0 ? (
                    <p className="reschedule-weekly-note">
                      No recurring weekly schedule is currently published.
                    </p>
                  ) : (
                    <div className="reschedule-weekly-list">
                      {rescheduleWeeklySchedule.map((entry) => (
                        <div key={`${entry.weekday}-${entry.timeRange}`} className="reschedule-weekly-item">
                          <strong>{entry.shortDay}</strong>
                          <span>{entry.timeRange}</span>
                          <small>{entry.slotDurationMinutes}m slots</small>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="reschedule-weekly-disclaimer">
                    Weekly hours do not guarantee live availability. Pick a date below to see open slots.
                  </p>
                </div>

                {/* 1. DATE SELECTION */}
                <div className="reschedule-field-group">
                  <label htmlFor="reschedule-date-input" className="reschedule-label">
                    <span>1. Select new consultation date</span>
                    <small>Today onwards (up to 60 days, Asia/Kolkata)</small>
                  </label>
                  <input
                    id="reschedule-date-input"
                    type="date"
                    className="reschedule-date-input"
                    value={rescheduleDate}
                    min={getTodayString()}
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
                            aria-pressed={isSelected}
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
                                : `${formatAppointmentTime(slot.start_time)} to ${formatAppointmentTime(
                                    slot.end_time,
                                  )}`
                            }
                          >
                            <Clock3 size={13} />
                            <span>
                              {formatAppointmentTime(slot.start_time)} –{" "}
                              {formatAppointmentTime(slot.end_time)}
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
                        {formatAppointmentTime(selectedSlot.start_time)} to{" "}
                        {formatAppointmentTime(selectedSlot.end_time)}
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
                      {formatAppointmentTime(acceptingProposal.current_start_time || "")} –{" "}
                      {formatAppointmentTime(acceptingProposal.current_end_time || "")}
                    </span>
                    <span className="accept-slot-tag release">Released</span>
                  </div>
                </div>

                <div className="accept-details-row highlight">
                  <span className="accept-details-label">New Confirmed Slot</span>
                  <div className="accept-slot-pill proposed">
                    <strong className="accept-details-new">
                      {formatDate(acceptingProposal.proposed_date)} ·{" "}
                      {formatAppointmentTime(acceptingProposal.proposed_start_time)} –{" "}
                      {formatAppointmentTime(acceptingProposal.proposed_end_time)}
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

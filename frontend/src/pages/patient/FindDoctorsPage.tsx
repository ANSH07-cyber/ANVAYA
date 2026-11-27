import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  AlertCircle,
  ArrowRight,
  Award,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  IndianRupee,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import PortalLayout from "../../layouts/PortalLayout";
import { patientNavigation } from "./patientNavigation";
import { patientService } from "../../services/patientService";
import {
  classifyBookingFailure, clinicDateAfter, createIdempotencyManager, createSlotRequests,
  filterUpcomingSlots, formatAppointmentTime, formatClinicDate, formatDoctorHeading,
  formatWeeklyScheduleSummary, isUpcomingSlot, matchBookedAttempt, patientReadError,
  scanPatientPages, validBookingDate, type WeeklyScheduleEntry,
} from "../../services/patientReliability";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import type {
  AppointmentCreateRequest,
  ApprovedDoctorSummary,
  AvailableSlot,
  PatientAppointment,
} from "../../types/patient";
import "./FindDoctorsPage.css";

type Doctor = ApprovedDoctorSummary;

const getTodayString = () => clinicDateAfter(0);
const getMaxDateString = () => clinicDateAfter(60);

const formatDisplayDate = formatClinicDate;

function getBookingErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if ([401, 403, 404].includes(error.response?.status ?? 0)) {
      return patientReadError(error, "the booking details");
    }
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item: { msg?: string }) => item.msg ?? "Validation error")
        .join(". ");
    }
  }
  return "Unable to complete appointment booking. Please try another slot or date.";
}

export default function FindDoctorsPage() {
  const { user } = useAuth();
  const displayName = user?.full_name?.trim() || "Patient";

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [directoryRevision, setDirectoryRevision] = useState(0);
  const [directoryOwner, setDirectoryOwner] = useState<string>();
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryComplete, setDirectoryComplete] = useState(false);
  const loading = directoryLoading || directoryOwner !== user?.id;
  const visibleDoctors = useMemo(() => directoryOwner === user?.id ? doctors : [], [directoryOwner, doctors, user?.id]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [specialization, setSpecialization] = useState("all");

  // Booking Modal State
  const [bookingDoctor, setBookingDoctor] = useState<Doctor | null>(null);
  const [bookingDate, setBookingDate] = useState<string>(getTodayString());
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklyScheduleEntry[]>([]);
  const [loadingWeeklySchedule, setLoadingWeeklySchedule] = useState(false);
  const [weeklyScheduleError, setWeeklyScheduleError] = useState("");
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingSuccess, setBookingSuccess] = useState<PatientAppointment | null>(null);

  const [slotRequests] = useState(createSlotRequests);
  const weeklyRequestRef = useRef<AbortController | null>(null);
  const bookingModalRef = useRef<HTMLDivElement>(null);
  const bookingIdempotency = useRef(createIdempotencyManager());
  const bookingInFlight = useRef(false);
  const [unconfirmed, setUnconfirmed] = useState<{
    doctor: Doctor;
    attempt: AppointmentCreateRequest;
  } | null>(null);

  useDialogFocusTrap(Boolean(bookingDoctor), bookingModalRef);

  useEffect(() => {
    if (!user?.id) return;
    const owner = user.id;
    const controller = new AbortController();
    setDirectoryLoading(true);
    setError("");
    void scanPatientPages(patientService.getApprovedDoctorsDirectory, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setDoctors(result.items);
      setDirectoryComplete(result.complete);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      setDoctors([]);
      setDirectoryComplete(false);
      setError(patientReadError(failure, "the doctor directory"));
    }).finally(() => {
      if (controller.signal.aborted) return;
      setDirectoryOwner(owner);
      setDirectoryLoading(false);
    });
    return () => controller.abort();
  }, [user?.id, directoryRevision]);

  const loadWeeklySchedule = useCallback(async (doctorId: string) => {
    weeklyRequestRef.current?.abort();
    const controller = new AbortController();
    weeklyRequestRef.current = controller;
    setWeeklySchedule([]);
    setWeeklyScheduleError("");
    setLoadingWeeklySchedule(true);

    try {
      const response = await patientService.getDoctorPublicAvailability(doctorId, controller.signal);
      if (weeklyRequestRef.current !== controller || controller.signal.aborted) return;
      setWeeklySchedule(formatWeeklyScheduleSummary(response.items));
    } catch (err) {
      if (weeklyRequestRef.current !== controller || controller.signal.aborted) return;
      setWeeklyScheduleError(
        axios.isAxiosError(err) && !err.response
          ? "Couldn't load recurring weekly hours."
          : getBookingErrorMessage(err),
      );
    } finally {
      if (weeklyRequestRef.current === controller) {
        setLoadingWeeklySchedule(false);
      }
    }
  }, []);

  const loadSlots = useCallback(async (doctorId: string, date: string) => {
    const request = slotRequests.begin(doctorId, date);
    setSlots([]);
    setSelectedSlot(null);
    setSlotsError("");
    setLoadingSlots(validBookingDate(date));
    if (!validBookingDate(date)) {
      setSlotsError("Choose today or a date within the next 60 days (Asia/Kolkata).");
      return;
    }

    try {
      const response = await patientService.getDoctorAvailabilitySlots(doctorId, date, request.signal);
      if (!request.isCurrent()) return;
      if (!request.matches(response)) {
        setSlotsError("The availability response did not match the selected doctor and date. Please refresh.");
        return;
      }
      setSlots(filterUpcomingSlots(date, response.items));
    } catch (err) {
      if (request.isCurrent()) {
        setSlotsError(axios.isAxiosError(err) && !err.response
          ? "Couldn't check availability. Check your connection and try again."
          : getBookingErrorMessage(err));
      }
    } finally {
      if (request.isCurrent()) setLoadingSlots(false);
    }
  }, [slotRequests]);

  const handleCloseBooking = useCallback(() => {
    if (bookingInFlight.current) return;
    slotRequests.invalidate();
    weeklyRequestRef.current?.abort();
    weeklyRequestRef.current = null;
    if (!unconfirmed) {
      bookingIdempotency.current.clear();
    }
    setBookingDoctor(null);
    setWeeklySchedule([]);
    setWeeklyScheduleError("");
    setSlots([]);
    setSelectedSlot(null);
    setReason("");
    setBookingError("");
    setBookingSuccess(null);
  }, [slotRequests, unconfirmed]);

  const handleOpenBooking = (doctor: Doctor) => {
    if (bookingInFlight.current) return;
    const date = getTodayString();
    setBookingDoctor(unconfirmed?.doctor ?? doctor);
    setBookingDate(date);
    setSelectedSlot(null);
    setReason("");
    setBookingError("");
    setBookingSuccess(null);
    if (!unconfirmed) {
      bookingIdempotency.current.clear();
      void loadWeeklySchedule(doctor.id);
      void loadSlots(doctor.id, date);
    }
  };

  useEffect(() => () => {
    slotRequests.invalidate();
    weeklyRequestRef.current?.abort();
  }, [slotRequests]);

  // Accessibility: Close modal on Escape key press if not actively submitting
  useEffect(() => {
    if (!bookingDoctor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        handleCloseBooking();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bookingDoctor, handleCloseBooking, submitting]);

  const handleSubmitBooking = async (event: FormEvent) => {
    event.preventDefault();
    if (bookingInFlight.current || unconfirmed || bookingSuccess) return;
    if (!bookingDoctor || !selectedSlot || loadingSlots || !validBookingDate(bookingDate) ||
        !slots.some((slot) => slot.start_time === selectedSlot.start_time)) {
      setBookingError("Select a date and a currently available time slot.");
      return;
    }

    if (!isUpcomingSlot(bookingDate, selectedSlot.start_time)) {
      setSelectedSlot(null);
      bookingIdempotency.current.clear();
      setBookingError("That time slot has just passed in Asia/Kolkata. Please choose an upcoming slot.");
      await loadSlots(bookingDoctor.id, bookingDate);
      return;
    }

    const normalizedReason = reason.trim() || null;
    const fingerprint = JSON.stringify({
      doctor_profile_id: bookingDoctor.id,
      appointment_date: bookingDate,
      start_time: selectedSlot.start_time,
      reason: normalizedReason,
    });
    const idempotencyKey = bookingIdempotency.current.getKey(fingerprint);

    const attempt: AppointmentCreateRequest = {
      doctor_profile_id: bookingDoctor.id,
      appointment_date: bookingDate,
      start_time: selectedSlot.start_time,
      reason: normalizedReason,
      idempotency_key: idempotencyKey,
    };
    bookingInFlight.current = true;
    setSubmitting(true);
    setBookingError("");

    try {
      const appointment = await patientService.bookAppointment(attempt);
      bookingIdempotency.current.clear();
      setBookingSuccess(appointment);
    } catch (failure) {
      const outcome = classifyBookingFailure(failure);
      if (outcome === "conflict") {
        bookingIdempotency.current.clear();
        setSelectedSlot(null);
        setBookingError(`${getBookingErrorMessage(failure)} Live availability has been refreshed below.`);
        await loadSlots(bookingDoctor.id, bookingDate);
      } else if (outcome === "unknown") {
        setUnconfirmed({ doctor: bookingDoctor, attempt });
        setSelectedSlot(null);
        setBookingError("We couldn't confirm whether the appointment was booked. Check status or retry safely with the same request.");
      } else {
        setBookingError(getBookingErrorMessage(failure));
      }
    } finally {
      bookingInFlight.current = false;
      setSubmitting(false);
    }
  };

  async function handleRetryUnconfirmedBooking() {
    if (!unconfirmed || bookingInFlight.current) return;
    bookingInFlight.current = true;
    setSubmitting(true);
    setBookingError("");
    try {
      const appointment = await patientService.bookAppointment(unconfirmed.attempt);
      bookingIdempotency.current.clear();
      setUnconfirmed(null);
      setBookingSuccess(appointment);
    } catch (failure) {
      const outcome = classifyBookingFailure(failure);
      if (outcome === "conflict") {
        bookingIdempotency.current.clear();
        const doc = unconfirmed.doctor;
        const date = unconfirmed.attempt.appointment_date;
        setUnconfirmed(null);
        setBookingDate(date);
        setBookingError(`${getBookingErrorMessage(failure)} Live availability has been refreshed below.`);
        await loadWeeklySchedule(doc.id);
        await loadSlots(doc.id, date);
      } else {
        setBookingError(getBookingErrorMessage(failure));
      }
    } finally {
      bookingInFlight.current = false;
      setSubmitting(false);
    }
  }

  async function handleCheckBooking() {
    if (!unconfirmed || bookingInFlight.current) return;
    bookingInFlight.current = true;
    setSubmitting(true);
    setBookingError("");
    try {
      const history = await scanPatientPages(patientService.getMyAppointments);
      const appointment = matchBookedAttempt(history.items, unconfirmed.attempt);
      if (appointment) {
        bookingIdempotency.current.clear();
        setUnconfirmed(null);
        setBookingSuccess(appointment);
      } else {
        setBookingError(history.complete
          ? "A matching booking hasn't appeared yet. You can retry safely or check Appointments again."
          : "Only part of your appointment history could be checked. Your booking remains unconfirmed.");
      }
    } catch (failure) {
      setBookingError(patientReadError(failure, "your appointments"));
    } finally {
      bookingInFlight.current = false;
      setSubmitting(false);
    }
  }

  const specializations = useMemo(() => {
    return Array.from(
      new Set(visibleDoctors.map((doctor) => doctor.specialization).filter(Boolean)),
    ).sort();
  }, [visibleDoctors]);

  const filteredDoctors = useMemo(() => {
    const query = search.trim().toLowerCase();

    return visibleDoctors.filter((doctor) => {
      const matchesSpecialization =
        specialization === "all" ||
        doctor.specialization === specialization;

      const matchesSearch =
        !query ||
        [
          doctor.full_name,
          doctor.specialization,
          doctor.qualification,
          doctor.clinic_name ?? "",
          doctor.bio ?? "",
        ].some((value) => value.toLowerCase().includes(query));

      return matchesSpecialization && matchesSearch;
    });
  }, [visibleDoctors, search, specialization]);

  const hasFilters = Boolean(search.trim()) || specialization !== "all";

  return (
    <PortalLayout
      roleLabel="Patient"
      userName={displayName}
      userMeta="Patient account"
      navItems={patientNavigation}
    >
      <main className="find-doctors-page">
        <section className="find-doctors-hero">
          <div className="find-doctors-hero-content">
            <span className="find-doctors-eyebrow">
              YOUR HEALTHCARE, YOUR CHOICE
            </span>

            <h1>Find the right doctor for your health</h1>

            <p>
              Explore verified healthcare professionals, check real-time availability,
              and schedule your consultation with ease.
            </p>

            <div className="find-doctors-hero-trust">
              <span>
                <ShieldCheck size={16} />
                Verified professionals
              </span>
              <span>
                <Stethoscope size={16} />
                Specialised care
              </span>
              <span>
                <CalendarDays size={16} />
                Instant scheduling
              </span>
            </div>
          </div>

          <div className="find-doctors-hero-icon">
            <Users size={54} strokeWidth={1.35} />
            <span>
              <ShieldCheck size={19} />
            </span>
          </div>
        </section>

        <section className="find-doctors-search-section">
          <div className="find-doctors-search-heading">
            <div>
              <span className="find-doctors-section-kicker">
                DOCTOR DIRECTORY
              </span>
              <h2>Discover healthcare professionals</h2>
              <p>
                Search by doctor name, specialty or qualification.
              </p>
            </div>

            <div className="find-doctors-count">
              <strong>{loading || error || !directoryComplete ? "—" : visibleDoctors.length}</strong>
              <span>Available profiles</span>
            </div>
          </div>

          <div className="find-doctors-controls">
            <label className="find-doctors-search">
              <Search size={19} />
              <input
                type="search"
                placeholder="Search doctors, specialties..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <label className="find-doctors-specialization">
              <span>Specialization</span>
              <select
                value={specialization}
                onChange={(event) => setSpecialization(event.target.value)}
              >
                <option value="all">All specialties</option>
                {specializations.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="find-doctors-results">
          <div className="find-doctors-results-heading">
            <div>
              <h2>Doctors for you</h2>
              <p>
                {loading
                  ? "Finding available healthcare professionals..."
                  : `${filteredDoctors.length} doctor profiles ${directoryComplete ? "found" : "in loaded results"}`}
              </p>
            </div>
          </div>

          {unconfirmed && !bookingDoctor && (
            <p role="status">A booking is still unconfirmed.{" "}
              <button type="button" onClick={() => handleOpenBooking(unconfirmed.doctor)}>Check booking status</button>
            </p>
          )}

          {!loading && !error && !directoryComplete && (
            <div role="status">
              <p>The doctor directory is incomplete. Search and filters cover loaded results only.</p>
              <button type="button" onClick={() => setDirectoryRevision((value) => value + 1)}>Retry directory</button>
            </div>
          )}

          {loading ? (
            <div className="find-doctors-state">
              <div className="find-doctors-spinner" />
              <h3>Finding your doctors</h3>
              <p>Loading verified doctor profiles securely.</p>
            </div>
          ) : error ? (
            <div className="find-doctors-state">
              <span className="find-doctors-state-icon error">
                <Stethoscope size={28} />
              </span>
              <h3>Unable to load doctors</h3>
              <p>{error}</p>
              <button
                type="button"
                className="find-doctors-retry"
                onClick={() => setDirectoryRevision((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : filteredDoctors.length === 0 ? (
            <div className="find-doctors-state">
              <span className="find-doctors-state-icon">
                {hasFilters ? (
                  <Search size={28} />
                ) : (
                  <UserRound size={29} />
                )}
              </span>

              <h3>
                {!directoryComplete
                  ? "No matching doctors in loaded results"
                  : hasFilters
                    ? "No matching doctors found"
                  : "No verified doctors available yet"}
              </h3>

              <p>
                {hasFilters
                  ? "Try another doctor name or select a different specialization."
                  : "Our doctor directory will show healthcare professionals after their profiles have been verified and approved."}
              </p>

              {hasFilters && (
                <button
                  type="button"
                  className="find-doctors-retry"
                  onClick={() => {
                    setSearch("");
                    setSpecialization("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="find-doctors-grid">
              {filteredDoctors.map((doctor) => (
                <article className="find-doctor-card" key={doctor.id}>
                  <div className="find-doctor-card-top">
                    <div className="find-doctor-avatar">
                      <UserRound size={28} />
                    </div>

                    <span className="find-doctor-verified">
                      <ShieldCheck size={13} />
                      Verified
                    </span>
                  </div>

                  <h3>{doctor.full_name}</h3>
                  <span className="find-doctor-specialty">
                    {doctor.specialization}
                  </span>

                  <p className="find-doctor-qualification">
                    <Award size={15} />
                    {doctor.qualification}
                  </p>

                  <div className="find-doctor-details">
                    <span>
                      <Clock3 size={15} />
                      {doctor.years_experience} years experience
                    </span>

                    {doctor.clinic_name && (
                      <span>
                        <Stethoscope size={15} />
                        {doctor.clinic_name}
                      </span>
                    )}

                    {doctor.consultation_fee && (
                      <span>
                        <IndianRupee size={15} />
                        {doctor.consultation_fee}
                        <small> consultation fee</small>
                      </span>
                    )}
                  </div>

                  {doctor.bio && (
                    <p className="find-doctor-bio">{doctor.bio}</p>
                  )}

                  <div className="find-doctor-card-footer">
                    <span>
                      <ShieldCheck size={14} />
                      Approved
                    </span>

                    <button
                      type="button"
                      className="find-doctor-book-action"
                      onClick={() => handleOpenBooking(doctor)}
                    >
                      <CalendarDays size={15} />
                      Book consultation
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="find-doctors-help-note">
          <ShieldCheck size={19} />
          <div>
            <strong>Your healthcare journey stays protected</strong>
            <p>
              Only doctor profiles returned by the approved doctor
              directory are displayed.
            </p>
          </div>
          <Link to="/patient">
            Back to overview <ArrowRight size={15} />
          </Link>
        </section>

        {/* BOOKING MODAL */}
        {bookingDoctor && (
          <div
            className="booking-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !submitting) {
                handleCloseBooking();
              }
            }}
          >
            <div className="booking-modal" ref={bookingModalRef} tabIndex={-1}>
              <button
                type="button"
                className="booking-modal-close"
                onClick={handleCloseBooking}
                disabled={submitting}
                aria-label="Close booking modal"
              >
                <X size={20} />
              </button>

              {unconfirmed ? (
                <div className="booking-modal-header">
                  <h2 id="booking-modal-title">Booking unconfirmed</h2>
                  <p role="status">{bookingError || "Check your appointments before making another booking."}</p>
                  <div className="booking-modal-actions">
                    <Link to="/patient/appointments" className="booking-btn-secondary">View appointments</Link>
                    <button
                      type="button"
                      className="booking-btn-secondary"
                      disabled={submitting}
                      onClick={() => void handleRetryUnconfirmedBooking()}
                    >
                      {submitting ? "Retrying…" : "Retry booking"}
                    </button>
                    <button type="button" className="booking-btn-primary" disabled={submitting}
                      onClick={() => void handleCheckBooking()}>
                      {submitting ? "Checking…" : "Check booking status"}
                    </button>
                  </div>
                </div>
              ) : bookingSuccess ? (
                <div className="booking-modal-success">
                  <div className="booking-success-icon">
                    <CheckCircle2 size={48} />
                  </div>

                  <span className="booking-modal-kicker">APPOINTMENT CONFIRMED</span>
                  <h2 id="booking-modal-title">Consultation scheduled successfully</h2>

                  <p className="booking-success-summary">
                    Your consultation with <strong>{formatDoctorHeading(bookingDoctor.full_name)}</strong> is booked
                    for <strong>{formatDisplayDate(bookingSuccess.appointment_date)}</strong> at{" "}
                    <strong>
                      {formatAppointmentTime(bookingSuccess.start_time)} – {formatAppointmentTime(bookingSuccess.end_time)} IST
                    </strong>.
                  </p>

                  <div className="booking-success-card">
                    <div>
                      <span>Specialization</span>
                      <strong>{bookingDoctor.specialization}</strong>
                    </div>
                    {bookingDoctor.clinic_name && (
                      <div>
                        <span>Location</span>
                        <strong>{bookingDoctor.clinic_name}</strong>
                      </div>
                    )}
                    <div>
                      <span>Status</span>
                      <strong className="status-booked">Confirmed</strong>
                    </div>
                  </div>

                  <div className="booking-modal-actions">
                    <Link
                      to="/patient/appointments"
                      className="booking-btn-primary"
                    >
                      <CalendarCheck size={16} />
                      View my appointments
                    </Link>

                    <button
                      type="button"
                      className="booking-btn-secondary"
                      onClick={handleCloseBooking}
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmitBooking} className="booking-form">
                  <div className="booking-modal-header">
                    <span className="booking-modal-kicker">SCHEDULE CONSULTATION</span>
                    <h2 id="booking-modal-title">Book an appointment</h2>
                    <p>Select your preferred consultation date and available slot.</p>
                  </div>

                  <div className="booking-doctor-brief">
                    <div className="booking-doctor-avatar">
                      <UserRound size={24} />
                    </div>
                    <div className="booking-doctor-meta">
                      <h3>{bookingDoctor.full_name}</h3>
                      <span>{bookingDoctor.specialization} · {bookingDoctor.qualification}</span>
                      {bookingDoctor.consultation_fee && (
                        <span className="booking-fee">
                          <IndianRupee size={13} /> {bookingDoctor.consultation_fee} consultation fee
                        </span>
                      )}
                    </div>
                  </div>

                  {bookingError && (
                    <div className="booking-error-alert" role="alert">
                      <AlertCircle size={18} />
                      <span>{bookingError}</span>
                    </div>
                  )}

                  <div className="booking-weekly-schedule">
                    <div className="booking-weekly-header">
                      <span className="booking-label">
                        <span>Weekly consulting hours</span>
                        <small>Recurring schedule (IST)</small>
                      </span>
                    </div>

                    {loadingWeeklySchedule ? (
                      <div className="weekly-schedule-loading">
                        <Loader2 size={14} className="spinner" />
                        <span>Loading weekly consulting hours...</span>
                      </div>
                    ) : weeklyScheduleError ? (
                      <p className="weekly-schedule-note">{weeklyScheduleError}</p>
                    ) : weeklySchedule.length === 0 ? (
                      <p className="weekly-schedule-note">
                        No recurring weekly schedule is currently published for this practitioner.
                      </p>
                    ) : (
                      <div className="weekly-schedule-list">
                        {weeklySchedule.map((entry) => (
                          <div
                            key={`${entry.weekday}-${entry.timeRange}`}
                            className="weekly-schedule-item"
                          >
                            <strong>{entry.shortDay}</strong>
                            <span>{entry.timeRange}</span>
                            <small>{entry.slotDurationMinutes}m slots</small>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="weekly-schedule-disclaimer">
                      Weekly hours reflect regular consulting shifts and do not guarantee open slots. Pick a date below to view real-time availability.
                    </p>
                  </div>

                  <div className="booking-field-group">
                    <label htmlFor="booking-date-input" className="booking-label">
                      <span>1. Select consultation date</span>
                      <small>Today onwards (up to 60 days, Asia/Kolkata)</small>
                    </label>
                    <input
                      id="booking-date-input"
                      type="date"
                      className="booking-date-input"
                      value={bookingDate}
                      min={getTodayString()}
                      max={getMaxDateString()}
                      disabled={submitting}
                      onChange={(e) => {
                        const date = e.target.value;
                        setBookingDate(date);
                        setBookingError("");
                        void loadSlots(bookingDoctor.id, date);
                      }}
                      required
                    />
                  </div>

                  <div className="booking-field-group">
                    <div className="booking-slots-header">
                      <label className="booking-label">
                        <span>2. Select an available time (IST)</span>
                        {slots.length > 0 && (
                          <span className="slots-count">{slots.length} available</span>
                        )}
                      </label>
                      <button
                        type="button"
                        className="slots-refresh-btn"
                        onClick={() => loadSlots(bookingDoctor.id, bookingDate)}
                        disabled={loadingSlots || submitting}
                        title="Refresh slots"
                      >
                        <RefreshCw size={13} className={loadingSlots ? "spinner" : ""} />
                        <span>Refresh</span>
                      </button>
                    </div>

                    {loadingSlots ? (
                      <div className="slots-loading">
                        <Loader2 size={20} className="spinner" />
                        <span>Checking doctor availability...</span>
                      </div>
                    ) : slotsError ? (
                      <div className="slots-error">
                        <AlertCircle size={16} />
                        <span>{slotsError}</span>
                      </div>
                    ) : slots.length === 0 ? (
                      <div className="slots-empty">
                        <CalendarDays size={22} />
                        <p>No available slots found on {formatDisplayDate(bookingDate)}.</p>
                        <span>Please choose another date when the doctor is consulting.</span>
                      </div>
                    ) : (
                      <div className="slots-grid">
                        {slots.map((slot) => {
                          const isSelected =
                            selectedSlot?.start_time === slot.start_time;
                          return (
                            <button
                              type="button"
                              key={slot.start_time}
                              className={`slot-chip ${isSelected ? "selected" : ""}`}
                              aria-pressed={isSelected}
                              onClick={() => setSelectedSlot(slot)}
                              disabled={submitting}
                            >
                              <Clock3 size={14} />
                              <span>{formatAppointmentTime(slot.start_time)} – {formatAppointmentTime(slot.end_time)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {selectedSlot && (
                    <div className="booking-selection-summary" role="status">
                      <CheckCircle2 size={16} />
                      <span>
                        Selected: <strong>{formatDisplayDate(bookingDate)}</strong> ·{" "}
                        <strong>
                          {formatAppointmentTime(selectedSlot.start_time)} –{" "}
                          {formatAppointmentTime(selectedSlot.end_time)} IST
                        </strong>
                      </span>
                    </div>
                  )}

                  <div className="booking-field-group">
                    <label htmlFor="booking-reason" className="booking-label">
                      <span>3. Reason for consultation (Optional)</span>
                      <small>{reason.length}/3000</small>
                    </label>
                    <textarea
                      id="booking-reason"
                      className="booking-reason-input"
                      placeholder="Briefly describe your symptoms or concern for the doctor..."
                      value={reason}
                      maxLength={3000}
                      disabled={submitting}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div className="booking-modal-actions">
                    <button
                      type="button"
                      className="booking-btn-secondary"
                      onClick={handleCloseBooking}
                      disabled={submitting}
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      className="booking-btn-primary"
                      disabled={submitting || loadingSlots || !selectedSlot}
                    >
                      {submitting ? (
                        <>
                          <Loader2 size={16} className="spinner" />
                          Confirming appointment...
                        </>
                      ) : (
                        <>
                          <CalendarCheck size={16} />
                          Confirm booking
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </main>
    </PortalLayout>
  );
}

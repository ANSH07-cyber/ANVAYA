import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import api from "../../services/api";
import { patientService } from "../../services/patientService";
import type {
  AvailableSlot,
  PatientAppointment,
} from "../../types/patient";
import "./FindDoctorsPage.css";

interface Doctor {
  id: string;
  full_name: string;
  specialization: string;
  qualification: string;
  years_experience: number;
  clinic_name: string | null;
  consultation_fee: string | null;
  bio: string | null;
}

interface DoctorDirectoryResponse {
  items: Doctor[];
  total: number;
  limit: number;
  offset: number;
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

function formatTime(value: string) {
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

function formatDisplayDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getBookingErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [specialization, setSpecialization] = useState("all");

  // Booking Modal State
  const [bookingDoctor, setBookingDoctor] = useState<Doctor | null>(null);
  const [bookingDate, setBookingDate] = useState<string>(getTomorrowString());
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingSuccess, setBookingSuccess] = useState<PatientAppointment | null>(null);

  useEffect(() => {
    let active = true;

    async function loadDoctors() {
      try {
        const response = await api.get<DoctorDirectoryResponse>("/doctors");

        if (active) {
          setDoctors(response.data.items);
        }
      } catch {
        if (active) {
          setError(
            "We couldn't load the doctor directory. Please try again.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDoctors();

    return () => {
      active = false;
    };
  }, []);

  const loadSlots = useCallback(async (doctorId: string, date: string) => {
    setLoadingSlots(true);
    setSlotsError("");
    setSelectedSlot(null);

    try {
      const response = await patientService.getDoctorAvailabilitySlots(doctorId, date);
      setSlots(response.items);
    } catch (err) {
      setSlots([]);
      setSlotsError(getBookingErrorMessage(err));
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  const handleCloseBooking = () => {
    setBookingDoctor(null);
    setSlots([]);
    setSelectedSlot(null);
    setReason("");
    setBookingError("");
    setBookingSuccess(null);
  };

  const handleOpenBooking = (doctor: Doctor) => {
    setBookingDoctor(doctor);
    setBookingDate(getTomorrowString());
    setSelectedSlot(null);
    setReason("");
    setBookingError("");
    setBookingSuccess(null);
  };

  // Fetch available slots when booking modal is opened or date changes
  useEffect(() => {
    if (!bookingDoctor) {
      return;
    }

    void loadSlots(bookingDoctor.id, bookingDate);
  }, [bookingDoctor, bookingDate, loadSlots]);

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
  }, [bookingDoctor, submitting]);

  const handleSubmitBooking = async (event: FormEvent) => {
    event.preventDefault();

    if (!bookingDoctor || !selectedSlot) {
      setBookingError("Please select an available time slot for your consultation.");
      return;
    }

    setSubmitting(true);
    setBookingError("");

    try {
      const appointment = await patientService.bookAppointment({
        doctor_profile_id: bookingDoctor.id,
        appointment_date: bookingDate,
        start_time: selectedSlot.start_time,
        reason: reason.trim() ? reason.trim() : null,
      });

      setBookingSuccess(appointment);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        const detail =
          typeof err.response.data?.detail === "string"
            ? err.response.data.detail
            : "The selected consultation slot is no longer available or conflicts with another appointment.";
        setBookingError(`${detail} Available slots have been refreshed below. Please choose another slot.`);
        // Refresh slots immediately to show latest availability
        await loadSlots(bookingDoctor.id, bookingDate);
      } else {
        setBookingError(getBookingErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const specializations = useMemo(() => {
    return Array.from(
      new Set(doctors.map((doctor) => doctor.specialization).filter(Boolean)),
    ).sort();
  }, [doctors]);

  const filteredDoctors = useMemo(() => {
    const query = search.trim().toLowerCase();

    return doctors.filter((doctor) => {
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
  }, [doctors, search, specialization]);

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
              <strong>{loading || error ? "—" : doctors.length}</strong>
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
                  : `${filteredDoctors.length} doctor profiles found`}
              </p>
            </div>
          </div>

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
                onClick={() => window.location.reload()}
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
                {hasFilters
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
            <div className="booking-modal">
              <button
                type="button"
                className="booking-modal-close"
                onClick={handleCloseBooking}
                disabled={submitting}
                aria-label="Close booking modal"
              >
                <X size={20} />
              </button>

              {bookingSuccess ? (
                <div className="booking-modal-success">
                  <div className="booking-success-icon">
                    <CheckCircle2 size={48} />
                  </div>

                  <span className="booking-modal-kicker">APPOINTMENT CONFIRMED</span>
                  <h2 id="booking-modal-title">Consultation scheduled successfully</h2>

                  <p className="booking-success-summary">
                    Your consultation with <strong>Dr. {bookingDoctor.full_name}</strong> is booked
                    for <strong>{formatDisplayDate(bookingSuccess.appointment_date)}</strong> at{" "}
                    <strong>
                      {formatTime(bookingSuccess.start_time)} – {formatTime(bookingSuccess.end_time)}
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

                  <div className="booking-field-group">
                    <label htmlFor="booking-date-input" className="booking-label">
                      <span>1. Select consultation date</span>
                      <small>Tomorrow onwards (up to 60 days)</small>
                    </label>
                    <input
                      id="booking-date-input"
                      type="date"
                      className="booking-date-input"
                      value={bookingDate}
                      min={getTomorrowString()}
                      max={getMaxDateString()}
                      disabled={submitting}
                      onChange={(e) => setBookingDate(e.target.value)}
                      required
                    />
                  </div>

                  <div className="booking-field-group">
                    <div className="booking-slots-header">
                      <label className="booking-label">
                        <span>2. Select available 30-min time slot</span>
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
                              onClick={() => setSelectedSlot(slot)}
                              disabled={submitting}
                            >
                              <Clock3 size={14} />
                              <span>{formatTime(slot.start_time)} – {formatTime(slot.end_time)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

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
                      disabled={submitting || !selectedSlot}
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

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  MapPin,
  Pill,
  RefreshCw,
  Scan,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import PortalLayout from "../../layouts/PortalLayout";
import { consentService } from "../../services/consentService";
import {
  HISTORY_PAGE_SIZE,
  appointmentInstant,
  formatAppointmentTime,
  nextBookedAppointment,
  patientReadError,
  readPatientPage,
  scanPatientPages,
} from "../../services/patientReliability";
import { patientService } from "../../services/patientService";
import type { ConsentDoctor } from "../../types/consent";
import type {
  PatientAppointment,
  PatientHealthRecord,
  PatientPrescription,
} from "../../types/patient";
import {
  BannerBotanicalAccent,
  ConsentBotanicalAccent,
  HeaderBotanicalAccent,
} from "./PatientBotanicalArt";
import { patientNavigation } from "./patientNavigation";
import "./PatientDashboard.css";

const MAX_RECENT_CARE_ITEMS = 3;

interface CareTimelineItem {
  id: string;
  kind: "record" | "prescription";
  title: string;
  subtitle: string;
  dateLabel: string;
  sortKey: string;
  to: string;
}

function formatReadableDate(isoValue: string): string {
  const datePart = isoValue.slice(0, 10);
  const parsed = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return datePart;
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatWeekday(isoValue: string): string {
  const datePart = isoValue.slice(0, 10);
  const parsed = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    timeZone: "UTC",
  }).format(parsed);
}

function formatHeaderToday(): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

function formatDoctorDisplayName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return "Approved clinician";
  }
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
}

function extractDoctorInitials(fullName?: string | null): string {
  if (!fullName) {
    return "AC";
  }
  const cleaned = fullName.replace(/^dr\.?\s+/i, "").trim();
  if (!cleaned) {
    return "AC";
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function isPlainSafeText(value: string | null | undefined): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && !trimmed.startsWith("enc:");
}

function fetchDashboard(signal: AbortSignal) {
  return Promise.allSettled([
    scanPatientPages(patientService.getMyAppointments, signal),
    readPatientPage(patientService.getMyHealthRecords, {
      limit: HISTORY_PAGE_SIZE,
      offset: 0,
      signal,
    }),
    readPatientPage(patientService.getMyPrescriptions, {
      limit: HISTORY_PAGE_SIZE,
      offset: 0,
      signal,
    }),
    consentService.getDoctors(),
    consentService.getPendingConsentRequests({ limit: 1, offset: 0 }),
  ]);
}

export default function PatientDashboard() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<PatientAppointment[]>([]);
  const [partialAppointments, setPartialAppointments] = useState(false);
  const [appointmentError, setAppointmentError] = useState<string | null>(null);

  const [records, setRecords] = useState<PatientHealthRecord[]>([]);
  const [recordTotal, setRecordTotal] = useState<number | null>(null);
  const [recordsError, setRecordsError] = useState<string | null>(null);

  const [prescriptions, setPrescriptions] = useState<PatientPrescription[]>([]);
  const [prescriptionTotal, setPrescriptionTotal] = useState<number | null>(null);
  const [prescriptionsError, setPrescriptionsError] = useState<string | null>(null);

  const [doctorsById, setDoctorsById] = useState<Record<string, ConsentDoctor>>({});
  const [pendingConsentCount, setPendingConsentCount] = useState<number | null>(null);

  const [scheduleTime, setScheduleTime] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const requestRevisionRef = useRef(0);
  const activeOwnerRef = useRef<string | null>(user?.id ?? null);

  useEffect(() => {
    activeOwnerRef.current = user?.id ?? null;
    requestRevisionRef.current += 1;
    const currentRevision = requestRevisionRef.current;
    const currentOwner = activeOwnerRef.current;

    const controller = new AbortController();

    if (reloadToken === 0) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    fetchDashboard(controller.signal).then(
      ([
        appointmentResult,
        recordResult,
        prescriptionResult,
        doctorResult,
        pendingConsentResult,
      ]) => {
        if (
          controller.signal.aborted ||
          requestRevisionRef.current !== currentRevision ||
          activeOwnerRef.current !== currentOwner
        ) {
          return;
        }

        if (appointmentResult.status === "fulfilled") {
          setAppointments(appointmentResult.value.items);
          setPartialAppointments(!appointmentResult.value.complete);
          setAppointmentError(null);
        } else {
          setAppointments([]);
          setPartialAppointments(false);
          setAppointmentError(
            patientReadError(appointmentResult.reason, "appointments"),
          );
        }

        if (recordResult.status === "fulfilled") {
          setRecords(recordResult.value.items);
          setRecordTotal(recordResult.value.total);
          setRecordsError(null);
        } else {
          setRecords([]);
          setRecordTotal(null);
          setRecordsError(
            patientReadError(recordResult.reason, "health records"),
          );
        }

        if (prescriptionResult.status === "fulfilled") {
          setPrescriptions(prescriptionResult.value.items);
          setPrescriptionTotal(prescriptionResult.value.total);
          setPrescriptionsError(null);
        } else {
          setPrescriptions([]);
          setPrescriptionTotal(null);
          setPrescriptionsError(
            patientReadError(prescriptionResult.reason, "prescriptions"),
          );
        }

        if (doctorResult.status === "fulfilled") {
          const doctorMap: Record<string, ConsentDoctor> = {};
          for (const doctor of doctorResult.value.items) {
            doctorMap[doctor.id] = doctor;
          }
          setDoctorsById(doctorMap);
        }

        if (pendingConsentResult.status === "fulfilled") {
          setPendingConsentCount(pendingConsentResult.value.total);
        } else {
          setPendingConsentCount(null);
        }

        setScheduleTime(Date.now());
        setLoading(false);
        setRefreshing(false);
      },
    );

    return () => {
      controller.abort();
    };
  }, [user?.id, reloadToken]);

  const todayLabel = useMemo(() => formatHeaderToday(), []);

  const upcomingAppointment = useMemo(
    () => partialAppointments ? null : nextBookedAppointment(appointments, scheduleTime),
    [appointments, partialAppointments, scheduleTime],
  );
  useEffect(() => {
    if (!upcomingAppointment) return;
    const start = appointmentInstant(
      upcomingAppointment.appointment_date,
      upcomingAppointment.start_time,
    );
    const updateSchedule = () => setScheduleTime(Date.now());
    const timer = window.setTimeout(updateSchedule, Math.max(0, Math.min(start - Date.now(), 2_147_483_647)));
    window.addEventListener("focus", updateSchedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", updateSchedule);
    };
  }, [upcomingAppointment, scheduleTime]);

  const upcomingDoctor = upcomingAppointment
    ? doctorsById[upcomingAppointment.doctor_profile_id]
    : undefined;

  const upcomingWeekday = upcomingAppointment
    ? formatWeekday(upcomingAppointment.appointment_date)
    : "";

  const recentCareItems = useMemo<CareTimelineItem[]>(() => {
    const items: CareTimelineItem[] = [];

    for (const record of records) {
      items.push({
        id: `record-${record.id}`,
        kind: "record",
        title: "Consultation record documented",
        subtitle: isPlainSafeText(record.follow_up_instructions)
          ? "Follow-up guidance available in records"
          : "Visit summary on file",
        dateLabel: formatReadableDate(record.visit_date),
        sortKey: record.visit_date,
        to: "/patient/records",
      });
    }

    for (const prescription of prescriptions) {
      const count = prescription.items.length;
      items.push({
        id: `rx-${prescription.id}`,
        kind: "prescription",
        title: "Prescription issued",
        subtitle:
          count === 1
            ? "1 prescribed medication on file"
            : count > 1
              ? `${count} prescribed medications on file`
              : "Prescription details on file",
        dateLabel: formatReadableDate(prescription.issued_at),
        sortKey: prescription.issued_at,
        to: "/patient/prescriptions",
      });
    }

    items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    return items.slice(0, MAX_RECENT_CARE_ITEMS);
  }, [records, prescriptions]);

  const activityErrors = useMemo(() => {
    const errors: string[] = [];
    if (recordsError) {
      errors.push(
        recordsError.toLowerCase().startsWith("health records")
          ? recordsError
          : `Health records: ${recordsError}`,
      );
    }
    if (prescriptionsError) {
      errors.push(
        prescriptionsError.toLowerCase().startsWith("prescriptions")
          ? prescriptionsError
          : `Prescriptions: ${prescriptionsError}`,
      );
    }
    return errors;
  }, [recordsError, prescriptionsError]);

  const showNoticeBanner = Boolean(
    appointmentError || partialAppointments || activityErrors.length > 0,
  );

  const noticeMessage = useMemo(() => {
    if (appointmentError && activityErrors.length === 2) {
      return "Your dashboard summary could not be loaded right now. Please retry to verify your schedule and records.";
    }
    if (appointmentError) {
      return `Unable to verify upcoming appointments (${appointmentError}).`;
    }
    if (partialAppointments) {
      return "Some appointment pages did not finish loading. The next visit could not be verified.";
    }
    if (activityErrors.length > 0) {
      return "Part of your recent care feed could not be loaded right now.";
    }
    return "";
  }, [appointmentError, partialAppointments, activityErrors.length]);

  const handleRetry = () => {
    if (refreshing) {
      return;
    }
    setReloadToken((prev) => prev + 1);
  };

  return (
    <PortalLayout
      roleLabel="Patient"
      userName={user?.full_name ?? "Patient"}
      userMeta={user?.email ?? "Care Summary"}
      navItems={patientNavigation}
    >
      <div className="patient-dashboard">
        <header className="patient-page-header">
          <HeaderBotanicalAccent />
          <div className="patient-page-heading">
            <h1 className="patient-page-title">Overview</h1>
            <p className="patient-page-subtitle">
              Your care, appointments and health information in one place.
            </p>
          </div>
          <div className="patient-header-date">
            <Calendar size={17} aria-hidden="true" />
            <span>{todayLabel}</span>
          </div>
        </header>

        {showNoticeBanner && (
          <div className="patient-notice-banner" role="alert">
            <div className="patient-notice-copy">
              <AlertCircle
                size={18}
                className="patient-notice-icon"
                aria-hidden="true"
              />
              <div>
                <p className="patient-notice-title">{noticeMessage}</p>
                {activityErrors.length > 0 && !appointmentError && (
                  <p className="patient-notice-detail">
                    {activityErrors.join(" ")}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              className="patient-btn-retry"
              onClick={handleRetry}
              disabled={refreshing || loading}
            >
              <RefreshCw
                size={16}
                className={refreshing ? "patient-spin" : undefined}
                aria-hidden="true"
              />
              <span>{refreshing ? "Refreshing..." : "Retry"}</span>
            </button>
          </div>
        )}

        <div className="patient-bento-grid">
          <section
            className="patient-appt-shell"
            aria-labelledby="next-appointment-heading"
          >
            <div className="patient-appt-banner">
              <BannerBotanicalAccent />
              <div className="patient-appt-banner-row">
                <div className="patient-appt-heading-group">
                  <Calendar
                    size={21}
                    className="patient-appt-header-icon"
                    aria-hidden="true"
                  />
                  <h2
                    id="next-appointment-heading"
                    className="patient-appt-heading"
                  >
                    Next appointment
                  </h2>
                </div>
                {upcomingAppointment && !loading && !appointmentError && (
                  <span className="patient-booked-pill">
                    <CheckCircle2 size={14} aria-hidden="true" />
                    <span>Booked</span>
                  </span>
                )}
                {partialAppointments && !appointmentError && (
                  <span className="patient-booked-pill patient-booked-pill--caution">
                    <span>Partial schedule</span>
                  </span>
                )}
              </div>
            </div>

            {loading && !upcomingAppointment && !appointmentError ? (
              <div className="patient-appt-body-wrap">
                <div className="patient-appt-surface" aria-busy="true">
                  <div className="patient-skeleton-block">
                    <div className="patient-skeleton patient-skeleton--title" />
                    <div className="patient-skeleton patient-skeleton--line" />
                    <div className="patient-skeleton patient-skeleton--short" />
                  </div>
                </div>
              </div>
            ) : appointmentError ? (
              <div className="patient-appt-body-wrap">
                <div className="patient-appt-surface patient-appt-surface--state">
                  <div className="patient-state-panel patient-state-panel--error">
                    <h3 className="patient-state-title">
                      Schedule temporarily unavailable
                    </h3>
                    <p className="patient-state-description">
                      We could not confirm your upcoming visits right now. Use
                      Retry above to refresh your schedule, or open Appointments
                      directly.
                    </p>
                  </div>
                </div>
                <div className="patient-appt-footer patient-appt-footer--end">
                  <Link to="/patient/appointments" className="patient-appt-cta">
                    <span>View appointments</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            ) : upcomingAppointment ? (
              <div className="patient-appt-body-wrap">
                <div className="patient-appt-surface">
                  <div className="patient-appt-main-grid">
                    <div className="patient-doctor-block">
                      <div className="patient-doctor-avatar" aria-hidden="true">
                        <span className="patient-doctor-initials">
                          {extractDoctorInitials(upcomingDoctor?.full_name)}
                        </span>
                        <span className="patient-doctor-emblem">
                          <Stethoscope size={13} />
                        </span>
                      </div>

                      <div className="patient-doctor-meta">
                        <p className="patient-appointment-clinician">
                          {upcomingDoctor
                            ? formatDoctorDisplayName(upcomingDoctor.full_name)
                            : "Scheduled clinical consultation"}
                        </p>
                        <p className="patient-appointment-specialty">
                          {upcomingDoctor?.specialization
                            ? upcomingDoctor.specialization
                            : "Outpatient appointment"}
                        </p>
                        {upcomingDoctor?.clinic_name && (
                          <p className="patient-appointment-clinic">
                            <MapPin
                              size={15}
                              className="patient-clinic-pin"
                              aria-hidden="true"
                            />
                            <span>{upcomingDoctor.clinic_name}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div
                      className="patient-appt-divider"
                      aria-hidden="true"
                    />

                    <dl className="patient-appt-schedule">
                      <div className="patient-schedule-cell">
                        <dt className="patient-schedule-icon">
                          <Calendar size={19} aria-label="Appointment date" />
                        </dt>
                        <dd className="patient-schedule-primary">
                          {formatReadableDate(
                            upcomingAppointment.appointment_date,
                          )}
                        </dd>
                        {upcomingWeekday && (
                          <dd className="patient-schedule-sub">
                            ({upcomingWeekday})
                          </dd>
                        )}
                      </div>

                      <div className="patient-schedule-cell">
                        <dt className="patient-schedule-icon">
                          <Clock size={19} aria-label="Appointment time IST" />
                        </dt>
                        <dd className="patient-schedule-primary">
                          {formatAppointmentTime(
                            upcomingAppointment.start_time,
                          )}
                          {upcomingAppointment.end_time
                            ? ` – ${formatAppointmentTime(upcomingAppointment.end_time)}`
                            : ""}
                        </dd>
                        <dd className="patient-schedule-sub">IST</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="patient-appt-footer">
                  {isPlainSafeText(upcomingAppointment.reason) ? (
                    <p className="patient-appointment-reason">
                      <span className="patient-reason-label">Visit focus:</span>{" "}
                      <span>{upcomingAppointment.reason}</span>
                    </p>
                  ) : (
                    <span className="patient-reason-placeholder">
                      Outpatient consultation scheduled
                    </span>
                  )}
                  <Link to="/patient/appointments" className="patient-appt-cta">
                    <span>View appointments</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="patient-appt-body-wrap">
                <div className="patient-appt-surface patient-appt-surface--state">
                  <div className="patient-state-panel">
                    <h3 className="patient-state-title">
                      {partialAppointments
                        ? "Next appointment could not be verified"
                        : "No upcoming appointments scheduled"}
                    </h3>
                    <p className="patient-state-description">
                      {partialAppointments
                        ? "Part of your schedule could not be verified. Retry loading or open Appointments to check your complete booking list."
                        : "When you book an outpatient visit, your clinician details, appointment time, and clinic location will appear here."}
                    </p>
                  </div>
                </div>
                <div className="patient-appt-footer">
                  <Link
                    to="/patient/appointments"
                    className="patient-btn-secondary"
                  >
                    <span>View appointments</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                  <Link to="/patient/doctors" className="patient-appt-cta">
                    <CalendarPlus size={16} aria-hidden="true" />
                    <span>Find a doctor</span>
                  </Link>
                </div>
              </div>
            )}
          </section>

          <section
            className="patient-card patient-actions-card"
            aria-labelledby="quick-actions-heading"
          >
            <div className="patient-card-header">
              <h2 id="quick-actions-heading" className="patient-card-title">
                Quick actions
              </h2>
            </div>
            <ul className="patient-actions-list">
              <li>
                <Link to="/patient/doctors" className="patient-action-item">
                  <span className="patient-action-tile" aria-hidden="true">
                    <Stethoscope size={20} />
                  </span>
                  <span className="patient-action-copy">
                    <span className="patient-action-title">Find a doctor</span>
                    <span className="patient-action-desc">
                      Browse clinicians and book a visit
                    </span>
                  </span>
                  <ArrowRight
                    size={17}
                    className="patient-row-arrow"
                    aria-hidden="true"
                  />
                </Link>
              </li>
              <li>
                <Link
                  to="/patient/appointments"
                  className="patient-action-item"
                >
                  <span className="patient-action-tile" aria-hidden="true">
                    <Calendar size={20} />
                  </span>
                  <span className="patient-action-copy">
                    <span className="patient-action-title">My appointments</span>
                    <span className="patient-action-desc">
                      View and manage your visits
                    </span>
                  </span>
                  <ArrowRight
                    size={17}
                    className="patient-row-arrow"
                    aria-hidden="true"
                  />
                </Link>
              </li>
              <li>
                <Link to="/patient/records" className="patient-action-item">
                  <span className="patient-action-tile" aria-hidden="true">
                    <FolderOpen size={20} />
                  </span>
                  <span className="patient-action-copy">
                    <span className="patient-action-title">Health records</span>
                    <span className="patient-action-desc">
                      Access your consultation records
                    </span>
                  </span>
                  <ArrowRight
                    size={17}
                    className="patient-row-arrow"
                    aria-hidden="true"
                  />
                </Link>
              </li>
              <li>
                <Link
                  to="/patient/skin-health"
                  className="patient-action-item"
                >
                  <span className="patient-action-tile" aria-hidden="true">
                    <Scan size={20} />
                  </span>
                  <span className="patient-action-copy">
                    <span className="patient-action-title">Skin screening</span>
                    <span className="patient-action-desc">
                      Submit a skin image for review
                    </span>
                  </span>
                  <ArrowRight
                    size={17}
                    className="patient-row-arrow"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            </ul>
          </section>

          <section
            className="patient-card patient-care-card"
            aria-labelledby="recent-care-heading"
          >
            <div className="patient-card-header patient-card-header--care">
              <div className="patient-care-title-wrap">
                <Clock
                  size={18}
                  className="patient-card-icon"
                  aria-hidden="true"
                />
                <div>
                  <h2 id="recent-care-heading" className="patient-card-title">
                    Recent care
                  </h2>
                  <p className="patient-card-subtitle">
                    Your latest visits and prescriptions
                  </p>
                </div>
              </div>
              <div
                className="patient-care-counts"
                aria-label="Care summary counts"
              >
                <span className="patient-count-chip">
                  Records:{" "}
                  <strong>
                    {recordsError
                      ? "Unavailable"
                      : recordTotal !== null
                        ? recordTotal
                        : "—"}
                  </strong>
                </span>
                <span className="patient-count-chip">
                  Prescriptions:{" "}
                  <strong>
                    {prescriptionsError
                      ? "Unavailable"
                      : prescriptionTotal !== null
                        ? prescriptionTotal
                        : "—"}
                  </strong>
                </span>
              </div>
            </div>

            {loading && recentCareItems.length === 0 ? (
              <div className="patient-skeleton-block" aria-busy="true">
                <div className="patient-skeleton patient-skeleton--line" />
                <div className="patient-skeleton patient-skeleton--line" />
              </div>
            ) : recentCareItems.length > 0 ? (
              <ul className="patient-timeline-list">
                {recentCareItems.map((item) => (
                  <li key={item.id} className="patient-timeline-item">
                    <span className="patient-timeline-rail" aria-hidden="true">
                      <span className="patient-timeline-dot" />
                    </span>
                    <Link to={item.to} className="patient-timeline-link">
                      <span
                        className={`patient-care-badge patient-care-badge--${item.kind}`}
                        aria-hidden="true"
                      >
                        {item.kind === "record" ? (
                          <FileText size={16} />
                        ) : (
                          <Pill size={16} />
                        )}
                      </span>
                      <span className="patient-care-copy">
                        <span className="patient-care-title">{item.title}</span>
                        <span className="patient-care-meta">
                          {item.dateLabel}
                          <span aria-hidden="true"> · </span>
                          {item.subtitle}
                        </span>
                      </span>
                      <ArrowRight
                        size={16}
                        className="patient-row-arrow"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="patient-state-panel patient-state-panel--compact">
                <h3 className="patient-state-title">
                  {activityErrors.length > 0
                    ? "Recent care history temporarily unavailable"
                    : "No consultation records on file yet"}
                </h3>
                <p className="patient-state-description">
                  {activityErrors.length > 0
                    ? "Retry loading or open your records and prescriptions pages directly."
                    : "Completed visit summaries and issued prescriptions will appear here without exposing clinical notes on the overview."}
                </p>
              </div>
            )}

            <div className="patient-care-footer">
              <Link to="/patient/records" className="patient-care-footer-link">
                <span>All health records</span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <Link
                to="/patient/prescriptions"
                className="patient-care-footer-link"
              >
                <span>All prescriptions</span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </section>

          <section
            className="patient-card patient-consent-card"
            aria-labelledby="consent-privacy-heading"
          >
            <ConsentBotanicalAccent />
            <div className="patient-consent-inner">
              <div className="patient-card-header">
                <div className="patient-card-title-group">
                  {pendingConsentCount !== null && pendingConsentCount > 0 ? (
                    <ShieldAlert
                      size={18}
                      className="patient-consent-icon patient-consent-icon--pending"
                      aria-hidden="true"
                    />
                  ) : (
                    <ShieldCheck
                      size={18}
                      className="patient-consent-icon"
                      aria-hidden="true"
                    />
                  )}
                  <h2
                    id="consent-privacy-heading"
                    className="patient-card-title"
                  >
                    Consent &amp; privacy
                  </h2>
                </div>
                {pendingConsentCount !== null && (
                  <span
                    className={`patient-status-badge ${
                      pendingConsentCount > 0
                        ? "patient-status-badge--caution"
                        : "patient-status-badge--neutral"
                    }`}
                  >
                    {pendingConsentCount > 0
                      ? `${pendingConsentCount} pending`
                      : "No pending requests"}
                  </span>
                )}
              </div>

              <p className="patient-consent-copy">
                {pendingConsentCount !== null && pendingConsentCount > 0
                  ? `You have ${pendingConsentCount} clinician access ${
                      pendingConsentCount === 1 ? "request" : "requests"
                    } awaiting review. Choose which record scopes and dates to share.`
                  : "Clinicians can only read the health record scopes and access windows you explicitly approve."}
              </p>

              <div className="patient-card-footer">
                <Link to="/patient/consent" className="patient-consent-btn">
                  <span>
                    {pendingConsentCount !== null && pendingConsentCount > 0
                      ? "Review consent requests"
                      : "Manage privacy controls"}
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </PortalLayout>
  );
}

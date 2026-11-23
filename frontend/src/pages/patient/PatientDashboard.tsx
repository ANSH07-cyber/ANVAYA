
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthContext";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  FolderHeart,
  HeartPulse,
  Pill,
  ScanFace,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import PortalLayout from "../../layouts/PortalLayout";
import { patientService } from "../../services/patientService";
import type {
  PatientAppointment,
  PatientHealthRecord,
  PatientPrescription,
} from "../../types/patient";
import { patientNavigation } from "./patientNavigation";
import "./PatientDashboard.css";

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFormattedDate() {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
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

function getAppointmentDateTime(appointment: PatientAppointment) {
  return new Date(
    `${appointment.appointment_date}T${appointment.start_time}`,
  );
}

function getUpcomingAppointment(appointments: PatientAppointment[]) {
  const now = new Date();

  return appointments
    .filter((appointment) => {
      return (
        appointment.status === "booked" &&
        getAppointmentDateTime(appointment) >= now
      );
    })
    .sort(
      (a, b) =>
        getAppointmentDateTime(a).getTime() -
        getAppointmentDateTime(b).getTime(),
    )[0] ?? null;
}

type DashboardActivity = {
  id: string;
  title: string;
  description: string;
  date: string;
  timestamp: number;
  icon: typeof FileText;
  tone: string;
};

export default function PatientDashboard() {
  const { user } = useAuth();

  const displayName = user?.full_name?.trim() || "Patient";
  const firstName = displayName.split(/\s+/)[0] || "Patient";

  const [appointments, setAppointments] = useState<PatientAppointment[]>([]);
  const [healthRecords, setHealthRecords] = useState<PatientHealthRecord[]>([]);
  const [prescriptions, setPrescriptions] = useState<PatientPrescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      setLoading(true);
      setLoadError(false);

      const results = await Promise.allSettled([
        patientService.getMyAppointments(),
        patientService.getMyHealthRecords(),
        patientService.getMyPrescriptions(),
      ]);

      if (!isMounted) return;

      let hasError = false;

      if (results[0].status === "fulfilled") {
        setAppointments(results[0].value.items);
      } else {
        hasError = true;
      }

      if (results[1].status === "fulfilled") {
        setHealthRecords(results[1].value.items);
      } else {
        hasError = true;
      }

      if (results[2].status === "fulfilled") {
        setPrescriptions(results[2].value.items);
      } else {
        hasError = true;
      }

      setLoadError(hasError);
      setLoading(false);
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  const upcomingAppointment = useMemo(
    () => getUpcomingAppointment(appointments),
    [appointments],
  );

  const activities = useMemo<DashboardActivity[]>(() => {
    const recordActivities: DashboardActivity[] = healthRecords.map(
      (record) => ({
        id: `record-${record.id}`,
        title: "Consultation record added",
        description:
          record.diagnosis ||
          record.chief_complaint ||
          "A consultation record is available in your health history.",
        date: formatDate(record.visit_date),
        timestamp: new Date(record.visit_date).getTime(),
        icon: FileText,
        tone: "teal",
      }),
    );

    const prescriptionActivities: DashboardActivity[] = prescriptions.map(
      (prescription) => ({
        id: `prescription-${prescription.id}`,
        title: "Prescription issued",
        description:
          prescription.items.length > 0
            ? `${prescription.items.length} medicine item(s) prescribed.`
            : "A prescription is available in your records.",
        date: formatDate(prescription.issued_at),
        timestamp: new Date(prescription.issued_at).getTime(),
        icon: Pill,
        tone: "blue",
      }),
    );

    return [...recordActivities, ...prescriptionActivities]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 4);
  }, [healthRecords, prescriptions]);

  const stats = [
    {
      label: "Appointments",
      value: appointments.length,
      detail: `${appointments.filter((item) => item.status === "booked").length} booked`,
      icon: CalendarDays,
      tone: "teal",
    },
    {
      label: "Prescriptions",
      value: prescriptions.length,
      detail: "Issued prescriptions",
      icon: Pill,
      tone: "blue",
    },
    {
      label: "Health records",
      value: healthRecords.length,
      detail: "Available care history",
      icon: FileText,
      tone: "violet",
    },
  ];

  return (
    <PortalLayout
      roleLabel="Patient"
      userName={displayName}
      userMeta="Patient account"
      navItems={patientNavigation}
    >
      <div className="patient-dashboard">
        <div className="patient-page-heading">
          <div>
            <span className="patient-eyebrow">
              {getFormattedDate().toUpperCase()}
            </span>
            <h1>
              {getGreeting()}, {firstName} <span>👋</span>
            </h1>
            <p>
              Your health journey, thoughtfully organized in one place.
            </p>
          </div>

          <Link className="patient-primary-action" to="/patient/doctors">
            <Search size={17} />
            Find a doctor
          </Link>
        </div>

        {loadError && (
          <div className="preview-notice" role="alert">
            <div className="preview-notice-icon">
              <ShieldCheck size={19} />
            </div>
            <div>
              <strong>Some dashboard information could not be loaded</strong>
              <p>
                Please refresh the page or try again later. Information that
                failed to load is not displayed as zero.
              </p>
            </div>
          </div>
        )}

        <section className="patient-stats-grid" aria-label="Health overview">
          {stats.map((stat) => {
            const Icon = stat.icon;

            return (
              <article className="patient-stat-card" key={stat.label}>
                <div className={`patient-stat-icon ${stat.tone}`}>
                  <Icon size={21} strokeWidth={1.9} />
                </div>
                <div className="patient-stat-copy">
                  <span>{stat.label}</span>
                  <strong>
                    {loading ? "—" : loadError ? "—" : stat.value}
                  </strong>
                  <small>
                    {loading
                      ? "Loading..."
                      : loadError
                        ? "Unable to load"
                        : stat.detail}
                  </small>
                </div>
                <span className="stat-decoration" aria-hidden="true" />
              </article>
            );
          })}
        </section>

        <section className="patient-main-grid">
          <div className="patient-section-column">
            <div className="patient-section-heading">
              <div>
                <span className="patient-section-kicker">YOUR SCHEDULE</span>
                <h2>Upcoming appointment</h2>
              </div>
              <Link to="/patient/appointments" className="patient-text-link">
                View all <ArrowRight size={15} />
              </Link>
            </div>

            <article className="upcoming-appointment-card">
              <div className="appointment-card-top">
                <div className="appointment-type">
                  <span className="appointment-type-icon">
                    <Stethoscope size={17} />
                  </span>
                  <span>CONSULTATION</span>
                </div>
                {upcomingAppointment && (
                  <span className="appointment-demo-label">
                    {upcomingAppointment.status.toUpperCase()}
                  </span>
                )}
              </div>

              {loading ? (
                <div className="appointment-doctor">
                  <div className="appointment-doctor-info">
                    <h3>Loading appointment...</h3>
                    <p>Please wait while we retrieve your schedule.</p>
                  </div>
                </div>
              ) : loadError ? (
                <div className="appointment-doctor">
                  <div className="appointment-doctor-info">
                    <h3>Appointment information unavailable</h3>
                    <p>Please try refreshing the page.</p>
                  </div>
                </div>
              ) : upcomingAppointment ? (
                <>
                  <div className="appointment-doctor">
                    <div className="doctor-avatar-placeholder">
                      <Stethoscope size={22} />
                    </div>
                    <div className="appointment-doctor-info">
                      <h3>Doctor consultation</h3>
                      <p>Your scheduled appointment</p>
                    </div>
                  </div>

                  <div className="appointment-divider" />

                  <div className="appointment-details">
                    <div>
                      <CalendarDays size={17} />
                      <span>
                        <small>DATE</small>
                        <strong>
                          {formatDate(upcomingAppointment.appointment_date)}
                        </strong>
                      </span>
                    </div>
                    <div>
                      <Clock3 size={17} />
                      <span>
                        <small>TIME</small>
                        <strong>
                          {formatTime(upcomingAppointment.start_time)} –{" "}
                          {formatTime(upcomingAppointment.end_time)}
                        </strong>
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="appointment-doctor">
                  <div className="doctor-avatar-placeholder">
                    <CalendarDays size={22} />
                  </div>
                  <div className="appointment-doctor-info">
                    <h3>No upcoming appointments</h3>
                    <p>Your next scheduled consultation will appear here.</p>
                  </div>
                </div>
              )}

              <Link
                to="/patient/appointments"
                className="appointment-details-link"
              >
                View appointments <ArrowRight size={16} />
              </Link>
            </article>

            <div className="patient-section-heading shortcuts-heading">
              <div>
                <span className="patient-section-kicker">QUICK ACCESS</span>
                <h2>Your care, your way</h2>
              </div>
            </div>

            <div className="patient-shortcuts-grid">
              <Link to="/patient/doctors" className="patient-shortcut-card">
                <div className="shortcut-icon teal">
                  <Search size={20} />
                </div>
                <strong>Find a doctor</strong>
                <span>Explore specialists and care options</span>
                <ArrowRight size={17} className="shortcut-arrow" />
              </Link>

              <Link to="/patient/records" className="patient-shortcut-card">
                <div className="shortcut-icon blue">
                  <FolderHeart size={20} />
                </div>
                <strong>Medical records</strong>
                <span>Keep your health history organized</span>
                <ArrowRight size={17} className="shortcut-arrow" />
              </Link>

              <Link to="/patient/skin-health" className="patient-shortcut-card">
                <div className="shortcut-icon violet">
                  <ScanFace size={20} />
                </div>
                <strong>Skin health AI</strong>
                <span>Explore the skin assessment feature</span>
                <ArrowRight size={17} className="shortcut-arrow" />
              </Link>

              <Link to="/patient/consent" className="patient-shortcut-card">
                <div className="shortcut-icon green">
                  <ShieldCheck size={20} />
                </div>
                <strong>Privacy controls</strong>
                <span>Manage doctor access permissions</span>
                <ArrowRight size={17} className="shortcut-arrow" />
              </Link>
            </div>
          </div>

          <aside className="patient-section-column patient-side-column">
            <div className="patient-section-heading">
              <div>
                <span className="patient-section-kicker">HEALTH JOURNAL</span>
                <h2>Recent activity</h2>
              </div>
              <Activity size={19} className="activity-heading-icon" />
            </div>

            <article className="recent-activity-card">
              <div className="activity-timeline">
                {loading ? (
                  <div className="activity-item">
                    <div className="activity-copy">
                      <strong>Loading recent activity...</strong>
                      <p>Retrieving your health history.</p>
                    </div>
                  </div>
                ) : loadError ? (
                  <div className="activity-item">
                    <div className="activity-copy">
                      <strong>Activity unavailable</strong>
                      <p>Some information could not be retrieved.</p>
                    </div>
                  </div>
                ) : activities.length > 0 ? (
                  activities.map((activity, index) => {
                    const Icon = activity.icon;

                    return (
                      <div className="activity-item" key={activity.id}>
                        <div className={`activity-icon ${activity.tone}`}>
                          <Icon size={17} />
                        </div>
                        <div className="activity-copy">
                          <strong>{activity.title}</strong>
                          <p>{activity.description}</p>
                          <small>{activity.date}</small>
                        </div>
                        {index !== activities.length - 1 && (
                          <span className="activity-connector" />
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="activity-item">
                    <div className="activity-copy">
                      <strong>No recent activity yet</strong>
                      <p>
                        Your consultation records and prescriptions will appear
                        here when available.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <Link to="/patient/records" className="activity-history-link">
                Explore health history <ArrowRight size={15} />
              </Link>
            </article>

            <article className="patient-wellness-card">
              <div className="wellness-decoration">
                <HeartPulse size={22} />
                <Sparkles size={17} />
              </div>
              <span className="patient-section-kicker">
                A GENTLER APPROACH TO CARE
              </span>
              <h3>Your health is more than a number.</h3>
              <p>
                Anvaya brings your appointments, records and care journey
                together, so important information is easier to find.
              </p>
              <Link to="/patient/consent">
                Explore privacy controls <ArrowRight size={15} />
              </Link>
            </article>

            <div className="patient-trust-note">
              <ShieldCheck size={17} />
              <p>
                Your medical information should remain private and accessible
                only through authorized access.
              </p>
            </div>
          </aside>
        </section>

        <div className="patient-dashboard-bottom">
          <div>
            <CheckCircle2 size={16} />
            <span>Designed around your care journey</span>
          </div>
          <span>ANVAYA · PATIENT EXPERIENCE</span>
        </div>
      </div>
    </PortalLayout>
  );
}

import { Link, useParams } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Clock,
  FolderHeart,
  LayoutDashboard,
  Lock,
  Pill,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import DoctorLayout from "../../layouts/DoctorLayout";
import "./DoctorPlaceholder.css";

export type DoctorModuleKey =
  | "overview"
  | "appointments"
  | "availability"
  | "patients"
  | "prescriptions"
  | "profile"
  | "consultation";

interface DoctorPlaceholderProps {
  module: DoctorModuleKey;
  title: string;
  kicker: string;
  description: string;
  phase: string;
}

export default function DoctorPlaceholder({
  module,
  title,
  kicker,
  description,
  phase,
}: DoctorPlaceholderProps) {
  const { user } = useAuth();
  const { appointmentId } = useParams<{ appointmentId?: string }>();

  const displayName = user?.full_name
    ? user.full_name.trim().toLowerCase().startsWith("dr.") ||
      user.full_name.trim().toLowerCase().startsWith("dr ")
      ? user.full_name.trim()
      : `Dr. ${user.full_name.trim()}`
    : "Doctor";

  return (
    <DoctorLayout title={title}>
      <div className="doctor-workspace">
        {/* Module Header Banner */}
        <section className="doc-header-banner">
          <div className="doc-header-left">
            <div className="doc-kicker-badge">
              <Stethoscope size={13} />
              <span>{kicker}</span>
            </div>
            <h1 className="doc-header-title">{title}</h1>
            <p className="doc-header-desc">{description}</p>
          </div>

          <div className="doc-header-right">
            <div className="doc-doctor-chip">
              <Stethoscope size={14} color="#0c8b82" />
              <span>{displayName}</span>
            </div>
            <div className="doc-phase-pill">
              <Clock size={12} color="#0c8b82" />
              <span>Activation: {phase}</span>
            </div>
          </div>
        </section>

        {/* 68:32 Clinical Workspace Grid */}
        <div className="doc-workspace-grid">
          {/* Main Clinical Canvas (Left ~68%) */}
          <main className="doc-primary-canvas">
            {/* OVERVIEW MODULE */}
            {module === "overview" && (
              <>
                <section className="doc-card">
                  <header className="doc-card-header">
                    <div className="doc-card-title-group">
                      <div className="doc-card-icon">
                        <LayoutDashboard size={18} />
                      </div>
                      <h2 className="doc-card-title">Practice Suite Navigation</h2>
                    </div>
                    <span className="doc-card-badge">Clinical Modules</span>
                  </header>

                  <div className="doc-card-body">
                    <div className="doc-launch-grid">
                      <Link to="/doctor/appointments" className="doc-launch-card">
                        <div className="doc-launch-top">
                          <div className="doc-launch-icon-box">
                            <CalendarDays size={20} />
                          </div>
                          <ArrowRight size={16} className="doc-launch-arrow" />
                        </div>
                        <h3 className="doc-launch-title">Consultation Queue</h3>
                        <p className="doc-launch-desc">
                          Manage patient consultation bookings, review appointment details,
                          and conduct clinical visits.
                        </p>
                      </Link>

                      <Link to="/doctor/availability" className="doc-launch-card">
                        <div className="doc-launch-top">
                          <div className="doc-launch-icon-box">
                            <Clock size={20} />
                          </div>
                          <ArrowRight size={16} className="doc-launch-arrow" />
                        </div>
                        <h3 className="doc-launch-title">Availability Schedule</h3>
                        <p className="doc-launch-desc">
                          Configure weekly clinical shifts, consultation slot duration, and
                          patient booking windows.
                        </p>
                      </Link>

                      <Link to="/doctor/patients" className="doc-launch-card">
                        <div className="doc-launch-top">
                          <div className="doc-launch-icon-box">
                            <FolderHeart size={20} />
                          </div>
                          <ArrowRight size={16} className="doc-launch-arrow" />
                        </div>
                        <h3 className="doc-launch-title">Patient Health Records</h3>
                        <p className="doc-launch-desc">
                          Access medical histories, allergies, and clinical records under
                          authorized patient consent.
                        </p>
                      </Link>

                      <Link to="/doctor/prescriptions" className="doc-launch-card">
                        <div className="doc-launch-top">
                          <div className="doc-launch-icon-box">
                            <Pill size={20} />
                          </div>
                          <ArrowRight size={16} className="doc-launch-arrow" />
                        </div>
                        <h3 className="doc-launch-title">Prescription Studio</h3>
                        <p className="doc-launch-desc">
                          Compose verified digital prescriptions, medication orders, and
                          treatment instructions.
                        </p>
                      </Link>
                    </div>
                  </div>
                </section>

                <section className="doc-card">
                  <header className="doc-card-header">
                    <div className="doc-card-title-group">
                      <div className="doc-card-icon">
                        <Activity size={18} />
                      </div>
                      <h2 className="doc-card-title">Doctor Portal Roadmap & Scopes</h2>
                    </div>
                    <span className="doc-card-badge">Implementation Scopes</span>
                  </header>

                  <div className="doc-card-body">
                    <div className="doc-readiness-list">
                      <div className="doc-readiness-row">
                        <div className="doc-readiness-left">
                          <span className="doc-phase-tag">Phase 1</span>
                          <span>Doctor Portal Layout, Navigation & Design System</span>
                        </div>
                        <span className="doc-readiness-chip active">Completed Shell</span>
                      </div>

                      <div className="doc-readiness-row">
                        <div className="doc-readiness-left">
                          <span className="doc-phase-tag">Phase 2</span>
                          <span>Doctor Overview Dashboard & Availability Management</span>
                        </div>
                        <span className="doc-readiness-chip pending">Next Phase</span>
                      </div>

                      <div className="doc-readiness-row">
                        <div className="doc-readiness-left">
                          <span className="doc-phase-tag">Phase 3</span>
                          <span>Consultation Queue & Appointment Lifecycle</span>
                        </div>
                        <span className="doc-readiness-chip pending">Scheduled</span>
                      </div>

                      <div className="doc-readiness-row">
                        <div className="doc-readiness-left">
                          <span className="doc-phase-tag">Phase 4</span>
                          <span>Consultation Room, Consent-Gated EHR & Prescription Studio</span>
                        </div>
                        <span className="doc-readiness-chip pending">Scheduled</span>
                      </div>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* APPOINTMENTS MODULE */}
            {module === "appointments" && (
              <section className="doc-card">
                <header className="doc-card-header">
                  <div className="doc-card-title-group">
                    <div className="doc-card-icon">
                      <CalendarDays size={18} />
                    </div>
                    <h2 className="doc-card-title">Consultation Queue</h2>
                  </div>
                  <span className="doc-card-badge">Daily Schedule</span>
                </header>

                <div className="doc-card-body">
                  <div className="doc-queue-tabs" aria-label="Queue filter previews">
                    <span className="doc-queue-tab active">
                      All Consultations
                    </span>
                    <span className="doc-queue-tab disabled" title="Filtered queue views will be activated in Phase 3">
                      Upcoming (Phase 3)
                    </span>
                    <span className="doc-queue-tab disabled" title="Filtered queue views will be activated in Phase 3">
                      Completed (Phase 3)
                    </span>
                    <span className="doc-queue-tab disabled" title="Filtered queue views will be activated in Phase 3">
                      Cancelled (Phase 3)
                    </span>
                  </div>

                  <div className="doc-queue-empty">
                    <div className="doc-queue-empty-icon">
                      <CalendarDays size={26} />
                    </div>
                    <h3 className="doc-queue-empty-title">No Consultations Scheduled</h3>
                    <p className="doc-queue-empty-text">
                      You do not have any patient appointments currently scheduled. When patients book
                      consultations through the Anvaya portal, they will appear in your queue in real time.
                    </p>
                    <Link to="/doctor/availability" className="doc-queue-empty-btn">
                      <Clock size={14} />
                      <span>Configure Consulting Hours</span>
                    </Link>
                  </div>
                </div>

                <footer className="doc-card-footer">
                  <span>Standard 30-minute consultation window enforced.</span>
                  <span>Queue updates automatically on patient booking.</span>
                </footer>
              </section>
            )}

            {/* AVAILABILITY MODULE */}
            {module === "availability" && (
              <section className="doc-card">
                <header className="doc-card-header">
                  <div className="doc-card-title-group">
                    <div className="doc-card-icon">
                      <Clock size={18} />
                    </div>
                    <h2 className="doc-card-title">Weekly Consulting Shifts</h2>
                  </div>
                  <span className="doc-card-badge">Illustrative Schedule Preview</span>
                </header>

                <div className="doc-card-body">
                  <div className="doc-preview-banner">
                    <Clock size={16} color="#0c8b82" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div className="doc-preview-banner-text">
                      <strong>Illustrative Schedule Preview</strong>
                      <span>
                        The shift template below illustrates the upcoming weekly scheduling structure. Actual doctor availability slots will be connected to live backend records in Phase 2.
                      </span>
                    </div>
                  </div>

                  <div className="doc-schedule-grid">
                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => (
                      <div key={day} className="doc-schedule-row">
                        <span className="doc-schedule-day">{day}</span>
                        <div className="doc-schedule-slots">
                          <span className="doc-slot-chip">09:00 - 13:00 (Morning)</span>
                          <span className="doc-slot-chip">16:00 - 20:00 (Evening)</span>
                        </div>
                        <span className="doc-schedule-status doc-schedule-preview-tag">
                          Preview Template
                        </span>
                      </div>
                    ))}
                    {["Saturday", "Sunday"].map((day) => (
                      <div key={day} className="doc-schedule-row">
                        <span className="doc-schedule-day">{day}</span>
                        <div className="doc-schedule-slots">
                          <span className="doc-slot-chip">By Appointment / Emergency On-Call</span>
                        </div>
                        <span className="doc-schedule-status doc-schedule-preview-tag">
                          Weekend Block
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <footer className="doc-card-footer">
                  <span>Standard Slot Interval: 30 minutes</span>
                  <span>Live availability integration scheduled for Phase 2</span>
                </footer>
              </section>
            )}

            {/* PATIENTS MODULE (CONSENT GATED) */}
            {module === "patients" && (
              <section className="doc-card">
                <header className="doc-card-header">
                  <div className="doc-card-title-group">
                    <div className="doc-card-icon">
                      <FolderHeart size={18} />
                    </div>
                    <h2 className="doc-card-title">Patient Health Records (EHR)</h2>
                  </div>
                  <span className="doc-card-badge">Consent Gated</span>
                </header>

                <div className="doc-card-body">
                  <div className="doc-consent-card">
                    <div className="doc-consent-banner">
                      <Lock size={20} color="#0c8b82" style={{ flexShrink: 0, marginTop: 2 }} />
                      <div className="doc-consent-banner-text">
                        <strong>Consent-Gated Clinical Access</strong>
                        <span>
                          In strict accordance with medical privacy standards, ANVAYA does not expose an
                          unrestricted patient directory. Patient medical records, past clinical notes, and
                          diagnostic histories are accessible exclusively when linked to an active patient
                          consultation or an authorized consent grant.
                        </span>
                      </div>
                    </div>

                    <div className="doc-scope-list">
                      <div className="doc-scope-box">
                        <span className="doc-scope-label">Clinical Notes</span>
                        <span className="doc-scope-detail">
                          Physician examination notes and diagnosis records recorded during consultations.
                        </span>
                      </div>
                      <div className="doc-scope-box">
                        <span className="doc-scope-label">Digital Prescriptions</span>
                        <span className="doc-scope-detail">
                          Prescribed medications, dosage instructions, and dispensing history.
                        </span>
                      </div>
                      <div className="doc-scope-box">
                        <span className="doc-scope-label">Diagnostic Files</span>
                        <span className="doc-scope-detail">
                          Patient lab reports and diagnostic uploads shared for clinical evaluation.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <footer className="doc-card-footer">
                  <span>All record accesses are cryptographically logged for patient audit.</span>
                  <Link to="/doctor/appointments" className="doc-queue-empty-btn" style={{ padding: "6px 12px" }}>
                    <span>View Scheduled Patients</span>
                  </Link>
                </footer>
              </section>
            )}

            {/* PRESCRIPTIONS MODULE */}
            {module === "prescriptions" && (
              <section className="doc-card">
                <header className="doc-card-header">
                  <div className="doc-card-title-group">
                    <div className="doc-card-icon">
                      <Pill size={18} />
                    </div>
                    <h2 className="doc-card-title">Digital Prescription Studio</h2>
                  </div>
                  <span className="doc-card-badge">Clinical Rx</span>
                </header>

                <div className="doc-card-body">
                  <div className="doc-rx-preview">
                    <div className="doc-rx-header-row">
                      <span className="doc-rx-badge">℞ CLINICAL PRESCRIPTION</span>
                      <span style={{ fontSize: 12, color: "#637e78" }}>
                        Practitioner: <strong>{displayName}</strong>
                      </span>
                    </div>

                    <div className="doc-rx-schema-grid">
                      <div className="doc-rx-schema-cell">
                        <span className="doc-rx-cell-title">Medication</span>
                        <span className="doc-rx-cell-val">Drug Name / Generic</span>
                      </div>
                      <div className="doc-rx-schema-cell">
                        <span className="doc-rx-cell-title">Dosage</span>
                        <span className="doc-rx-cell-val">Strength (e.g. 500mg)</span>
                      </div>
                      <div className="doc-rx-schema-cell">
                        <span className="doc-rx-cell-title">Frequency</span>
                        <span className="doc-rx-cell-val">M - A - N Schedule</span>
                      </div>
                      <div className="doc-rx-schema-cell">
                        <span className="doc-rx-cell-title">Duration</span>
                        <span className="doc-rx-cell-val">Days & Instructions</span>
                      </div>
                    </div>

                    <p style={{ margin: 0, fontSize: 12.5, color: "#55756d", lineHeight: 1.6 }}>
                      The digital prescription studio will be activated in <strong>Phase 4</strong> alongside the
                      Consultation Room. It allows you to compose verified digital prescriptions, check for
                      contraindications, and immediately deliver prescription records to the patient's portal.
                    </p>
                  </div>
                </div>

                <footer className="doc-card-footer">
                  <span>Prescriptions require verified doctor session credentials.</span>
                  <Link to="/doctor/appointments" className="doc-queue-empty-btn" style={{ padding: "6px 12px" }}>
                    <span>Launch Consultation</span>
                  </Link>
                </footer>
              </section>
            )}

            {/* PRACTICE PROFILE MODULE */}
            {module === "profile" && (
              <section className="doc-card">
                <header className="doc-card-header">
                  <div className="doc-card-title-group">
                    <div className="doc-card-icon">
                      <Stethoscope size={18} />
                    </div>
                    <h2 className="doc-card-title">Doctor Practice Profile</h2>
                  </div>
                  <span className="doc-card-badge">Profile Preview</span>
                </header>

                <div className="doc-card-body">
                  <div className="doc-profile-grid">
                    <div className="doc-profile-field">
                      <span className="doc-profile-label">Practitioner Name</span>
                      <span className="doc-profile-val">{displayName}</span>
                    </div>
                    <div className="doc-profile-field">
                      <span className="doc-profile-label">Registered Email</span>
                      <span className="doc-profile-val">{user?.email || "doctor@anvaya.com"}</span>
                    </div>
                    <div className="doc-profile-field">
                      <span className="doc-profile-label">Account Role</span>
                      <span className="doc-profile-val">Doctor ({user?.role || "doctor"})</span>
                    </div>
                    <div className="doc-profile-field">
                      <span className="doc-profile-label">Credential Verification</span>
                      <span className="doc-profile-val" style={{ color: "#55756d", fontWeight: 600, fontSize: 12 }}>
                        Pending Profile Integration (Phase 5)
                      </span>
                    </div>
                  </div>

                  <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "#55756d", lineHeight: 1.6 }}>
                    Your doctor profile details are synchronized with your authenticated Anvaya account. In Phase 5,
                    you will be able to manage your clinical biography, medical council registration number,
                    qualifications, and consultation fees.
                  </p>
                </div>

                <footer className="doc-card-footer">
                  <span>Authentication Provider: Anvaya Identity Engine</span>
                  <Link to="/doctor/availability" className="doc-queue-empty-btn" style={{ padding: "6px 12px" }}>
                    <span>Set Consulting Hours</span>
                  </Link>
                </footer>
              </section>
            )}

            {/* CONSULTATION ROOM MODULE */}
            {module === "consultation" && (
              <section className="doc-card">
                <header className="doc-card-header">
                  <div className="doc-card-title-group">
                    <div className="doc-card-icon">
                      <Stethoscope size={18} />
                    </div>
                    <h2 className="doc-card-title">Active Consultation Room</h2>
                  </div>
                  <span className="doc-card-badge">Clinical Room</span>
                </header>

                <div className="doc-card-body">
                  {!appointmentId ? (
                    <div className="doc-consult-warning">
                      <AlertCircle size={22} color="#b45309" style={{ flexShrink: 0, marginTop: 2 }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <strong style={{ fontSize: 14 }}>Valid Appointment ID Required</strong>
                        <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                          The Consultation Room cannot be initialized without a specific appointment reference.
                          Please select an active consultation from your appointment queue.
                        </span>
                        <Link
                          to="/doctor/appointments"
                          className="doc-queue-empty-btn"
                          style={{ width: "fit-content", marginTop: 8 }}
                        >
                          <ArrowRight size={14} />
                          <span>Return to Consultation Queue</span>
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="doc-consult-valid">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, color: "#1a3932" }}>
                          Appointment Session ID: <strong>{appointmentId}</strong>
                        </span>
                        <span className="doc-card-badge">Session Ready</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: "#55756d", lineHeight: 1.6 }}>
                        This consultation session will be integrated in <strong>Phase 4</strong> with real-time
                        clinical examination recording, patient history review under active consent, and direct
                        e-prescription composition.
                      </p>
                    </div>
                  )}
                </div>

                <footer className="doc-card-footer">
                  <span>Consultations must be accessed contextually from an appointment.</span>
                  <Link to="/doctor/appointments" style={{ color: "#0c8b82", fontWeight: 700, textDecoration: "none" }}>
                    ← Back to Queue
                  </Link>
                </footer>
              </section>
            )}
          </main>

          {/* Practice Context Rail (Right ~32%) */}
          <aside className="doc-context-rail">
            {/* Authenticated Doctor Details */}
            <section className="doc-context-card">
              <h3 className="doc-context-title">
                <Stethoscope size={16} color="#0c8b82" />
                <span>Doctor Session</span>
              </h3>
              <ul className="doc-info-list">
                <li className="doc-info-item">
                  <span className="doc-info-key">Practitioner</span>
                  <span className="doc-info-val">{displayName}</span>
                </li>
                <li className="doc-info-item">
                  <span className="doc-info-key">Account Role</span>
                  <span className="doc-info-val">Doctor</span>
                </li>
                <li className="doc-info-item">
                  <span className="doc-info-key">Session State</span>
                  <span className="doc-info-val">
                    Authenticated
                  </span>
                </li>
              </ul>
            </section>

            {/* Clinical Workflow Standards */}
            <section className="doc-context-card">
              <h3 className="doc-context-title">
                <ShieldCheck size={16} color="#0c8b82" />
                <span>Practice Guidelines</span>
              </h3>
              <p className="doc-guidance-text">
                All patient health records are consent-gated. Maintain regular consulting hours in the Availability
                manager so patients can book appointments.
              </p>
              <div className="doc-rail-nav">
                <Link to="/doctor/appointments" className="doc-rail-link">
                  <span>Consultation Queue</span>
                  <ArrowRight size={14} />
                </Link>
                <Link to="/doctor/availability" className="doc-rail-link">
                  <span>Consulting Hours</span>
                  <ArrowRight size={14} />
                </Link>
                <Link to="/doctor/profile" className="doc-rail-link">
                  <span>Practice Profile</span>
                  <ArrowRight size={14} />
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </DoctorLayout>
  );
}

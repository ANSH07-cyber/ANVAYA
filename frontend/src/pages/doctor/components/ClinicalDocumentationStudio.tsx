import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileCheck2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { doctorService } from "../../../services/doctorService";
import type {
  ConsultationCompletionPayload,
  DoctorAppointmentItem,
  HealthRecordRead,
} from "../../../types/doctor";
import "./ClinicalDocumentationStudio.css";

interface ClinicalDocumentationStudioProps {
  appointment: DoctorAppointmentItem;
  onSuccess: (record: HealthRecordRead) => void;
  recentHealthRecordId?: string | null;
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

export default function ClinicalDocumentationStudio({
  appointment,
  onSuccess,
  recentHealthRecordId,
}: ClinicalDocumentationStudioProps) {
  const [visitSummary, setVisitSummary] = useState<string>("");
  const [chiefComplaint, setChiefComplaint] = useState<string>("");
  const [symptoms, setSymptoms] = useState<string>("");
  const [diagnosis, setDiagnosis] = useState<string>("");
  const [clinicalNotes, setClinicalNotes] = useState<string>("");
  const [treatmentPlan, setTreatmentPlan] = useState<string>("");
  const [followUpInstructions, setFollowUpInstructions] = useState<string>("");

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedRecord, setSavedRecord] = useState<HealthRecordRead | null>(null);

  const isCompleted = appointment.status === "completed";
  const isCancelled = appointment.status === "cancelled";
  const isBooked = appointment.status === "booked";
  const hasStarted = isAppointmentStarted(appointment.appointment_date, appointment.start_time);

  const isSummaryValid = visitSummary.trim().length >= 10;
  const canSubmit = isBooked && hasStarted && isSummaryValid && !isSubmitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isBooked) {
      setErrorMessage("Only booked appointments can be completed.");
      return;
    }

    if (!hasStarted) {
      setErrorMessage("A future appointment cannot be completed. Available after scheduled start time.");
      return;
    }

    if (!isSummaryValid) {
      setErrorMessage("Visit Summary requires at least 10 characters to document clinical consultation.");
      return;
    }

    const payload: ConsultationCompletionPayload = {
      visit_summary: visitSummary.trim(),
      chief_complaint: chiefComplaint.trim() || null,
      symptoms: symptoms.trim() || null,
      diagnosis: diagnosis.trim() || null,
      clinical_notes: clinicalNotes.trim() || null,
      treatment_plan: treatmentPlan.trim() || null,
      follow_up_instructions: followUpInstructions.trim() || null,
    };

    setIsSubmitting(true);

    try {
      const record = await doctorService.completeConsultation(appointment.id, payload);
      setSavedRecord(record);
      onSuccess(record);
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;

      if (detail) {
        setErrorMessage(detail);
      } else {
        setErrorMessage("Unable to save consultation record. Please verify connection and retry.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayedRecordId = savedRecord?.id || recentHealthRecordId;

  // View for ALREADY COMPLETED appointments (Read-Only Archive)
  if (isCompleted || savedRecord) {
    return (
      <section className="doc-studio-panel">
        <header className="doc-studio-header">
          <div className="doc-studio-title-group">
            <div className="doc-studio-kicker">
              <FileCheck2 size={13} />
              <span>CONSULTATION ARCHIVED</span>
            </div>
            <h2 className="doc-studio-title">Encounter Completed</h2>
          </div>
          <span className="doc-status-tag completed">completed</span>
        </header>

        <div className="doc-studio-body">
          <div className="doc-studio-alert doc-studio-alert-success">
            <CheckCircle2 size={20} color="#34d399" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ display: "block", fontSize: "0.95rem", color: "#ffffff", marginBottom: 4 }}>
                Clinical Encounter Concluded & Archived
              </strong>
              <p style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.5, color: "#e2e8f0" }}>
                This consultation has been finalized. The clinical encounter record is committed and the appointment status is marked as completed.
              </p>
              {displayedRecordId && (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "#070d18", borderRadius: 6, fontSize: "0.8rem" }}>
                  <span>Health Record Reference: </span>
                  <code style={{ color: "#38bdf8", fontWeight: 700 }}>{displayedRecordId}</code>
                </div>
              )}
            </div>
          </div>

          <div className="doc-studio-readonly-notice">
            <ShieldCheck size={14} color="#0ea5e9" />
            <span>Editing is permanently locked to preserve medical record integrity.</span>
          </div>
        </div>
      </section>
    );
  }

  // View for CANCELLED appointments
  if (isCancelled) {
    return (
      <section className="doc-studio-panel">
        <header className="doc-studio-header">
          <div className="doc-studio-title-group">
            <div className="doc-studio-kicker">
              <ShieldAlert size={13} color="#f87171" />
              <span>CONSULTATION CANCELLED</span>
            </div>
            <h2 className="doc-studio-title">Cancelled Appointment</h2>
          </div>
          <span className="doc-status-tag cancelled">cancelled</span>
        </header>

        <div className="doc-studio-body">
          <div className="doc-studio-alert doc-studio-alert-warn">
            <AlertCircle size={20} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ display: "block", fontSize: "0.95rem", color: "#ffffff", marginBottom: 4 }}>
                Consultation Was Cancelled
              </strong>
              <p style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.5, color: "#e2e8f0" }}>
                This appointment was cancelled. Clinical examination and consultation completion cannot be performed on cancelled bookings.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // View for ACTIVE or FUTURE BOOKED appointments
  return (
    <section className="doc-studio-panel">
      <header className="doc-studio-header">
        <div className="doc-studio-title-group">
          <div className="doc-studio-kicker">
            <FileCheck2 size={13} />
            <span>CLINICAL EXAMINATION</span>
          </div>
          <h2 className="doc-studio-title">Consultation Documentation</h2>
        </div>

        <span className={`doc-status-tag ${appointment.status}`}>
          {appointment.status}
        </span>
      </header>

      {/* Future Appointment Warning Banner */}
      {!hasStarted && (
        <div className="doc-studio-timing-banner">
          <Clock size={16} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong style={{ color: "#ffffff", display: "block" }}>Scheduled Future Visit</strong>
            <span>Available after scheduled appointment start time.</span>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && (
        <div className="doc-studio-alert doc-studio-alert-error" role="alert" style={{ margin: "14px 22px 0" }}>
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>Action Blocked: </strong>
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* Documentation Form */}
      <form onSubmit={handleSubmit} className="doc-studio-form">
        <div className="doc-studio-body">
          {/* Mandatory Visit Summary */}
          <div className="doc-studio-field">
            <label className="doc-studio-label">
              <span>
                Visit Summary <span className="doc-studio-req">*</span>
              </span>
              <span className={`doc-char-count ${isSummaryValid ? "doc-char-count-valid" : ""}`}>
                {visitSummary.length}/10 min chars
              </span>
            </label>
            <textarea
              className="doc-studio-textarea"
              rows={3}
              value={visitSummary}
              placeholder="Document the patient consultation encounter and core assessment findings..."
              disabled={isSubmitting || !hasStarted}
              onChange={(e) => {
                setVisitSummary(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              required
            />
          </div>

          {/* Provisional / Final Diagnosis */}
          <div className="doc-studio-field">
            <label className="doc-studio-label">
              <span>Provisional / Final Diagnosis</span>
            </label>
            <input
              type="text"
              className="doc-studio-input"
              value={diagnosis}
              placeholder="e.g. Acute Pharyngitis, Type 2 Diabetes Mellitus"
              disabled={isSubmitting || !hasStarted}
              onChange={(e) => setDiagnosis(e.target.value)}
            />
          </div>

          {/* Chief Complaint */}
          <div className="doc-studio-field">
            <label className="doc-studio-label">
              <span>Chief Complaint</span>
            </label>
            <input
              type="text"
              className="doc-studio-input"
              value={chiefComplaint}
              placeholder="Primary issue reported by patient"
              disabled={isSubmitting || !hasStarted}
              onChange={(e) => setChiefComplaint(e.target.value)}
            />
          </div>

          {/* Reported Symptoms */}
          <div className="doc-studio-field">
            <label className="doc-studio-label">
              <span>Reported Symptoms</span>
            </label>
            <input
              type="text"
              className="doc-studio-input"
              value={symptoms}
              placeholder="e.g. High grade fever, throat pain, difficulty swallowing"
              disabled={isSubmitting || !hasStarted}
              onChange={(e) => setSymptoms(e.target.value)}
            />
          </div>

          {/* Clinical Examination Notes */}
          <div className="doc-studio-field">
            <label className="doc-studio-label">
              <span>Physical Examination Notes</span>
            </label>
            <textarea
              className="doc-studio-textarea"
              rows={2}
              value={clinicalNotes}
              placeholder="Physical examination findings, systemic evaluations, vital observations..."
              disabled={isSubmitting || !hasStarted}
              onChange={(e) => setClinicalNotes(e.target.value)}
            />
          </div>

          {/* Treatment Plan */}
          <div className="doc-studio-field">
            <label className="doc-studio-label">
              <span>Treatment Plan</span>
            </label>
            <textarea
              className="doc-studio-textarea"
              rows={2}
              value={treatmentPlan}
              placeholder="Therapeutic recommendations, lab investigation orders, dietary advice..."
              disabled={isSubmitting || !hasStarted}
              onChange={(e) => setTreatmentPlan(e.target.value)}
            />
          </div>

          {/* Follow-up Instructions */}
          <div className="doc-studio-field">
            <label className="doc-studio-label">
              <span>Follow-Up Instructions</span>
            </label>
            <input
              type="text"
              className="doc-studio-input"
              value={followUpInstructions}
              placeholder="e.g. In-clinic review in 7 days or SOS"
              disabled={isSubmitting || !hasStarted}
              onChange={(e) => setFollowUpInstructions(e.target.value)}
            />
          </div>
        </div>

        {/* Studio Footer */}
        <footer className="doc-studio-footer">
          <div className="doc-studio-footer-hint">
            <ShieldCheck size={13} color="#0ea5e9" />
            <span>Consultation completion atomically creates the permanent health record.</span>
          </div>

          <button
            type="submit"
            className="doc-btn doc-btn-primary"
            disabled={!canSubmit}
            title={
              !hasStarted
                ? "Available after scheduled appointment start time."
                : !isSummaryValid
                ? "Visit Summary requires at least 10 characters."
                : "Complete and archive consultation"
            }
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={14} className="doc-spin" />
                <span>Saving Health Record...</span>
              </>
            ) : (
              <>
                <ShieldCheck size={14} />
                <span>Complete & Save Record</span>
              </>
            )}
          </button>
        </footer>
      </form>
    </section>
  );
}


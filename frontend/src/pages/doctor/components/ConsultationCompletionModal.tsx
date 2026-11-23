import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileCheck2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

import { doctorService } from "../../../services/doctorService";
import type {
  ConsultationCompletionPayload,
  DoctorAppointmentItem,
  HealthRecordRead,
} from "../../../types/doctor";
import "./ConsultationCompletionModal.css";

interface ConsultationCompletionModalProps {
  appointment: DoctorAppointmentItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (appointmentId: string, healthRecord: HealthRecordRead) => void;
}

export default function ConsultationCompletionModal({
  appointment,
  isOpen,
  onClose,
  onSuccess,
}: ConsultationCompletionModalProps) {
  const [visitSummary, setVisitSummary] = useState<string>("");
  const [chiefComplaint, setChiefComplaint] = useState<string>("");
  const [symptoms, setSymptoms] = useState<string>("");
  const [diagnosis, setDiagnosis] = useState<string>("");
  const [clinicalNotes, setClinicalNotes] = useState<string>("");
  const [treatmentPlan, setTreatmentPlan] = useState<string>("");
  const [followUpInstructions, setFollowUpInstructions] = useState<string>("");

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdHealthRecord, setCreatedHealthRecord] = useState<HealthRecordRead | null>(null);

  if (!isOpen || !appointment) return null;

  const isSummaryValid = visitSummary.trim().length >= 10;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

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
      setCreatedHealthRecord(record);
      onSuccess(appointment.id, record);
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

  const handleModalClose = () => {
    if (isSubmitting) return;
    setErrorMessage(null);
    setCreatedHealthRecord(null);
    onClose();
  };

  return (
    <div className="doc-modal-overlay" onClick={handleModalClose} role="dialog" aria-modal="true">
      <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="doc-modal-header">
          <div className="doc-modal-title-group">
            <div className="doc-modal-kicker">
              <FileCheck2 size={13} />
              <span>CLINICAL COMPLETION</span>
            </div>
            <h2 className="doc-modal-title">Complete Consultation</h2>
            <p className="doc-modal-sub">
              Patient: <strong>{appointment.patient_name || "Patient"}</strong> · Appointment:{" "}
              {appointment.appointment_date} ({appointment.start_time.slice(0, 5)})
            </p>
          </div>
          <button
            type="button"
            className="doc-modal-close"
            onClick={handleModalClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </header>

        {/* Successful Completion View */}
        {createdHealthRecord ? (
          <div className="doc-modal-body">
            <div className="doc-modal-alert doc-modal-alert-success">
              <CheckCircle2 size={20} color="#34d399" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ display: "block", fontSize: "0.95rem", color: "#ffffff", marginBottom: 4 }}>
                  Consultation Completed & Health Record Created
                </strong>
                <span>
                  The appointment status has been updated to <strong>completed</strong> and the clinical encounter is atomically archived.
                </span>
                <div style={{ marginTop: 10, padding: 8, background: "#070d18", borderRadius: 6, fontSize: "0.8rem" }}>
                  <span>Created Health Record ID: </span>
                  <code style={{ color: "#38bdf8", fontWeight: 700 }}>{createdHealthRecord.id}</code>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button
                type="button"
                className="doc-modal-btn doc-modal-btn-primary"
                onClick={handleModalClose}
              >
                <span>Return to Queue</span>
              </button>
            </div>
          </div>
        ) : (
          /* Completion Form */
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div className="doc-modal-body">
              {/* Error Banner */}
              {errorMessage && (
                <div className="doc-modal-alert doc-modal-alert-error" role="alert">
                  <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong>Action Blocked: </strong>
                    <span>{errorMessage}</span>
                  </div>
                </div>
              )}

              {/* Mandatory Visit Summary */}
              <div className="doc-modal-field">
                <label className="doc-modal-label">
                  <span>
                    Visit Summary <span className="doc-modal-req">*</span>
                  </span>
                  <span className={`doc-char-count ${isSummaryValid ? "doc-char-count-valid" : ""}`}>
                    {visitSummary.length}/10 min chars
                  </span>
                </label>
                <textarea
                  className="doc-modal-textarea"
                  rows={3}
                  value={visitSummary}
                  placeholder="Document the patient consultation encounter and core assessment..."
                  disabled={isSubmitting}
                  onChange={(e) => {
                    setVisitSummary(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  required
                />
              </div>

              {/* Diagnosis */}
              <div className="doc-modal-field">
                <label className="doc-modal-label">
                  <span>Provisional / Final Diagnosis</span>
                </label>
                <input
                  type="text"
                  className="doc-modal-input"
                  value={diagnosis}
                  placeholder="e.g. Acute Bronchitis, Essential Hypertension"
                  disabled={isSubmitting}
                  onChange={(e) => setDiagnosis(e.target.value)}
                />
              </div>

              {/* Chief Complaint */}
              <div className="doc-modal-field">
                <label className="doc-modal-label">
                  <span>Chief Complaint</span>
                </label>
                <input
                  type="text"
                  className="doc-modal-input"
                  value={chiefComplaint}
                  placeholder="Primary issue reported by patient"
                  disabled={isSubmitting}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                />
              </div>

              {/* Symptoms */}
              <div className="doc-modal-field">
                <label className="doc-modal-label">
                  <span>Reported Symptoms</span>
                </label>
                <input
                  type="text"
                  className="doc-modal-input"
                  value={symptoms}
                  placeholder="e.g. Fever, productive cough, fatigue"
                  disabled={isSubmitting}
                  onChange={(e) => setSymptoms(e.target.value)}
                />
              </div>

              {/* Clinical Notes & Observations */}
              <div className="doc-modal-field">
                <label className="doc-modal-label">
                  <span>Clinical Examination Notes</span>
                </label>
                <textarea
                  className="doc-modal-textarea"
                  rows={2}
                  value={clinicalNotes}
                  placeholder="Physical examination findings, vital signs observations..."
                  disabled={isSubmitting}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                />
              </div>

              {/* Treatment Plan */}
              <div className="doc-modal-field">
                <label className="doc-modal-label">
                  <span>Treatment Plan</span>
                </label>
                <textarea
                  className="doc-modal-textarea"
                  rows={2}
                  value={treatmentPlan}
                  placeholder="Recommended therapeutic interventions and dietary guidelines..."
                  disabled={isSubmitting}
                  onChange={(e) => setTreatmentPlan(e.target.value)}
                />
              </div>

              {/* Follow-up Instructions */}
              <div className="doc-modal-field">
                <label className="doc-modal-label">
                  <span>Follow-Up Instructions</span>
                </label>
                <input
                  type="text"
                  className="doc-modal-input"
                  value={followUpInstructions}
                  placeholder="e.g. Review in 10 days or SOS"
                  disabled={isSubmitting}
                  onChange={(e) => setFollowUpInstructions(e.target.value)}
                />
              </div>
            </div>

            {/* Modal Actions */}
            <footer className="doc-modal-footer">
              <button
                type="button"
                className="doc-modal-btn doc-modal-btn-cancel"
                onClick={handleModalClose}
                disabled={isSubmitting}
              >
                <span>Cancel</span>
              </button>

              <button
                type="submit"
                className="doc-modal-btn doc-modal-btn-primary"
                disabled={isSubmitting || !isSummaryValid}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={15} className="doc-spin" />
                    <span>Saving Health Record...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    <span>Complete & Save Record</span>
                  </>
                )}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}

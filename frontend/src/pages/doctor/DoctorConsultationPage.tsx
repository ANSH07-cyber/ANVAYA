import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Pill,
  RefreshCw,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import DoctorLayout from "../../layouts/DoctorLayout";
import { doctorService } from "../../services/doctorService";
import type {
  DoctorAppointmentItem,
  HealthRecordRead,
  PrescriptionCreatePayload,
  PrescriptionRead,
} from "../../types/doctor";
import ConsultationHeader from "./components/ConsultationHeader";
import ConsentEHRViewer from "./components/ConsentEHRViewer";
import SkinLesionReviewPanel from "./components/SkinLesionReviewPanel";
import ClinicalDocumentationStudio from "./components/ClinicalDocumentationStudio";
import PrescriptionStudioModal from "./components/PrescriptionStudioModal";
import PrescriptionReceiptCard from "./components/PrescriptionReceiptCard";
import "./DoctorConsultationPage.css";

export default function DoctorConsultationPage() {
  const { user } = useAuth();
  const { appointmentId } = useParams<{ appointmentId: string }>();

  const [appointment, setAppointment] = useState<DoctorAppointmentItem | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recentHealthRecordId, setRecentHealthRecordId] = useState<string | null>(null);

  // Prescription Workflow State
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState<boolean>(false);
  const [isPrescribing, setIsPrescribing] = useState<boolean>(false);
  const [prescriptionError, setPrescriptionError] = useState<string | null>(null);
  const [issuedPrescription, setIssuedPrescription] = useState<PrescriptionRead | null>(null);

  const doctorDisplayName = user?.full_name
    ? user.full_name.trim().toLowerCase().startsWith("dr.") ||
      user.full_name.trim().toLowerCase().startsWith("dr ")
      ? user.full_name.trim()
      : `Dr. ${user.full_name.trim()}`
    : "Doctor";

  const fetchAppointment = async () => {
    if (!appointmentId) {
      setErrorMessage("Appointment ID parameter missing from consultation route.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const appt = await doctorService.getDoctorAppointmentById(appointmentId);
      if (!appt) {
        setErrorMessage(
          "Appointment not found or you do not have permission to access this clinical session."
        );
      } else {
        setAppointment(appt);
      }
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setErrorMessage(detail || "Unable to load consultation details from clinical service.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchAppointment();
  }, [appointmentId]);

  const handleCompletionSuccess = (record: HealthRecordRead) => {
    setAppointment((prev) => (prev ? { ...prev, status: "completed" } : null));
    setRecentHealthRecordId(record.id);
  };

  const handlePrescriptionSubmit = async (payload: PrescriptionCreatePayload) => {
    if (isPrescribing) return;
    setIsPrescribing(true);
    setPrescriptionError(null);

    try {
      const created = await doctorService.createPrescription(payload);
      setIssuedPrescription(created);
      setIsPrescriptionModalOpen(false);
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;

      const message =
        detail || "Unable to issue digital prescription. Please verify connection and retry.";
      setPrescriptionError(message);
      setIsPrescriptionModalOpen(false);
    } finally {
      setIsPrescribing(false);
    }
  };

  const isCompleted = appointment?.status === "completed";

  return (
    <DoctorLayout title="Active Consultation Workspace">
      <div className="doc-consult-container">
        {/* Loading State */}
        {isLoading && (
          <div className="doc-consult-card" style={{ padding: 48, textAlign: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="doc-skeleton-box" style={{ height: 60 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div className="doc-skeleton-box" style={{ height: 400 }} />
                <div className="doc-skeleton-box" style={{ height: 400 }} />
              </div>
            </div>
          </div>
        )}

        {/* Error / Not Found State */}
        {!isLoading && (errorMessage || !appointment) && (
          <div className="doc-consult-error-card">
            <AlertCircle size={32} color="#f87171" />
            <h2 className="doc-consult-error-title">Consultation Unavailable</h2>
            <p className="doc-consult-error-desc">
              {errorMessage || "The requested consultation session could not be verified."}
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <button
                type="button"
                className="doc-btn doc-btn-secondary"
                onClick={fetchAppointment}
              >
                <RefreshCw size={14} />
                <span>Retry</span>
              </button>
              <Link to="/doctor/appointments" className="doc-btn doc-btn-primary">
                <ArrowLeft size={14} />
                <span>Return to Consultation Queue</span>
              </Link>
            </div>
          </div>
        )}

        {/* Main Consultation Room */}
        {!isLoading && appointment && (
          <>
            {/* Command Header */}
            <ConsultationHeader appointment={appointment} />

            {/* Split Clinical Workspace (Desktop 50:50 / Stacked on Mobile) */}
            <div className="doc-consult-split-grid">
              {/* Left Column: Consent-Gated EHR History & AI Skin Lesion Screenings */}
              <div className="doc-consult-col">
                <ConsentEHRViewer patientProfileId={appointment.patient_profile_id} />
                <SkinLesionReviewPanel patientProfileId={appointment.patient_profile_id} />
              </div>

              {/* Right Column: Live Clinical Documentation Studio & Prescription Workflow */}
              <div className="doc-consult-col">
                <ClinicalDocumentationStudio
                  appointment={appointment}
                  onSuccess={handleCompletionSuccess}
                  recentHealthRecordId={recentHealthRecordId}
                />

                {/* Digital Prescription Studio Workflow (Only available for completed visits) */}
                {isCompleted && (
                  <>
                    {issuedPrescription ? (
                      <PrescriptionReceiptCard
                        prescription={issuedPrescription}
                        patientName={appointment.patient_name}
                        doctorName={doctorDisplayName}
                      />
                    ) : (
                      <div className="doc-consult-rx-card">
                        <div className="doc-consult-rx-header">
                          <div className="doc-consult-rx-kicker">
                            <Pill size={13} aria-hidden="true" />
                            <span>DIGITAL PRESCRIPTION STUDIO</span>
                          </div>
                          <h3 className="doc-consult-rx-title">Official Clinical Prescription</h3>
                          <p className="doc-consult-rx-desc">
                            Encounter documentation is concluded. You can now compose and issue an official digital prescription for this completed visit.
                          </p>
                        </div>

                        {prescriptionError && (
                          <div className="doc-consult-rx-error" role="alert">
                            <AlertCircle size={16} aria-hidden="true" />
                            <span>{prescriptionError}</span>
                          </div>
                        )}

                        <div className="doc-consult-rx-actions">
                          <button
                            type="button"
                            className="doc-btn doc-btn-primary"
                            onClick={() => {
                              setPrescriptionError(null);
                              setIsPrescriptionModalOpen(true);
                            }}
                            disabled={isPrescribing}
                          >
                            <Pill size={15} aria-hidden="true" />
                            <span>Compose Digital Prescription (℞)</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Prescription Studio Modal */}
            {isPrescriptionModalOpen && (
              <PrescriptionStudioModal
                open={isPrescriptionModalOpen}
                appointmentId={appointment.id}
                onClose={() => {
                  if (!isPrescribing) {
                    setIsPrescriptionModalOpen(false);
                  }
                }}
                onReview={handlePrescriptionSubmit}
              />
            )}
          </>
        )}
      </div>
    </DoctorLayout>
  );
}

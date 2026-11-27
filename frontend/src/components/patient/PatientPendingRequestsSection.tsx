import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Clock3,
  FileCheck2,
  Inbox,
  Info,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Stethoscope,
} from "lucide-react";

import { consentService } from "../../services/consentService";
import type {
  ConsentRequestRead,
  HealthDataScope,
} from "../../types/consent";
import { formatDoctorDisplayName } from "../../utils/formatters";
import PatientConsentResponseModal from "./PatientConsentResponseModal";
import "./PatientPendingRequestsSection.css";

export interface PatientPendingRequestsSectionProps {
  onResolved?: (message?: string) => void;
  onPendingCountChange?: (count: number) => void;
}

const SCOPE_LABELS: Record<HealthDataScope, string> = {
  visit_summary: "Visit summary",
  chief_complaint: "Chief complaint",
  symptoms: "Symptoms",
  diagnosis: "Diagnosis",
  clinical_notes: "Clinical notes",
  treatment_plan: "Treatment plan",
  follow_up_instructions: "Follow-up instructions",
};

function formatDateTime(value: string | null): string {
  if (!value) return "Not specified";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getExpiryBadge(expiresAtStr: string): {
  isExpiringSoon: boolean;
  label: string;
} {
  const expiresAt = new Date(expiresAtStr).getTime();
  const now = Date.now();
  const diffMs = expiresAt - now;

  if (diffMs <= 0) {
    return { isExpiringSoon: true, label: "Expired" };
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 24) {
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return {
      isExpiringSoon: true,
      label: `Expires in ${hours}h ${mins}m`,
    };
  }

  const days = Math.floor(hours / 24);
  return {
    isExpiringSoon: false,
    label: `Expires in ${days} day${days > 1 ? "s" : ""}`,
  };
}

export default function PatientPendingRequestsSection({
  onResolved,
  onPendingCountChange,
}: PatientPendingRequestsSectionProps) {
  const [requests, setRequests] = useState<ConsentRequestRead[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Deep-link support
  const [searchParams] = useSearchParams();
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const handledDeepLinkRef = useRef(false);

  // Modal interaction state
  const [activeRequest, setActiveRequest] = useState<ConsentRequestRead | null>(
    null,
  );
  const [modalMode, setModalMode] = useState<"review" | "decline">("review");
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const loadPendingRequests = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await consentService.getPendingConsentRequests({
        limit: 50,
        offset: 0,
      });
      setRequests(response.items);
      onPendingCountChange?.(response.total);

      // Deep-link auto-selection of specific request (validated strictly against backend response)
      const targetRequestId = searchParams.get("request_id") || searchParams.get("requestId");
      if (targetRequestId && !handledDeepLinkRef.current) {
        handledDeepLinkRef.current = true;
        const matched = response.items.find((r) => r.id === targetRequestId);
        if (matched) {
          const isExpired = new Date(matched.expires_at).getTime() <= Date.now();
          if (!isExpired) {
            setActiveRequest(matched);
            setModalMode("review");
            setIsModalOpen(true);
          } else {
            setDeepLinkNotice("The selected consent request has expired and can no longer be approved.");
          }
        } else {
          setDeepLinkNotice("The selected consent request is no longer pending or has already been resolved.");
        }
      }
    } catch (err) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (
              err as {
                response?: { data?: { detail?: string } };
              }
            ).response?.data?.detail || "Unable to load pending requests."
          : "Unable to load pending consent requests.";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  }, [onPendingCountChange, searchParams]);

  useEffect(() => {
    void loadPendingRequests();
  }, [loadPendingRequests]);

  function handleOpenModal(
    req: ConsentRequestRead,
    mode: "review" | "decline",
  ) {
    setActiveRequest(req);
    setModalMode(mode);
    setIsModalOpen(true);
  }

  function handleCloseModal() {
    setIsModalOpen(false);
    setActiveRequest(null);
  }

  function handleResolved(
    _updated: ConsentRequestRead,
    resolutionMessage: string,
  ) {
    void loadPendingRequests();
    onResolved?.(resolutionMessage);
  }

  return (
    <section className="patient-pending-section" aria-label="Pending consent requests">
      <div className="patient-pending-header">
        <div className="patient-pending-title-group">
          <div className="patient-pending-kicker-row">
            <span className="patient-pending-kicker">
              PENDING INBOX
            </span>
            {requests.length > 0 && (
              <span className="patient-pending-count-badge">
                {requests.length} Action Required
              </span>
            )}
          </div>
          <h2>Doctor EHR Access Requests</h2>
          <p>
            When a doctor needs to view your health records, their request
            appears here. You control exactly which medical categories are
            shared.
          </p>
        </div>

        <button
          type="button"
          className="patient-pending-refresh-btn"
          onClick={() => void loadPendingRequests()}
          disabled={isLoading}
          aria-label="Refresh pending requests"
        >
          <RefreshCw
            size={16}
            className={isLoading ? "patient-pending-spin" : ""}
          />
          Refresh
        </button>
      </div>

      {/* Deep-link Resolution Notice */}
      {deepLinkNotice && (
        <div className="patient-pending-notice" role="status" aria-live="polite">
          <Info size={16} />
          <span>{deepLinkNotice}</span>
          <button
            type="button"
            className="patient-pending-notice-dismiss"
            onClick={() => setDeepLinkNotice(null)}
            aria-label="Dismiss notice"
          >
            ×
          </button>
        </div>
      )}

      {/* Error State */}
      {errorMessage && (
        <div className="patient-pending-error-alert" role="alert">
          <AlertCircle size={20} />
          <span>{errorMessage}</span>
          <button
            type="button"
            className="patient-pending-retry-btn"
            onClick={() => void loadPendingRequests()}
          >
            Try again
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading ? (
        <div className="patient-pending-empty-state loading">
          <RefreshCw size={26} className="patient-pending-spin" />
          <strong>Checking for pending requests...</strong>
          <span>Retrieving doctor access requests securely.</span>
        </div>
      ) : !errorMessage && requests.length === 0 ? (
        /* Empty State */
        <div className="patient-pending-empty-state">
          <div className="patient-pending-empty-icon">
            <Inbox size={28} />
          </div>
          <strong>No pending EHR access requests</strong>
          <span>
            You have no outstanding consent requests from doctors. When a doctor
            requests access to your clinical records, it will appear here for your
            review.
          </span>
        </div>
      ) : (
        /* Requests List */
        !errorMessage && (
          <div className="patient-pending-cards-grid">
            {requests.map((request) => {
              const doctorDisplayName = formatDoctorDisplayName(
                request.doctor_name,
                "Doctor",
              );
              const doctorSpecialty =
                request.doctor_specialization || "Clinical Specialist";
              const clinicName = request.clinic_name || "ANVAYA Clinic";
              const expiryBadge = getExpiryBadge(request.expires_at);

              return (
                <article
                  key={request.id}
                  className="patient-pending-card"
                  aria-labelledby={`req-title-${request.id}`}
                >
                  {/* Card Top / Header */}
                  <div className="patient-pending-card-top">
                    <div className="patient-pending-doctor-info">
                      <div className="patient-pending-doctor-avatar">
                        <Stethoscope size={22} />
                      </div>
                      <div>
                        <strong
                          id={`req-title-${request.id}`}
                          className="patient-pending-doctor-name"
                        >
                          {doctorDisplayName}
                        </strong>
                        <span className="patient-pending-doctor-sub">
                          {doctorSpecialty} · {clinicName}
                        </span>
                      </div>
                    </div>

                    <span className="patient-pending-status-pill">
                      <Clock3 size={13} />
                      Awaiting Your Decision
                    </span>
                  </div>

                  {/* Date & Expiry Row */}
                  <div className="patient-pending-meta-row">
                    <span className="patient-pending-meta-item">
                      <Clock3 size={14} />
                      Requested: {formatDateTime(request.created_at)}
                    </span>
                    <span
                      className={`patient-pending-meta-item ${
                        expiryBadge.isExpiringSoon ? "expiring" : ""
                      }`}
                    >
                      {expiryBadge.isExpiringSoon ? (
                        <AlertTriangle size={14} />
                      ) : (
                        <Clock3 size={14} />
                      )}
                      {expiryBadge.label}
                    </span>
                  </div>

                  {/* Doctor Message Quote Block */}
                  {request.doctor_message && (
                    <div className="patient-pending-message-block">
                      <span className="patient-pending-message-caption">
                        Doctor's Clinical Note:
                      </span>
                      <blockquote className="patient-pending-message-quote">
                        "{request.doctor_message}"
                      </blockquote>
                    </div>
                  )}

                  {/* Requested Scopes */}
                  <div className="patient-pending-scopes-box">
                    <span className="patient-pending-scopes-caption">
                      <FileCheck2 size={15} />
                      Requested Clinical Records ({request.requested_scopes.length}):
                    </span>
                    <div className="patient-pending-chips">
                      {request.requested_scopes.map((scope) => (
                        <span key={scope} className="patient-pending-chip">
                          {SCOPE_LABELS[scope] || scope}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Card Actions Footer */}
                  <div className="patient-pending-card-footer">
                    <button
                      type="button"
                      className="patient-pending-btn-decline"
                      onClick={() => handleOpenModal(request, "decline")}
                      aria-label={`Decline request from ${doctorDisplayName}`}
                    >
                      <ShieldOff size={15} />
                      Decline
                    </button>

                    <button
                      type="button"
                      className="patient-pending-btn-review"
                      onClick={() => handleOpenModal(request, "review")}
                      aria-label={`Review and respond to request from ${doctorDisplayName}`}
                    >
                      <ShieldCheck size={16} />
                      Review & Respond
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )
      )}

      {/* Response Modal */}
      {isModalOpen && activeRequest && (
        <PatientConsentResponseModal
          isOpen={isModalOpen}
          request={activeRequest}
          initialMode={modalMode}
          onClose={handleCloseModal}
          onResolved={handleResolved}
        />
      )}
    </section>
  );
}

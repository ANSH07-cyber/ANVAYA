import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Pill,
  RefreshCw,
  User,
  X,
} from "lucide-react";

import { doctorService } from "../../../services/doctorService";
import type { DoctorPrescriptionRead } from "../../../types/doctor";
import PrescriptionReceiptCard from "./PrescriptionReceiptCard";
import "./DoctorPrescriptionDetailDrawer.css";

interface DoctorPrescriptionDetailDrawerProps {
  prescriptionId: string | null;
  isOpen: boolean;
  onClose: () => void;
  initialPrescription?: DoctorPrescriptionRead | null;
  doctorName?: string;
}

export default function DoctorPrescriptionDetailDrawer({
  prescriptionId,
  isOpen,
  onClose,
  initialPrescription,
  doctorName,
}: DoctorPrescriptionDetailDrawerProps) {
  const [fetchState, setFetchState] = useState<{
    id: string | null;
    loading: boolean;
    data: DoctorPrescriptionRead | null;
    error: string | null;
  }>({
    id: null,
    loading: false,
    data: null,
    error: null,
  });

  const isInitialMatch = Boolean(
    initialPrescription &&
      prescriptionId &&
      initialPrescription.id === prescriptionId,
  );

  const prescription: DoctorPrescriptionRead | null = isInitialMatch
    ? (initialPrescription ?? null)
    : fetchState.id === prescriptionId
    ? fetchState.data
    : null;

  const isLoading =
    isOpen &&
    Boolean(prescriptionId) &&
    !isInitialMatch &&
    (fetchState.id !== prescriptionId || fetchState.loading);

  const error =
    !isInitialMatch && fetchState.id === prescriptionId
      ? fetchState.error
      : null;

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Fetch full details if not provided or when prescriptionId changes
  useEffect(() => {
    if (!isOpen || !prescriptionId) {
      return;
    }

    // If initial prescription is already provided and matches ID, no need to fetch
    if (initialPrescription && initialPrescription.id === prescriptionId) {
      return;
    }

    let isMounted = true;

    doctorService
      .getDoctorPrescriptionById(prescriptionId)
      .then((data) => {
        if (isMounted) {
          setFetchState({
            id: prescriptionId,
            loading: false,
            data,
            error: null,
          });
        }
      })
      .catch((err) => {
        if (isMounted) {
          const detail =
            err?.response?.data?.detail ||
            "Unable to retrieve prescription details. Please verify your connection.";
          setFetchState({
            id: prescriptionId,
            loading: false,
            data: null,
            error: detail,
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, prescriptionId, initialPrescription]);

  const handleRetry = () => {
    if (!prescriptionId) return;
    setFetchState((prev) => ({ ...prev, loading: true, error: null }));
    doctorService
      .getDoctorPrescriptionById(prescriptionId)
      .then((data) => {
        setFetchState({
          id: prescriptionId,
          loading: false,
          data,
          error: null,
        });
      })
      .catch((err) => {
        const detail =
          err?.response?.data?.detail ||
          "Unable to retrieve prescription details. Please verify your connection.";
        setFetchState({
          id: prescriptionId,
          loading: false,
          data: null,
          error: detail,
        });
      });
  };

  if (!isOpen) return null;

  return (
    <div
      className="rx-drawer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rx-drawer-title"
    >
      <div
        className="rx-drawer"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {/* Sticky Header */}
        <header className="rx-drawer-header">
          <div className="rx-drawer-header-info">
            <div className="rx-drawer-kicker">
              <Pill size={13} aria-hidden="true" />
              <span>PRESCRIPTION RECORD</span>
            </div>
            <h2 id="rx-drawer-title" className="rx-drawer-title">
              Prescription Inspection
            </h2>
          </div>

          <button
            type="button"
            className="rx-drawer-close-btn"
            onClick={onClose}
            aria-label="Close prescription drawer"
            title="Close (Esc)"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {/* Drawer Content */}
        <div className="rx-drawer-body">
          {isLoading ? (
            <div className="rx-drawer-loading" role="status" aria-live="polite">
              <div className="rx-drawer-spinner" aria-hidden="true" />
              <span>Retrieving verified prescription record...</span>
            </div>
          ) : error ? (
            <div className="rx-drawer-error" role="alert">
              <AlertCircle size={28} color="#f87171" aria-hidden="true" />
              <h4>Failed to Load Prescription</h4>
              <p>{error}</p>
              <button
                type="button"
                className="rx-drawer-retry-btn"
                onClick={handleRetry}
              >
                <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                Retry Lookup
              </button>
            </div>
          ) : prescription ? (
            <>
              {/* Context Strip */}
              <div className="rx-drawer-context-strip">
                <div className="rx-drawer-context-patient">
                  <User size={15} color="#14b8a6" aria-hidden="true" />
                  <span>{prescription.patient_name}</span>
                </div>
                <span className="rx-drawer-context-badge">
                  <CheckCircle2 size={12} aria-hidden="true" />
                  Encounter Record
                </span>
              </div>

              {/* Official Receipt Card Embedded */}
              <div className="rx-drawer-receipt-wrapper">
                <PrescriptionReceiptCard
                  prescription={prescription}
                  patientName={prescription.patient_name}
                  doctorName={doctorName}
                />
              </div>
            </>
          ) : (
            <div className="rx-drawer-loading">
              <FileText size={24} color="#64748b" aria-hidden="true" />
              <span>Select a prescription to view clinical details.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


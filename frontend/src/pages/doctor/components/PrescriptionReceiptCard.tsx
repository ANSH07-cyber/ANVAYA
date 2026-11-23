import {
  FileText,
  Pill,
  Printer,
  CheckCircle2,
  Stethoscope,
} from "lucide-react";
import type { PrescriptionRead } from "../../../types/doctor";
import "./PrescriptionReceiptCard.css";

export interface PrescriptionReceiptCardProps {
  prescription: PrescriptionRead;
  patientName?: string;
  doctorName?: string;
  onPrint?: () => void;
}

function formatKolkataTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return isoString;
  }
}

export default function PrescriptionReceiptCard({
  prescription,
  patientName,
  doctorName,
  onPrint,
}: PrescriptionReceiptCardProps) {
  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  };

  const formattedDate = formatKolkataTimestamp(prescription.issued_at);

  return (
    <article className="rx-receipt-card" aria-label="Official Prescription Receipt">
      {/* Receipt Top Header */}
      <header className="rx-receipt-header">
        <div className="rx-receipt-branding">
          <div className="rx-receipt-kicker">
            <Stethoscope size={13} aria-hidden="true" />
            <span>ANVAYA CLINICAL HEALTH</span>
          </div>
          <h3 className="rx-receipt-title">Official Prescription Receipt</h3>
          <span className="rx-receipt-subtitle">
            Issued for patient medical care under registered clinical encounter
          </span>
        </div>

        <div className="rx-receipt-header-actions">
          <button
            type="button"
            className="rx-receipt-print-btn"
            onClick={handlePrint}
            title="Print Official Prescription Receipt"
            aria-label="Print Official Prescription Receipt"
          >
            <Printer size={15} aria-hidden="true" />
            <span>Print Receipt</span>
          </button>
        </div>
      </header>

      {/* Verification Notice */}
      <div className="rx-receipt-banner">
        <CheckCircle2 size={18} className="rx-receipt-banner-icon" aria-hidden="true" />
        <div className="rx-receipt-banner-text">
          <strong>Prescription Successfully Created</strong>
          <p>
            This prescription has been committed to the health records registry and is immediately
            accessible in the patient&apos;s digital health portal.
          </p>
        </div>
      </div>

      {/* Clinical Context Grid */}
      <section className="rx-receipt-meta-grid">
        <div className="rx-receipt-meta-item">
          <span className="rx-receipt-meta-label">Patient</span>
          <strong className="rx-receipt-meta-val">
            {patientName || `Patient Ref: ...${prescription.patient_profile_id.slice(-8)}`}
          </strong>
        </div>

        <div className="rx-receipt-meta-item">
          <span className="rx-receipt-meta-label">Prescribing Doctor</span>
          <strong className="rx-receipt-meta-val">
            {doctorName || `Doctor Ref: ...${prescription.doctor_profile_id.slice(-8)}`}
          </strong>
        </div>

        <div className="rx-receipt-meta-item">
          <span className="rx-receipt-meta-label">Issued At (IST)</span>
          <strong className="rx-receipt-meta-val">{formattedDate}</strong>
        </div>

        <div className="rx-receipt-meta-item">
          <span className="rx-receipt-meta-label">Prescription Reference</span>
          <code className="rx-receipt-code" title={prescription.id}>
            {prescription.id}
          </code>
        </div>

        <div className="rx-receipt-meta-item">
          <span className="rx-receipt-meta-label">Encounter ID</span>
          <code className="rx-receipt-code" title={prescription.appointment_id}>
            ...{prescription.appointment_id.slice(-8)}
          </code>
        </div>

        <div className="rx-receipt-meta-item">
          <span className="rx-receipt-meta-label">Health Record ID</span>
          <code className="rx-receipt-code" title={prescription.health_record_id}>
            ...{prescription.health_record_id.slice(-8)}
          </code>
        </div>
      </section>

      {/* Prescribed Medications */}
      <section className="rx-receipt-meds-section">
        <div className="rx-receipt-section-header">
          <div className="rx-receipt-section-title-wrap">
            <Pill size={16} className="rx-receipt-section-icon" aria-hidden="true" />
            <h4 className="rx-receipt-section-title">
              Prescribed Medications ({prescription.items.length})
            </h4>
          </div>
          <span className="rx-receipt-rx-symbol" aria-hidden="true">℞</span>
        </div>

        <div className="rx-receipt-meds-list">
          {prescription.items.map((item, idx) => (
            <article key={item.id || idx} className="rx-receipt-med-item">
              <div className="rx-receipt-med-top">
                <span className="rx-receipt-med-num">{item.sort_order + 1}</span>
                <div className="rx-receipt-med-name-wrap">
                  <h5 className="rx-receipt-med-name">{item.medicine_name}</h5>
                  <div className="rx-receipt-tags">
                    <span className="rx-receipt-tag dosage">
                      Strength: <strong>{item.dosage}</strong>
                    </span>
                    <span className="rx-receipt-tag frequency">
                      Frequency: <strong>{item.frequency}</strong>
                    </span>
                    <span className="rx-receipt-tag duration">
                      Duration: <strong>{item.duration}</strong>
                    </span>
                    {item.route && (
                      <span className="rx-receipt-tag route">
                        Route: <strong>{item.route}</strong>
                      </span>
                    )}
                    {item.quantity && (
                      <span className="rx-receipt-tag quantity">
                        Quantity: <strong>{item.quantity}</strong>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {item.instructions && (
                <div className="rx-receipt-instructions">
                  <span className="rx-receipt-inst-label">Instructions:</span>
                  <p className="rx-receipt-inst-text">{item.instructions}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* General Clinical Advice / Notes */}
      {prescription.notes && (
        <section className="rx-receipt-notes-section">
          <div className="rx-receipt-section-title-wrap">
            <FileText size={15} className="rx-receipt-section-icon" aria-hidden="true" />
            <h4 className="rx-receipt-section-title">Clinical Notes & Patient Guidance</h4>
          </div>
          <div className="rx-receipt-notes-body">
            <p>{prescription.notes}</p>
          </div>
        </section>
      )}

      {/* Receipt Footer */}
      <footer className="rx-receipt-footer">
        <div className="rx-receipt-footer-left">
          <span>This receipt is an official clinical document generated through the ANVAYA Healthcare Platform.</span>
        </div>
        <div className="rx-receipt-footer-right">
          <span>Total Medications: {prescription.items.length}</span>
        </div>
      </footer>
    </article>
  );
}

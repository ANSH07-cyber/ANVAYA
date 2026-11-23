import React, { useState, useEffect, useId } from "react";
import {
  Pill,
  Plus,
  Trash2,
  X,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  FileText,
  Eye,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import type {
  PrescriptionCreatePayload,
  PrescriptionItemCreate,
} from "../../../types/doctor";
import "./PrescriptionStudioModal.css";

export interface MedicineItemDraft {
  clientId: string;
  medicine_name: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: string;
  instructions: string;
}

export interface MedicineItemErrors {
  medicine_name?: string;
  dosage?: string;
  route?: string;
  frequency?: string;
  duration?: string;
  quantity?: string;
  instructions?: string;
}

export interface PrescriptionStudioModalProps {
  open: boolean;
  onClose: () => void;
  onReview: (payload: PrescriptionCreatePayload) => void;
  appointmentId: string;
}

function createBlankMedicine(): MedicineItemDraft {
  return {
    clientId: `med_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`,
    medicine_name: "",
    dosage: "",
    route: "",
    frequency: "",
    duration: "",
    quantity: "",
    instructions: "",
  };
}

export default function PrescriptionStudioModal({
  open,
  onClose,
  onReview,
  appointmentId,
}: PrescriptionStudioModalProps) {
  const routesDatalistId = useId();
  const frequenciesDatalistId = useId();

  const [step, setStep] = useState<"edit" | "review">("edit");
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<MedicineItemDraft[]>([createBlankMedicine()]);
  const [errors, setErrors] = useState<Record<string, MedicineItemErrors>>({});
  const [notesError, setNotesError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Lock body scroll and register escape-key dismiss
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Medicine Item Mutation Handlers
  const handleItemChange = (
    clientId: string,
    field: keyof Omit<MedicineItemDraft, "clientId">,
    value: string,
  ) => {
    setItems((prev) =>
      prev.map((item) => (item.clientId === clientId ? { ...item, [field]: value } : item)),
    );

    // Clear field-level error when doctor types
    if (errors[clientId]?.[field]) {
      setErrors((prev) => ({
        ...prev,
        [clientId]: {
          ...prev[clientId],
          [field]: undefined,
        },
      }));
    }
    setGeneralError(null);
  };

  const handleAddMedicine = () => {
    if (items.length >= 50) {
      setGeneralError("Prescription cannot exceed 50 medicine items.");
      return;
    }
    setItems((prev) => [...prev, createBlankMedicine()]);
    setGeneralError(null);
  };

  const handleRemoveMedicine = (clientId: string) => {
    if (items.length <= 1) {
      setGeneralError("Prescription requires at least one medicine item.");
      return;
    }
    setItems((prev) => prev.filter((item) => item.clientId !== clientId));
    setErrors((prev) => {
      const updated = { ...prev };
      delete updated[clientId];
      return updated;
    });
    setGeneralError(null);
  };

  // Validation
  const validateForm = (): boolean => {
    let isValid = true;
    const newErrors: Record<string, MedicineItemErrors> = {};

    // Validate Appointment Context
    if (!appointmentId || !appointmentId.trim()) {
      setGeneralError("Appointment context is required to prepare a prescription.");
      return false;
    }

    // Validate Items Count
    if (items.length < 1) {
      setGeneralError("Prescription requires at least one medicine item.");
      return false;
    }
    if (items.length > 50) {
      setGeneralError("Prescription cannot exceed 50 medicine items.");
      return false;
    }

    // Validate Notes
    if (notes.length > 5000) {
      setNotesError("Prescription notes cannot exceed 5,000 characters.");
      isValid = false;
    } else {
      setNotesError(null);
    }

    // Validate Each Medicine
    items.forEach((item, index) => {
      const itemErrors: MedicineItemErrors = {};

      // 1. Medicine Name (Required, max 200)
      const trimmedName = item.medicine_name.trim();
      if (!trimmedName) {
        itemErrors.medicine_name = `Medicine #${index + 1} name is required.`;
        isValid = false;
      } else if (item.medicine_name.length > 200) {
        itemErrors.medicine_name = "Medicine name must be 200 characters or fewer.";
        isValid = false;
      }

      // 2. Dosage (Required, max 100)
      const trimmedDosage = item.dosage.trim();
      if (!trimmedDosage) {
        itemErrors.dosage = "Dosage strength is required.";
        isValid = false;
      } else if (item.dosage.length > 100) {
        itemErrors.dosage = "Dosage must be 100 characters or fewer.";
        isValid = false;
      }

      // 3. Frequency (Required, max 100)
      const trimmedFreq = item.frequency.trim();
      if (!trimmedFreq) {
        itemErrors.frequency = "Frequency schedule is required.";
        isValid = false;
      } else if (item.frequency.length > 100) {
        itemErrors.frequency = "Frequency must be 100 characters or fewer.";
        isValid = false;
      }

      // 4. Duration (Required, max 100)
      const trimmedDuration = item.duration.trim();
      if (!trimmedDuration) {
        itemErrors.duration = "Treatment duration is required.";
        isValid = false;
      } else if (item.duration.length > 100) {
        itemErrors.duration = "Duration must be 100 characters or fewer.";
        isValid = false;
      }

      // 5. Route (Optional, max 80)
      if (item.route.length > 80) {
        itemErrors.route = "Route must be 80 characters or fewer.";
        isValid = false;
      }

      // 6. Quantity (Optional, max 100)
      if (item.quantity.length > 100) {
        itemErrors.quantity = "Quantity must be 100 characters or fewer.";
        isValid = false;
      }

      // 7. Instructions (Optional, max 5000)
      if (item.instructions.length > 5000) {
        itemErrors.instructions = "Instructions must be 5,000 characters or fewer.";
        isValid = false;
      }

      if (Object.keys(itemErrors).length > 0) {
        newErrors[item.clientId] = itemErrors;
      }
    });

    setErrors(newErrors);

    if (!isValid) {
      setGeneralError("Please review and complete all required medicine fields.");
    } else {
      setGeneralError(null);
    }

    return isValid;
  };

  const buildCreatePayload = (): PrescriptionCreatePayload | null => {
    if (!appointmentId || !appointmentId.trim()) {
      return null;
    }

    const formattedItems: PrescriptionItemCreate[] = items.map((item) => ({
      medicine_name: item.medicine_name.trim(),
      dosage: item.dosage.trim(),
      route: item.route.trim() ? item.route.trim() : null,
      frequency: item.frequency.trim(),
      duration: item.duration.trim(),
      quantity: item.quantity.trim() ? item.quantity.trim() : null,
      instructions: item.instructions.trim() ? item.instructions.trim() : null,
    }));

    return {
      appointment_id: appointmentId.trim(),
      notes: notes.trim() ? notes.trim() : null,
      items: formattedItems,
    };
  };

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setStep("review");
  };

  const handleConfirmReview = () => {
    if (!validateForm()) {
      setStep("edit");
      return;
    }
    const payload = buildCreatePayload();
    if (!payload) {
      setGeneralError("Cannot submit prescription without a valid appointment reference.");
      setStep("edit");
      return;
    }
    onReview(payload);
  };

  return (
    <div
      className="rx-composer-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rx-composer-title"
    >
      <div className="rx-composer-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <header className="rx-composer-header">
          <div className="rx-composer-header-left">
            <div className="rx-composer-kicker">
              <Stethoscope size={13} aria-hidden="true" />
              <span>CLINICAL PRESCRIPTION STUDIO</span>
            </div>
            <h2 id="rx-composer-title" className="rx-composer-title">
              {step === "edit" ? "New Digital Prescription" : "Review Digital Prescription"}
            </h2>
            <p className="rx-composer-subtitle">
              {step === "edit"
                ? "Prepare a structured prescription for the patient."
                : "Verify medication details, dosages, and administration instructions before finalizing prescription."}
            </p>
          </div>

          <div className="rx-composer-header-right">
            <div className="rx-composer-step-indicator">
              <span className={`rx-step-pill ${step === "edit" ? "active" : "complete"}`}>
                1. Composition
              </span>
              <span className="rx-step-arrow">›</span>
              <span className={`rx-step-pill ${step === "review" ? "active" : ""}`}>
                2. Clinical Review
              </span>
            </div>
            <button
              type="button"
              className="rx-composer-close-btn"
              onClick={onClose}
              aria-label="Close prescription modal"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Global Error Banner */}
        {generalError && (
          <div className="rx-composer-alert rx-composer-alert-error" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{generalError}</span>
          </div>
        )}

        {/* Datalists for standard options while allowing free-form input */}
        <datalist id={routesDatalistId}>
          <option value="Oral" />
          <option value="Topical" />
          <option value="Inhalation" />
          <option value="Sublingual" />
          <option value="Intravenous (IV)" />
          <option value="Intramuscular (IM)" />
          <option value="Ophthalmic (Eye)" />
          <option value="Otic (Ear)" />
          <option value="Nasal" />
        </datalist>

        <datalist id={frequenciesDatalistId}>
          <option value="Once daily (OD)" />
          <option value="Twice daily (1-0-1 / BD)" />
          <option value="Thrice daily (1-1-1 / TDS)" />
          <option value="Four times daily (QID)" />
          <option value="SOS / As needed" />
          <option value="Every 8 hours" />
          <option value="At bedtime (HS)" />
          <option value="Before meals (AC)" />
          <option value="After meals (PC)" />
        </datalist>

        {/* ======================================================== */}
        {/* STEP 1: COMPOSITION MODE                                 */}
        {/* ======================================================== */}
        {step === "edit" && (
          <form className="rx-composer-form" onSubmit={handleProceedToReview} noValidate>
            <div className="rx-composer-body">
              {/* Prescription General Notes */}
              <section className="rx-section-card">
                <div className="rx-section-header">
                  <div className="rx-section-title-wrap">
                    <FileText size={16} className="rx-section-icon" aria-hidden="true" />
                    <h3 className="rx-section-title">Clinical Notes & General Advice</h3>
                  </div>
                  <span className="rx-char-counter">
                    {notes.length} / 5,000 characters
                  </span>
                </div>
                <div className="rx-field-group">
                  <label htmlFor="rx-general-notes" className="rx-field-label">
                    General Patient Instructions (Optional)
                  </label>
                  <textarea
                    id="rx-general-notes"
                    className={`rx-textarea ${notesError ? "rx-input-error" : ""}`}
                    placeholder="Enter dietary guidelines, lifestyle precautions, follow-up timelines, or general administration advice..."
                    value={notes}
                    maxLength={5000}
                    rows={3}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      if (notesError) setNotesError(null);
                    }}
                  />
                  {notesError && <span className="rx-error-text">{notesError}</span>}
                </div>
              </section>

              {/* Medicines List Section */}
              <section className="rx-section-card">
                <div className="rx-section-header">
                  <div className="rx-section-title-wrap">
                    <Pill size={16} className="rx-section-icon" aria-hidden="true" />
                    <h3 className="rx-section-title">Medication Schedule</h3>
                    <span className="rx-item-count-badge">
                      {items.length} {items.length === 1 ? "Item" : "Items"} (Max 50)
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rx-btn-secondary rx-btn-sm"
                    onClick={handleAddMedicine}
                    disabled={items.length >= 50}
                    aria-label="Add another medication"
                  >
                    <Plus size={14} aria-hidden="true" />
                    <span>Add Medication</span>
                  </button>
                </div>

                <div className="rx-medicine-cards-list">
                  {items.map((item, index) => {
                    const itemError = errors[item.clientId] || {};
                    const canRemove = items.length > 1;

                    return (
                      <article key={item.clientId} className="rx-med-card">
                        <header className="rx-med-card-header">
                          <div className="rx-med-card-index">
                            <span className="rx-med-index-badge">{index + 1}</span>
                            <span className="rx-med-index-label">Medication #{index + 1}</span>
                          </div>
                          <button
                            type="button"
                            className="rx-med-remove-btn"
                            onClick={() => handleRemoveMedicine(item.clientId)}
                            disabled={!canRemove}
                            title={
                              canRemove
                                ? `Remove Medication #${index + 1}`
                                : "At least one medication is required"
                            }
                            aria-label={`Remove Medication #${index + 1}`}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            <span>Remove</span>
                          </button>
                        </header>

                        <div className="rx-med-card-body">
                          {/* Medicine Name (Full Width) */}
                          <div className="rx-field-group">
                            <label
                              htmlFor={`med-name-${item.clientId}`}
                              className="rx-field-label required"
                            >
                              Medicine Name & Strength
                            </label>
                            <input
                              id={`med-name-${item.clientId}`}
                              type="text"
                              className={`rx-input ${
                                itemError.medicine_name ? "rx-input-error" : ""
                              }`}
                              placeholder="e.g. Amoxicillin & Potassium Clavulanate Tablets IP, Paracetamol"
                              maxLength={200}
                              value={item.medicine_name}
                              onChange={(e) =>
                                handleItemChange(item.clientId, "medicine_name", e.target.value)
                              }
                              required
                            />
                            {itemError.medicine_name && (
                              <span className="rx-error-text">{itemError.medicine_name}</span>
                            )}
                          </div>

                          {/* Row 1: Dosage, Route, Frequency */}
                          <div className="rx-grid-3">
                            <div className="rx-field-group">
                              <label
                                htmlFor={`med-dosage-${item.clientId}`}
                                className="rx-field-label required"
                              >
                                Dosage
                              </label>
                              <input
                                id={`med-dosage-${item.clientId}`}
                                type="text"
                                className={`rx-input ${
                                  itemError.dosage ? "rx-input-error" : ""
                                }`}
                                placeholder="e.g. 500mg, 10ml, 1 tab"
                                maxLength={100}
                                value={item.dosage}
                                onChange={(e) =>
                                  handleItemChange(item.clientId, "dosage", e.target.value)
                                }
                                required
                              />
                              {itemError.dosage && (
                                <span className="rx-error-text">{itemError.dosage}</span>
                              )}
                            </div>

                            <div className="rx-field-group">
                              <label
                                htmlFor={`med-route-${item.clientId}`}
                                className="rx-field-label"
                              >
                                Route
                              </label>
                              <input
                                id={`med-route-${item.clientId}`}
                                list={routesDatalistId}
                                type="text"
                                className={`rx-input ${
                                  itemError.route ? "rx-input-error" : ""
                                }`}
                                placeholder="e.g. Oral, Topical, IV"
                                maxLength={80}
                                value={item.route}
                                onChange={(e) =>
                                  handleItemChange(item.clientId, "route", e.target.value)
                                }
                              />
                              {itemError.route && (
                                <span className="rx-error-text">{itemError.route}</span>
                              )}
                            </div>

                            <div className="rx-field-group">
                              <label
                                htmlFor={`med-freq-${item.clientId}`}
                                className="rx-field-label required"
                              >
                                Frequency
                              </label>
                              <input
                                id={`med-freq-${item.clientId}`}
                                list={frequenciesDatalistId}
                                type="text"
                                className={`rx-input ${
                                  itemError.frequency ? "rx-input-error" : ""
                                }`}
                                placeholder="e.g. 1-0-1, Once daily, TDS"
                                maxLength={100}
                                value={item.frequency}
                                onChange={(e) =>
                                  handleItemChange(item.clientId, "frequency", e.target.value)
                                }
                                required
                              />
                              {itemError.frequency && (
                                <span className="rx-error-text">{itemError.frequency}</span>
                              )}
                            </div>
                          </div>

                          {/* Row 2: Duration, Quantity */}
                          <div className="rx-grid-2">
                            <div className="rx-field-group">
                              <label
                                htmlFor={`med-duration-${item.clientId}`}
                                className="rx-field-label required"
                              >
                                Duration
                              </label>
                              <input
                                id={`med-duration-${item.clientId}`}
                                type="text"
                                className={`rx-input ${
                                  itemError.duration ? "rx-input-error" : ""
                                }`}
                                placeholder="e.g. 5 days, 2 weeks, 1 month"
                                maxLength={100}
                                value={item.duration}
                                onChange={(e) =>
                                  handleItemChange(item.clientId, "duration", e.target.value)
                                }
                                required
                              />
                              {itemError.duration && (
                                <span className="rx-error-text">{itemError.duration}</span>
                              )}
                            </div>

                            <div className="rx-field-group">
                              <label
                                htmlFor={`med-qty-${item.clientId}`}
                                className="rx-field-label"
                              >
                                Quantity (Optional)
                              </label>
                              <input
                                id={`med-qty-${item.clientId}`}
                                type="text"
                                className={`rx-input ${
                                  itemError.quantity ? "rx-input-error" : ""
                                }`}
                                placeholder="e.g. 10 tablets, 1 bottle"
                                maxLength={100}
                                value={item.quantity}
                                onChange={(e) =>
                                  handleItemChange(item.clientId, "quantity", e.target.value)
                                }
                              />
                              {itemError.quantity && (
                                <span className="rx-error-text">{itemError.quantity}</span>
                              )}
                            </div>
                          </div>

                          {/* Row 3: Special Administration Instructions */}
                          <div className="rx-field-group">
                            <label
                              htmlFor={`med-inst-${item.clientId}`}
                              className="rx-field-label"
                            >
                              Administration Instructions (Optional)
                            </label>
                            <textarea
                              id={`med-inst-${item.clientId}`}
                              className={`rx-textarea rx-textarea-sm ${
                                itemError.instructions ? "rx-input-error" : ""
                              }`}
                              placeholder="e.g. Take after breakfast and dinner with water. Avoid dairy within 2 hours of ingestion."
                              maxLength={5000}
                              rows={2}
                              value={item.instructions}
                              onChange={(e) =>
                                handleItemChange(item.clientId, "instructions", e.target.value)
                              }
                            />
                            {itemError.instructions && (
                              <span className="rx-error-text">{itemError.instructions}</span>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="rx-add-bottom-row">
                  <button
                    type="button"
                    className="rx-btn-secondary"
                    onClick={handleAddMedicine}
                    disabled={items.length >= 50}
                  >
                    <Plus size={15} aria-hidden="true" />
                    <span>Add Another Medication ({items.length}/50)</span>
                  </button>
                </div>
              </section>
            </div>

            {/* Footer Actions */}
            <footer className="rx-composer-footer">
              <div className="rx-footer-note">
                <ShieldCheck size={14} className="rx-footer-icon" aria-hidden="true" />
                <span>Required fields are validated before review.</span>
              </div>
              <div className="rx-footer-actions">
                <button type="button" className="rx-btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="rx-btn-primary">
                  <Eye size={15} aria-hidden="true" />
                  <span>Review Prescription ({items.length})</span>
                </button>
              </div>
            </footer>
          </form>
        )}

        {/* ======================================================== */}
        {/* STEP 2: REVIEW MODE                                      */}
        {/* ======================================================== */}
        {step === "review" && (
          <div className="rx-composer-review">
            <div className="rx-composer-body">
              {/* Review Notification Banner */}
              <div className="rx-review-notice">
                <ShieldCheck size={20} className="rx-review-notice-icon" aria-hidden="true" />
                <div>
                  <strong className="rx-review-notice-title">
                    Clinical Prescription Draft Review
                  </strong>
                  <p className="rx-review-notice-text">
                    Verify all medication strengths, frequency schedules, and administration
                    guidance. Once submitted in the next step, digital prescriptions will be recorded in
                    the patient&apos;s medical history after successful submission.
                  </p>
                </div>
              </div>

              {/* General Notes Summary */}
              {notes.trim() && (
                <section className="rx-review-card">
                  <h4 className="rx-review-card-title">
                    <FileText size={15} aria-hidden="true" />
                    <span>Clinical Notes & General Instructions</span>
                  </h4>
                  <p className="rx-review-notes-content">{notes.trim()}</p>
                </section>
              )}

              {/* Medicines Summary */}
              <section className="rx-review-card">
                <div className="rx-review-card-header">
                  <h4 className="rx-review-card-title">
                    <Pill size={15} aria-hidden="true" />
                    <span>Prescribed Medications ({items.length})</span>
                  </h4>
                  <span className="rx-review-summary-chip">
                    {items.length} {items.length === 1 ? "Item" : "Items"}
                  </span>
                </div>

                <div className="rx-review-items-list">
                  {items.map((item, index) => (
                    <article key={item.clientId} className="rx-review-item-card">
                      <div className="rx-review-item-top">
                        <span className="rx-review-index">{index + 1}</span>
                        <div className="rx-review-item-title-wrap">
                          <h5 className="rx-review-med-name">{item.medicine_name.trim()}</h5>
                          <div className="rx-review-pill-tags">
                            <span className="rx-tag dosage">
                              Strength: <strong>{item.dosage.trim()}</strong>
                            </span>
                            <span className="rx-tag frequency">
                              Frequency: <strong>{item.frequency.trim()}</strong>
                            </span>
                            <span className="rx-tag duration">
                              Duration: <strong>{item.duration.trim()}</strong>
                            </span>
                            {item.route.trim() && (
                              <span className="rx-tag route">
                                Route: <strong>{item.route.trim()}</strong>
                              </span>
                            )}
                            {item.quantity.trim() && (
                              <span className="rx-tag quantity">
                                Quantity: <strong>{item.quantity.trim()}</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {item.instructions.trim() && (
                        <div className="rx-review-item-instructions">
                          <span className="rx-review-inst-label">Instructions:</span>
                          <span className="rx-review-inst-text">
                            {item.instructions.trim()}
                          </span>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            </div>

            {/* Review Footer */}
            <footer className="rx-composer-footer">
              <button
                type="button"
                className="rx-btn-secondary"
                onClick={() => setStep("edit")}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                <span>Back to Edit</span>
              </button>

              <div className="rx-footer-actions">
                <button type="button" className="rx-btn-ghost" onClick={onClose}>
                  Discard & Close
                </button>
                <button
                  type="button"
                  className="rx-btn-primary rx-btn-success"
                  onClick={handleConfirmReview}
                >
                  <CheckCircle2 size={15} aria-hidden="true" />
                  <span>Confirm Prescription Draft</span>
                </button>
              </div>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}


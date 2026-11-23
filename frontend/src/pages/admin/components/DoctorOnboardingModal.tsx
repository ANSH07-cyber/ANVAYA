import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileBadge,
  GraduationCap,
  IndianRupee,
  KeyRound,
  Mail,
  RefreshCw,
  Stethoscope,
  User,
  UserPlus,
  X,
} from "lucide-react";

import { adminService } from "../../../services/adminService";
import type {
  DoctorAccountCreatePayload,
  DoctorProfileRead,
} from "../../../types/admin";
import "./DoctorOnboardingModal.css";

interface DoctorOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newDoctor: DoctorProfileRead, doctorName: string) => void;
}

interface FormState {
  fullName: string;
  email: string;
  password: string;
  specialization: string;
  qualification: string;
  licenseNumber: string;
  yearsExperience: string;
  clinicName: string;
  consultationFee: string;
  bio: string;
}

const INITIAL_FORM_STATE: FormState = {
  fullName: "",
  email: "",
  password: "",
  specialization: "",
  qualification: "",
  licenseNumber: "",
  yearsExperience: "",
  clinicName: "",
  consultationFee: "",
  bio: "",
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data && typeof data === "object") {
      if ("detail" in data) {
        const detail = (data as { detail: unknown }).detail;
        if (typeof detail === "string") return detail;
        if (Array.isArray(detail)) {
          return detail
            .map((item) =>
              typeof item === "object" && item && "msg" in item
                ? String(item.msg)
                : JSON.stringify(item),
            )
            .join("; ");
        }
      }
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export default function DoctorOnboardingModal({
  isOpen,
  onClose,
  onSuccess,
}: DoctorOnboardingModalProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const fullNameInputRef = useRef<HTMLInputElement>(null);

  // Focus first input on mount
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      fullNameInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Handle Escape key and body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) {
    return null;
  }

  const handleFieldChange = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const updated = { ...prev };
        delete updated[field];
        return updated;
      });
    }
    if (serverError) {
      setServerError(null);
      setIsConflict(false);
    }
  };

  const validateForm = (): boolean => {
    const errors: FieldErrors = {};

    // 1. Full Name: 2-120 chars
    const cleanName = form.fullName.trim();
    if (!cleanName) {
      errors.fullName = "Practitioner full name is required.";
    } else if (cleanName.length < 2 || cleanName.length > 120) {
      errors.fullName = "Full name must be between 2 and 120 characters.";
    }

    // 2. Email: valid email
    const cleanEmail = form.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail) {
      errors.email = "Email address is required.";
    } else if (!emailRegex.test(cleanEmail)) {
      errors.email = "Please enter a valid email address.";
    }

    // 3. Password: 8-128 chars
    if (!form.password) {
      errors.password = "Initial password is required.";
    } else if (form.password.length < 8) {
      errors.password = "Password must be at least 8 characters.";
    } else if (form.password.length > 128) {
      errors.password = "Password cannot exceed 128 characters.";
    }

    // 4. Specialization: 2-100 chars
    const cleanSpec = form.specialization.trim();
    if (!cleanSpec) {
      errors.specialization = "Specialization is required.";
    } else if (cleanSpec.length < 2 || cleanSpec.length > 100) {
      errors.specialization = "Specialization must be between 2 and 100 characters.";
    }

    // 5. Qualification: 2-255 chars
    const cleanQual = form.qualification.trim();
    if (!cleanQual) {
      errors.qualification = "Academic qualification is required.";
    } else if (cleanQual.length < 2 || cleanQual.length > 255) {
      errors.qualification = "Qualification must be between 2 and 255 characters.";
    }

    // 6. License Number: 3-100 chars
    const cleanLicense = form.licenseNumber.trim();
    if (!cleanLicense) {
      errors.licenseNumber = "Medical council license number is required.";
    } else if (cleanLicense.length < 3 || cleanLicense.length > 100) {
      errors.licenseNumber = "License number must be between 3 and 100 characters.";
    }

    // 7. Years Experience (Optional): 0-80 integer
    if (form.yearsExperience.trim()) {
      const expNum = Number(form.yearsExperience.trim());
      if (isNaN(expNum) || !Number.isInteger(expNum) || expNum < 0 || expNum > 80) {
        errors.yearsExperience = "Experience must be a whole number between 0 and 80 years.";
      }
    }

    // 8. Clinic Name (Optional): max 200 chars
    if (form.clinicName.trim().length > 200) {
      errors.clinicName = "Clinic name cannot exceed 200 characters.";
    }

    // 9. Consultation Fee (Optional): non-negative, max 2 decimals
    if (form.consultationFee.trim()) {
      const feeNum = Number(form.consultationFee.trim());
      const feeRegex = /^\d+(\.\d{1,2})?$/;
      if (isNaN(feeNum) || feeNum < 0 || !feeRegex.test(form.consultationFee.trim())) {
        errors.consultationFee = "Consultation fee must be a non-negative number with at most 2 decimal places.";
      }
    }

    // 10. Bio (Optional): max 5000 chars
    if (form.bio.length > 5000) {
      errors.bio = "Biography cannot exceed 5000 characters.";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setIsConflict(false);

    if (!validateForm()) {
      return;
    }

    const payload: DoctorAccountCreatePayload = {
      full_name: form.fullName.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password,
      specialization: form.specialization.trim(),
      qualification: form.qualification.trim(),
      license_number: form.licenseNumber.trim(),
      years_experience: form.yearsExperience.trim()
        ? parseInt(form.yearsExperience.trim(), 10)
        : null,
      clinic_name: form.clinicName.trim() || null,
      consultation_fee: form.consultationFee.trim()
        ? parseFloat(form.consultationFee.trim())
        : null,
      bio: form.bio.trim() || null,
    };

    setIsSubmitting(true);

    try {
      const createdDoctor = await adminService.createDoctor(payload);
      onSuccess(createdDoctor, form.fullName.trim());
      onClose();
    } catch (err: unknown) {
      const isStatus409 =
        err &&
        typeof err === "object" &&
        "response" in err &&
        (err as { response?: { status?: number } }).response?.status === 409;

      if (isStatus409) {
        setIsConflict(true);
        setServerError(
          "Duplicate Account or License: A practitioner account with this email address or medical council license number already exists in the system.",
        );
      } else {
        const errorDetail = extractErrorMessage(
          err,
          "Failed to create doctor account. Please verify connectivity and administrator privileges.",
        );
        setServerError(errorDetail);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="onboarding-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-modal-title"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="onboarding-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="onboarding-modal-header">
          <div className="onboarding-header-content">
            <div className="onboarding-kicker">
              <UserPlus size={14} className="onboarding-kicker-icon" />
              <span>PRACTITIONER ONBOARDING</span>
            </div>
            <h2 id="onboarding-modal-title" className="onboarding-title">
              Onboard New Healthcare Practitioner
            </h2>
            <p className="onboarding-subtitle">
              Register medical credentials, create practitioner authentication, and record an immutable administrative audit log.
            </p>
          </div>
          <button
            type="button"
            className="onboarding-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close onboarding modal"
            title="Close modal"
          >
            <X size={20} />
          </button>
        </header>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="onboarding-form" noValidate>
          <div className="onboarding-body">
            {/* Server Error Alert */}
            {serverError && (
              <div
                className={`onboarding-alert ${isConflict ? "conflict" : "error"}`}
                role="alert"
              >
                <AlertCircle size={18} className="onboarding-alert-icon" />
                <div className="onboarding-alert-content">
                  <strong>{isConflict ? "Duplicate Record" : "Registration Failed"}</strong>
                  <p>{serverError}</p>
                </div>
              </div>
            )}

            {/* Pending Status Callout */}
            <div className="onboarding-governance-notice">
              <div className="notice-icon-wrap">
                <Clock size={16} />
              </div>
              <div className="notice-copy">
                <strong>Initial Status: PENDING REVIEW</strong>
                <p>
                  Newly registered practitioners are assigned Pending status by default. An administrator must independently review credentials and authorize clinical privileges before the practitioner can conduct consultations.
                </p>
              </div>
            </div>

            {/* Section 1: Account & Identity */}
            <section className="form-section">
              <div className="form-section-header">
                <User size={14} className="section-icon text-sky" />
                <span className="section-title">Practitioner Identity & Login Account</span>
              </div>

              <div className="form-grid-2">
                {/* Full Name */}
                <div className="form-group">
                  <label htmlFor="onboard-full-name" className="form-label">
                    <span>Full Legal Name</span>
                    <span className="badge-req">Required</span>
                  </label>
                  <input
                    id="onboard-full-name"
                    ref={fullNameInputRef}
                    type="text"
                    className={`form-input ${fieldErrors.fullName ? "has-error" : ""}`}
                    placeholder="e.g. Dr. Ramesh Gupta"
                    value={form.fullName}
                    onChange={(e) => handleFieldChange("fullName", e.target.value)}
                    disabled={isSubmitting}
                    maxLength={120}
                    autoComplete="name"
                  />
                  {fieldErrors.fullName && (
                    <span className="field-error">{fieldErrors.fullName}</span>
                  )}
                </div>

                {/* Email Address */}
                <div className="form-group">
                  <label htmlFor="onboard-email" className="form-label">
                    <span>Email Address (Login Username)</span>
                    <span className="badge-req">Required</span>
                  </label>
                  <div className="input-with-icon">
                    <Mail size={16} className="input-lead-icon" />
                    <input
                      id="onboard-email"
                      type="email"
                      className={`form-input with-lead-icon ${fieldErrors.email ? "has-error" : ""}`}
                      placeholder="practitioner@example.com"
                      value={form.email}
                      onChange={(e) => handleFieldChange("email", e.target.value)}
                      disabled={isSubmitting}
                      autoComplete="email"
                      spellCheck="false"
                    />
                  </div>
                  {fieldErrors.email && (
                    <span className="field-error">{fieldErrors.email}</span>
                  )}
                </div>
              </div>

              {/* Password */}
              <div className="form-group">
                <label htmlFor="onboard-password" className="form-label">
                  <span>Initial Password</span>
                  <span className="badge-req">Required</span>
                </label>
                <div className="input-with-icon">
                  <KeyRound size={16} className="input-lead-icon" />
                  <input
                    id="onboard-password"
                    type={showPassword ? "text" : "password"}
                    className={`form-input with-lead-icon with-tail-btn ${fieldErrors.password ? "has-error" : ""}`}
                    placeholder="Minimum 8 characters"
                    value={form.password}
                    onChange={(e) => handleFieldChange("password", e.target.value)}
                    disabled={isSubmitting}
                    autoComplete="new-password"
                    maxLength={128}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {fieldErrors.password ? (
                  <span className="field-error">{fieldErrors.password}</span>
                ) : (
                  <span className="field-hint">
                    Temporary credential. The practitioner will be prompted to reset upon initial login.
                  </span>
                )}
              </div>
            </section>

            {/* Section 2: Medical Licensure & Academic Credentials */}
            <section className="form-section">
              <div className="form-section-header">
                <FileBadge size={14} className="section-icon text-teal" />
                <span className="section-title">Medical Licensure & Academic Credentials</span>
              </div>

              <div className="form-grid-3">
                {/* License Number */}
                <div className="form-group">
                  <label htmlFor="onboard-license" className="form-label">
                    <span>Medical Council License</span>
                    <span className="badge-req">Required</span>
                  </label>
                  <input
                    id="onboard-license"
                    type="text"
                    className={`form-input font-mono ${fieldErrors.licenseNumber ? "has-error" : ""}`}
                    placeholder="e.g. MCI-2019-876543"
                    value={form.licenseNumber}
                    onChange={(e) => handleFieldChange("licenseNumber", e.target.value)}
                    disabled={isSubmitting}
                    maxLength={100}
                    spellCheck="false"
                  />
                  {fieldErrors.licenseNumber && (
                    <span className="field-error">{fieldErrors.licenseNumber}</span>
                  )}
                </div>

                {/* Specialization */}
                <div className="form-group">
                  <label htmlFor="onboard-spec" className="form-label">
                    <span>Clinical Specialization</span>
                    <span className="badge-req">Required</span>
                  </label>
                  <div className="input-with-icon">
                    <Stethoscope size={16} className="input-lead-icon" />
                    <input
                      id="onboard-spec"
                      type="text"
                      className={`form-input with-lead-icon ${fieldErrors.specialization ? "has-error" : ""}`}
                      placeholder="e.g. Cardiology"
                      value={form.specialization}
                      onChange={(e) => handleFieldChange("specialization", e.target.value)}
                      disabled={isSubmitting}
                      maxLength={100}
                    />
                  </div>
                  {fieldErrors.specialization && (
                    <span className="field-error">{fieldErrors.specialization}</span>
                  )}
                </div>

                {/* Qualification */}
                <div className="form-group">
                  <label htmlFor="onboard-qual" className="form-label">
                    <span>Academic Qualification</span>
                    <span className="badge-req">Required</span>
                  </label>
                  <div className="input-with-icon">
                    <GraduationCap size={16} className="input-lead-icon" />
                    <input
                      id="onboard-qual"
                      type="text"
                      className={`form-input with-lead-icon ${fieldErrors.qualification ? "has-error" : ""}`}
                      placeholder="e.g. MBBS, MD, DM"
                      value={form.qualification}
                      onChange={(e) => handleFieldChange("qualification", e.target.value)}
                      disabled={isSubmitting}
                      maxLength={255}
                    />
                  </div>
                  {fieldErrors.qualification && (
                    <span className="field-error">{fieldErrors.qualification}</span>
                  )}
                </div>
              </div>
            </section>

            {/* Section 3: Practice & Consultation Details (Optional) */}
            <section className="form-section">
              <div className="form-section-header">
                <Building2 size={14} className="section-icon text-amber" />
                <span className="section-title">Practice Location & Consultation Operations</span>
                <span className="section-badge-opt">Optional</span>
              </div>

              <div className="form-grid-3">
                {/* Clinical Experience */}
                <div className="form-group">
                  <label htmlFor="onboard-exp" className="form-label">
                    <span>Experience (Years)</span>
                  </label>
                  <input
                    id="onboard-exp"
                    type="number"
                    min="0"
                    max="80"
                    className={`form-input ${fieldErrors.yearsExperience ? "has-error" : ""}`}
                    placeholder="e.g. 10"
                    value={form.yearsExperience}
                    onChange={(e) => handleFieldChange("yearsExperience", e.target.value)}
                    disabled={isSubmitting}
                  />
                  {fieldErrors.yearsExperience && (
                    <span className="field-error">{fieldErrors.yearsExperience}</span>
                  )}
                </div>

                {/* Clinic Name */}
                <div className="form-group">
                  <label htmlFor="onboard-clinic" className="form-label">
                    <span>Clinic / Hospital Name</span>
                  </label>
                  <input
                    id="onboard-clinic"
                    type="text"
                    className={`form-input ${fieldErrors.clinicName ? "has-error" : ""}`}
                    placeholder="e.g. Apex Heart Institute"
                    value={form.clinicName}
                    onChange={(e) => handleFieldChange("clinicName", e.target.value)}
                    disabled={isSubmitting}
                    maxLength={200}
                  />
                  {fieldErrors.clinicName && (
                    <span className="field-error">{fieldErrors.clinicName}</span>
                  )}
                </div>

                {/* Consultation Fee */}
                <div className="form-group">
                  <label htmlFor="onboard-fee" className="form-label">
                    <span>Consultation Fee (₹ INR)</span>
                  </label>
                  <div className="input-with-icon">
                    <IndianRupee size={16} className="input-lead-icon" />
                    <input
                      id="onboard-fee"
                      type="number"
                      min="0"
                      step="0.01"
                      className={`form-input with-lead-icon ${fieldErrors.consultationFee ? "has-error" : ""}`}
                      placeholder="e.g. 800.00"
                      value={form.consultationFee}
                      onChange={(e) => handleFieldChange("consultationFee", e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                  {fieldErrors.consultationFee && (
                    <span className="field-error">{fieldErrors.consultationFee}</span>
                  )}
                </div>
              </div>

              {/* Bio */}
              <div className="form-group">
                <label htmlFor="onboard-bio" className="form-label">
                  <span>Professional Biography & Clinical Statement</span>
                  <span className="bio-counter">{form.bio.length}/5000</span>
                </label>
                <textarea
                  id="onboard-bio"
                  rows={3}
                  className={`form-textarea ${fieldErrors.bio ? "has-error" : ""}`}
                  placeholder="Clinical interests, fellowships, surgical specialties, patient care philosophy..."
                  value={form.bio}
                  onChange={(e) => handleFieldChange("bio", e.target.value)}
                  disabled={isSubmitting}
                  maxLength={5000}
                />
                {fieldErrors.bio && (
                  <span className="field-error">{fieldErrors.bio}</span>
                )}
              </div>
            </section>
          </div>

          {/* Footer Actions */}
          <footer className="onboarding-modal-footer">
            <button
              type="button"
              className="onboard-cancel-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="onboard-submit-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={16} className="spin-animation" />
                  <span>Onboarding Practitioner...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>Onboard Practitioner</span>
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

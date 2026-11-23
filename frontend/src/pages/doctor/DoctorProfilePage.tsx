import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  GraduationCap,
  IndianRupee,
  Lock,
  Mail,
  Pencil,
  RefreshCw,
  Save,
  ShieldCheck,
  Stethoscope,
  UserCheck,
  X,
} from "lucide-react";

import DoctorLayout from "../../layouts/DoctorLayout";
import { doctorService } from "../../services/doctorService";
import type {
  DoctorProfileMeResponse,
  DoctorProfileUpdatePayload,
  DoctorVerificationStatus,
} from "../../types/doctor";
import "./DoctorProfilePage.css";

interface ProfileFormData {
  full_name: string;
  specialization: string;
  qualification: string;
  years_experience: string;
  clinic_name: string;
  consultation_fee: string;
  bio: string;
}

interface FormErrors {
  full_name?: string;
  specialization?: string;
  qualification?: string;
  years_experience?: string;
  clinic_name?: string;
  consultation_fee?: string;
  bio?: string;
}

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

function formatCurrencyINR(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") {
    return "Not set";
  }
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "Not set";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(num);
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function getDoctorInitials(name: string): string {
  if (!name) return "DR";
  const cleaned = name.replace(/^dr\.?\s+/i, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDoctorDisplayName(name: string): string {
  if (!name) return "Doctor";
  const trimmed = name.trim();
  if (trimmed.toLowerCase().startsWith("dr.") || trimmed.toLowerCase().startsWith("dr ")) {
    return trimmed;
  }
  return `Dr. ${trimmed}`;
}

export default function DoctorProfilePage() {
  const [profile, setProfile] = useState<DoctorProfileMeResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Edit Mode state
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [formData, setFormData] = useState<ProfileFormData>({
    full_name: "",
    specialization: "",
    qualification: "",
    years_experience: "",
    clinic_name: "",
    consultation_fee: "",
    bio: "",
  });
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Top Action alert banner
  const [actionAlert, setActionAlert] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Populate form from profile data
  const initFormData = useCallback((p: DoctorProfileMeResponse): ProfileFormData => {
    return {
      full_name: p.full_name || "",
      specialization: p.specialization || "",
      qualification: p.qualification || "",
      years_experience: p.years_experience !== null ? String(p.years_experience) : "",
      clinic_name: p.clinic_name || "",
      consultation_fee: p.consultation_fee !== null ? String(p.consultation_fee) : "",
      bio: p.bio || "",
    };
  }, []);

  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    setGeneralError(null);
    try {
      const data = await doctorService.getDoctorProfile();
      setProfile(data);
      setFormData(initFormData(data));
    } catch (err: unknown) {
      setGeneralError(
        extractErrorMessage(
          err,
          "Unable to load medical practice profile. Please check connection and try again.",
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }, [initFormData]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const data = await doctorService.getDoctorProfile();
        if (isMounted) {
          setProfile(data);
          setFormData(initFormData(data));
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setGeneralError(
          extractErrorMessage(
            err,
            "Unable to load medical practice profile. Please check connection and try again.",
          ),
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      isMounted = false;
    };
  }, [initFormData]);

  // Validation function matching backend Pydantic schema constraints
  const validate = useCallback((data: ProfileFormData): FormErrors => {
    const errors: FormErrors = {};

    // full_name: min 2, max 120
    const nameTrimmed = data.full_name.trim();
    if (!nameTrimmed) {
      errors.full_name = "Full name is required (2–120 characters)";
    } else if (nameTrimmed.length < 2) {
      errors.full_name = "Full name must be at least 2 characters";
    } else if (nameTrimmed.length > 120) {
      errors.full_name = "Full name cannot exceed 120 characters";
    }

    // specialization: min 2, max 100
    const specTrimmed = data.specialization.trim();
    if (!specTrimmed) {
      errors.specialization = "Specialization is required (2–100 characters)";
    } else if (specTrimmed.length < 2) {
      errors.specialization = "Specialization must be at least 2 characters";
    } else if (specTrimmed.length > 100) {
      errors.specialization = "Specialization cannot exceed 100 characters";
    }

    // qualification: min 2, max 255
    const qualTrimmed = data.qualification.trim();
    if (!qualTrimmed) {
      errors.qualification = "Medical qualification is required (2–255 characters)";
    } else if (qualTrimmed.length < 2) {
      errors.qualification = "Qualification must be at least 2 characters";
    } else if (qualTrimmed.length > 255) {
      errors.qualification = "Qualification cannot exceed 255 characters";
    }

    // years_experience: optional int 0 <= x <= 80
    if (data.years_experience.trim() !== "") {
      const expNum = Number(data.years_experience.trim());
      if (
        isNaN(expNum) ||
        !Number.isInteger(expNum) ||
        expNum < 0 ||
        expNum > 80
      ) {
        errors.years_experience = "Experience must be a whole number between 0 and 80 years";
      }
    }

    // clinic_name: optional max 200
    if (data.clinic_name.trim().length > 200) {
      errors.clinic_name = "Clinic name cannot exceed 200 characters";
    }

    // consultation_fee: optional decimal >= 0, at most two decimal places
    if (data.consultation_fee.trim() !== "") {
      const feeTrimmed = data.consultation_fee.trim();
      const feeNum = Number(feeTrimmed);
      if (isNaN(feeNum) || feeNum < 0) {
        errors.consultation_fee = "Consultation fee must be a non-negative number";
      } else if (!/^\d+(\.\d{1,2})?$/.test(feeTrimmed)) {
        errors.consultation_fee = "Consultation fee can have at most two decimal places";
      }
    }

    // bio: optional max 5000
    if (data.bio.length > 5000) {
      errors.bio = "Biography cannot exceed 5000 characters";
    }

    return errors;
  }, []);

  // Dirty check: has any field changed compared to original profile?
  const isDirty = useMemo(() => {
    if (!profile) return false;
    const initial = initFormData(profile);
    return (
      formData.full_name !== initial.full_name ||
      formData.specialization !== initial.specialization ||
      formData.qualification !== initial.qualification ||
      formData.years_experience !== initial.years_experience ||
      formData.clinic_name !== initial.clinic_name ||
      formData.consultation_fee !== initial.consultation_fee ||
      formData.bio !== initial.bio
    );
  }, [formData, profile, initFormData]);

  const handleFieldChange = (field: keyof ProfileFormData, value: string) => {
    const updated = { ...formData, [field]: value };
    setFormData(updated);
    if (touchedFields[field]) {
      const errs = validate(updated);
      setFormErrors(errs);
    }
  };

  const handleFieldBlur = (field: keyof ProfileFormData) => {
    setTouchedFields((prev) => ({ ...prev, [field]: true }));
    const errs = validate(formData);
    setFormErrors(errs);
  };

  const handleEnterEditMode = () => {
    if (!profile) return;
    setFormData(initFormData(profile));
    setFormErrors({});
    setTouchedFields({});
    setActionAlert(null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (isDirty) {
      const confirmDiscard = window.confirm(
        "You have unsaved changes to your practice profile. Discard them?",
      );
      if (!confirmDiscard) return;
    }
    if (profile) {
      setFormData(initFormData(profile));
    }
    setFormErrors({});
    setTouchedFields({});
    setIsEditing(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    // Validate all fields
    const errors = validate(formData);
    setFormErrors(errors);
    setTouchedFields({
      full_name: true,
      specialization: true,
      qualification: true,
      years_experience: true,
      clinic_name: true,
      consultation_fee: true,
      bio: true,
    });

    if (Object.keys(errors).length > 0) {
      setActionAlert({
        type: "error",
        message: "Please correct the highlighted validation errors before saving.",
      });
      return;
    }

    setIsSubmitting(true);
    setActionAlert(null);

    // Build payload matching DoctorProfileUpdate
    const payload: DoctorProfileUpdatePayload = {
      full_name: formData.full_name.trim(),
      specialization: formData.specialization.trim(),
      qualification: formData.qualification.trim(),
      years_experience:
        formData.years_experience.trim() === ""
          ? null
          : parseInt(formData.years_experience.trim(), 10),
      clinic_name:
        formData.clinic_name.trim() === ""
          ? null
          : formData.clinic_name.trim(),
      consultation_fee:
        formData.consultation_fee.trim() === ""
          ? null
          : parseFloat(formData.consultation_fee.trim()),
      bio: formData.bio.trim() === "" ? null : formData.bio.trim(),
    };

    try {
      const updatedProfile = await doctorService.updateDoctorProfile(payload);
      setProfile(updatedProfile);
      setFormData(initFormData(updatedProfile));
      setIsEditing(false);
      setActionAlert({
        type: "success",
        message: "Medical practice profile updated successfully.",
      });
    } catch (err: unknown) {
      setActionAlert({
        type: "error",
        message: extractErrorMessage(
          err,
          "Failed to update profile. Please verify your details and try again.",
        ),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStatusBanner = (status: DoctorVerificationStatus) => {
    switch (status) {
      case "approved":
        return (
          <div className="doc-profile-status-banner approved" role="status">
            <div className="doc-profile-status-icon">
              <ShieldCheck size={22} />
            </div>
            <div className="doc-profile-status-content">
              <h3 className="doc-profile-status-title">Verified Medical Practitioner</h3>
              <p className="doc-profile-status-desc">
                Your medical registration and professional credentials have been verified by
                clinical administration. Your practice profile is active and eligible for patient
                scheduling and electronic prescriptions.
              </p>
            </div>
          </div>
        );
      case "pending":
        return (
          <div className="doc-profile-status-banner pending" role="status">
            <div className="doc-profile-status-icon">
              <Clock size={22} />
            </div>
            <div className="doc-profile-status-content">
              <h3 className="doc-profile-status-title">Credential Verification In Review</h3>
              <p className="doc-profile-status-desc">
                Your medical license and practitioner credentials are currently under administrative
                review. You may update practice details below, but patient booking availability
                remains restricted until verification is complete.
              </p>
            </div>
          </div>
        );
      case "rejected":
        return (
          <div className="doc-profile-status-banner rejected" role="alert">
            <div className="doc-profile-status-icon">
              <AlertCircle size={22} />
            </div>
            <div className="doc-profile-status-content">
              <h3 className="doc-profile-status-title">Credential Verification Required</h3>
              <p className="doc-profile-status-desc">
                Your medical credentials could not be validated by administrative compliance.
                Please contact the healthcare administration office or review your registration
                details.
              </p>
            </div>
          </div>
        );
    }
  };

  const renderStatusBadge = (status: DoctorVerificationStatus) => {
    switch (status) {
      case "approved":
        return (
          <span className="doc-profile-badge approved">
            <ShieldCheck size={12} />
            Verified
          </span>
        );
      case "pending":
        return (
          <span className="doc-profile-badge pending">
            <Clock size={12} />
            Pending Review
          </span>
        );
      case "rejected":
        return (
          <span className="doc-profile-badge rejected">
            <AlertCircle size={12} />
            Rejected
          </span>
        );
    }
  };

  return (
    <DoctorLayout title="Practice Profile">
      <div className="doc-profile-container">
        {/* Top Header & Context */}
        <header className="doc-profile-header">
          <div className="doc-profile-title-group">
            <span className="doc-profile-kicker">
              <Stethoscope size={13} />
              Professional Practice
            </span>
            <h1 className="doc-profile-title">Practice Profile & Credentials</h1>
            <p className="doc-profile-subtitle">
              Manage your verified medical profile, clinical specialization, qualifications, and
              consultation parameters.
            </p>
          </div>

          <div className="doc-profile-header-actions">
            {!isLoading && profile && !isEditing && (
              <button
                type="button"
                className="doc-btn doc-btn-primary"
                onClick={handleEnterEditMode}
              >
                <Pencil size={15} />
                Edit Profile
              </button>
            )}
            {!isLoading && (
              <button
                type="button"
                className="doc-btn doc-btn-outline"
                onClick={fetchProfile}
                title="Refresh profile"
              >
                <RefreshCw size={15} />
                Refresh
              </button>
            )}
          </div>
        </header>

        {/* Global Action Alert (Save success / error) */}
        {actionAlert && (
          <div className={`doc-profile-alert ${actionAlert.type}`} role="alert">
            <div className="doc-profile-alert-body">
              {actionAlert.type === "success" ? (
                <CheckCircle2 size={18} />
              ) : (
                <AlertTriangle size={18} />
              )}
              <span>{actionAlert.message}</span>
            </div>
            <button
              type="button"
              className="doc-profile-alert-close"
              onClick={() => setActionAlert(null)}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="doc-profile-container">
            <div className="doc-skeleton doc-skeleton-hero" />
            <div className="doc-profile-grid">
              <div className="doc-profile-col-8">
                <div className="doc-skeleton doc-skeleton-card" />
              </div>
              <div className="doc-profile-col-4">
                <div className="doc-skeleton doc-skeleton-card" />
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {!isLoading && generalError && !profile && (
          <div className="doc-profile-error-container" role="alert">
            <AlertCircle size={44} className="doc-profile-error-icon" />
            <h2 className="doc-profile-error-title">Unable to Load Practice Profile</h2>
            <p className="doc-profile-error-msg">{generalError}</p>
            <button
              type="button"
              className="doc-btn doc-btn-primary"
              onClick={fetchProfile}
            >
              <RefreshCw size={16} />
              Try Again
            </button>
          </div>
        )}

        {/* Content: View Mode or Edit Mode */}
        {!isLoading && profile && (
          <>
            {/* Regulatory Status Banner */}
            {renderStatusBanner(profile.verification_status)}

            {!isEditing ? (
              /* ==========================================================
                 VIEW MODE
                 ========================================================== */
              <>
                {/* Doctor Identity Hero Card */}
                <section className="doc-profile-hero-card" aria-label="Practitioner Identity">
                  <div className="doc-profile-identity">
                    <div className="doc-profile-avatar" aria-hidden="true">
                      {getDoctorInitials(profile.full_name)}
                    </div>
                    <div className="doc-profile-name-group">
                      <div className="doc-profile-name-row">
                        <h2 className="doc-profile-name">
                          {formatDoctorDisplayName(profile.full_name)}
                        </h2>
                        {renderStatusBadge(profile.verification_status)}
                      </div>
                      <p className="doc-profile-specialization-text">
                        {profile.specialization}
                      </p>
                      <p className="doc-profile-qualification-text">
                        {profile.qualification}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="doc-btn doc-btn-primary"
                    onClick={handleEnterEditMode}
                  >
                    <Pencil size={15} />
                    Edit Profile
                  </button>
                </section>

                {/* Information Grid */}
                <div className="doc-profile-grid">
                  {/* Left Column (8 cols): Practice & Bio */}
                  <div className="doc-profile-col-8">
                    {/* Clinical Practice Details */}
                    <article className="doc-profile-card">
                      <div className="doc-profile-card-header">
                        <div className="doc-profile-card-title-group">
                          <span className="doc-profile-card-icon">
                            <Stethoscope size={18} />
                          </span>
                          <h3 className="doc-profile-card-title">Clinical Practice Details</h3>
                        </div>
                      </div>

                      <div className="doc-profile-info-grid">
                        <div className="doc-profile-info-item">
                          <span className="doc-profile-label">
                            <Award size={13} /> Specialization
                          </span>
                          <span className="doc-profile-value highlight">
                            {profile.specialization}
                          </span>
                        </div>

                        <div className="doc-profile-info-item">
                          <span className="doc-profile-label">
                            <GraduationCap size={13} /> Medical Qualification
                          </span>
                          <span className="doc-profile-value">
                            {profile.qualification}
                          </span>
                        </div>

                        <div className="doc-profile-info-item">
                          <span className="doc-profile-label">
                            <Clock size={13} /> Clinical Experience
                          </span>
                          <span className="doc-profile-value">
                            {profile.years_experience !== null
                              ? `${profile.years_experience} years of clinical practice`
                              : "Not specified"}
                          </span>
                        </div>

                        <div className="doc-profile-info-item">
                          <span className="doc-profile-label">
                            <Building2 size={13} /> Clinic / Hospital Location
                          </span>
                          <span className="doc-profile-value">
                            {profile.clinic_name || (
                              <span className="muted">Not specified</span>
                            )}
                          </span>
                        </div>

                        <div className="doc-profile-info-item full-width">
                          <span className="doc-profile-label">
                            <IndianRupee size={13} /> Consultation Fee
                          </span>
                          <span className="doc-profile-value highlight">
                            {formatCurrencyINR(profile.consultation_fee)}
                          </span>
                        </div>
                      </div>
                    </article>

                    {/* Professional Biography */}
                    <article className="doc-profile-card">
                      <div className="doc-profile-card-header">
                        <div className="doc-profile-card-title-group">
                          <span className="doc-profile-card-icon">
                            <UserCheck size={18} />
                          </span>
                          <h3 className="doc-profile-card-title">Professional Biography</h3>
                        </div>
                      </div>

                      {profile.bio ? (
                        <p className="doc-profile-bio-text">{profile.bio}</p>
                      ) : (
                        <p className="doc-profile-bio-empty">
                          No professional biography provided yet. Click &quot;Edit Profile&quot; to add a
                          summary of your clinical expertise, special interests, and patient care
                          philosophy.
                        </p>
                      )}
                    </article>
                  </div>

                  {/* Right Column (4 cols): Regulatory Identity & Compliance */}
                  <div className="doc-profile-col-4">
                    <article className="doc-profile-card">
                      <div className="doc-profile-card-header">
                        <div className="doc-profile-card-title-group">
                          <span className="doc-profile-card-icon">
                            <ShieldCheck size={18} />
                          </span>
                          <h3 className="doc-profile-card-title">Regulatory Credentials</h3>
                        </div>
                      </div>

                      <div className="doc-compliance-notice">
                        <Lock size={15} className="doc-compliance-notice-icon" />
                        <div>
                          Medical license and core account identifiers are protected under medical
                          compliance. Modifications require administrative re-verification.
                        </div>
                      </div>

                      <div className="doc-compliance-list">
                        <div className="doc-compliance-item">
                          <div className="doc-compliance-label-row">
                            <span className="doc-profile-label">
                              <ShieldCheck size={12} /> Medical License
                            </span>
                            <span className="doc-lock-tag">
                              <Lock size={10} /> Immutable
                            </span>
                          </div>
                          <span className="doc-mono-val">{profile.license_number}</span>
                        </div>

                        <div className="doc-compliance-item">
                          <div className="doc-compliance-label-row">
                            <span className="doc-profile-label">
                              <Mail size={12} /> Primary Account Email
                            </span>
                            <span className="doc-lock-tag">
                              <Lock size={10} /> Locked
                            </span>
                          </div>
                          <span className="doc-mono-val">{profile.email}</span>
                        </div>

                        <div className="doc-compliance-item">
                          <div className="doc-compliance-label-row">
                            <span className="doc-profile-label">
                              <UserCheck size={12} /> System Doctor ID
                            </span>
                          </div>
                          <span className="doc-mono-val">{profile.id}</span>
                        </div>

                        <div className="doc-compliance-item">
                          <div className="doc-compliance-label-row">
                            <span className="doc-profile-label">
                              <Calendar size={12} /> Registration Date
                            </span>
                          </div>
                          <span className="doc-profile-value" style={{ fontSize: "0.85rem" }}>
                            {formatDateTime(profile.created_at)}
                          </span>
                        </div>

                        <div className="doc-compliance-item">
                          <div className="doc-compliance-label-row">
                            <span className="doc-profile-label">
                              <Clock size={12} /> Last Updated
                            </span>
                          </div>
                          <span className="doc-profile-value" style={{ fontSize: "0.85rem" }}>
                            {formatDateTime(profile.updated_at)}
                          </span>
                        </div>
                      </div>
                    </article>
                  </div>
                </div>
              </>
            ) : (
              /* ==========================================================
                 EDIT MODE
                 ========================================================== */
              <form className="doc-edit-container" onSubmit={handleSubmit} noValidate>
                {/* Edit Sticky Action Bar */}
                <div className="doc-edit-bar">
                  <div className="doc-edit-bar-title">
                    <Pencil size={18} />
                    <span>Editing Medical Practice Profile</span>
                  </div>
                  <div className="doc-edit-bar-actions">
                    <button
                      type="button"
                      className="doc-btn doc-btn-ghost"
                      onClick={handleCancelEdit}
                      disabled={isSubmitting}
                    >
                      <X size={15} />
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="doc-btn doc-btn-primary"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw size={15} className="spinner" />
                          Saving Changes...
                        </>
                      ) : (
                        <>
                          <Save size={15} />
                          Save Changes
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Editable Fields Card */}
                <div className="doc-form-card">
                  <h2 className="doc-form-section-title">Practitioner Details</h2>

                  <div className="doc-form-grid">
                    {/* Full Name */}
                    <div className="doc-form-field">
                      <label htmlFor="full_name" className="doc-form-label">
                        <span>
                          Full Name <span className="required">*</span>
                        </span>
                      </label>
                      <input
                        id="full_name"
                        type="text"
                        className={`doc-form-input ${
                          touchedFields.full_name && formErrors.full_name ? "has-error" : ""
                        }`}
                        value={formData.full_name}
                        onChange={(e) => handleFieldChange("full_name", e.target.value)}
                        onBlur={() => handleFieldBlur("full_name")}
                        placeholder="e.g. Dr. Jane Doe"
                        maxLength={120}
                        disabled={isSubmitting}
                        required
                      />
                      <div className="doc-form-field-info">
                        {touchedFields.full_name && formErrors.full_name ? (
                          <span className="doc-form-field-error">
                            <AlertCircle size={12} /> {formErrors.full_name}
                          </span>
                        ) : (
                          <span>Your full legal or professional name (2–120 characters)</span>
                        )}
                      </div>
                    </div>

                    {/* Specialization */}
                    <div className="doc-form-field">
                      <label htmlFor="specialization" className="doc-form-label">
                        <span>
                          Specialization <span className="required">*</span>
                        </span>
                      </label>
                      <input
                        id="specialization"
                        type="text"
                        className={`doc-form-input ${
                          touchedFields.specialization && formErrors.specialization ? "has-error" : ""
                        }`}
                        value={formData.specialization}
                        onChange={(e) => handleFieldChange("specialization", e.target.value)}
                        onBlur={() => handleFieldBlur("specialization")}
                        placeholder="e.g. Cardiology, Dermatology"
                        maxLength={100}
                        disabled={isSubmitting}
                        required
                      />
                      <div className="doc-form-field-info">
                        {touchedFields.specialization && formErrors.specialization ? (
                          <span className="doc-form-field-error">
                            <AlertCircle size={12} /> {formErrors.specialization}
                          </span>
                        ) : (
                          <span>Primary medical field (2–100 characters)</span>
                        )}
                      </div>
                    </div>

                    {/* Qualification */}
                    <div className="doc-form-field">
                      <label htmlFor="qualification" className="doc-form-label">
                        <span>
                          Medical Qualification <span className="required">*</span>
                        </span>
                      </label>
                      <input
                        id="qualification"
                        type="text"
                        className={`doc-form-input ${
                          touchedFields.qualification && formErrors.qualification ? "has-error" : ""
                        }`}
                        value={formData.qualification}
                        onChange={(e) => handleFieldChange("qualification", e.target.value)}
                        onBlur={() => handleFieldBlur("qualification")}
                        placeholder="e.g. MBBS, MD - Internal Medicine"
                        maxLength={255}
                        disabled={isSubmitting}
                        required
                      />
                      <div className="doc-form-field-info">
                        {touchedFields.qualification && formErrors.qualification ? (
                          <span className="doc-form-field-error">
                            <AlertCircle size={12} /> {formErrors.qualification}
                          </span>
                        ) : (
                          <span>Conferred medical degrees & board certifications (2–255 characters)</span>
                        )}
                      </div>
                    </div>

                    {/* Years of Experience */}
                    <div className="doc-form-field">
                      <label htmlFor="years_experience" className="doc-form-label">
                        <span>Years of Experience</span>
                      </label>
                      <input
                        id="years_experience"
                        type="number"
                        min="0"
                        max="80"
                        step="1"
                        className={`doc-form-input ${
                          touchedFields.years_experience && formErrors.years_experience ? "has-error" : ""
                        }`}
                        value={formData.years_experience}
                        onChange={(e) => handleFieldChange("years_experience", e.target.value)}
                        onBlur={() => handleFieldBlur("years_experience")}
                        placeholder="e.g. 10"
                        disabled={isSubmitting}
                      />
                      <div className="doc-form-field-info">
                        {touchedFields.years_experience && formErrors.years_experience ? (
                          <span className="doc-form-field-error">
                            <AlertCircle size={12} /> {formErrors.years_experience}
                          </span>
                        ) : (
                          <span>Total years of active clinical practice (0–80)</span>
                        )}
                      </div>
                    </div>

                    {/* Clinic Name */}
                    <div className="doc-form-field">
                      <label htmlFor="clinic_name" className="doc-form-label">
                        <span>Clinic / Hospital Name</span>
                      </label>
                      <input
                        id="clinic_name"
                        type="text"
                        className={`doc-form-input ${
                          touchedFields.clinic_name && formErrors.clinic_name ? "has-error" : ""
                        }`}
                        value={formData.clinic_name}
                        onChange={(e) => handleFieldChange("clinic_name", e.target.value)}
                        onBlur={() => handleFieldBlur("clinic_name")}
                        placeholder="e.g. Apollo Hospital or City Heart Clinic"
                        maxLength={200}
                        disabled={isSubmitting}
                      />
                      <div className="doc-form-field-info">
                        {touchedFields.clinic_name && formErrors.clinic_name ? (
                          <span className="doc-form-field-error">
                            <AlertCircle size={12} /> {formErrors.clinic_name}
                          </span>
                        ) : (
                          <span>Primary clinical practice location (max 200 characters)</span>
                        )}
                      </div>
                    </div>

                    {/* Consultation Fee */}
                    <div className="doc-form-field">
                      <label htmlFor="consultation_fee" className="doc-form-label">
                        <span>Consultation Fee (₹ INR)</span>
                      </label>
                      <input
                        id="consultation_fee"
                        type="number"
                        min="0"
                        step="0.01"
                        className={`doc-form-input ${
                          touchedFields.consultation_fee && formErrors.consultation_fee ? "has-error" : ""
                        }`}
                        value={formData.consultation_fee}
                        onChange={(e) => handleFieldChange("consultation_fee", e.target.value)}
                        onBlur={() => handleFieldBlur("consultation_fee")}
                        placeholder="e.g. 500.00"
                        disabled={isSubmitting}
                      />
                      <div className="doc-form-field-info">
                        {touchedFields.consultation_fee && formErrors.consultation_fee ? (
                          <span className="doc-form-field-error">
                            <AlertCircle size={12} /> {formErrors.consultation_fee}
                          </span>
                        ) : (
                          <span>Standard consultation charge per scheduled visit</span>
                        )}
                      </div>
                    </div>

                    {/* Professional Biography */}
                    <div className="doc-form-field full-width">
                      <div className="doc-form-label">
                        <span>Professional Biography</span>
                        <span
                          className={`doc-char-count ${
                            formData.bio.length > 4800
                              ? "limit-near"
                              : formData.bio.length >= 5000
                              ? "limit-reached"
                              : ""
                          }`}
                        >
                          {formData.bio.length} / 5000 characters
                        </span>
                      </div>
                      <textarea
                        id="bio"
                        className={`doc-form-input doc-form-textarea ${
                          touchedFields.bio && formErrors.bio ? "has-error" : ""
                        }`}
                        value={formData.bio}
                        onChange={(e) => handleFieldChange("bio", e.target.value)}
                        onBlur={() => handleFieldBlur("bio")}
                        placeholder="Describe your medical background, research interests, special expertise, and approach to patient care..."
                        maxLength={5000}
                        rows={6}
                        disabled={isSubmitting}
                      />
                      <div className="doc-form-field-info">
                        {touchedFields.bio && formErrors.bio ? (
                          <span className="doc-form-field-error">
                            <AlertCircle size={12} /> {formErrors.bio}
                          </span>
                        ) : (
                          <span>
                            Visible to patients on your booking overview. Max 5000 characters.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Locked Compliance Panel in Edit Mode */}
                  <div className="doc-locked-fields-panel">
                    <div className="doc-locked-fields-header">
                      <Lock size={16} />
                      <span>Regulatory Identifiers (Locked for Compliance)</span>
                    </div>

                    <div className="doc-form-grid">
                      <div className="doc-form-field">
                        <label htmlFor="locked_license" className="doc-form-label">
                          <span>Medical License Number</span>
                          <span className="doc-lock-tag">
                            <Lock size={10} /> Locked
                          </span>
                        </label>
                        <input
                          id="locked_license"
                          type="text"
                          className="doc-form-input"
                          value={profile.license_number}
                          disabled
                        />
                      </div>

                      <div className="doc-form-field">
                        <label htmlFor="locked_email" className="doc-form-label">
                          <span>Primary Email</span>
                          <span className="doc-lock-tag">
                            <Lock size={10} /> Locked
                          </span>
                        </label>
                        <input
                          id="locked_email"
                          type="text"
                          className="doc-form-input"
                          value={profile.email}
                          disabled
                        />
                      </div>
                    </div>
                  </div>

                  {/* Form Actions Footer */}
                  <div className="doc-form-footer">
                    <button
                      type="button"
                      className="doc-btn doc-btn-ghost"
                      onClick={handleCancelEdit}
                      disabled={isSubmitting}
                    >
                      <X size={15} />
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="doc-btn doc-btn-primary"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw size={15} className="spinner" />
                          Saving Changes...
                        </>
                      ) : (
                        <>
                          <Save size={15} />
                          Save Changes
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </DoctorLayout>
  );
}


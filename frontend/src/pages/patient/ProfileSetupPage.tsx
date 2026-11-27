import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  HeartPulse,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import { patientReadError } from "../../services/patientReliability";
import { patientService } from "../../services/patientService";
import type {
  PatientProfileUpdate,
} from "../../types/patient";
import "./ProfileSetup.css";

type ProfileForm = {
  date_of_birth: string;
  phone_number: string;
  gender: string;
  blood_group: string;
  address: string;
};

const emptyForm: ProfileForm = {
  date_of_birth: "",
  phone_number: "",
  gender: "",
  blood_group: "",
  address: "",
};

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
  }

  return "Unable to save your profile. Please try again.";
}

export default function ProfileSetupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const profile = await patientService.getMyProfile();

        if (!active) return;

        setForm({
          date_of_birth: profile.date_of_birth ?? "",
          phone_number: profile.phone_number ?? "",
          gender: profile.gender ?? "",
          blood_group: profile.blood_group ?? "",
          address: profile.address ?? "",
        });
      } catch (err) {
        if (!active) return;

        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setForm(emptyForm);
        } else {
          setLoadError(patientReadError(err, "your profile"));
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [loadRevision]);

  const updateField = (field: keyof ProfileForm, value: string) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
    setError("");
    setSuccess(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || loadError || isSaving) return;
    setError("");
    setSuccess(false);
    setIsSaving(true);

    const payload: PatientProfileUpdate = {
      date_of_birth: form.date_of_birth || null,
      phone_number: form.phone_number.trim() || null,
      gender: form.gender || null,
      blood_group: form.blood_group || null,
      address: form.address.trim() || null,
    };

    try {
      await patientService.updateMyProfile(payload);
      setSuccess(true);

      navigate("/patient", {
        replace: true,
        state: { profileCompleted: true },
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const displayName = user?.full_name || "Patient";

  return (
    <div className="profile-setup-page">
      <header className="profile-setup-header">
        <Link to="/patient" className="profile-brand">
          <span className="profile-brand-icon">
            <HeartPulse size={22} />
          </span>
          <strong>anvaya<span>.</span></strong>
        </Link>

        <div className="profile-user">
          <div className="profile-user-avatar">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <strong>{displayName}</strong>
            <small>Patient account</small>
          </div>
        </div>
      </header>

      <main className="profile-setup-content">
        <section className="profile-intro">
          <span className="profile-kicker">PATIENT ONBOARDING</span>

          <div className="profile-intro-icon">
            <UserRound size={27} />
          </div>

          <h1>Let's get to know you better.</h1>

          <p>
            Add a few details to complete your patient profile.
            This helps organize your healthcare information in one place.
          </p>

          <div className="profile-intro-note">
            <ShieldCheck size={19} />
            <span>
              Your profile information is accessible through authenticated
              account access.
            </span>
          </div>

          <div className="profile-step-indicator">
            <span className="profile-step-active">01</span>
            <div>
              <strong>Personal profile</strong>
              <small>Basic information and contact details</small>
            </div>
          </div>
        </section>

        <section className="profile-form-card">
          <div className="profile-form-heading">
            <span>YOUR INFORMATION</span>
            <h2>Patient profile</h2>
            <p>Fields marked with an asterisk are required only when applicable.</p>
          </div>

          {error && (
            <div className="profile-message profile-message-error" role="alert">
              {error}
            </div>
          )}

          {success && (
            <div className="profile-message profile-message-success">
              <CheckCircle2 size={17} />
              Profile saved successfully.
            </div>
          )}

          {isLoading ? (
            <div className="profile-loading">
              <div className="auth-loading-spinner" />
              <span>Loading your profile...</span>
            </div>
          ) : loadError ? (
            <div className="profile-message profile-message-error" role="alert">
              <p>{loadError}</p>
              <button type="button" onClick={() => {
                setLoadError("");
                setIsLoading(true);
                setLoadRevision((revision) => revision + 1);
              }}>Retry profile</button>
            </div>
          ) : (
            <form className="profile-form" onSubmit={handleSubmit}>
              <div className="profile-field-grid">
                <div className="profile-field">
                  <label htmlFor="profile-dob">
                    <CalendarDays size={15} />
                    Date of birth
                  </label>
                  <input
                    id="profile-dob"
                    type="date"
                    value={form.date_of_birth}
                    onChange={(event) =>
                      updateField("date_of_birth", event.target.value)
                    }
                  />
                </div>

                <div className="profile-field">
                  <label htmlFor="profile-phone">
                    <Phone size={15} />
                    Phone number
                  </label>
                  <input
                    id="profile-phone"
                    type="tel"
                    maxLength={20}
                    placeholder="Enter your phone number"
                    value={form.phone_number}
                    onChange={(event) =>
                      updateField("phone_number", event.target.value)
                    }
                  />
                </div>

                <div className="profile-field">
                  <label htmlFor="profile-gender">
                    <UserRound size={15} />
                    Gender
                  </label>
                  <select
                    id="profile-gender"
                    value={form.gender}
                    onChange={(event) =>
                      updateField("gender", event.target.value)
                    }
                  >
                    <option value="">Select gender</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Non-binary">Non-binary</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>

                <div className="profile-field">
                  <label htmlFor="profile-blood">
                    <HeartPulse size={15} />
                    Blood group
                  </label>
                  <select
                    id="profile-blood"
                    value={form.blood_group}
                    onChange={(event) =>
                      updateField("blood_group", event.target.value)
                    }
                  >
                    <option value="">Select blood group</option>
                    {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(
                      (group) => (
                        <option value={group} key={group}>
                          {group}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                <div className="profile-field profile-field-full">
                  <label htmlFor="profile-address">
                    <MapPin size={15} />
                    Residential address
                  </label>
                  <textarea
                    id="profile-address"
                    rows={3}
                    maxLength={2000}
                    placeholder="Enter your residential address"
                    value={form.address}
                    onChange={(event) =>
                      updateField("address", event.target.value)
                    }
                  />
                </div>
              </div>

              <div className="profile-form-footer">
                <span>
                  You can update these details later from your profile.
                </span>

                <button
                  type="submit"
                  className="profile-save-button"
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save profile"}
                  {!isSaving && <ArrowRight size={17} />}
                </button>
              </div>
            </form>
          )}
        </section>
      </main>

      <footer className="profile-setup-footer">
        <ShieldCheck size={15} />
        <span>Anvaya · Your healthcare information, thoughtfully organized</span>
      </footer>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  ArrowRight,
  Eye,
  EyeOff,
  HeartPulse,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import { getRoleHomePath } from "../../utils/roleUtils";
import { isFirebaseConfigured } from "../../services/firebase";
import { patientService } from "../../services/patientService";
import type { RegisterRequest } from "../../types/auth";
import "./AuthPages.css";

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;

    if (typeof detail === "string") return detail;

    if (Array.isArray(detail)) {
      return detail
        .map((item: { msg?: string }) => item.msg ?? "Invalid input")
        .join(". ");
    }
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;

    if (code === "auth/popup-closed-by-user") {
      return "Google sign-in was cancelled.";
    }

    if (code === "auth/popup-blocked") {
      return "Your browser blocked the Google sign-in popup.";
    }

    if (code === "auth/unauthorized-domain") {
      return "This domain is not authorized for Google sign-in.";
    }
  }

  return "Unable to create your account right now. Please try again.";
}

export default function RegisterPage() {
  const { user, isLoading, register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState<RegisterRequest>({
    full_name: "",
    email: "",
    password: "",
  });

  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  if (isLoading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
        <span>Preparing your Anvaya workspace...</span>
      </div>
    );
  }

  if (user && !isSubmitting && !isGoogleSubmitting) {
    return <Navigate to={getRoleHomePath(user.role)} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (form.password.length < 8) {
      setError("Your password must contain at least 8 characters.");
      return;
    }

    if (form.password !== confirmPassword) {
      setError("Your passwords do not match. Please check and try again.");
      return;
    }

    try {
      const registeredUser = await register({
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });

      navigate(
        registeredUser.role === "patient"
          ? "/patient/profile-setup"
          : getRoleHomePath(registeredUser.role),
        { replace: true },
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setIsGoogleSubmitting(true);

    try {
      const authenticatedUser = await loginWithGoogle();

      let destination = getRoleHomePath(authenticatedUser.role);

      if (authenticatedUser.role === "patient") {
        try {
          await patientService.getMyProfile();
          destination = "/patient";
        } catch (profileError) {
          if (
            axios.isAxiosError(profileError) &&
            profileError.response?.status === 404
          ) {
            destination = "/patient/profile-setup";
          } else {
            destination = "/patient";
          }
        }
      }

      navigate(destination, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <aside className="auth-visual">
        <div className="auth-brand">
          <span className="auth-brand-icon">
            <HeartPulse size={23} />
          </span>
          <span>anvaya<span className="auth-brand-dot">.</span></span>
        </div>

        <div className="auth-visual-copy">
          <span className="auth-eyebrow">A BETTER WAY TO MANAGE YOUR HEALTH</span>
          <h1>Take a more connected approach to your healthcare.</h1>
          <p>
            Create your account to organize health information, connect with
            doctors and stay involved in your healthcare journey.
          </p>

          <div className="auth-feature">
            <span><UserRound size={19} /></span>
            <div>
              <strong>Your healthcare, in one workspace</strong>
              <small>Appointments, records and care information together.</small>
            </div>
          </div>
        </div>

        <div className="auth-visual-footer">
          <ShieldCheck size={17} />
          <span>Designed with privacy and responsible access in mind</span>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-mobile-brand">
          <span className="auth-brand-icon">
            <HeartPulse size={21} />
          </span>
          <strong>anvaya<span className="auth-brand-dot">.</span></strong>
        </div>

        <section className="auth-card">
          <div className="auth-heading">
            <span className="auth-card-eyebrow">GET STARTED</span>
            <h2>Create your account</h2>
            <p>Set up your patient account to get started with Anvaya.</p>
          </div>

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label htmlFor="register-name">Full name</label>
            <input
              id="register-name"
              type="text"
              autoComplete="name"
              placeholder="Enter your full name"
              minLength={2}
              maxLength={120}
              value={form.full_name}
              onChange={(event) =>
                setForm({ ...form, full_name: event.target.value })
              }
              required
            />

            <label htmlFor="register-email" style={{ marginTop: 21 }}>
              Email address
            </label>
            <input
              id="register-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
              required
            />

            <label htmlFor="register-password" style={{ marginTop: 21 }}>
              Create password
            </label>
            <div className="auth-password-field">
              <input
                id="register-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                minLength={8}
                maxLength={128}
                value={form.password}
                onChange={(event) =>
                  setForm({ ...form, password: event.target.value })
                }
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <label htmlFor="register-confirm" style={{ marginTop: 21 }}>
              Confirm password
            </label>
            <div className="auth-password-field">
              <input
                id="register-confirm"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Enter your password again"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={
                  showConfirmPassword ? "Hide password" : "Show password"
                }
              >
                {showConfirmPassword ? (
                  <EyeOff size={18} />
                ) : (
                  <Eye size={18} />
                )}
              </button>
            </div>

            <button
              type="submit"
              className="auth-submit"
              disabled={isSubmitting || isGoogleSubmitting}
            >
              {isSubmitting ? "Creating account..." : "Create patient account"}
              {!isSubmitting && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="auth-provider-divider">
            <span>OR CONTINUE WITH</span>
          </div>

          <button
            type="button"
            className="auth-google-button"
            onClick={() => void handleGoogleSignIn()}
            disabled={!isFirebaseConfigured || isSubmitting || isGoogleSubmitting}
            title={
              !isFirebaseConfigured
                ? "Google Sign-In is unavailable in this environment"
                : "Continue with Google"
            }
          >
            <svg
              className="auth-google-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="#4285F4"
                d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.51h6.44a5.5 5.5 0 0 1-2.39 3.61v2.99h3.87c2.27-2.09 3.57-5.17 3.57-8.84z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.89l-3.87-2.99c-1.08.72-2.46 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.09A12 12 0 0 0 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.32A7.2 7.2 0 0 1 4.9 12c0-.81.14-1.59.38-2.32V6.59H1.28A12 12 0 0 0 0 12c0 1.94.46 3.78 1.28 5.41z"
              />
              <path
                fill="#EA4335"
                d="M12 4.73c1.77 0 3.35.61 4.6 1.82l3.45-3.45C17.94 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.59l4 3.09C6.23 6.84 8.88 4.73 12 4.73z"
              />
            </svg>

            <span>
              {!isFirebaseConfigured
                ? "Google Sign-In Unavailable"
                : isGoogleSubmitting
                  ? "Connecting to Google..."
                  : "Continue with Google"}
            </span>
          </button>

          <p className="auth-switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>

          <div className="auth-security-note">
            <ShieldCheck size={16} />
            <span>Your account details are handled through Anvaya's backend.</span>
          </div>
        </section>

        <footer className="auth-page-footer">
          Anvaya · Connected healthcare experience
        </footer>
      </main>
    </div>
  );
}





import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  HeartPulse,
  ShieldCheck,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import { getRoleHomePath, isPathAllowedForRole } from "../../utils/roleUtils";
import { isFirebaseConfigured } from "../../services/firebase";
import { patientService } from "../../services/patientService";
import type { LoginRequest, UserPublic } from "../../types/auth";
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

  return "Unable to sign in right now. Please try again.";
}

async function resolveLoginDestination(
  authenticatedUser: UserPublic,
  requestedPath?: string | null,
): Promise<string> {
  const roleHome = getRoleHomePath(authenticatedUser.role);

  // Validate destination against the authenticated user's role
  let targetPath = roleHome;
  if (
    requestedPath &&
    requestedPath.startsWith("/") &&
    requestedPath !== "/login" &&
    requestedPath !== "/register" &&
    isPathAllowedForRole(requestedPath, authenticatedUser.role)
  ) {
    targetPath = requestedPath;
  }

  // Preserve existing patient profile-setup requirement for both password and Google login
  if (authenticatedUser.role === "patient") {
    try {
      await patientService.getMyProfile();
    } catch (profileError) {
      if (
        axios.isAxiosError(profileError) &&
        profileError.response?.status === 404
      ) {
        return "/patient/profile-setup";
      }
    }
  }

  return targetPath;
}

export default function LoginPage() {
  const { user, isLoading, login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState<LoginRequest>({
    email: "",
    password: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const isSessionExpired =
    new URLSearchParams(location.search).get("session_expired") === "true";

  if (isLoading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
        <span>Preparing your Anvaya workspace...</span>
      </div>
    );
  }

  if (user && !isGoogleSubmitting) {
    return <Navigate to={getRoleHomePath(user.role)} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const authenticatedUser = await login({
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });

      const requestedDestination =
        location.state?.from?.pathname ||
        new URLSearchParams(location.search).get("redirect");

      const destination = await resolveLoginDestination(
        authenticatedUser,
        requestedDestination,
      );

      navigate(destination, { replace: true });
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

      const requestedDestination =
        location.state?.from?.pathname ||
        new URLSearchParams(location.search).get("redirect");

      const destination = await resolveLoginDestination(
        authenticatedUser,
        requestedDestination,
      );

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
          <span className="auth-brand-icon"><HeartPulse size={23} /></span>
          <span>anvaya<span className="auth-brand-dot">.</span></span>
        </div>

        <div className="auth-visual-copy">
          <span className="auth-eyebrow">CONNECTED HEALTHCARE</span>
          <h1>Your health journey, connected in one place.</h1>
          <p>
            A more connected healthcare experience for patients and
            professionals. Access care, manage records and stay informed.
          </p>

          <div className="auth-feature">
            <span><Activity size={19} /></span>
            <div>
              <strong>Care that stays connected</strong>
              <small>Your healthcare journey, organized around you.</small>
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
          <span className="auth-brand-icon"><HeartPulse size={21} /></span>
          <strong>anvaya<span className="auth-brand-dot">.</span></strong>
        </div>

        <section className="auth-card">
          <div className="auth-heading">
            <span className="auth-card-eyebrow">WELCOME BACK</span>
            <h2>Sign in to Anvaya</h2>
            <p>Enter your account details to continue to your workspace.</p>
          </div>

          {isSessionExpired && (
            <div className="auth-warning" role="status">
              <AlertTriangle
                size={15}
                style={{
                  display: "inline",
                  marginRight: "6px",
                  verticalAlign: "middle",
                }}
              />
              Your session has expired. Please sign in again to continue.
            </div>
          )}

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
              required
            />

            <div className="auth-password-heading">
              <label htmlFor="login-password">Password</label>
            </div>

            <div className="auth-password-field">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
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

            <button
              type="submit"
              className="auth-submit"
              disabled={isSubmitting || isGoogleSubmitting}
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
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
            New to Anvaya? <Link to="/register">Create an account</Link>
          </p>

          <div className="auth-security-note">
            <ShieldCheck size={16} />
            <span>Your account is protected by authenticated access.</span>
          </div>
        </section>

        <footer className="auth-page-footer">
          Anvaya · Connected healthcare experience
        </footer>
      </main>
    </div>
  );
}

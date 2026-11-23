/**
 * ANVAYA — Notification Helpers & Role-Based Navigation Security
 *
 * Provides pure utility functions for:
 * - Role-safe path validation and open-redirect prevention
 * - Event category labels for healthcare operational notifications
 * - Contextual action labels for patient and doctor journeys
 * - Visual tag modifiers for styling neutral, success, and warning states
 */

const ROLE_PATH_PREFIXES: Record<string, string> = {
  patient: "/patient",
  doctor: "/doctor",
  admin: "/admin",
};

/**
 * Validates that an action path is a safe relative internal route belonging
 * strictly to the authenticated user's portal role.
 *
 * Prevents:
 * - Open redirects (http://, https://, //evil.com, ftp://)
 * - Cross-portal unauthorized navigation (e.g. Patient accessing /admin/..., Doctor accessing /patient/...)
 * - Javascript/Data/VBScript URI injection
 * - Path traversal (.. or backslashes)
 * - Safe optional query parameters validation (e.g. ?request_id=...)
 */
export function isSafeRolePath(path: string | null | undefined, userRole: string): boolean {
  if (!path) return false;

  const trimmed = path.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();

  // Reject external protocols, protocol-relative URLs, script schemes, and path traversal
  if (
    lower.includes("javascript:") ||
    lower.includes("data:") ||
    lower.includes("vbscript:") ||
    lower.includes("://") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.includes("\\") ||
    trimmed.includes("..")
  ) {
    return false;
  }

  // Split into pathname and query string
  const parts = trimmed.split("?");
  if (parts.length > 2) {
    // Disallow multiple query string delimiters
    return false;
  }

  const [pathname, queryString] = parts;

  // Pathname must begin with a single slash and contain only alphanumeric, underscores, hyphens, and slashes
  if (!/^\/[a-zA-Z0-9_/-]+$/.test(pathname)) {
    return false;
  }

  // Prevent double slashes in pathname (e.g., /patient//consent)
  if (pathname.includes("//")) {
    return false;
  }

  // Validate query string if present
  if (queryString !== undefined) {
    if (queryString.length === 0) {
      // Empty query string like "/patient/consent?" is invalid
      return false;
    }
    // Query string must contain only alphanumeric, underscores, hyphens, equals, and ampersands
    if (!/^[a-zA-Z0-9_=&-]+$/.test(queryString)) {
      return false;
    }
  }

  const expectedPrefix = ROLE_PATH_PREFIXES[userRole.toLowerCase()];
  if (!expectedPrefix) return false;

  return pathname === expectedPrefix || pathname.startsWith(`${expectedPrefix}/`);
}

/**
 * Maps an action path and notification type to a user-friendly, contextual action label.
 *
 * Patient:
 * - "consent.requested" -> "Review Request"
 *
 * Doctor:
 * - "consent.approved", "consent.partially_approved", "consent.declined", "consent.revoked" -> "View Patient Directory"
 *
 * Existing Workflows:
 * - Appointments -> "View Appointments"
 * - Prescriptions -> "View Prescriptions"
 * - Availability -> "Manage Availability"
 * - Doctor Review -> "Review Doctors"
 * - Profile -> "View Profile"
 * - Fallback -> "View Details"
 */
export function getNotificationActionLabel(
  path: string | null | undefined,
  type?: string,
): string {
  const p = path || "";
  if (
    type === "consent.requested" ||
    type === "consent.request_created" ||
    p.includes("/patient/consent")
  ) {
    return "Review Request";
  }
  if (
    type === "consent.approved" ||
    type === "consent.partially_approved" ||
    type === "consent.declined" ||
    type === "consent.revoked" ||
    type === "consent.request_approved" ||
    type === "consent.request_partially_approved" ||
    type === "consent.request_declined" ||
    p.includes("/doctor/patients")
  ) {
    return "View Patient Directory";
  }
  if (p.includes("/appointments")) return "View Appointments";
  if (p.includes("/prescriptions")) return "View Prescriptions";
  if (p.includes("/availability")) return "Manage Availability";
  if (p.includes("/doctors")) return "Review Doctors";
  if (p.includes("/profile")) return "View Profile";
  return "View Details";
}

/**
 * Returns a human-readable category badge label for each supported notification event.
 */
export function getNotificationCategoryLabel(type: string): string {
  switch (type) {
    case "consent.requested":
    case "consent.request_created":
      return "Consent Request";
    case "consent.approved":
    case "consent.request_approved":
      return "Consent Approved";
    case "consent.partially_approved":
    case "consent.request_partially_approved":
      return "Partial Consent";
    case "consent.declined":
    case "consent.request_declined":
      return "Consent Declined";
    case "consent.revoked":
      return "Consent Revoked";
    case "appointment.booked":
      return "Appointment Booked";
    case "appointment.rescheduled":
    case "appointment.reschedule_proposed":
    case "appointment.reschedule_accepted":
      return "Appointment Rescheduled";
    case "appointment.reschedule_declined":
    case "appointment.cancelled":
      return "Appointment Cancelled";
    case "prescription.issued":
      return "Prescription Issued";
    case "doctor.onboarded":
    case "doctor.application.received":
      return "Doctor Application";
    case "doctor.verification.approved":
      return "Doctor Verified";
    case "doctor.verification.rejected":
    case "doctor.verification.suspended":
      return "Doctor Verification Alert";
    default:
      return "Notification";
  }
}

/**
 * Returns a CSS class modifier for visual styling (neutral, success, warning, or alert).
 */
export function getNotificationTagModifier(type: string): string {
  switch (type) {
    case "consent.requested":
    case "consent.request_created":
      return "consent-requested";
    case "consent.approved":
    case "consent.request_approved":
      return "consent-approved";
    case "consent.partially_approved":
    case "consent.request_partially_approved":
      return "consent-partial";
    case "consent.declined":
    case "consent.request_declined":
      return "consent-declined";
    case "consent.revoked":
      return "consent-revoked";
    case "appointment.booked":
    case "appointment.rescheduled":
    case "appointment.reschedule_proposed":
    case "appointment.reschedule_accepted":
    case "appointment.reschedule_declined":
    case "appointment.cancelled":
      return "appointment";
    case "prescription.issued":
      return "prescription";
    case "doctor.onboarded":
    case "doctor.application.received":
    case "doctor.verification.approved":
    case "doctor.verification.rejected":
    case "doctor.verification.suspended":
      return "doctor";
    default:
      return "default";
  }
}

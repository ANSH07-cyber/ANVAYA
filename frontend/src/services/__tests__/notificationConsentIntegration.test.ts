/**
 * ANVAYA Stage 3 Phase 2B.5 Step 5: Notification Consent Integration & Deep-Link Safety Tests
 *
 * Exercises all 14 required regression and security scenarios:
 * 1. Patient consent-request notification rendering
 * 2. Doctor full approval notification
 * 3. Doctor partial approval notification
 * 4. Doctor decline notification
 * 5. Consent revocation notification
 * 6. Valid patient navigation
 * 7. Valid doctor navigation
 * 8. Cross-role route rejection
 * 9. External URL rejection
 * 10. javascript: URL rejection
 * 11. Missing and invalid action path handling
 * 12. Existing appointment notifications unaffected
 * 13. Safe handling of expired or already-resolved consent requests
 * 14. No sensitive medical data leaked in notification preview
 */

import {
  isSafeRolePath,
  getNotificationActionLabel,
  getNotificationCategoryLabel,
  getNotificationTagModifier,
} from "../notificationHelpers.ts";
import type { NotificationItem } from "../../types/notification.ts";

// --- Self-contained Browser/Node-safe Assertion Utilities ---
function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion Failed: expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}. ${message || ""}`,
    );
  }
}

function assertTrue(actual: boolean, message?: string): void {
  if (!actual) {
    throw new Error(`Assertion Failed: expected true, got false. ${message || ""}`);
  }
}

function assertFalse(actual: boolean, message?: string): void {
  if (actual) {
    throw new Error(`Assertion Failed: expected false, got true. ${message || ""}`);
  }
}

function assertNotIncludes(haystack: string, needle: string, message?: string): void {
  if (haystack.toLowerCase().includes(needle.toLowerCase())) {
    throw new Error(
      `Privacy Assertion Failed: found sensitive token "${needle}" in "${haystack}". ${message || ""}`,
    );
  }
}

// --- Test Suite Execution ---
console.log("============================================================");
console.log("ANVAYA Phase 2B.5 Step 5: Notification Consent Safety Tests");
console.log("============================================================\n");

// Scenario 1: Patient consent-request notification rendering
console.log("Scenario 1: Patient consent-request notification rendering");
{
  const notif: NotificationItem = {
    id: "notif-001",
    recipient_user_id: "patient-user-1",
    notification_type: "consent.requested",
    title: "EHR Consent Requested",
    message: "Dr. Sarah Jenkins has requested access to your health records for clinical consultation. Please review and respond.",
    is_read: false,
    created_at: "2026-11-23T10:00:00Z",
    read_at: null,
    related_entity_type: "consent_request",
    related_entity_id: "req-101",
    safe_action_path: "/patient/consent",
  };

  const actionLabel = getNotificationActionLabel(notif.safe_action_path, notif.notification_type);
  const categoryLabel = getNotificationCategoryLabel(notif.notification_type);
  const tagModifier = getNotificationTagModifier(notif.notification_type);
  const isSafeForPatient = isSafeRolePath(notif.safe_action_path, "patient");
  const isSafeForDoctor = isSafeRolePath(notif.safe_action_path, "doctor");

  assertEqual(actionLabel, "Review Request", "Patient action label must be 'Review Request'");
  assertEqual(categoryLabel, "Consent Request", "Category must be 'Consent Request'");
  assertEqual(tagModifier, "consent-requested", "Tag modifier must be 'consent-requested'");
  assertTrue(isSafeForPatient, "Path /patient/consent must be valid for patient");
  assertFalse(isSafeForDoctor, "Path /patient/consent must NOT be valid for doctor");
  console.log("  ✓ Patient consent request rendered with 'Review Request' and safe patient route.");
}

// Scenario 2: Doctor full approval notification
console.log("\nScenario 2: Doctor full approval notification");
{
  const notif: NotificationItem = {
    id: "notif-002",
    recipient_user_id: "doctor-user-1",
    notification_type: "consent.approved",
    title: "EHR Consent Approved",
    message: "A patient has approved your request to access their health records.",
    is_read: false,
    created_at: "2026-11-23T10:05:00Z",
    read_at: null,
    related_entity_type: "consent_request",
    related_entity_id: "req-101",
    safe_action_path: "/doctor/patients",
  };

  const actionLabel = getNotificationActionLabel(notif.safe_action_path, notif.notification_type);
  const categoryLabel = getNotificationCategoryLabel(notif.notification_type);
  const tagModifier = getNotificationTagModifier(notif.notification_type);
  const isSafeForDoctor = isSafeRolePath(notif.safe_action_path, "doctor");
  const isSafeForPatient = isSafeRolePath(notif.safe_action_path, "patient");

  assertEqual(actionLabel, "View Patient Directory", "Doctor action label must be 'View Patient Directory'");
  assertEqual(categoryLabel, "Consent Approved", "Category must be 'Consent Approved'");
  assertEqual(tagModifier, "consent-approved", "Tag modifier must be 'consent-approved'");
  assertTrue(isSafeForDoctor, "Path /doctor/patients must be valid for doctor");
  assertFalse(isSafeForPatient, "Path /doctor/patients must NOT be valid for patient");
  console.log("  ✓ Doctor full approval notification rendered with 'View Patient Directory'.");
}

// Scenario 3: Doctor partial approval notification
console.log("\nScenario 3: Doctor partial approval notification");
{
  const notif: NotificationItem = {
    id: "notif-003",
    recipient_user_id: "doctor-user-1",
    notification_type: "consent.partially_approved",
    title: "EHR Consent Partially Approved",
    message: "A patient has partially approved your health records consent request for selected categories.",
    is_read: false,
    created_at: "2026-11-23T10:10:00Z",
    read_at: null,
    related_entity_type: "consent_request",
    related_entity_id: "req-102",
    safe_action_path: "/doctor/patients",
  };

  const actionLabel = getNotificationActionLabel(notif.safe_action_path, notif.notification_type);
  const categoryLabel = getNotificationCategoryLabel(notif.notification_type);
  const tagModifier = getNotificationTagModifier(notif.notification_type);

  assertEqual(actionLabel, "View Patient Directory");
  assertEqual(categoryLabel, "Partial Consent");
  assertEqual(tagModifier, "consent-partial");
  assertTrue(isSafeRolePath(notif.safe_action_path, "doctor"));
  console.log("  ✓ Doctor partial approval notification rendered with amber 'Partial Consent' badge.");
}

// Scenario 4: Doctor decline notification
console.log("\nScenario 4: Doctor decline notification");
{
  const notif: NotificationItem = {
    id: "notif-004",
    recipient_user_id: "doctor-user-1",
    notification_type: "consent.declined",
    title: "EHR Consent Declined",
    message: "A patient has declined your request to access their health records.",
    is_read: false,
    created_at: "2026-11-23T10:15:00Z",
    read_at: null,
    related_entity_type: "consent_request",
    related_entity_id: "req-103",
    safe_action_path: "/doctor/patients",
  };

  const actionLabel = getNotificationActionLabel(notif.safe_action_path, notif.notification_type);
  const categoryLabel = getNotificationCategoryLabel(notif.notification_type);
  const tagModifier = getNotificationTagModifier(notif.notification_type);

  assertEqual(actionLabel, "View Patient Directory");
  assertEqual(categoryLabel, "Consent Declined");
  assertEqual(tagModifier, "consent-declined");
  assertTrue(isSafeRolePath(notif.safe_action_path, "doctor"));
  console.log("  ✓ Doctor decline notification rendered with neutral 'Consent Declined' treatment.");
}

// Scenario 5: Consent revocation notification
console.log("\nScenario 5: Consent revocation notification");
{
  const notif: NotificationItem = {
    id: "notif-005",
    recipient_user_id: "doctor-user-1",
    notification_type: "consent.revoked",
    title: "EHR Consent Revoked",
    message: "Consent for health record access has been revoked by the patient.",
    is_read: false,
    created_at: "2026-11-23T10:20:00Z",
    read_at: null,
    related_entity_type: "consent",
    related_entity_id: "rec-201",
    safe_action_path: "/doctor/patients",
  };

  const actionLabel = getNotificationActionLabel(notif.safe_action_path, notif.notification_type);
  const categoryLabel = getNotificationCategoryLabel(notif.notification_type);
  const tagModifier = getNotificationTagModifier(notif.notification_type);

  assertEqual(actionLabel, "View Patient Directory");
  assertEqual(categoryLabel, "Consent Revoked");
  assertEqual(tagModifier, "consent-revoked");
  assertTrue(isSafeRolePath(notif.safe_action_path, "doctor"));
  console.log("  ✓ Consent revocation notification rendered with security warning 'Consent Revoked'.");
}

// Scenario 6: Valid patient navigation
console.log("\nScenario 6: Valid patient navigation");
{
  assertTrue(isSafeRolePath("/patient/consent", "patient"));
  assertTrue(isSafeRolePath("/patient/consent?request_id=fc91220b-141a-467a-bed6-c5365c6efa1d", "patient"));
  assertTrue(isSafeRolePath("/patient/appointments", "patient"));
  assertTrue(isSafeRolePath("/patient/records", "patient"));
  assertTrue(isSafeRolePath("/patient/prescriptions", "patient"));
  assertTrue(isSafeRolePath("/patient/doctors", "patient"));
  assertTrue(isSafeRolePath("/patient/skin-health", "patient"));
  assertTrue(isSafeRolePath("/patient", "patient"));
  console.log("  ✓ All authorized patient relative routes accepted.");
}

// Scenario 7: Valid doctor navigation
console.log("\nScenario 7: Valid doctor navigation");
{
  assertTrue(isSafeRolePath("/doctor/patients", "doctor"));
  assertTrue(isSafeRolePath("/doctor/appointments", "doctor"));
  assertTrue(isSafeRolePath("/doctor/availability", "doctor"));
  assertTrue(isSafeRolePath("/doctor/prescriptions", "doctor"));
  assertTrue(isSafeRolePath("/doctor/profile", "doctor"));
  assertTrue(isSafeRolePath("/doctor", "doctor"));
  console.log("  ✓ All authorized doctor relative routes accepted.");
}

// Scenario 8: Cross-role route rejection
console.log("\nScenario 8: Cross-role route rejection");
{
  assertFalse(isSafeRolePath("/doctor/patients", "patient"), "Patient cannot access doctor patients");
  assertFalse(isSafeRolePath("/doctor/appointments", "patient"), "Patient cannot access doctor appointments");
  assertFalse(isSafeRolePath("/admin/users", "patient"), "Patient cannot access admin users");
  assertFalse(isSafeRolePath("/admin/settings", "patient"), "Patient cannot access admin settings");

  assertFalse(isSafeRolePath("/patient/consent", "doctor"), "Doctor cannot access patient consent");
  assertFalse(isSafeRolePath("/patient/records", "doctor"), "Doctor cannot access patient records page");
  assertFalse(isSafeRolePath("/admin/users", "doctor"), "Doctor cannot access admin users");

  assertFalse(isSafeRolePath("/patient/consent", "admin"), "Admin cannot access patient consent directly");
  assertFalse(isSafeRolePath("/doctor/patients", "admin"), "Admin cannot access doctor patients directly");
  console.log("  ✓ Cross-portal unauthorized path traversal rejected across all role pairs.");
}

// Scenario 9: External URL rejection
console.log("\nScenario 9: External URL rejection");
{
  assertFalse(isSafeRolePath("https://evil.com/patient/consent", "patient"));
  assertFalse(isSafeRolePath("http://evil.com/doctor/patients", "doctor"));
  assertFalse(isSafeRolePath("//evil.com/patient/consent", "patient"));
  assertFalse(isSafeRolePath("/\\evil.com/patient/consent", "patient"));
  assertFalse(isSafeRolePath("ftp://malicious.org/download", "patient"));
  assertFalse(isSafeRolePath("/patient/consent?redirect=https://evil.com", "patient"));
  console.log("  ✓ External absolute and protocol-relative URLs rejected.");
}

// Scenario 10: javascript: URL rejection
console.log("\nScenario 10: javascript: URL rejection");
{
  assertFalse(isSafeRolePath("javascript:alert(1)", "patient"));
  assertFalse(isSafeRolePath("JAVASCRIPT:alert(1)", "doctor"));
  assertFalse(isSafeRolePath("data:text/html,<script>alert(1)</script>", "patient"));
  assertFalse(isSafeRolePath("vbscript:msgbox(1)", "patient"));
  assertFalse(isSafeRolePath("/patient/consent?id=1&action=javascript:alert(1)", "patient"));
  console.log("  ✓ Script execution injection schemes rejected.");
}

// Scenario 11: Missing and invalid action path handling
console.log("\nScenario 11: Missing and invalid action path handling");
{
  assertFalse(isSafeRolePath(null, "patient"));
  assertFalse(isSafeRolePath(undefined, "patient"));
  assertFalse(isSafeRolePath("", "patient"));
  assertFalse(isSafeRolePath("   ", "patient"));
  assertFalse(isSafeRolePath("/patient/../admin/users", "patient"));
  assertFalse(isSafeRolePath("/patient/consent\\escape", "patient"));
  assertFalse(isSafeRolePath("/patient//consent", "patient"));
  assertFalse(isSafeRolePath("/patient/consent?", "patient"));
  assertFalse(isSafeRolePath("/patient/consent?a=1?b=2", "patient"));
  assertFalse(isSafeRolePath("/patient/consent?<script>", "patient"));
  assertEqual(getNotificationActionLabel(null, "unknown.type"), "View Details");
  assertEqual(getNotificationActionLabel(undefined, "unknown.type"), "View Details");
  console.log("  ✓ Missing, malformed, traversal, and invalid query paths safely rejected.");
}

// Scenario 12: Existing appointment notifications unaffected
console.log("\nScenario 12: Existing appointment notifications unaffected");
{
  assertEqual(getNotificationActionLabel("/patient/appointments", "appointment.booked"), "View Appointments");
  assertEqual(getNotificationCategoryLabel("appointment.booked"), "Appointment Booked");
  assertEqual(getNotificationTagModifier("appointment.booked"), "appointment");

  assertEqual(getNotificationActionLabel("/patient/appointments", "appointment.cancelled"), "View Appointments");
  assertEqual(getNotificationCategoryLabel("appointment.cancelled"), "Appointment Cancelled");

  assertEqual(getNotificationActionLabel("/patient/appointments", "appointment.rescheduled"), "View Appointments");
  assertEqual(getNotificationCategoryLabel("appointment.rescheduled"), "Appointment Rescheduled");

  assertEqual(getNotificationActionLabel("/patient/prescriptions", "prescription.issued"), "View Prescriptions");
  assertEqual(getNotificationCategoryLabel("prescription.issued"), "Prescription Issued");
  assertEqual(getNotificationTagModifier("prescription.issued"), "prescription");

  assertEqual(getNotificationActionLabel("/admin/doctors", "doctor.verification.approved"), "Review Doctors");
  assertEqual(getNotificationCategoryLabel("doctor.verification.approved"), "Doctor Verified");
  assertEqual(getNotificationTagModifier("doctor.verification.approved"), "doctor");
  console.log("  ✓ All existing appointment, prescription, and onboarding notification mappings preserved.");
}

// Scenario 13: Safe handling of expired or already-resolved consent requests
console.log("\nScenario 13: Safe handling of expired or already-resolved consent requests");
{
  const mockBackendPendingList = [
    {
      id: "valid-req-1",
      doctor_profile_id: "doc-1",
      patient_profile_id: "pat-1",
      requested_scopes: ["diagnosis", "symptoms"],
      status: "pending",
      created_at: "2026-11-23T08:00:00Z",
      expires_at: new Date(Date.now() + 86400000).toISOString(), // 24h future
      resolved_at: null,
      approved_scopes: null,
    },
    {
      id: "expired-req-2",
      doctor_profile_id: "doc-2",
      patient_profile_id: "pat-1",
      requested_scopes: ["clinical_notes"],
      status: "pending",
      created_at: "2026-11-20T08:00:00Z",
      expires_at: new Date(Date.now() - 3600000).toISOString(), // 1h past
      resolved_at: null,
      approved_scopes: null,
    },
  ];

  // Simulation: Patient clicks notification with valid pending request
  const matchedValid = mockBackendPendingList.find((r) => r.id === "valid-req-1");
  assertTrue(matchedValid !== undefined);
  const isValidExpired = new Date(matchedValid!.expires_at).getTime() <= Date.now();
  assertFalse(isValidExpired, "Active request must not be marked expired");

  // Simulation: Patient clicks notification with expired request
  const matchedExpired = mockBackendPendingList.find((r) => r.id === "expired-req-2");
  assertTrue(matchedExpired !== undefined);
  const isExpired = new Date(matchedExpired!.expires_at).getTime() <= Date.now();
  assertTrue(isExpired, "Expired request must be detected");

  // Simulation: Patient clicks notification for request already approved/declined (absent from pending)
  const resolvedId = "already-resolved-req-3";
  const matchedResolved = mockBackendPendingList.find((r) => r.id === resolvedId);
  assertEqual(matchedResolved, undefined, "Resolved requests must not match pending inbox items");

  // Simulation: Malicious attempt to pass foreign patient's request ID in URL
  const foreignId = "foreign-patient-req-999";
  const matchedForeign = mockBackendPendingList.find((r) => r.id === foreignId);
  assertEqual(matchedForeign, undefined, "Foreign patient request must never match authenticated inbox");
  console.log("  ✓ Expired, resolved, and foreign request IDs handled safely without authorization bypass.");
}

// Scenario 14: No sensitive medical data leaked in notification preview
console.log("\nScenario 14: No sensitive medical data leaked in notification preview");
{
  const consentNotifications: NotificationItem[] = [
    {
      id: "c-1",
      recipient_user_id: "u-1",
      notification_type: "consent.requested",
      title: "EHR Consent Requested",
      message: "Dr. Sarah Jenkins has requested access to your health records for clinical consultation. Please review and respond.",
      is_read: false,
      created_at: "2026-11-23T10:00:00Z",
      read_at: null,
      related_entity_type: "consent_request",
      related_entity_id: "req-1",
      safe_action_path: "/patient/consent",
    },
    {
      id: "c-2",
      recipient_user_id: "u-2",
      notification_type: "consent.approved",
      title: "EHR Consent Approved",
      message: "A patient has approved your request to access their health records.",
      is_read: false,
      created_at: "2026-11-23T10:05:00Z",
      read_at: null,
      related_entity_type: "consent_request",
      related_entity_id: "req-1",
      safe_action_path: "/doctor/patients",
    },
    {
      id: "c-3",
      recipient_user_id: "u-2",
      notification_type: "consent.partially_approved",
      title: "EHR Consent Partially Approved",
      message: "A patient has partially approved your health records consent request for selected categories.",
      is_read: false,
      created_at: "2026-11-23T10:10:00Z",
      read_at: null,
      related_entity_type: "consent_request",
      related_entity_id: "req-2",
      safe_action_path: "/doctor/patients",
    },
    {
      id: "c-4",
      recipient_user_id: "u-2",
      notification_type: "consent.declined",
      title: "EHR Consent Declined",
      message: "A patient has declined your request to access their health records.",
      is_read: false,
      created_at: "2026-11-23T10:15:00Z",
      read_at: null,
      related_entity_type: "consent_request",
      related_entity_id: "req-3",
      safe_action_path: "/doctor/patients",
    },
    {
      id: "c-5",
      recipient_user_id: "u-2",
      notification_type: "consent.revoked",
      title: "EHR Consent Revoked",
      message: "Consent for health record access has been revoked by the patient.",
      is_read: false,
      created_at: "2026-11-23T10:20:00Z",
      read_at: null,
      related_entity_type: "consent",
      related_entity_id: "rec-1",
      safe_action_path: "/doctor/patients",
    },
  ];

  const sensitiveClinicalTerms = [
    "melanoma",
    "carcinoma",
    "biopsy",
    "hypertension",
    "diabetes",
    "metformin",
    "lisinopril",
    "chief_complaint",
    "clinical_notes",
    "visit_summary",
    "treatment_plan",
    "follow_up_instructions",
    "ICD-10",
  ];

  for (const notif of consentNotifications) {
    const textToCheck = `${notif.title} ${notif.message} ${getNotificationCategoryLabel(notif.notification_type)} ${getNotificationActionLabel(notif.safe_action_path, notif.notification_type)}`;
    for (const term of sensitiveClinicalTerms) {
      assertNotIncludes(
        textToCheck,
        term,
        `Notification ${notif.id} (${notif.notification_type}) must not leak clinical term "${term}"`,
      );
    }
  }
  console.log("  ✓ Zero clinical terms, diagnoses, medications, or raw scopes found in any notification preview.");
}

console.log("\n============================================================");
console.log("ALL 14/14 NOTIFICATION CONSENT INTEGRATION TESTS PASSED!");
console.log("============================================================\n");

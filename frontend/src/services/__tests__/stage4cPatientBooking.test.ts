import {
  classifyBookingFailure,
  clinicDateAfter,
  createIdempotencyManager,
  filterUpcomingSlots,
  formatClinicDate,
  formatWeeklyScheduleSummary,
  isUpcomingSlot,
  resolveAppointmentDoctorMeta,
  scanPatientPages,
  validBookingDate,
} from "../patientReliability.ts";
import type { AvailableSlot, PatientAppointment } from "../../types/patient.ts";

function equal<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function truthy(value: boolean, message: string): void {
  if (!value) {
    throw new Error(message);
  }
}

// 1-3. Same-day upcoming slots, past-slot rejection, and IST date rollover
const beforeMidnightIst = new Date("2026-12-31T18:29:59Z");
const afterMidnightIst = new Date("2026-12-31T18:30:00Z");
equal(clinicDateAfter(0, beforeMidnightIst), "2026-12-31", "Before IST midnight stays 2026-12-31");
equal(clinicDateAfter(0, afterMidnightIst), "2027-01-01", "After IST midnight advances to 2027-01-01");
equal(validBookingDate("2026-12-31", beforeMidnightIst), true, "Same-day allowed before IST midnight");
equal(validBookingDate("2026-12-31", afterMidnightIst), false, "Yesterday rejected after IST midnight");
equal(validBookingDate("2027-01-01", afterMidnightIst), true, "New same-day allowed after IST midnight");

const nowIst1015 = Date.parse("2026-11-27T10:15:00+05:30");
const todaySlots: AvailableSlot[] = [
  { start_time: "09:30:00", end_time: "10:00:00" },
  { start_time: "10:15:00", end_time: "10:45:00" },
  { start_time: "10:30:00", end_time: "11:00:00" },
  { start_time: "16:00:00", end_time: "16:30:00" },
];
equal(isUpcomingSlot("2026-11-27", "09:30:00", nowIst1015), false, "Past slot rejected");
equal(isUpcomingSlot("2026-11-27", "10:15:00", nowIst1015), false, "Exact boundary slot rejected");
equal(isUpcomingSlot("2026-11-27", "10:30:00", nowIst1015), true, "Upcoming same-day slot allowed");
const filteredSlots = filterUpcomingSlots("2026-11-27", todaySlots, nowIst1015);
equal(filteredSlots.map((s) => s.start_time).join(","), "10:30:00,16:00:00", "Only upcoming slots kept");
truthy(formatClinicDate("2026-11-27").includes("2026"), "Clinic IST date formats reliably");

// 4. Weekly availability sorting and formatting
const weekly = formatWeeklyScheduleSummary([
  { weekday: 4, start_time: "14:00:00", end_time: "17:00:00", slot_duration_minutes: 20 },
  { weekday: 0, start_time: "09:00:00", end_time: "12:00:00", slot_duration_minutes: 30 },
]);
equal(weekly.length, 2, "Weekly summary includes all recurring shifts");
equal(weekly[0].shortDay, "Mon", "Sorted chronologically Mon first");
equal(weekly[0].slotDurationMinutes, 30, "Preserves slot duration");
equal(weekly[1].shortDay, "Fri", "Sorted chronologically Fri second");
equal(formatWeeklyScheduleSummary([]).length, 0, "Empty weekly availability handled");

// 5-7. Booking & reschedule idempotency key reuse on identical payload + rotation on changed payload
let seq = 0;
const manager = createIdempotencyManager(() => `key-${++seq}`);
const fpA = JSON.stringify({
  doctor_profile_id: "d1",
  appointment_date: "2026-11-27",
  start_time: "10:30:00",
  reason: null,
});
const fpB = JSON.stringify({
  doctor_profile_id: "d1",
  appointment_date: "2026-11-27",
  start_time: "11:00:00",
  reason: null,
});
equal(manager.getKey(fpA), "key-1", "First booking attempt generates unique key");
equal(manager.getKey(fpA), "key-1", "Retry with identical payload reuses same key");
equal(manager.getKey(fpB), "key-2", "Changed slot payload rotates to new idempotency key");
manager.clear();
equal(manager.getKey(fpB), "key-3", "Clearing after completion or 409 generates fresh key");

// 8. 409 conflict classification
equal(classifyBookingFailure({ response: { status: 409 } }), "conflict", "409 classified as conflict");

// 9-10. Doctor directory pagination + suspended/inactive doctor enrichment & neutral fallback
const allDoctors = Array.from({ length: 25 }, (_, i) => ({
  id: `doc-${i + 1}`,
  full_name: `Doctor ${i + 1}`,
  specialization: "Dermatology",
}));
const dirScan = await scanPatientPages(async ({ limit, offset }) => ({
  limit,
  offset,
  total: allDoctors.length,
  items: allDoctors.slice(offset, offset + limit),
}));
equal(dirScan.complete, true, "Paginated doctor directory loads past default 20 limit");
equal(dirScan.items.length, 25, "All 25 doctors loaded across pages");

const suspendedAppt: PatientAppointment = {
  id: "appt-susp",
  patient_profile_id: "pat-1",
  doctor_profile_id: "doc-suspended",
  appointment_date: "2026-11-27",
  start_time: "10:30:00",
  end_time: "11:00:00",
  status: "completed",
  reason: null,
  doctor_name: "Dr. Meera Nair",
  doctor_specialization: "Dermatology",
  doctor_clinic_name: "Anvaya Skin Clinic",
  created_at: "",
  updated_at: "",
};
const metaFromAppointment = resolveAppointmentDoctorMeta(suspendedAppt, {});
equal(metaFromAppointment.heading, "Dr. Meera Nair", "Preserves historical doctor display name without double Dr.");
equal(metaFromAppointment.specializationLabel, "DERMATOLOGY", "Preserves historical specialization");
equal(metaFromAppointment.clinicName, "Anvaya Skin Clinic", "Preserves historical clinic name");

const unknownMeta = resolveAppointmentDoctorMeta(
  { ...suspendedAppt, doctor_name: null, doctor_specialization: null, doctor_clinic_name: null },
  {},
);
equal(unknownMeta.heading, "Consultation appointment", "Neutral heading fallback when unavailable");
equal(unknownMeta.modalName, "Healthcare Practitioner", "Neutral dialog fallback when unavailable");
equal(unknownMeta.specializationLabel, "DOCTOR CONSULTATION", "Neutral specialization fallback");

console.log("ALL_STAGE_4C_UNIT_TESTS_PASSED");

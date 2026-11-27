import {
  appointmentInstant, classifyBookingFailure, clinicDateAfter, createSlotRequests, formatAppointmentTime,
  matchBookedAttempt, nextBookedAppointment, patientReadError, readPatientPage, requireReadableHealthRecords,
  scanPatientPages, uniqueById, validBookingDate, type PatientPageLoader,
} from "../patientReliability.ts";
import type { PatientAppointment, PatientHealthRecord } from "../../types/patient.ts";

function equal<T>(actual: T, expected: T, message: string) {
  if (!Object.is(actual, expected)) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

async function rejects(run: () => Promise<unknown>, message: string) {
  try { await run(); } catch { return; }
  throw new Error(message);
}

function appointment(id: string, date = "2027-01-04", time = "09:00:00"): PatientAppointment {
  return {
    id, appointment_date: date, start_time: time, end_time: "10:00:00",
    status: "booked", doctor_profile_id: "doctor-a", patient_profile_id: "clinic-fixture",
    reason: null, created_at: "", updated_at: "",
  };
}

const late = Array.from({ length: 100 }, (_, index) => appointment(`late-${index}`));
const earliest = appointment("earliest", "2027-01-02", "09:15:00");
const dataset = [...late, { ...appointment("cancelled"), status: "cancelled" as const }, earliest];
const offsets: number[] = [];
const load: PatientPageLoader<PatientAppointment> = async ({ limit, offset }) => {
  offsets.push(offset);
  return { limit, offset, total: dataset.length, items: dataset.slice(offset, offset + limit) };
};

const history = await scanPatientPages(load);
equal(history.complete, true, "Multi-page history complete");
equal(history.items.length, 102, "All appointment pages represented");
equal(offsets.join(","), "0,100", "Server offset advanced");
equal(nextBookedAppointment(history.items, Date.parse("2027-01-01T00:00:00Z"))?.id,
  "earliest", "Nearest booked visit may be on a later page");
equal(nextBookedAppointment([earliest], appointmentInstant(earliest.appointment_date, earliest.start_time)),
  null, "An already-started appointment is excluded");

const before = new Date("2026-12-31T18:29:59Z");
const after = new Date("2026-12-31T18:30:00Z");
equal(clinicDateAfter(0, before), "2026-12-31", "Today immediately before IST midnight");
equal(clinicDateAfter(0, after), "2027-01-01", "Today rolls over immediately at IST midnight");
equal(clinicDateAfter(1, before), "2027-01-01", "Tomorrow immediately before IST midnight");
equal(clinicDateAfter(1, after), "2027-01-02", "Tomorrow immediately after IST midnight");
equal(validBookingDate("2026-12-31", after), false, "Yesterday IST is invalid after midnight rollover");
equal(validBookingDate("2027-01-01", after), true, "Same-day IST booking date is allowed");
equal(validBookingDate(clinicDateAfter(60, after), after), true, "The last booking day is inclusive");
equal(validBookingDate(clinicDateAfter(61, after), after), false, "Reject dates beyond booking window");
equal(appointmentInstant("2027-01-02", "00:15:00"), Date.parse("2027-01-01T18:45:00Z"), "Compare local IST times as instants");

equal(formatAppointmentTime("02:30:00").startsWith("2:30"), true, "Wall-clock display does not shift with browser DST");

const firstPage = await readPatientPage(load, { limit: 20, offset: 0 });
equal(firstPage.total, 102, "Server total preserved separately from loaded entries");
equal(firstPage.items.length, 20, "History page contains only the requested entries");
const terminated = await scanPatientPages(load, undefined, 1);
equal(terminated.complete, false, "The scan cap never reports a partial load as complete");

const duplicate = await scanPatientPages(async ({ offset, limit }) => ({
  offset, limit, total: 200, items: late,
}));
equal(duplicate.complete, false, "Repeated pages terminate as incomplete");
equal(duplicate.items.length, 100, "Repeated IDs do not inflate counts");
equal(uniqueById([earliest, earliest]).length, 1, "History rendering deduplicates identifiers");
const premature = await scanPatientPages(async (query) => query.offset
  ? { ...query, total: 102, items: [] } : load(query));
equal(premature.complete, false, "Premature empty page cannot establish completion");
const network = await scanPatientPages(async (query) => {
  if (query.offset) throw new Error("Offline");
  return load(query);
});
equal(network.complete, false, "Later transport failure leaves history incomplete");
equal(network.items.length, 100, "Already loaded IDs retained after transport failure");
for (const status of [401, 403, 404]) {
  await rejects(() => scanPatientPages(async (query) => {
    if (query.offset) throw { response: { status } };
    return load(query);
  }), `Status ${status} must not return old patient data`);
}
await rejects(() => scanPatientPages(async () => { throw new Error("Offline"); }), "First request failure is not empty");
const empty = await scanPatientPages(async ({ offset, limit }) => ({ offset, limit, total: 0, items: [] }));
equal(empty.complete, true, "Confirmed empty history completes");
equal(empty.items.length, 0, "Confirmed empty history has zero entries");
equal(patientReadError({ response: { status: 403 } }, "records").includes("don't have access"), true, "Forbidden status is distinct");
equal(patientReadError({ response: { status: 503 } }, "health records"), "Health records are temporarily unavailable. Please try again.", "503 health records error");
equal(patientReadError({ response: { status: 503 } }, "your health records"), "Health records are temporarily unavailable. Please try again.", "503 prefix stripped correctly");
equal(patientReadError({ response: { status: 503 } }, "the doctor directory"), "Doctor directory is temporarily unavailable. Please try again.", "503 singular error formatted");
equal(patientReadError({ response: { status: 503 } }, "prescriptions"), "Prescriptions are temporarily unavailable. Please try again.", "503 prescriptions error");

const slots = createSlotRequests();
const old = slots.begin("doctor-a", "2027-01-02");
const current = slots.begin("doctor-b", "2027-01-03");
const response = { doctor_profile_id: "doctor-b", appointment_date: "2027-01-03", total: 0, items: [] };
equal(old.isCurrent(), false, "Late doctor/date response is stale");
equal(old.signal.aborted, true, "Previous query is aborted");
equal(current.matches({ ...response, appointment_date: "2027-01-02" }), false, "Wrong response date rejected");
equal(current.matches(response), true, "Current empty result is valid");
slots.invalidate();
equal(current.matches(response), false, "Closing the form invalidates pending results");

equal(classifyBookingFailure({ response: { status: 409 } }), "conflict", "Conflict is definitive and refreshable");
equal(classifyBookingFailure({ response: { status: 422 } }), "rejected", "Validation response is definitive");
equal(classifyBookingFailure({ response: { status: 503 } }), "unknown", "Server failure may follow a commit");
equal(classifyBookingFailure(new Error("Timeout")), "unknown", "Timeout requires read-only reconciliation");
const attempt = { doctor_profile_id: "doctor-a", appointment_date: earliest.appointment_date, start_time: "09:15" };
equal(matchBookedAttempt(history.items, attempt)?.id, earliest.id, "Recover booking by exact doctor, IST date/time and booked status");
equal(matchBookedAttempt([{ ...earliest, status: "cancelled" }], attempt), undefined, "Cancelled visit cannot confirm an attempt");
equal(matchBookedAttempt(history.items, { ...attempt, doctor_profile_id: "doctor-b" }), undefined, "Other doctor's visit cannot confirm an attempt");
console.log("Patient reliability tests passed");

const readableRecord: PatientHealthRecord = {
  id: "record", patient_profile_id: "fixture", doctor_profile_id: "doctor-a",
  appointment_id: "appointment", visit_date: "2027-01-01", chief_complaint: "Encephalopathy",
  visit_summary: "Synthetic visit", symptoms: null, diagnosis: null, clinical_notes: null,
  treatment_plan: null, follow_up_instructions: null, created_at: "", updated_at: "",
};
const readablePage = { items: [readableRecord], total: 1, limit: 20, offset: 0 };
equal(requireReadableHealthRecords(readablePage), readablePage, "Authorized plaintext page is preserved");
for (const field of ["chief_complaint", "visit_summary", "symptoms", "diagnosis",
  "clinical_notes", "treatment_plan", "follow_up_instructions"] as const) {
  await rejects(async () => requireReadableHealthRecords({
    ...readablePage, items: [readableRecord, { ...readableRecord, [field]: "  ENC:v1:synthetic" }],
  }), "Ciphertext in any clinical field must reject the entire page");
}

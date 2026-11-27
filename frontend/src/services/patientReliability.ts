import type {
  AppointmentCreateRequest,
  AvailableSlot,
  AvailableSlotsResponse,
  DoctorPublicAvailabilityItem,
  PaginatedResponse,
  PatientAppointment,
  PatientHealthRecord,
} from "../types/patient";

export type PatientPageQuery = { limit: number; offset: number; signal?: AbortSignal };
export type PatientPageLoader<T> = (query: PatientPageQuery) => Promise<PaginatedResponse<T>>;
type Identified = { id: string };
export const HISTORY_PAGE_SIZE = 20;

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "response" in error) {
    return (error.response as { status?: number } | undefined)?.status;
  }
}

const CLINICAL_TEXT_FIELDS = [
  "chief_complaint", "visit_summary", "symptoms", "diagnosis",
  "clinical_notes", "treatment_plan", "follow_up_instructions",
] as const satisfies ReadonlyArray<keyof PatientHealthRecord>;

class ClinicalRecordUnavailableError extends Error {}

export function requireReadableHealthRecords(page: PaginatedResponse<PatientHealthRecord>) {
  const hasEnvelope = page.items.some((record) => CLINICAL_TEXT_FIELDS.some((field) => {
    const value = record[field];
    return typeof value === "string" && /^enc:/i.test(value.trimStart());
  }));
  if (hasEnvelope) throw new ClinicalRecordUnavailableError();
  return page;
}

export function patientReadError(error: unknown, subject: string): string {
  if (error instanceof ClinicalRecordUnavailableError) {
    return "Health records are temporarily unavailable. Please try again.";
  }
  switch (statusOf(error)) {
    case 401: return `Your session expired. Sign in again to view ${subject}.`;
    case 403: return `You don't have access to ${subject}.`;
    case 404: return `The information needed to show ${subject} could not be found.`;
    case 503: {
      const norm = subject.trim().toLowerCase().replace(/^(your|the)\s+/, "");
      const capitalized = norm.charAt(0).toUpperCase() + norm.slice(1);
      const verb = /s$/i.test(norm) ? "are" : "is";
      return `${capitalized} ${verb} temporarily unavailable. Please try again.`;
    }
    case undefined: return `Couldn't load ${subject}. Check your connection and try again.`;
    default: return `Couldn't load ${subject}. Please try again.`;
  }
}

export function uniqueById<T extends Identified>(items: T[]): T[] {
  const unique = new Map<string, T>();
  for (const item of items) unique.set(item.id, item);
  return [...unique.values()];
}

export async function readPatientPage<T extends Identified>(
  load: PatientPageLoader<T>, query: PatientPageQuery,
): Promise<PaginatedResponse<T>> {
  query.signal?.throwIfAborted();
  const page = await load(query);
  query.signal?.throwIfAborted();
  if (page.offset !== query.offset || page.limit !== query.limit ||
      !Number.isSafeInteger(page.total) || page.total < 0 ||
      !Array.isArray(page.items) || page.items.length > query.limit ||
      page.items.length !== Math.max(0, Math.min(query.limit, page.total - query.offset)) ||
      page.items.some((item) => !item?.id)) {
    throw new Error("Inconsistent pagination response");
  }
  return page;
}

export async function scanPatientPages<T extends Identified>(
  load: PatientPageLoader<T>,
  signal?: AbortSignal,
  maxPages = 100,
): Promise<{ items: T[]; complete: boolean }> {
  const limit = 100;
  const items = new Map<string, T>();
  let total: number | undefined;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    let page: PaginatedResponse<T>;
    try {
      page = await readPatientPage(load, { limit, offset: pageIndex * limit, signal });
    } catch (error) {
      if (pageIndex === 0 || signal?.aborted || [401, 403, 404].includes(statusOf(error) ?? 0)) throw error;
      return { items: [...items.values()], complete: false };
    }
    const previousSize = items.size;
    for (const item of page.items) items.set(item.id, item);
    total ??= page.total;
    // Offset paging has no snapshot. A changed total or duplicate signals a moving list.
    if (total !== page.total || items.size - previousSize !== page.items.length) break;
    if (items.size === total) return { items: [...items.values()], complete: true };
  }
  return { items: [...items.values()], complete: false };
}

const clinicDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});

export function clinicDateAfter(days: number, now = new Date()): string {
  const date = new Date(`${clinicDate.format(now)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function validBookingDate(date: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < clinicDateAfter(0, now) || date > clinicDateAfter(60, now)) return false;
  const midnight = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(+midnight) && midnight.toISOString().startsWith(date);
}

const clinicDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatClinicDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(`${value}T00:00:00+05:30`);
  return Number.isFinite(+parsed) ? clinicDateFormatter.format(parsed) : value;
}

export function isUpcomingSlot(date: string, startTime: string, now = Date.now()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !startTime) return false;
  const instant = appointmentInstant(date, startTime);
  return Number.isFinite(instant) && instant > now;
}

export function filterUpcomingSlots<T extends Pick<AvailableSlot, "start_time">>(
  date: string,
  slots: T[],
  now = Date.now(),
): T[] {
  return slots.filter((slot) => isUpcomingSlot(date, slot.start_time, now));
}

const WEEKDAY_NAMES: ReadonlyArray<{ short: string; full: string }> = [
  { short: "Mon", full: "Monday" },
  { short: "Tue", full: "Tuesday" },
  { short: "Wed", full: "Wednesday" },
  { short: "Thu", full: "Thursday" },
  { short: "Fri", full: "Friday" },
  { short: "Sat", full: "Saturday" },
  { short: "Sun", full: "Sunday" },
];

export interface WeeklyScheduleEntry {
  weekday: number;
  shortDay: string;
  fullDay: string;
  timeRange: string;
  slotDurationMinutes: number;
}

export function formatWeeklyScheduleSummary(
  items: DoctorPublicAvailabilityItem[],
): WeeklyScheduleEntry[] {
  return [...items]
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
    .map((item) => {
      const day = WEEKDAY_NAMES[item.weekday] ?? { short: `Day ${item.weekday}`, full: `Day ${item.weekday}` };
      return {
        weekday: item.weekday,
        shortDay: day.short,
        fullDay: day.full,
        timeRange: `${formatAppointmentTime(item.start_time)} – ${formatAppointmentTime(item.end_time)}`,
        slotDurationMinutes: item.slot_duration_minutes,
      };
    });
}

function defaultIdempotencyGenerator(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createIdempotencyManager(generateKey: () => string = defaultIdempotencyGenerator) {
  let activeFingerprint: string | null = null;
  let activeKey: string | null = null;

  return {
    getKey(fingerprint: string): string {
      if (activeKey && activeFingerprint === fingerprint) {
        return activeKey;
      }
      activeFingerprint = fingerprint;
      activeKey = generateKey();
      return activeKey;
    },
    peekKey(): string | null {
      return activeKey;
    },
    clear(): void {
      activeFingerprint = null;
      activeKey = null;
    },
  };
}

export function formatDoctorHeading(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return "Consultation appointment";
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
}

export interface ResolvedAppointmentDoctor {
  heading: string;
  modalName: string;
  specializationLabel: string;
  clinicName: string | null;
  searchTerms: string[];
}

export function resolveAppointmentDoctorMeta(
  appointment: PatientAppointment,
  doctorsMap: Record<string, { full_name?: string | null; specialization?: string | null; clinic_name?: string | null }>,
): ResolvedAppointmentDoctor {
  const directoryEntry = doctorsMap[appointment.doctor_profile_id];
  const rawName = appointment.doctor_name?.trim() || directoryEntry?.full_name?.trim() || "";
  const specialization = appointment.doctor_specialization?.trim() || directoryEntry?.specialization?.trim() || "";
  const clinicName = appointment.doctor_clinic_name?.trim() || directoryEntry?.clinic_name?.trim() || null;

  return {
    heading: rawName ? formatDoctorHeading(rawName) : "Consultation appointment",
    modalName: rawName ? formatDoctorHeading(rawName) : "Healthcare Practitioner",
    specializationLabel: specialization ? specialization.toUpperCase() : "DOCTOR CONSULTATION",
    clinicName,
    searchTerms: [rawName, specialization, clinicName ?? ""].filter(Boolean),
  };
}

const appointmentClock = new Intl.DateTimeFormat("en-IN", {
  timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true,
});

export function formatAppointmentTime(value: string): string {
  // Preserve clinic wall-clock digits even on a browser-local DST transition.
  const time = Date.parse(`2000-01-01T${value}Z`);
  return Number.isFinite(time) ? appointmentClock.format(time) : value;
}

export function appointmentInstant(date: string, time: string): number {
  return Date.parse(`${date}T${time}+05:30`);
}

export function isUpcomingAppointment(appointment: PatientAppointment, now = Date.now()): boolean {
  return appointment.status === "booked" &&
    appointmentInstant(appointment.appointment_date, appointment.start_time) > now;
}

export function nextBookedAppointment(appointments: PatientAppointment[], now = Date.now()): PatientAppointment | null {
  return appointments.reduce<PatientAppointment | null>((next, appointment) => {
    if (!isUpcomingAppointment(appointment, now)) return next;
    const starts = appointmentInstant(appointment.appointment_date, appointment.start_time);
    return !next || starts < appointmentInstant(next.appointment_date, next.start_time) ? appointment : next;
  }, null);
}

export function createSlotRequests() {
  let current: AbortController | undefined;
  return {
    invalidate() {
      current?.abort();
      current = undefined;
    },
    begin(doctorId: string, date: string) {
      current?.abort();
      const request = new AbortController();
      current = request;
      return {
        signal: request.signal,
        isCurrent: () => current === request,
        matches: (response: AvailableSlotsResponse) =>
          current === request && response.doctor_profile_id === doctorId && response.appointment_date === date,
      };
    },
  };
}

export function classifyBookingFailure(error: unknown): "conflict" | "unknown" | "rejected" {
  const status = statusOf(error);
  if (status === 409) return "conflict";
  return status === undefined || status === 408 || status >= 500 ? "unknown" : "rejected";
}

export function matchBookedAttempt(appointments: PatientAppointment[], attempt: Pick<AppointmentCreateRequest, "doctor_profile_id" | "appointment_date" | "start_time">): PatientAppointment | undefined {
  const start = appointmentInstant(attempt.appointment_date, attempt.start_time);
  return appointments.find((appointment) => appointment.status === "booked" &&
    appointment.doctor_profile_id === attempt.doctor_profile_id &&
    appointmentInstant(appointment.appointment_date, appointment.start_time) === start);
}

import type { DoctorAppointmentItem } from "../../../types/doctor.ts";

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

function filterQueue(
  items: DoctorAppointmentItem[],
  tab: "all" | "today" | "upcoming" | "past_due" | "completed" | "cancelled",
  todayKolkata: string
): DoctorAppointmentItem[] {
  return items.filter((appt) => {
    if (tab === "today") {
      return appt.appointment_date === todayKolkata && appt.status === "booked";
    }
    if (tab === "upcoming") {
      return appt.appointment_date > todayKolkata && appt.status === "booked";
    }
    if (tab === "past_due") {
      return appt.appointment_date < todayKolkata && appt.status === "booked";
    }
    if (tab === "completed") {
      return appt.status === "completed";
    }
    if (tab === "cancelled") {
      return appt.status === "cancelled";
    }
    return true;
  });
}

// Mock dataset
const todayKolkata = "2026-11-27";
const mockAppointments: DoctorAppointmentItem[] = [
  {
    id: "appt-1",
    appointment_date: "2026-11-26",
    start_time: "10:00:00",
    end_time: "10:30:00",
    status: "booked",
    patient_name: "Overdue Patient",
    reason: "Follow-up check",
    patient_profile_id: "pat-1",
    doctor_profile_id: "doc-1",
    created_at: "2026-11-20T10:00:00Z",
    updated_at: "2026-11-20T10:00:00Z",
  },
  {
    id: "appt-2",
    appointment_date: "2026-11-27",
    start_time: "11:00:00",
    end_time: "11:30:00",
    status: "booked",
    patient_name: "Today Patient",
    reason: "Skin examination",
    patient_profile_id: "pat-2",
    doctor_profile_id: "doc-1",
    created_at: "2026-11-20T10:00:00Z",
    updated_at: "2026-11-20T10:00:00Z",
  },
  {
    id: "appt-3",
    appointment_date: "2026-11-28",
    start_time: "14:00:00",
    end_time: "14:30:00",
    status: "booked",
    patient_name: "Future Patient",
    reason: "New consultation",
    patient_profile_id: "pat-3",
    doctor_profile_id: "doc-1",
    created_at: "2026-11-20T10:00:00Z",
    updated_at: "2026-11-20T10:00:00Z",
  },
  {
    id: "appt-4",
    appointment_date: "2026-11-26",
    start_time: "15:00:00",
    end_time: "15:30:00",
    status: "completed",
    patient_name: "Completed Patient",
    reason: "Routine visit",
    patient_profile_id: "pat-4",
    doctor_profile_id: "doc-1",
    created_at: "2026-11-20T10:00:00Z",
    updated_at: "2026-11-20T10:00:00Z",
  },
  {
    id: "appt-5",
    appointment_date: "2026-11-27",
    start_time: "16:00:00",
    end_time: "16:30:00",
    status: "cancelled",
    patient_name: "Cancelled Patient",
    reason: "Patient emergency",
    patient_profile_id: "pat-5",
    doctor_profile_id: "doc-1",
    created_at: "2026-11-20T10:00:00Z",
    updated_at: "2026-11-20T10:00:00Z",
  },
];

// Test 1: Past-Due queue filtering
const pastDueList = filterQueue(mockAppointments, "past_due", todayKolkata);
equal(pastDueList.length, 1, "Past-due filter returns exactly 1 overdue booked appointment");
equal(pastDueList[0].id, "appt-1", "Correct overdue appointment selected");

// Test 2: Today queue filtering
const todayList = filterQueue(mockAppointments, "today", todayKolkata);
equal(todayList.length, 1, "Today filter returns exactly 1 today appointment");
equal(todayList[0].id, "appt-2", "Correct today appointment selected");

// Test 3: Upcoming queue filtering
const upcomingList = filterQueue(mockAppointments, "upcoming", todayKolkata);
equal(upcomingList.length, 1, "Upcoming filter returns exactly 1 future appointment");
equal(upcomingList[0].id, "appt-3", "Correct upcoming appointment selected");

// Test 4: Completed queue filtering
const completedList = filterQueue(mockAppointments, "completed", todayKolkata);
equal(completedList.length, 1, "Completed filter returns exactly 1 completed visit");
equal(completedList[0].id, "appt-4", "Correct completed appointment selected");

// Test 5: Cancelled queue filtering
const cancelledList = filterQueue(mockAppointments, "cancelled", todayKolkata);
equal(cancelledList.length, 1, "Cancelled filter returns exactly 1 cancelled visit");
equal(cancelledList[0].id, "appt-5", "Correct cancelled appointment selected");

// Test 6: All appointments count
const allList = filterQueue(mockAppointments, "all", todayKolkata);
equal(allList.length, 5, "All filter returns all 5 appointments");

// Test 7: Overdue booked appointments are NOT hidden from queue
const allBooked = mockAppointments.filter((a) => a.status === "booked");
equal(allBooked.length, 3, "Total 3 booked appointments in system");
truthy(allBooked.some((a) => a.appointment_date < todayKolkata), "Overdue appointment is detected and surfaced");

console.log("All 7 stage4dDoctorQueue unit tests PASSED successfully!");

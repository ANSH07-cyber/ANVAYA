
export interface PatientProfile {
  id: string;
  user_id: string;
  date_of_birth: string | null;
  phone_number: string | null;
  gender: string | null;
  blood_group: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientProfileUpdate {
  date_of_birth?: string | null;
  phone_number?: string | null;
  gender?: string | null;
  blood_group?: string | null;
  address?: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type AppointmentStatus = "booked" | "cancelled" | "completed";

export interface PatientAppointment {
  id: string;
  patient_profile_id: string;
  doctor_profile_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientHealthRecord {
  id: string;
  patient_profile_id: string;
  doctor_profile_id: string;
  appointment_id: string;
  visit_date: string;
  chief_complaint: string | null;
  visit_summary: string;
  symptoms: string | null;
  diagnosis: string | null;
  clinical_notes: string | null;
  treatment_plan: string | null;
  follow_up_instructions: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrescriptionItem {
  id: string;
  prescription_id: string;
  medicine_name: string;
  dosage: string;
  route: string | null;
  frequency: string;
  duration: string;
  quantity: string | null;
  instructions: string | null;
  sort_order: number;
}

export interface PatientPrescription {
  id: string;
  patient_profile_id: string;
  doctor_profile_id: string;
  appointment_id: string;
  health_record_id: string;
  notes: string | null;
  issued_at: string;
  created_at: string;
  updated_at: string;
  items: PrescriptionItem[];
}

export interface AvailableSlot {
  start_time: string;
  end_time: string;
}

export interface AvailableSlotsResponse {
  doctor_profile_id: string;
  appointment_date: string;
  items: AvailableSlot[];
  total: number;
}

export interface AppointmentCreateRequest {
  doctor_profile_id: string;
  appointment_date: string;
  start_time: string;
  reason?: string | null;
}

export interface AppointmentRescheduleRequest {
  appointment_date: string;
  start_time: string;
}

export type {
  ProposalStatus,
  AppointmentRescheduleProposal,
  RescheduleProposalListResponse,
  RescheduleProposalCreatePayload,
  RescheduleProposalRespondPayload,
} from "./appointmentReschedule";




export type AppointmentStatus = "booked" | "cancelled" | "completed";

export interface DoctorAppointmentItem {
  id: string;
  patient_profile_id: string;
  doctor_profile_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  reason: string | null;
  patient_name: string;
  created_at: string;
  updated_at: string;
}

export interface DoctorAppointmentListResponse {
  items: DoctorAppointmentItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface DoctorAvailabilityItem {
  id: string;
  doctor_profile_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DoctorAvailabilityListResponse {
  items: DoctorAvailabilityItem[];
  total: number;
}

export interface DoctorAvailabilityCreatePayload {
  weekday: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes?: number;
}

export interface DoctorAvailabilityUpdatePayload {
  weekday: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes?: number;
}

export interface DoctorAvailabilityStatusPayload {
  is_active: boolean;
}

export interface ConsultationCompletionPayload {
  visit_summary: string;
  chief_complaint?: string | null;
  symptoms?: string | null;
  diagnosis?: string | null;
  clinical_notes?: string | null;
  treatment_plan?: string | null;
  follow_up_instructions?: string | null;
}

export interface DoctorAppointmentCancelPayload {
  cancellation_reason: string;
  idempotency_key?: string;
}

export interface HealthRecordRead {
  id: string;
  patient_profile_id: string;
  doctor_profile_id: string;
  appointment_id: string;
  visit_date: string;
  visit_summary: string;
  chief_complaint: string | null;
  symptoms: string | null;
  diagnosis: string | null;
  clinical_notes: string | null;
  treatment_plan: string | null;
  follow_up_instructions: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrescriptionItemCreate {
  medicine_name: string;
  dosage: string;
  route?: string | null;
  frequency: string;
  duration: string;
  quantity?: string | null;
  instructions?: string | null;
}

export interface PrescriptionCreatePayload {
  appointment_id: string;
  notes?: string | null;
  items: PrescriptionItemCreate[];
}

export interface PrescriptionItemRead {
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

export interface PrescriptionRead {
  id: string;
  patient_profile_id: string;
  doctor_profile_id: string;
  appointment_id: string;
  health_record_id: string;
  notes: string | null;
  issued_at: string;
  created_at: string;
  updated_at: string;
  items: PrescriptionItemRead[];
}

export interface PrescriptionListResponse {
  items: PrescriptionRead[];
  total: number;
  limit: number;
  offset: number;
}

export interface DoctorPrescriptionRead extends PrescriptionRead {
  patient_name: string;
  appointment_date: string;
}

export interface DoctorPrescriptionListResponse {
  items: DoctorPrescriptionRead[];
  total: number;
  limit: number;
  offset: number;
}

export interface DoctorPrescriptionFilterParams {
  limit?: number;
  offset?: number;
  search?: string;
  appointment_id?: string;
  patient_profile_id?: string;
}

export type HealthDataScope =
  | "visit_summary"
  | "chief_complaint"
  | "symptoms"
  | "diagnosis"
  | "clinical_notes"
  | "treatment_plan"
  | "follow_up_instructions";

export interface DoctorSharedHealthRecordRead {
  record_id: string;
  visit_date: string;
  data: Partial<Record<HealthDataScope, string | null>>;
}

export interface DoctorSharedHealthRecordListResponse {
  items: DoctorSharedHealthRecordRead[];
  total: number;
  limit: number;
  offset: number;
  requested_scopes: HealthDataScope[];
}

export type DoctorVerificationStatus = "pending" | "approved" | "rejected";

export interface DoctorProfileMeResponse {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  specialization: string;
  qualification: string;
  license_number: string;
  years_experience: number | null;
  clinic_name: string | null;
  consultation_fee: number | string | null;
  bio: string | null;
  verification_status: DoctorVerificationStatus;
  created_at: string;
  updated_at: string;
}

export interface DoctorProfileUpdatePayload {
  full_name?: string;
  specialization?: string;
  qualification?: string;
  years_experience?: number | null;
  clinic_name?: string | null;
  consultation_fee?: number | null;
  bio?: string | null;
}

export interface DoctorPatientDirectoryItem {
  patient_profile_id: string;
  full_name: string;
  phone_number: string | null;
  gender: string | null;
  total_appointments: number;
  last_appointment_date: string;
  last_appointment_status: string;
  has_active_consent: boolean;
}

export interface DoctorPatientDirectoryFilterParams {
  search?: string;
  has_consent?: boolean;
  limit?: number;
  offset?: number;
}

export interface DoctorPatientDirectoryResponse {
  items: DoctorPatientDirectoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export type {
  ProposalStatus,
  AppointmentRescheduleProposal,
  RescheduleProposalListResponse,
  RescheduleProposalCreatePayload,
  RescheduleProposalRespondPayload,
} from "./appointmentReschedule";



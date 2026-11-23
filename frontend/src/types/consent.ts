export type HealthDataScope =
  | "visit_summary"
  | "chief_complaint"
  | "symptoms"
  | "diagnosis"
  | "clinical_notes"
  | "treatment_plan"
  | "follow_up_instructions";

export type ConsentRequestStatus =
  | "pending"
  | "approved"
  | "partially_approved"
  | "declined"
  | "expired"
  | "superseded";

export interface ConsentGrantRequest {
  doctor_profile_id: string;
  data_scopes: HealthDataScope[];
}

export interface PatientConsent {
  id: string;
  patient_profile_id: string;
  doctor_profile_id: string;
  data_scopes: HealthDataScope[];
  is_active: boolean;
  granted_at: string;
  revoked_at: string | null;
}

export type ConsentRead = PatientConsent;

export interface ConsentListResponse {
  items: PatientConsent[];
  total: number;
  limit: number;
  offset: number;
}

export interface ConsentDoctor {
  id: string;
  full_name: string;
  specialization: string;
  qualification: string;
  years_experience: number | null;
  clinic_name: string | null;
  consultation_fee: number | null;
  bio: string | null;
}

export interface DoctorListResponse {
  items: ConsentDoctor[];
  total: number;
  limit: number;
  offset: number;
}

export interface ConsentRequestCreate {
  patient_profile_id: string;
  requested_scopes: HealthDataScope[];
  doctor_message?: string | null;
  idempotency_key?: string | null;
}

export interface ConsentRequestRespond {
  action: "approve" | "decline";
  approved_scopes?: HealthDataScope[] | null;
  idempotency_key?: string | null;
}

export interface ConsentRequestRead {
  id: string;
  doctor_profile_id: string;
  patient_profile_id: string;
  requested_scopes: HealthDataScope[];
  approved_scopes: HealthDataScope[] | null;
  doctor_message: string | null;
  status: ConsentRequestStatus;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  consent_record_id: string | null;
  doctor_name: string | null;
  doctor_specialization: string | null;
  clinic_name: string | null;
  patient_name: string | null;
}

export interface ConsentRequestListResponse {
  items: ConsentRequestRead[];
  total: number;
  limit: number;
  offset: number;
}

export interface DoctorPatientConsentStatus {
  doctor_profile_id: string;
  patient_profile_id: string;
  has_active_consent: boolean;
  active_consent_id: string | null;
  active_scopes: HealthDataScope[];
  pending_request: ConsentRequestRead | null;
  can_request_consent: boolean;
  relationship_established: boolean;
}

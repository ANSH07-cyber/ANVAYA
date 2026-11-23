export type ProposalStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "superseded";

export interface AppointmentRescheduleProposal {
  id: string;
  appointment_id: string;
  doctor_profile_id: string;
  patient_profile_id: string;
  proposed_date: string;
  proposed_start_time: string;
  proposed_end_time: string;
  doctor_message: string | null;
  status: ProposalStatus;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  doctor_name?: string | null;
  doctor_specialization?: string | null;
  patient_name?: string | null;
  current_appointment_date?: string | null;
  current_start_time?: string | null;
  current_end_time?: string | null;
}

export interface RescheduleProposalListResponse {
  items: AppointmentRescheduleProposal[];
  total: number;
  limit: number;
  offset: number;
}

export interface RescheduleProposalCreatePayload {
  proposed_date: string;
  proposed_start_time: string;
  doctor_message?: string | null;
  idempotency_key?: string | null;
}

export interface RescheduleProposalRespondPayload {
  action: "accept" | "decline";
  idempotency_key?: string | null;
}

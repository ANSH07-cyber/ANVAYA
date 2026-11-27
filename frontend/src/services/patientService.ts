import api from "./api";
import { requireReadableHealthRecords, type PatientPageQuery } from "./patientReliability";

import type {
  PatientProfile,
  PatientProfileUpdate,
  PatientAppointment,
  PatientHealthRecord,
  PatientPrescription,
  PaginatedResponse,
  AvailableSlotsResponse,
  DoctorPublicAvailabilityListResponse,
  ApprovedDoctorSummary,
  AppointmentCreateRequest,
  AppointmentRescheduleRequest,
  AppointmentRescheduleProposal,
  RescheduleProposalListResponse,
  RescheduleProposalRespondPayload,
} from "../types/patient";

async function getMyProfile(): Promise<PatientProfile> {
  const response = await api.get<PatientProfile>("/patients/me");
  return response.data;
}

async function updateMyProfile(
  payload: PatientProfileUpdate,
): Promise<PatientProfile> {
  const response = await api.put<PatientProfile>(
    "/patients/me",
    payload,
  );

  return response.data;
}

async function getMyAppointments({ limit, offset, signal }: Partial<PatientPageQuery> = {}): Promise<PaginatedResponse<PatientAppointment>> {
  const response = await api.get<PaginatedResponse<PatientAppointment>>(
    "/appointments/me",
    { params: { limit, offset }, signal },
  );
  return response.data;
}

async function getMyHealthRecords({ limit, offset, signal }: Partial<PatientPageQuery> = {}): Promise<PaginatedResponse<PatientHealthRecord>> {
  const response = await api.get<PaginatedResponse<PatientHealthRecord>>(
    "/health-records/me",
    { params: { limit, offset }, signal },
  );
  return requireReadableHealthRecords(response.data);
}

async function getMyPrescriptions({ limit, offset, signal }: Partial<PatientPageQuery> = {}): Promise<PaginatedResponse<PatientPrescription>> {
  const response = await api.get<PaginatedResponse<PatientPrescription>>(
    "/prescriptions/me",
    { params: { limit, offset }, signal },
  );
  return response.data;
}

async function getApprovedDoctorsDirectory(
  { limit, offset, signal }: Partial<PatientPageQuery> = {},
): Promise<PaginatedResponse<ApprovedDoctorSummary>> {
  const response = await api.get<PaginatedResponse<ApprovedDoctorSummary>>(
    "/doctors",
    { params: { limit, offset }, signal },
  );
  return response.data;
}

async function getDoctorPublicAvailability(
  doctorProfileId: string,
  signal?: AbortSignal,
): Promise<DoctorPublicAvailabilityListResponse> {
  const response = await api.get<DoctorPublicAvailabilityListResponse>(
    `/doctors/${doctorProfileId}/availability`,
    { signal },
  );
  return response.data;
}

async function getDoctorAvailabilitySlots(
  doctorProfileId: string,
  appointmentDate: string,
  signal?: AbortSignal,
): Promise<AvailableSlotsResponse> {
  const response = await api.get<AvailableSlotsResponse>(
    `/doctors/${doctorProfileId}/availability/slots`,
    {
      params: { appointment_date: appointmentDate },
      signal,
    },
  );
  return response.data;
}

async function bookAppointment(
  payload: AppointmentCreateRequest,
): Promise<PatientAppointment> {
  const headers: Record<string, string> = {};
  if (payload.idempotency_key) {
    headers["Idempotency-Key"] = payload.idempotency_key;
  }
  const response = await api.post<PatientAppointment>(
    "/appointments",
    payload,
    { headers },
  );
  return response.data;
}

async function cancelAppointment(
  appointmentId: string,
): Promise<PatientAppointment> {
  const response = await api.patch<PatientAppointment>(
    `/appointments/${appointmentId}/cancel`,
  );
  return response.data;
}

async function rescheduleAppointment(
  appointmentId: string,
  payload: AppointmentRescheduleRequest,
): Promise<PatientAppointment> {
  const headers: Record<string, string> = {};
  if (payload.idempotency_key) {
    headers["Idempotency-Key"] = payload.idempotency_key;
  }
  const response = await api.patch<PatientAppointment>(
    `/appointments/${appointmentId}/reschedule`,
    payload,
    { headers },
  );
  return response.data;
}

async function getMyPendingProposals(): Promise<RescheduleProposalListResponse> {
  const response = await api.get<RescheduleProposalListResponse>(
    "/appointments/proposals/pending",
  );
  return response.data;
}

async function respondToRescheduleProposal(
  proposalId: string,
  payload: RescheduleProposalRespondPayload,
): Promise<AppointmentRescheduleProposal> {
  const headers: Record<string, string> = {};
  if (payload.idempotency_key) {
    headers["Idempotency-Key"] = payload.idempotency_key;
  }
  const response = await api.patch<AppointmentRescheduleProposal>(
    `/appointments/proposals/${proposalId}/respond`,
    payload,
    { headers },
  );
  return response.data;
}

async function getAppointmentProposals(
  appointmentId: string,
): Promise<RescheduleProposalListResponse> {
  const response = await api.get<RescheduleProposalListResponse>(
    `/appointments/${appointmentId}/proposals`,
  );
  return response.data;
}

export const patientService = {
  getMyProfile,
  updateMyProfile,
  getMyAppointments,
  getMyHealthRecords,
  getMyPrescriptions,
  getApprovedDoctorsDirectory,
  getDoctorPublicAvailability,
  getDoctorAvailabilitySlots,
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getMyPendingProposals,
  respondToRescheduleProposal,
  getAppointmentProposals,
};

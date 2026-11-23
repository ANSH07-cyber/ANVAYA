
import api from "./api";

import type {
  PatientProfile,
  PatientProfileUpdate,
  PatientAppointment,
  PatientHealthRecord,
  PatientPrescription,
  PaginatedResponse,
  AvailableSlotsResponse,
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

async function getMyAppointments(): Promise<PaginatedResponse<PatientAppointment>> {
  const response = await api.get<PaginatedResponse<PatientAppointment>>(
    "/appointments/me",
  );
  return response.data;
}

async function getMyHealthRecords(): Promise<PaginatedResponse<PatientHealthRecord>> {
  const response = await api.get<PaginatedResponse<PatientHealthRecord>>(
    "/health-records/me",
  );
  return response.data;
}

async function getMyPrescriptions(): Promise<PaginatedResponse<PatientPrescription>> {
  const response = await api.get<PaginatedResponse<PatientPrescription>>(
    "/prescriptions/me",
  );
  return response.data;
}

async function getDoctorAvailabilitySlots(
  doctorProfileId: string,
  appointmentDate: string,
): Promise<AvailableSlotsResponse> {
  const response = await api.get<AvailableSlotsResponse>(
    `/doctors/${doctorProfileId}/availability/slots`,
    {
      params: { appointment_date: appointmentDate },
    },
  );
  return response.data;
}

async function bookAppointment(
  payload: AppointmentCreateRequest,
): Promise<PatientAppointment> {
  const response = await api.post<PatientAppointment>(
    "/appointments",
    payload,
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
  const response = await api.patch<PatientAppointment>(
    `/appointments/${appointmentId}/reschedule`,
    payload,
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
  getDoctorAvailabilitySlots,
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getMyPendingProposals,
  respondToRescheduleProposal,
  getAppointmentProposals,
};

import axios from "axios";
import api from "./api";
import type {
  DoctorAppointmentItem,
  DoctorAppointmentListResponse,
  DoctorAppointmentSummaryResponse,
  DoctorAvailabilityListResponse,
  DoctorAvailabilityItem,
  DoctorAvailabilityCreatePayload,
  DoctorAvailabilityUpdatePayload,
  DoctorAvailabilityStatusPayload,
  ConsultationCompletionPayload,
  DoctorAppointmentCancelPayload,
  HealthRecordRead,
  PrescriptionCreatePayload,
  PrescriptionRead,
  DoctorSharedHealthRecordListResponse,
  HealthDataScope,
  DoctorPrescriptionRead,
  DoctorPrescriptionListResponse,
  DoctorPrescriptionFilterParams,
  DoctorProfileMeResponse,
  DoctorProfileUpdatePayload,
  DoctorPatientDirectoryResponse,
  DoctorPatientDirectoryFilterParams,
  AppointmentRescheduleProposal,
  RescheduleProposalListResponse,
  RescheduleProposalCreatePayload,
} from "../types/doctor";
import type { AvailableSlotsResponse } from "../types/patient";

async function getDoctorAppointments(
  limit: number = 50,
  offset: number = 0,
  params?: {
    status?: string;
    tab?: string;
    appointment_date?: string;
    search?: string;
  },
): Promise<DoctorAppointmentListResponse> {
  const queryParams: Record<string, string | number> = { limit, offset };
  if (params?.status) queryParams.status = params.status;
  if (params?.tab) queryParams.tab = params.tab;
  if (params?.appointment_date) queryParams.appointment_date = params.appointment_date;
  if (params?.search) queryParams.search = params.search;

  const response = await api.get<DoctorAppointmentListResponse>(
    "/appointments/doctor/me",
    {
      params: queryParams,
    },
  );
  return response.data;
}

async function getDoctorAppointmentSummary(): Promise<DoctorAppointmentSummaryResponse> {
  const response = await api.get<DoctorAppointmentSummaryResponse>(
    "/appointments/doctor/me/summary",
  );
  return response.data;
}

async function getDoctorAppointmentById(
  appointmentId: string,
): Promise<DoctorAppointmentItem | null> {
  try {
    const response = await api.get<DoctorAppointmentItem>(
      `/appointments/${appointmentId}`,
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

async function getDoctorAvailability(): Promise<DoctorAvailabilityListResponse> {
  const response = await api.get<DoctorAvailabilityListResponse>(
    "/doctors/me/availability",
  );
  return response.data;
}

async function createDoctorAvailability(
  payload: DoctorAvailabilityCreatePayload,
): Promise<DoctorAvailabilityItem> {
  const response = await api.post<DoctorAvailabilityItem>(
    "/doctors/me/availability",
    payload,
  );
  return response.data;
}

async function updateDoctorAvailability(
  availabilityId: string,
  payload: DoctorAvailabilityUpdatePayload,
): Promise<DoctorAvailabilityItem> {
  const response = await api.put<DoctorAvailabilityItem>(
    `/doctors/me/availability/${availabilityId}`,
    payload,
  );
  return response.data;
}

async function updateDoctorAvailabilityStatus(
  availabilityId: string,
  payload: DoctorAvailabilityStatusPayload,
): Promise<DoctorAvailabilityItem> {
  const response = await api.patch<DoctorAvailabilityItem>(
    `/doctors/me/availability/${availabilityId}/status`,
    payload,
  );
  return response.data;
}

async function deleteDoctorAvailability(
  availabilityId: string,
): Promise<DoctorAvailabilityItem> {
  const response = await api.delete<DoctorAvailabilityItem>(
    `/doctors/me/availability/${availabilityId}`,
  );
  return response.data;
}

async function completeConsultation(
  appointmentId: string,
  payload: ConsultationCompletionPayload,
): Promise<HealthRecordRead> {
  const response = await api.patch<HealthRecordRead>(
    `/appointments/${appointmentId}/status`,
    payload,
  );
  return response.data;
}

async function cancelDoctorAppointment(
  appointmentId: string,
  payload: DoctorAppointmentCancelPayload,
): Promise<DoctorAppointmentItem> {
  const response = await api.patch<DoctorAppointmentItem>(
    `/appointments/doctor/${appointmentId}/cancel`,
    payload,
  );
  return response.data;
}

async function createPrescription(
  payload: PrescriptionCreatePayload,
): Promise<PrescriptionRead> {
  const response = await api.post<PrescriptionRead>(
    "/prescriptions",
    payload,
  );
  return response.data;
}

async function getPatientHealthRecords(
  patientProfileId: string,
  scopes: HealthDataScope[],
  limit: number = 20,
  offset: number = 0,
): Promise<DoctorSharedHealthRecordListResponse> {
  const queryParams = new URLSearchParams();
  scopes.forEach((scope) => queryParams.append("scopes", scope));
  queryParams.set("limit", String(limit));
  queryParams.set("offset", String(offset));

  const response = await api.get<DoctorSharedHealthRecordListResponse>(
    `/health-records/patient/${patientProfileId}?${queryParams.toString()}`,
  );
  return response.data;
}

async function getDoctorPrescriptions(
  params?: DoctorPrescriptionFilterParams,
): Promise<DoctorPrescriptionListResponse> {
  const response = await api.get<DoctorPrescriptionListResponse>(
    "/prescriptions/doctor/me",
    { params },
  );
  return response.data;
}

async function getDoctorPrescriptionById(
  prescriptionId: string,
): Promise<DoctorPrescriptionRead> {
  const response = await api.get<DoctorPrescriptionRead>(
    `/prescriptions/doctor/${prescriptionId}`,
  );
  return response.data;
}

async function getDoctorProfile(): Promise<DoctorProfileMeResponse> {
  const response = await api.get<DoctorProfileMeResponse>("/doctors/me");
  return response.data;
}

async function updateDoctorProfile(
  payload: DoctorProfileUpdatePayload,
): Promise<DoctorProfileMeResponse> {
  const response = await api.patch<DoctorProfileMeResponse>(
    "/doctors/me",
    payload,
  );
  return response.data;
}

async function getDoctorPatients(
  params?: DoctorPatientDirectoryFilterParams,
): Promise<DoctorPatientDirectoryResponse> {
  const queryParams: Record<string, string | number | boolean> = {};

  if (params?.search && params.search.trim()) {
    queryParams.search = params.search.trim();
  }

  if (typeof params?.has_consent === "boolean") {
    queryParams.has_consent = params.has_consent;
  }

  if (typeof params?.limit === "number") {
    queryParams.limit = params.limit;
  }

  if (typeof params?.offset === "number") {
    queryParams.offset = params.offset;
  }

  const response = await api.get<DoctorPatientDirectoryResponse>(
    "/doctors/me/patients",
    { params: queryParams },
  );
  return response.data;
}

async function proposeAppointmentReschedule(
  appointmentId: string,
  payload: RescheduleProposalCreatePayload,
): Promise<AppointmentRescheduleProposal> {
  const headers: Record<string, string> = {};
  if (payload.idempotency_key) {
    headers["Idempotency-Key"] = payload.idempotency_key;
  }
  const response = await api.post<AppointmentRescheduleProposal>(
    `/appointments/doctor/${appointmentId}/propose-reschedule`,
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

export const doctorService = {
  getDoctorAppointments,
  getDoctorAppointmentSummary,
  getDoctorAppointmentById,
  getDoctorAvailability,
  createDoctorAvailability,
  updateDoctorAvailability,
  updateDoctorAvailabilityStatus,
  deleteDoctorAvailability,
  completeConsultation,
  cancelDoctorAppointment,
  createPrescription,
  getPatientHealthRecords,
  getDoctorPrescriptions,
  getDoctorPrescriptionById,
  getDoctorProfile,
  updateDoctorProfile,
  getDoctorPatients,
  proposeAppointmentReschedule,
  getAppointmentProposals,
  getDoctorAvailabilitySlots,
};



import api from "./api";

import type {
  ConsentGrantRequest,
  ConsentListResponse,
  ConsentRequestCreate,
  ConsentRequestListResponse,
  ConsentRequestRead,
  ConsentRequestRespond,
  DoctorListResponse,
  DoctorPatientConsentStatus,
  PatientConsent,
} from "../types/consent";

async function getDoctors(): Promise<DoctorListResponse> {
  const response = await api.get<DoctorListResponse>("/doctors");
  return response.data;
}

async function getMyConsents(params?: {
  limit?: number;
  offset?: number;
}): Promise<ConsentListResponse> {
  const response = await api.get<ConsentListResponse>("/consents/me", {
    params: {
      limit: params?.limit ?? 20,
      offset: params?.offset ?? 0,
    },
  });
  return response.data;
}

async function grantConsent(
  payload: ConsentGrantRequest,
): Promise<PatientConsent> {
  const response = await api.post<PatientConsent>("/consents", payload);
  return response.data;
}

async function revokeConsent(
  consentId: string,
): Promise<PatientConsent> {
  const response = await api.patch<PatientConsent>(
    `/consents/${consentId}/revoke`,
  );

  return response.data;
}

async function getDoctorPatientConsentStatus(
  patientProfileId: string,
): Promise<DoctorPatientConsentStatus> {
  const response = await api.get<DoctorPatientConsentStatus>(
    `/consents/status/patient/${patientProfileId}`,
  );
  return response.data;
}

async function createConsentRequest(
  payload: ConsentRequestCreate,
  idempotencyKey?: string,
): Promise<ConsentRequestRead> {
  const effectiveKey =
    (idempotencyKey || payload.idempotency_key || "").trim() || undefined;
  const headers: Record<string, string> = {};
  if (effectiveKey) {
    headers["X-Idempotency-Key"] = effectiveKey;
    headers["Idempotency-Key"] = effectiveKey;
  }
  const body: ConsentRequestCreate = effectiveKey
    ? { ...payload, idempotency_key: effectiveKey }
    : payload;

  const response = await api.post<ConsentRequestRead>(
    "/consents/requests",
    body,
    { headers },
  );
  return response.data;
}

async function getPendingConsentRequests(params?: {
  limit?: number;
  offset?: number;
}): Promise<ConsentRequestListResponse> {
  const response = await api.get<ConsentRequestListResponse>(
    "/consents/requests/pending",
    {
      params: {
        limit: params?.limit ?? 20,
        offset: params?.offset ?? 0,
      },
    },
  );
  return response.data;
}

async function getConsentRequestById(
  requestId: string,
): Promise<ConsentRequestRead> {
  const response = await api.get<ConsentRequestRead>(
    `/consents/requests/${requestId}`,
  );
  return response.data;
}

async function respondToConsentRequest(
  requestId: string,
  payload: ConsentRequestRespond,
  idempotencyKey?: string,
): Promise<ConsentRequestRead> {
  const effectiveKey =
    (idempotencyKey || payload.idempotency_key || "").trim() || undefined;
  const headers: Record<string, string> = {};
  if (effectiveKey) {
    headers["X-Idempotency-Key"] = effectiveKey;
    headers["Idempotency-Key"] = effectiveKey;
  }
  const body: ConsentRequestRespond = effectiveKey
    ? { ...payload, idempotency_key: effectiveKey }
    : payload;

  const response = await api.patch<ConsentRequestRead>(
    `/consents/requests/${requestId}/respond`,
    body,
    { headers },
  );
  return response.data;
}

async function revokeAllConsentsForDoctor(
  doctorProfileId: string,
): Promise<ConsentListResponse> {
  const response = await api.patch<ConsentListResponse>(
    `/consents/doctor/${doctorProfileId}/revoke-all`,
  );
  return response.data;
}

export const consentService = {
  getDoctors,
  getMyConsents,
  grantConsent,
  revokeConsent,
  getDoctorPatientConsentStatus,
  createConsentRequest,
  getPendingConsentRequests,
  getConsentRequestById,
  respondToConsentRequest,
  revokeAllConsentsForDoctor,
};

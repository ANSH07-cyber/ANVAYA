/**
 * Static Typecheck Verification Test
 * Validates that all new and existing methods of consentService strictly conform
 * to the TypeScript contracts defined in types/consent.ts.
 */

import { consentService } from "../consentService";
import type {
  ConsentDoctor,
  ConsentGrantRequest,
  ConsentListResponse,
  ConsentRequestCreate,
  ConsentRequestListResponse,
  ConsentRequestRead,
  ConsentRequestRespond,
  ConsentRequestStatus,
  DoctorListResponse,
  DoctorPatientConsentStatus,
  HealthDataScope,
  PatientConsent,
} from "../../types/consent";

export async function verifyConsentServiceTypes(): Promise<void> {
  const dummyUuid = "00000000-0000-0000-0000-000000000000";
  const dummyScopes: HealthDataScope[] = ["diagnosis", "treatment_plan"];

  // 1. getDoctors
  const doctorsResp: DoctorListResponse = await consentService.getDoctors();
  const firstDoctor: ConsentDoctor | undefined = doctorsResp.items[0];
  if (firstDoctor) {
    const docName: string = firstDoctor.full_name;
    void docName;
  }

  // 2. getMyConsents (with and without params)
  const myConsentsA: ConsentListResponse = await consentService.getMyConsents();
  const myConsentsB: ConsentListResponse = await consentService.getMyConsents({
    limit: 10,
    offset: 0,
  });
  const firstConsent: PatientConsent | undefined = myConsentsA.items[0] || myConsentsB.items[0];
  if (firstConsent) {
    const isActive: boolean = firstConsent.is_active;
    const scopes: HealthDataScope[] = firstConsent.data_scopes;
    void isActive;
    void scopes;
  }

  // 3. grantConsent
  const grantPayload: ConsentGrantRequest = {
    doctor_profile_id: dummyUuid,
    data_scopes: dummyScopes,
  };
  const grantedConsent: PatientConsent = await consentService.grantConsent(grantPayload);
  const grantedId: string = grantedConsent.id;
  void grantedId;

  // 4. revokeConsent
  const revokedConsent: PatientConsent = await consentService.revokeConsent(dummyUuid);
  const isRevokedActive: boolean = revokedConsent.is_active;
  void isRevokedActive;

  // 5. getDoctorPatientConsentStatus
  const statusResp: DoctorPatientConsentStatus =
    await consentService.getDoctorPatientConsentStatus(dummyUuid);
  const canRequest: boolean = statusResp.can_request_consent;
  const activeScopes: HealthDataScope[] = statusResp.active_scopes;
  const pendingReq: ConsentRequestRead | null = statusResp.pending_request;
  void canRequest;
  void activeScopes;
  void pendingReq;

  // 6. createConsentRequest (with and without explicit idempotencyKey)
  const createPayload: ConsentRequestCreate = {
    patient_profile_id: dummyUuid,
    requested_scopes: ["clinical_notes", "symptoms"],
    doctor_message: "Need for follow-up evaluation",
    idempotency_key: "key-123",
  };
  const createdReqA: ConsentRequestRead =
    await consentService.createConsentRequest(createPayload);
  const createdReqB: ConsentRequestRead =
    await consentService.createConsentRequest(createPayload, "key-456");
  const reqStatusA: ConsentRequestStatus = createdReqA.status;
  const reqStatusB: ConsentRequestStatus = createdReqB.status;
  void reqStatusA;
  void reqStatusB;

  // 7. getPendingConsentRequests (with and without params)
  const pendingRespA: ConsentRequestListResponse =
    await consentService.getPendingConsentRequests();
  const pendingRespB: ConsentRequestListResponse =
    await consentService.getPendingConsentRequests({ limit: 5, offset: 0 });
  const pendingItem: ConsentRequestRead | undefined =
    pendingRespA.items[0] || pendingRespB.items[0];
  if (pendingItem) {
    const expiresAt: string = pendingItem.expires_at;
    void expiresAt;
  }

  // 8. getConsentRequestById
  const singleReq: ConsentRequestRead =
    await consentService.getConsentRequestById(dummyUuid);
  const singleStatus: ConsentRequestStatus = singleReq.status;
  void singleStatus;

  // 9. respondToConsentRequest (approve and decline)
  const approvePayload: ConsentRequestRespond = {
    action: "approve",
    approved_scopes: ["clinical_notes"],
  };
  const declinePayload: ConsentRequestRespond = {
    action: "decline",
  };
  const approvedResult: ConsentRequestRead =
    await consentService.respondToConsentRequest(dummyUuid, approvePayload, "key-789");
  const declinedResult: ConsentRequestRead =
    await consentService.respondToConsentRequest(dummyUuid, declinePayload);
  void approvedResult;
  void declinedResult;

  // 10. revokeAllConsentsForDoctor
  const revokeAllResp: ConsentListResponse =
    await consentService.revokeAllConsentsForDoctor(dummyUuid);
  const revokedCount: number = revokeAllResp.total;
  void revokedCount;
}

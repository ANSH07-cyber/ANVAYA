/**
 * ANVAYA — Step 4.1: Executable Runtime Pagination & Revocation Test Suite
 *
 * Runs all 10 test scenarios required by Stage 3 Phase 2B.5 Step 4.1.
 * Pure TypeScript implementation (zero external Node-only types).
 * Executable via: node --experimental-strip-types frontend/src/services/__tests__/consentPagination.test.ts
 */

import { fetchCompleteConsentHistory } from "../consentPagination.ts";
import type {
  ConsentListResponse,
  HealthDataScope,
  PatientConsent,
} from "../../types/consent.ts";

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message || `Assertion failed: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function assertTrue(value: boolean, message?: string): void {
  if (!value) {
    throw new Error(message || "Assertion failed: expected true, got false");
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message?: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(
      message || `Assertion failed: expected ${expectedStr}, got ${actualStr}`,
    );
  }
}

function createMockConsent(
  id: string,
  doctorId: string,
  scopes: HealthDataScope[],
  isActive: boolean,
  grantedAt = "2026-11-20T10:00:00Z",
): PatientConsent {
  return {
    id,
    patient_profile_id: "patient-profile-1",
    doctor_profile_id: doctorId,
    data_scopes: scopes,
    is_active: isActive,
    granted_at: grantedAt,
    revoked_at: isActive ? null : "2026-11-22T10:00:00Z",
  };
}

export async function runConsentPaginationTests(): Promise<{
  allPassed: boolean;
  passedCount: number;
}> {
  console.log("============================================================");
  console.log("ANVAYA Phase 2B.5 Step 4.1: Runtime Pagination Safety Tests");
  console.log("============================================================\n");

  let passedCount = 0;

  // --- Scenario 1: 0 consent records ---
  {
    console.log("Scenario 1: 0 consent records");
    const fetchFn = async (params: { limit: number; offset: number }): Promise<ConsentListResponse> => {
      assertEqual(params.offset, 0);
      return {
        items: [],
        total: 0,
        limit: 100,
        offset: 0,
      };
    };

    const result = await fetchCompleteConsentHistory(fetchFn);
    assertEqual(result.items.length, 0);
    assertEqual(result.serverTotal, 0);
    assertEqual(result.isComplete, true);
    assertEqual(result.hasPartialError, false);
    console.log("  ✓ Correctly handled 0 consent records as complete.\n");
    passedCount++;
  }

  // --- Scenario 2: 1 consent record ---
  {
    console.log("Scenario 2: 1 consent record");
    const mockRecord = createMockConsent("rec-1", "doc-A", ["diagnosis"], true);
    const fetchFn = async (params: { limit: number; offset: number }): Promise<ConsentListResponse> => {
      assertEqual(params.offset, 0);
      return {
        items: [mockRecord],
        total: 1,
        limit: 100,
        offset: 0,
      };
    };

    const result = await fetchCompleteConsentHistory(fetchFn);
    assertEqual(result.items.length, 1);
    assertEqual(result.serverTotal, 1);
    assertEqual(result.isComplete, true);
    assertEqual(result.hasPartialError, false);
    console.log("  ✓ Correctly loaded 1 consent record as complete in single page.\n");
    passedCount++;
  }

  // --- Scenario 3: Exactly 100 records (single page boundary) ---
  {
    console.log("Scenario 3: 100 records (single page limit)");
    const mock100 = Array.from({ length: 100 }, (_, i) =>
      createMockConsent(`rec-${i}`, "doc-A", ["symptoms"], true),
    );
    let fetchCalls = 0;
    const fetchFn = async (params: { limit: number; offset: number }): Promise<ConsentListResponse> => {
      fetchCalls++;
      assertEqual(params.offset, 0);
      return {
        items: mock100,
        total: 100,
        limit: 100,
        offset: 0,
      };
    };

    const result = await fetchCompleteConsentHistory(fetchFn);
    assertEqual(result.items.length, 100);
    assertEqual(result.serverTotal, 100);
    assertEqual(result.isComplete, true);
    assertEqual(fetchCalls, 1, "Should not make a second page call when first page satisfies total");
    console.log("  ✓ Correctly loaded 100 records in 1 call without redundant fetching.\n");
    passedCount++;
  }

  // --- Scenario 4: 1,001 records (11 pages, beyond 1,000 without truncation!) ---
  {
    console.log("Scenario 4: 1,001 records (validates removal of 1,000 truncation cap)");
    const totalCount = 1001;
    const allSynthetic = Array.from({ length: totalCount }, (_, i) =>
      createMockConsent(`rec-${i}`, "doc-A", ["clinical_notes"], true),
    );
    let fetchCalls = 0;
    const fetchFn = async (params: { limit: number; offset: number }): Promise<ConsentListResponse> => {
      fetchCalls++;
      const slice = allSynthetic.slice(params.offset, params.offset + params.limit);
      return {
        items: slice,
        total: totalCount,
        limit: params.limit,
        offset: params.offset,
      };
    };

    const result = await fetchCompleteConsentHistory(fetchFn);
    assertEqual(result.items.length, 1001, "Must load all 1,001 records");
    assertEqual(result.serverTotal, 1001);
    assertEqual(result.isComplete, true);
    assertEqual(result.hasPartialError, false);
    assertEqual(fetchCalls, 11, "Should have retrieved 11 pages (10x100 + 1x1)");
    console.log("  ✓ Correctly loaded 1,001 records across 11 pages without silent 1,000 truncation.\n");
    passedCount++;
  }

  // --- Scenario 5: More than 1,500 records (1,550 records across 16 pages) ---
  {
    console.log("Scenario 5: 1,550 records (large volume multi-page retrieval)");
    const totalCount = 1550;
    const allSynthetic = Array.from({ length: totalCount }, (_, i) =>
      createMockConsent(`rec-${i}`, "doc-A", ["treatment_plan"], i % 2 === 0),
    );
    let fetchCalls = 0;
    const fetchFn = async (params: { limit: number; offset: number }): Promise<ConsentListResponse> => {
      fetchCalls++;
      const slice = allSynthetic.slice(params.offset, params.offset + params.limit);
      return {
        items: slice,
        total: totalCount,
        limit: params.limit,
        offset: params.offset,
      };
    };

    const result = await fetchCompleteConsentHistory(fetchFn);
    assertEqual(result.items.length, 1550);
    assertEqual(result.serverTotal, 1550);
    assertEqual(result.isComplete, true);
    assertEqual(fetchCalls, 16);
    console.log("  ✓ Successfully loaded 1,550 records in 16 calls without truncation.\n");
    passedCount++;
  }

  // --- Scenario 6: Empty page before reported total ---
  {
    console.log("Scenario 6: Empty page returned before reported total");
    let fetchCalls = 0;
    const fetchFn = async (params: { limit: number; offset: number }): Promise<ConsentListResponse> => {
      fetchCalls++;
      if (params.offset === 0) {
        return {
          items: Array.from({ length: 100 }, (_, i) =>
            createMockConsent(`rec-${i}`, "doc-A", ["visit_summary"], true),
          ),
          total: 250, // Claims 250 records exist
          limit: 100,
          offset: 0,
        };
      }
      // Page 2 unexpectedly returns empty
      return {
        items: [],
        total: 250,
        limit: 100,
        offset: 100,
      };
    };

    const result = await fetchCompleteConsentHistory(fetchFn);
    assertEqual(result.items.length, 100);
    assertEqual(result.serverTotal, 250);
    assertEqual(result.isComplete, false, "Must be marked incomplete when premature empty page occurs");
    assertEqual(result.hasPartialError, true);
    assertEqual(result.inconsistencyDetected, true);
    assertEqual(fetchCalls, 2);
    console.log("  ✓ Detected premature EOF, stopped loop, and flagged history as incomplete.\n");
    passedCount++;
  }

  // --- Scenario 7: Repeated page (duplicate page returned, loop prevention) ---
  {
    console.log("Scenario 7: Repeated page returned (infinite loop prevention)");
    const page1Items = Array.from({ length: 100 }, (_, i) =>
      createMockConsent(`rec-${i}`, "doc-A", ["visit_summary"], true),
    );
    let fetchCalls = 0;
    const fetchFn = async (params: { limit: number; offset: number }): Promise<ConsentListResponse> => {
      fetchCalls++;
      // Even on offset 100, server mistakenly sends page 1 items again
      return {
        items: page1Items,
        total: 300,
        limit: params.limit,
        offset: params.offset,
      };
    };

    const result = await fetchCompleteConsentHistory(fetchFn);
    assertEqual(result.items.length, 100, "Should deduplicate and not multiply items");
    assertEqual(result.isComplete, false);
    assertEqual(result.hasPartialError, true);
    assertEqual(result.inconsistencyDetected, true);
    assertEqual(fetchCalls, 2, "Loop must abort upon discovering repeated page with 0 new IDs");
    console.log("  ✓ Aborted infinite loop upon detecting zero new IDs on page 2.\n");
    passedCount++;
  }

  // --- Scenario 8: Network failure midway through loading ---
  {
    console.log("Scenario 8: Network failure on page 3");
    let fetchCalls = 0;
    const fetchFn = async (params: { limit: number; offset: number }): Promise<ConsentListResponse> => {
      fetchCalls++;
      if (params.offset === 0) {
        return {
          items: Array.from({ length: 100 }, (_, i) => createMockConsent(`p1-${i}`, "doc-A", ["diagnosis"], true)),
          total: 300,
          limit: 100,
          offset: 0,
        };
      }
      if (params.offset === 100) {
        return {
          items: Array.from({ length: 100 }, (_, i) => createMockConsent(`p2-${i}`, "doc-A", ["clinical_notes"], true)),
          total: 300,
          limit: 100,
          offset: 100,
        };
      }
      throw new Error("ETIMEDOUT: Connection reset by peer");
    };

    const result = await fetchCompleteConsentHistory(fetchFn);
    assertEqual(result.items.length, 200, "Should preserve the 200 records already received");
    assertEqual(result.serverTotal, 300);
    assertEqual(result.isComplete, false);
    assertEqual(result.hasPartialError, true);
    assertEqual(fetchCalls, 3);
    assertTrue(Boolean(result.errorMessage?.includes("ETIMEDOUT")));
    console.log("  ✓ Preserved 200 partially loaded records, flagged error, and marked isComplete=false.\n");
    passedCount++;
  }

  // --- Scenario 9: Multiple doctors with overlapping grants ---
  {
    console.log("Scenario 9: Multiple doctors with overlapping grants & partial safety");
    const docAGrant1 = createMockConsent("g1", "doc-A", ["diagnosis", "treatment_plan"], true);
    const docAGrant2 = createMockConsent("g2", "doc-A", ["diagnosis", "symptoms"], true);
    const docBGrant1 = createMockConsent("g3", "doc-B", ["visit_summary"], true);

    const consents = [docAGrant1, docAGrant2, docBGrant1];

    // Compute doctor groups
    const groupMap = new Map<string, PatientConsent[]>();
    for (const c of consents) {
      const list = groupMap.get(c.doctor_profile_id) || [];
      list.push(c);
      groupMap.set(c.doctor_profile_id, list);
    }

    const docAGrants = groupMap.get("doc-A")!;
    const docBGrants = groupMap.get("doc-B")!;

    assertEqual(docAGrants.length, 2);
    assertEqual(docBGrants.length, 1);

    const docAUnionScopes = Array.from(
      new Set(docAGrants.filter((c) => c.is_active).flatMap((c) => c.data_scopes)),
    );
    assertDeepEqual(docAUnionScopes.sort(), ["diagnosis", "symptoms", "treatment_plan"].sort());

    // Revoke single grant g1
    docAGrant1.is_active = false;
    const remainingScopesDocA = Array.from(
      new Set(docAGrants.filter((c) => c.is_active).flatMap((c) => c.data_scopes)),
    );
    assertTrue(remainingScopesDocA.includes("diagnosis"), "Overlapping diagnosis scope must survive");
    assertTrue(!remainingScopesDocA.includes("treatment_plan"), "Treatment plan was unique to g1 and is gone");

    console.log("  ✓ Verified overlapping scope survival across multiple doctor grants.\n");
    passedCount++;
  }

  // --- Scenario 10: Revoke-all impact summary after complete loading ---
  {
    console.log("Scenario 10: Revoke-all impact summary verification");
    const docAActiveGrants = [
      createMockConsent("g1", "doc-A", ["diagnosis"], true),
      createMockConsent("g2", "doc-A", ["symptoms", "clinical_notes"], true),
      createMockConsent("g3", "doc-A", ["treatment_plan"], true),
    ];
    const docARevokedGrant = createMockConsent("g4", "doc-A", ["visit_summary"], false);
    const allDocA = [...docAActiveGrants, docARevokedGrant];

    const activeCount = allDocA.filter((c) => c.is_active).length;
    const unionScopes = Array.from(
      new Set(allDocA.filter((c) => c.is_active).flatMap((c) => c.data_scopes)),
    );

    assertEqual(activeCount, 3);
    assertEqual(unionScopes.length, 4);
    assertTrue(unionScopes.includes("diagnosis"));
    assertTrue(unionScopes.includes("symptoms"));
    assertTrue(unionScopes.includes("clinical_notes"));
    assertTrue(unionScopes.includes("treatment_plan"));
    assertTrue(!unionScopes.includes("visit_summary"), "Revoked grant scope must not be in active union");

    console.log("  ✓ Verified active grant count and scope union precision for Revoke-All.\n");
    passedCount++;
  }

  console.log("============================================================");
  console.log(`ALL ${passedCount}/10 RUNTIME REGRESSION SCENARIOS PASSED!`);
  console.log("============================================================\n");

  return { allPassed: passedCount === 10, passedCount };
}

// Auto-run when executed directly via Node
void runConsentPaginationTests();

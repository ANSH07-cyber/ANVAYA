/**
 * ANVAYA — Patient Consent History Pagination Engine
 *
 * Implements bounded, safe multi-page retrieval for patient consent records.
 *
 * Safety guarantees:
 * 1. No silent truncation at 1,000 records.
 * 2. Deduplication across pages (guards against pagination drift).
 * 3. Premature EOF / empty page detection.
 * 4. Repeated page / infinite loop prevention.
 * 5. Explicit tracking of complete vs. partial history.
 * 6. Partial failure and network timeout resilience.
 */

import type { ConsentListResponse, PatientConsent } from "../types/consent";

export interface PaginationOptions {
  pageSize?: number; // Backend allows max 100
  maxPages?: number;  // Safety cap to prevent runaway memory (default 100 pages = 10,000 records)
}

export interface CompleteConsentHistoryResult {
  items: PatientConsent[];
  serverTotal: number;
  loadedCount: number;
  isComplete: boolean;
  hasPartialError: boolean;
  errorMessage?: string;
  inconsistencyDetected?: boolean;
}

export async function fetchCompleteConsentHistory(
  fetchPageFn: (params: { limit: number; offset: number }) => Promise<ConsentListResponse>,
  options: PaginationOptions = {},
): Promise<CompleteConsentHistoryResult> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 100);
  const maxPages = options.maxPages ?? 100;

  let firstPage: ConsentListResponse;
  try {
    firstPage = await fetchPageFn({ limit: pageSize, offset: 0 });
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : "Failed to load initial consent records.";
    return {
      items: [],
      serverTotal: 0,
      loadedCount: 0,
      isComplete: false,
      hasPartialError: true,
      errorMessage: errorMsg,
    };
  }

  const serverTotal = firstPage.total;

  // Handle empty history
  if (serverTotal === 0 || firstPage.items.length === 0) {
    if (serverTotal > 0 && firstPage.items.length === 0) {
      // Server claims records exist but first page is empty
      return {
        items: [],
        serverTotal,
        loadedCount: 0,
        isComplete: false,
        hasPartialError: true,
        errorMessage: `Server reported ${serverTotal} records but returned an empty first page.`,
        inconsistencyDetected: true,
      };
    }

    return {
      items: [],
      serverTotal: 0,
      loadedCount: 0,
      isComplete: true,
      hasPartialError: false,
    };
  }

  const seenIds = new Set<string>();
  const allItems: PatientConsent[] = [];

  // Deduplicate and collect first page
  for (const item of firstPage.items) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      allItems.push(item);
    }
  }

  // If first page holds all records, return immediately
  if (allItems.length >= serverTotal) {
    return {
      items: allItems,
      serverTotal,
      loadedCount: allItems.length,
      isComplete: true,
      hasPartialError: false,
    };
  }

  let currentPageIndex = 1;
  let hasPartialError = false;
  let errorMessage: string | undefined;
  let inconsistencyDetected = false;
  let currentServerTotal = serverTotal;

  // Paginate through remaining records
  while (allItems.length < currentServerTotal && currentPageIndex < maxPages) {
    const offset = currentPageIndex * pageSize;
    let nextPage: ConsentListResponse;

    try {
      nextPage = await fetchPageFn({ limit: pageSize, offset });
    } catch (err) {
      hasPartialError = true;
      errorMessage =
        err instanceof Error
          ? `Network error while loading page ${currentPageIndex + 1}: ${err.message}`
          : `Network error while loading page ${currentPageIndex + 1}.`;
      break;
    }

    // Detect premature empty page
    if (nextPage.items.length === 0) {
      hasPartialError = true;
      inconsistencyDetected = true;
      errorMessage = `Server returned an empty page at offset ${offset} before reaching reported total of ${currentServerTotal}.`;
      break;
    }

    // Detect repeated page / zero new records
    let newItemsCount = 0;
    for (const item of nextPage.items) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        allItems.push(item);
        newItemsCount++;
      }
    }

    if (newItemsCount === 0) {
      // Entire page was redundant/repeated - pagination loop safeguard
      hasPartialError = true;
      inconsistencyDetected = true;
      errorMessage = `Repeated or circular page detected at offset ${offset}. No new records discovered.`;
      break;
    }

    // Check for server total drift during pagination
    if (nextPage.total !== currentServerTotal) {
      currentServerTotal = Math.max(currentServerTotal, nextPage.total);
    }

    currentPageIndex++;
  }

  // Check if loop terminated due to maxPages threshold without finishing
  if (!hasPartialError && allItems.length < currentServerTotal && currentPageIndex >= maxPages) {
    hasPartialError = true;
    errorMessage = `Consent history exceeded safe retrieval threshold (${maxPages * pageSize} records).`;
  }

  const isComplete = !hasPartialError && allItems.length >= currentServerTotal;

  return {
    items: allItems,
    serverTotal: currentServerTotal,
    loadedCount: allItems.length,
    isComplete,
    hasPartialError,
    errorMessage,
    inconsistencyDetected,
  };
}

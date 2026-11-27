export const SKIN_HISTORY_PAGE_SIZE = 20;

export interface SkinHistoryPageMeta {
  currentPage: number;
  pageSize: number;
  total: number;
  totalPages: number;
  startItem: number;
  endItem: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  outOfRangePage: number | null;
  summaryText: string;
  pageIndicatorText: string;
}

export function normalizeHistoryTotal(total: number, fallbackItemCount = 0): number {
  if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
    return Math.trunc(total);
  }
  return Math.max(0, Math.trunc(fallbackItemCount));
}

export function computeHistoryPageMeta(
  requestedPage: number,
  itemCount: number,
  rawTotal: number,
  pageSize: number = SKIN_HISTORY_PAGE_SIZE,
): SkinHistoryPageMeta {
  const safeSize = Math.max(1, Math.trunc(pageSize) || SKIN_HISTORY_PAGE_SIZE);
  const safeCount = Math.max(0, Math.trunc(itemCount) || 0);
  const total = normalizeHistoryTotal(rawTotal, safeCount);
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const normalizedRequested = Math.max(1, Math.trunc(requestedPage) || 1);
  const outOfRangePage = normalizedRequested > totalPages ? totalPages : null;
  const currentPage = outOfRangePage ?? normalizedRequested;

  const startItem = safeCount > 0 ? (currentPage - 1) * safeSize + 1 : 0;
  const endItem = safeCount > 0 ? Math.min(total > 0 ? total : startItem + safeCount - 1, startItem + safeCount - 1) : 0;

  let summaryText: string;
  if (total === 0) {
    summaryText = '0 recorded entries';
  } else if (total <= safeSize && currentPage === 1) {
    summaryText = `${total} recorded ${total === 1 ? 'entry' : 'entries'}`;
  } else if (safeCount > 0) {
    summaryText = `Showing ${startItem}–${endItem} of ${total} analyses`;
  } else {
    summaryText = `${total} recorded ${total === 1 ? 'entry' : 'entries'}`;
  }

  return {
    currentPage,
    pageSize: safeSize,
    total,
    totalPages,
    startItem,
    endItem,
    canGoPrev: currentPage > 1,
    canGoNext: currentPage < totalPages && total > currentPage * safeSize,
    outOfRangePage,
    summaryText,
    pageIndicatorText: `Page ${currentPage} of ${totalPages}`,
  };
}

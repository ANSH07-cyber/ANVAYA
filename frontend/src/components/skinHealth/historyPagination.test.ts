import { computeHistoryPageMeta, SKIN_HISTORY_PAGE_SIZE } from './historyPagination.ts';

function equal<T>(actual: T, expected: T, message: string) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

equal(SKIN_HISTORY_PAGE_SIZE, 20, 'Default page size must be 20');

// 1. Zero history records
const zero = computeHistoryPageMeta(1, 0, 0);
equal(zero.total, 0, 'zero total');
equal(zero.totalPages, 1, 'zero totalPages');
equal(zero.currentPage, 1, 'zero currentPage');
equal(zero.canGoPrev, false, 'zero canGoPrev');
equal(zero.canGoNext, false, 'zero canGoNext');
equal(zero.outOfRangePage, null, 'zero outOfRangePage');
equal(zero.summaryText, '0 recorded entries', 'zero summary');
equal(zero.pageIndicatorText, 'Page 1 of 1', 'zero indicator');

// 2. Exactly 20 records -> single page, Next disabled
const twenty = computeHistoryPageMeta(1, 20, 20);
equal(twenty.total, 20, 'twenty total');
equal(twenty.totalPages, 1, 'twenty totalPages');
equal(twenty.canGoPrev, false, 'twenty canGoPrev');
equal(twenty.canGoNext, false, 'twenty canGoNext');
equal(twenty.summaryText, '20 recorded entries', 'twenty summary');
equal(twenty.pageIndicatorText, 'Page 1 of 1', 'twenty indicator');

// 3. 21 records -> two pages, page 1 canGoNext, page 2 has 1 item & shows 21 total
const twentyOneP1 = computeHistoryPageMeta(1, 20, 21);
equal(twentyOneP1.totalPages, 2, '21 p1 totalPages');
equal(twentyOneP1.canGoPrev, false, '21 p1 canGoPrev');
equal(twentyOneP1.canGoNext, true, '21 p1 canGoNext');
equal(twentyOneP1.summaryText, 'Showing 1–20 of 21 analyses', '21 p1 summary');
equal(twentyOneP1.pageIndicatorText, 'Page 1 of 2', '21 p1 indicator');

const twentyOneP2 = computeHistoryPageMeta(2, 1, 21);
equal(twentyOneP2.totalPages, 2, '21 p2 totalPages');
equal(twentyOneP2.canGoPrev, true, '21 p2 canGoPrev');
equal(twentyOneP2.canGoNext, false, '21 p2 canGoNext');
equal(twentyOneP2.summaryText, 'Showing 21–21 of 21 analyses', '21 p2 summary');
equal(twentyOneP2.pageIndicatorText, 'Page 2 of 2', '21 p2 indicator');

// 4. Multiple pages & middle page
const multiP2 = computeHistoryPageMeta(2, 20, 55);
equal(multiP2.totalPages, 3, '55 p2 totalPages');
equal(multiP2.canGoPrev, true, '55 p2 canGoPrev');
equal(multiP2.canGoNext, true, '55 p2 canGoNext');
equal(multiP2.summaryText, 'Showing 21–40 of 55 analyses', '55 p2 summary');
equal(multiP2.pageIndicatorText, 'Page 2 of 3', '55 p2 indicator');

// 5. Last page (page 3 of 55)
const multiP3 = computeHistoryPageMeta(3, 15, 55);
equal(multiP3.canGoPrev, true, '55 p3 canGoPrev');
equal(multiP3.canGoNext, false, '55 p3 canGoNext');
equal(multiP3.summaryText, 'Showing 41–55 of 55 analyses', '55 p3 summary');
equal(multiP3.pageIndicatorText, 'Page 3 of 3', '55 p3 indicator');

// 6. Total count shrinks below current page -> returns safe fallback page
const shrunk = computeHistoryPageMeta(3, 0, 20);
equal(shrunk.outOfRangePage, 1, 'shrunk outOfRangePage');
equal(shrunk.currentPage, 1, 'shrunk currentPage');
equal(shrunk.totalPages, 1, 'shrunk totalPages');

const shrunkZero = computeHistoryPageMeta(2, 0, 0);
equal(shrunkZero.outOfRangePage, 1, 'shrunkZero outOfRangePage');
equal(shrunkZero.currentPage, 1, 'shrunkZero currentPage');

console.log('Skin health history pagination tests passed');

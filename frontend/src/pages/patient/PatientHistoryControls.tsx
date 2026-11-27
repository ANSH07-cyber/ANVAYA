import type { PaginatedResponse } from "../../types/patient";
import { HISTORY_PAGE_SIZE } from "../../services/patientReliability";

interface Props {
  page?: PaginatedResponse<unknown>;
  offset: number;
  loadedCount: number;
  setOffset: (offset: number) => void;
}

export default function PatientHistoryControls({ page, offset, loadedCount, setOffset }: Props) {
  const hasMore = !!page && offset + page.items.length < page.total && page.items.length > 0;
  const incomplete = !!page && (offset > 0 || hasMore || loadedCount !== page.total);
  const lastOffset = page ? Math.max(0, Math.ceil(page.total / HISTORY_PAGE_SIZE) - 1) * HISTORY_PAGE_SIZE : offset;
  return (
    <>
      {page && incomplete && (
        <p role="status">
          {page.items.length ? `Viewing entries ${offset + 1}–${offset + page.items.length} of ${page.total}. Search, filters and summary counts apply to this page.`
            : `This page is empty. ${page.total} entries are available on other pages.`}
          {loadedCount < page.items.length && " Duplicate entries were hidden. Refresh to check for changes."}
        </p>
      )}
      {(offset > 0 || hasMore) && (
        <nav aria-label="History pages">
          <button type="button" disabled={offset === 0}
            onClick={() => setOffset(Math.min(lastOffset, Math.max(0, offset - HISTORY_PAGE_SIZE)))}>
            Previous page
          </button>{" "}
          <button type="button" disabled={!hasMore}
            onClick={() => setOffset(offset + HISTORY_PAGE_SIZE)}>
            Next page
          </button>
        </nav>
      )}
    </>
  );
}

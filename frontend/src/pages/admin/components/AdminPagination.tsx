import { ChevronLeft, ChevronRight } from "lucide-react";

interface AdminPaginationProps {
  page: number; // 0-based
  pageSize: number;
  total: number;
  onPageChange: (newPage: number) => void;
  disabled?: boolean;
  itemLabel?: string;
}

export default function AdminPagination({
  page,
  pageSize,
  total,
  onPageChange,
  disabled = false,
  itemLabel = "records",
}: AdminPaginationProps) {
  if (total <= 0) {
    return null;
  }

  const totalPages = Math.ceil(total / pageSize);
  const startItem = page * pageSize + 1;
  const endItem = Math.min((page + 1) * pageSize, total);

  return (
    <nav
      className="doctor-pagination-bar"
      aria-label="Pagination controls"
    >
      <div className="doctor-pagination-info">
        Showing <strong>{startItem}</strong>–<strong>{endItem}</strong> of{" "}
        <strong>{total}</strong> {itemLabel}
      </div>

      <div className="doctor-pagination-actions">
        <button
          type="button"
          className="doctor-page-btn"
          disabled={disabled || page === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
          <span>Previous</span>
        </button>

        <span className="doctor-page-indicator" aria-current="page">
          Page <strong>{page + 1}</strong> of <strong>{totalPages || 1}</strong>
        </span>

        <button
          type="button"
          className="doctor-page-btn"
          disabled={disabled || page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}

import {
  CheckCircle2,
  Clock,
  Search,
  UserMinus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import type { DoctorVerificationStatus } from "../../../types/admin";

interface DoctorSearchAndFiltersProps {
  searchTerm: string;
  onSearchChange: (newSearch: string) => void;
  selectedStatus: DoctorVerificationStatus | "all";
  onStatusChange: (status: DoctorVerificationStatus | "all") => void;
  totalCount: number;
  isLoading: boolean;
}

interface FilterTab {
  id: DoctorVerificationStatus | "all";
  label: string;
  icon: typeof Users;
  colorClass: string;
}

const FILTER_TABS: FilterTab[] = [
  { id: "all", label: "All Practitioners", icon: Users, colorClass: "tab-all" },
  {
    id: "pending",
    label: "Pending Review",
    icon: Clock,
    colorClass: "tab-amber",
  },
  {
    id: "approved",
    label: "Approved & Active",
    icon: CheckCircle2,
    colorClass: "tab-emerald",
  },
  {
    id: "suspended",
    label: "Suspended",
    icon: UserMinus,
    colorClass: "tab-purple",
  },
  {
    id: "rejected",
    label: "Rejected",
    icon: XCircle,
    colorClass: "tab-rose",
  },
];

export default function DoctorSearchAndFilters({
  searchTerm,
  onSearchChange,
  selectedStatus,
  onStatusChange,
  totalCount,
  isLoading,
}: DoctorSearchAndFiltersProps) {
  const handleClear = () => {
    onSearchChange("");
  };

  return (
    <div className="doctor-filter-toolbar">
      {/* Search Input Bar */}
      <div className="doctor-search-box">
        <label htmlFor="doctor-search-input" className="sr-only">
          Search practitioners by name, email, or medical license number
        </label>
        <div className="doctor-search-input-wrap">
          <Search size={18} className="doctor-search-icon" aria-hidden="true" />
          <input
            id="doctor-search-input"
            type="text"
            className="doctor-search-input"
            placeholder="Search by practitioner name, email, or license number..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={isLoading && !totalCount}
            autoComplete="off"
            spellCheck="false"
          />
          {searchTerm && (
            <button
              type="button"
              className="doctor-search-clear-btn"
              onClick={handleClear}
              aria-label="Clear search input"
              title="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Verification Status Filter Tabs */}
      <div
        className="doctor-status-tabs"
        role="tablist"
        aria-label="Filter practitioners by verification status"
      >
        {FILTER_TABS.map(({ id, label, icon: Icon, colorClass }) => {
          const isActive = selectedStatus === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`doctor-filter-chip ${colorClass} ${isActive ? "active" : ""}`}
              onClick={() => onStatusChange(id)}
            >
              <Icon size={14} className="doctor-chip-icon" />
              <span>{label}</span>
              {isActive && (
                <span className="doctor-chip-count" aria-label={`${totalCount} total results`}>
                  {totalCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Search & Filter Feedback Strip */}
      {(searchTerm.trim() || selectedStatus !== "all") && (
        <div className="doctor-active-filters-row">
          <span className="doctor-filter-summary-label">Active Filters:</span>
          {selectedStatus !== "all" && (
            <span className="doctor-filter-tag">
              Status: <strong>{selectedStatus.toUpperCase()}</strong>
              <button
                type="button"
                className="doctor-tag-remove"
                onClick={() => onStatusChange("all")}
                aria-label={`Remove ${selectedStatus} status filter`}
              >
                <X size={12} />
              </button>
            </span>
          )}
          {searchTerm.trim() && (
            <span className="doctor-filter-tag">
              Query: <strong>"{searchTerm.trim()}"</strong>
              <button
                type="button"
                className="doctor-tag-remove"
                onClick={handleClear}
                aria-label="Remove search query filter"
              >
                <X size={12} />
              </button>
            </span>
          )}
          <button
            type="button"
            className="doctor-clear-all-link"
            onClick={() => {
              handleClear();
              onStatusChange("all");
            }}
          >
            Reset All Filters
          </button>
        </div>
      )}
    </div>
  );
}

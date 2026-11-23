import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Search,
  X,
  XCircle,
} from "lucide-react";
import type { AdminAppointmentStatus } from "../../../types/admin";

interface AppointmentSearchAndFiltersProps {
  searchTerm: string;
  onSearchChange: (newSearch: string) => void;
  selectedStatus: AdminAppointmentStatus | "all";
  onStatusChange: (status: AdminAppointmentStatus | "all") => void;
  dateFrom: string;
  onDateFromChange: (d: string) => void;
  dateTo: string;
  onDateToChange: (d: string) => void;
  totalCount: number;
  isLoading: boolean;
}

interface FilterTab {
  id: AdminAppointmentStatus | "all";
  label: string;
  icon: typeof CalendarClock;
  colorClass: string;
}

const FILTER_TABS: FilterTab[] = [
  { id: "all", label: "All Appointments", icon: CalendarClock, colorClass: "tab-all" },
  { id: "booked", label: "Booked", icon: Clock, colorClass: "tab-cyan" },
  { id: "in_progress", label: "In Progress", icon: Calendar, colorClass: "tab-amber" },
  { id: "completed", label: "Completed", icon: CheckCircle2, colorClass: "tab-emerald" },
  { id: "cancelled", label: "Cancelled", icon: XCircle, colorClass: "tab-rose" },
];

export default function AppointmentSearchAndFilters({
  searchTerm,
  onSearchChange,
  selectedStatus,
  onStatusChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  totalCount,
  isLoading,
}: AppointmentSearchAndFiltersProps) {
  const hasActiveFilters =
    searchTerm || selectedStatus !== "all" || dateFrom || dateTo;

  const handleReset = () => {
    onSearchChange("");
    onStatusChange("all");
    onDateFromChange("");
    onDateToChange("");
  };

  return (
    <div className="doctor-filter-toolbar">
      {/* Search Input Bar */}
      <div className="doctor-search-box">
        <label htmlFor="appointment-search-input" className="sr-only">
          Search appointments by doctor, patient, specialization, or clinical reason
        </label>
        <div className="doctor-search-input-wrap">
          <Search size={18} className="doctor-search-icon" aria-hidden="true" />
          <input
            id="appointment-search-input"
            type="text"
            className="doctor-search-input"
            placeholder="Search by practitioner, patient, specialization, or reason..."
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
              onClick={() => onSearchChange("")}
              aria-label="Clear search input"
              title="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Status Tabs */}
      <div className="doctor-status-tabs" role="tablist" aria-label="Appointment status filter">
        {FILTER_TABS.map((tab) => {
          const isActive = selectedStatus === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`doctor-filter-tab ${isActive ? `is-active ${tab.colorClass}` : ""}`}
              onClick={() => onStatusChange(tab.id)}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}

        {/* Date Range Pickers */}
        <div className="appointment-date-inputs">
          <label className="appointment-date-label">
            <span>From:</span>
            <input
              type="date"
              className="appointment-date-input"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              title="Start Date"
            />
          </label>
          <label className="appointment-date-label">
            <span>To:</span>
            <input
              type="date"
              className="appointment-date-input"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              title="End Date"
            />
          </label>
        </div>

        {/* Clear Filters Shortcut */}
        {hasActiveFilters && (
          <button
            type="button"
            className="doctor-filter-reset-btn"
            onClick={handleReset}
            title="Reset all filters"
          >
            <X size={13} />
            <span>Reset</span>
          </button>
        )}
      </div>
    </div>
  );
}

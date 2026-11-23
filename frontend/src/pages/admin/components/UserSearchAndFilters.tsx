import {
  Search,
  Shield,
  Stethoscope,
  User,
  Users,
  X,
} from "lucide-react";

interface UserSearchAndFiltersProps {
  searchTerm: string;
  onSearchChange: (newSearch: string) => void;
  selectedRole: string;
  onRoleChange: (role: string) => void;
  selectedStatus: string;
  onStatusChange: (status: string) => void;
  totalCount: number;
  isLoading: boolean;
}

const ROLE_OPTIONS = [
  { id: "all", label: "All Roles", icon: Users },
  { id: "patient", label: "Patients", icon: User },
  { id: "doctor", label: "Doctors", icon: Stethoscope },
  { id: "admin", label: "Administrators", icon: Shield },
];

const STATUS_OPTIONS = [
  { id: "all", label: "All Statuses" },
  { id: "active", label: "Active Only" },
  { id: "inactive", label: "Inactive / Suspended" },
];

export default function UserSearchAndFilters({
  searchTerm,
  onSearchChange,
  selectedRole,
  onRoleChange,
  selectedStatus,
  onStatusChange,
  totalCount,
  isLoading,
}: UserSearchAndFiltersProps) {
  const hasActiveFilters =
    searchTerm.trim() !== "" ||
    selectedRole !== "all" ||
    selectedStatus !== "all";

  const handleReset = () => {
    onSearchChange("");
    onRoleChange("all");
    onStatusChange("all");
  };

  return (
    <div className="doctor-filter-toolbar">
      {/* Search Input Bar */}
      <div className="doctor-search-box">
        <label htmlFor="user-search-input" className="sr-only">
          Search users by name or email
        </label>
        <div className="doctor-search-input-wrap">
          <Search size={18} className="doctor-search-icon" aria-hidden="true" />
          <input
            id="user-search-input"
            type="text"
            className="doctor-search-input"
            placeholder="Search users by name or email address..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={isLoading}
            autoComplete="off"
            spellCheck="false"
          />
          {searchTerm && (
            <button
              type="button"
              className="doctor-search-clear-btn"
              onClick={() => onSearchChange("")}
              aria-label="Clear search text"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Filter Select Controls */}
      <div className="user-filter-controls">
        <div className="user-select-group">
          <label htmlFor="user-role-filter" className="user-filter-label">
            Role:
          </label>
          <select
            id="user-role-filter"
            className="doctor-filter-select"
            value={selectedRole}
            onChange={(e) => onRoleChange(e.target.value)}
            disabled={isLoading}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="user-select-group">
          <label htmlFor="user-status-filter" className="user-filter-label">
            Status:
          </label>
          <select
            id="user-status-filter"
            className="doctor-filter-select"
            value={selectedStatus}
            onChange={(e) => onStatusChange(e.target.value)}
            disabled={isLoading}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            className="user-reset-filters-btn"
            onClick={handleReset}
            disabled={isLoading}
            title="Reset all search filters"
          >
            <X size={14} />
            <span>Reset</span>
          </button>
        )}

        <div className="user-filter-count-badge">
          <span className="user-count-number">{totalCount}</span>
          <span className="user-count-label">
            {totalCount === 1 ? "user" : "users"}
          </span>
        </div>
      </div>
    </div>
  );
}

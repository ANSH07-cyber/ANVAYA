import {
  Droplet,
  Search,
  User,
  Users,
  X,
} from "lucide-react";

interface PatientSearchAndFiltersProps {
  searchTerm: string;
  onSearchChange: (newSearch: string) => void;
  selectedGender: string;
  onGenderChange: (gender: string) => void;
  selectedBloodGroup: string;
  onBloodGroupChange: (bloodGroup: string) => void;
  totalCount: number;
  isLoading: boolean;
}

const GENDER_OPTIONS = [
  { id: "all", label: "All Genders" },
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "other", label: "Other" },
];

const BLOOD_GROUPS = [
  "all",
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
];

export default function PatientSearchAndFilters({
  searchTerm,
  onSearchChange,
  selectedGender,
  onGenderChange,
  selectedBloodGroup,
  onBloodGroupChange,
  totalCount,
  isLoading,
}: PatientSearchAndFiltersProps) {
  const hasActiveFilters =
    searchTerm || selectedGender !== "all" || selectedBloodGroup !== "all";

  const handleReset = () => {
    onSearchChange("");
    onGenderChange("all");
    onBloodGroupChange("all");
  };

  return (
    <div className="doctor-filter-toolbar">
      {/* Search Input Bar */}
      <div className="doctor-search-box">
        <label htmlFor="patient-search-input" className="sr-only">
          Search patients by name, email, or phone number
        </label>
        <div className="doctor-search-input-wrap">
          <Search size={18} className="doctor-search-icon" aria-hidden="true" />
          <input
            id="patient-search-input"
            type="text"
            className="doctor-search-input"
            placeholder="Search patients by name, email, or phone..."
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

      {/* Filter Options Row */}
      <div className="doctor-status-tabs" role="tablist" aria-label="Gender filter">
        {GENDER_OPTIONS.map((g) => {
          const isActive = selectedGender === g.id;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`doctor-filter-tab ${isActive ? "is-active tab-all" : ""}`}
              onClick={() => onGenderChange(g.id)}
            >
              {g.id === "all" ? <Users size={15} /> : <User size={15} />}
              <span>{g.label}</span>
            </button>
          );
        })}

        {/* Blood Group Select */}
        <div className="patient-filter-select-wrap">
          <Droplet size={14} className="patient-filter-icon" />
          <select
            className="patient-filter-select"
            value={selectedBloodGroup}
            onChange={(e) => onBloodGroupChange(e.target.value)}
            aria-label="Filter by blood group"
          >
            {BLOOD_GROUPS.map((bg) => (
              <option key={bg} value={bg}>
                {bg === "all" ? "Blood Group: All" : `Blood Group: ${bg}`}
              </option>
            ))}
          </select>
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

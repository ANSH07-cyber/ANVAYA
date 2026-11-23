import {
  CheckCircle2,
  FileText,
  KeyRound,
  Lock,
  Pill,
  Shield,
  ShieldAlert,
  Stethoscope,
  X,
  XCircle,
} from "lucide-react";
import type { AuditLogOutcome } from "../../../types/admin";

interface AuditLogsSearchAndFiltersProps {
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  selectedOutcome: AuditLogOutcome | "all";
  onOutcomeChange: (outcome: AuditLogOutcome | "all") => void;
  dateFrom: string;
  onDateFromChange: (d: string) => void;
  dateTo: string;
  onDateToChange: (d: string) => void;
}

interface CategoryOption {
  id: string;
  label: string;
  icon: typeof FileText;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  { id: "all", label: "All Audit Events", icon: FileText },
  { id: "doctor.", label: "Practitioners", icon: Stethoscope },
  { id: "consent.", label: "Patient Consent", icon: Shield },
  { id: "ehr.", label: "EHR Access", icon: Lock },
  { id: "prescription.", label: "E-Prescriptions", icon: Pill },
  { id: "admin.", label: "Security & Admin", icon: KeyRound },
];

export default function AuditLogsSearchAndFilters({
  selectedCategory,
  onCategoryChange,
  selectedOutcome,
  onOutcomeChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
}: AuditLogsSearchAndFiltersProps) {
  const hasActiveFilters =
    selectedCategory !== "all" || selectedOutcome !== "all" || dateFrom || dateTo;

  const handleReset = () => {
    onCategoryChange("all");
    onOutcomeChange("all");
    onDateFromChange("");
    onDateToChange("");
  };

  return (
    <div className="doctor-filter-toolbar">
      {/* Event Category Tabs */}
      <div className="doctor-status-tabs" role="tablist" aria-label="Event category filter">
        {CATEGORY_OPTIONS.map((cat) => {
          const isActive = selectedCategory === cat.id;
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`doctor-filter-tab ${isActive ? "is-active tab-all" : ""}`}
              onClick={() => onCategoryChange(cat.id)}
            >
              <Icon size={15} />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Outcome Tabs & Date Inputs Row */}
      <div className="doctor-status-tabs" style={{ marginTop: 8 }} role="tablist" aria-label="Outcome filter">
        <span className="audit-subfilter-label">Outcome:</span>
        <button
          type="button"
          role="tab"
          aria-selected={selectedOutcome === "all"}
          className={`doctor-filter-tab ${selectedOutcome === "all" ? "is-active tab-all" : ""}`}
          onClick={() => onOutcomeChange("all")}
        >
          <span>All Outcomes</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedOutcome === "success"}
          className={`doctor-filter-tab ${selectedOutcome === "success" ? "is-active tab-emerald" : ""}`}
          onClick={() => onOutcomeChange("success")}
        >
          <CheckCircle2 size={14} />
          <span>Success</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedOutcome === "denied"}
          className={`doctor-filter-tab ${selectedOutcome === "denied" ? "is-active tab-amber" : ""}`}
          onClick={() => onOutcomeChange("denied")}
        >
          <ShieldAlert size={14} />
          <span>Access Denied</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedOutcome === "failure"}
          className={`doctor-filter-tab ${selectedOutcome === "failure" ? "is-active tab-rose" : ""}`}
          onClick={() => onOutcomeChange("failure")}
        >
          <XCircle size={14} />
          <span>Failure</span>
        </button>

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

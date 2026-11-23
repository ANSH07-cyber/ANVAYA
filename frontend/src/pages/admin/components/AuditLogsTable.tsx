import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCode2,
  KeyRound,
  Lock,
  Pill,
  SearchX,
  Shield,
  ShieldAlert,
  Stethoscope,
  XCircle,
} from "lucide-react";
import type { AdminAuditLogItem, AuditLogOutcome } from "../../../types/admin";

interface AuditLogsTableProps {
  logs: AdminAuditLogItem[];
  isLoading: boolean;
  hasFilters: boolean;
  onResetFilters: () => void;
  onSelectLog: (log: AdminAuditLogItem) => void;
}

function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return isoString;
  }
}

function getEventBadge(eventType: string) {
  if (eventType.startsWith("doctor.")) {
    return {
      label: eventType,
      pillClass: "audit-pill-cyan",
      icon: Stethoscope,
    };
  }
  if (eventType.startsWith("consent.")) {
    return {
      label: eventType,
      pillClass: "audit-pill-purple",
      icon: Shield,
    };
  }
  if (eventType.startsWith("ehr.")) {
    return {
      label: eventType,
      pillClass: "audit-pill-blue",
      icon: Lock,
    };
  }
  if (eventType.startsWith("prescription.")) {
    return {
      label: eventType,
      pillClass: "audit-pill-emerald",
      icon: Pill,
    };
  }
  if (eventType.startsWith("admin.")) {
    return {
      label: eventType,
      pillClass: "audit-pill-amber",
      icon: KeyRound,
    };
  }
  return {
    label: eventType,
    pillClass: "audit-pill-gray",
    icon: Shield,
  };
}

function getOutcomeBadge(outcome: AuditLogOutcome) {
  switch (outcome) {
    case "success":
      return {
        label: "Success",
        pillClass: "status-pill-emerald",
        icon: CheckCircle2,
      };
    case "denied":
      return {
        label: "Denied",
        pillClass: "status-pill-amber",
        icon: ShieldAlert,
      };
    case "failure":
      return {
        label: "Failure",
        pillClass: "status-pill-rose",
        icon: XCircle,
      };
    default:
      return {
        label: outcome,
        pillClass: "status-pill-gray",
        icon: AlertTriangle,
      };
  }
}

export default function AuditLogsTable({
  logs,
  isLoading,
  hasFilters,
  onResetFilters,
  onSelectLog,
}: AuditLogsTableProps) {
  if (isLoading && logs.length === 0) {
    return (
      <div className="doctor-table-card">
        <div className="doctor-table-wrap">
          <table className="doctor-table" aria-busy="true">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>Actor User</th>
                <th>Resource Target</th>
                <th>Outcome</th>
                <th className="th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} className="skeleton-row">
                  <td>
                    <div className="skeleton skeleton-text" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-badge" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-text-short" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-text" />
                  </td>
                  <td>
                    <div className="skeleton skeleton-badge" />
                  </td>
                  <td className="td-actions">
                    <div className="skeleton skeleton-btn" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="doctor-empty-state">
        <div className="doctor-empty-icon-wrap" aria-hidden="true">
          <SearchX size={36} />
        </div>
        <h3 className="doctor-empty-title">No audit records found</h3>
        <p className="doctor-empty-desc">
          {hasFilters
            ? "No security audit log entries match your selected category or outcome filters."
            : "No audit logs have been recorded in the platform ledger yet."}
        </p>
        {hasFilters && (
          <button
            type="button"
            className="doctor-empty-reset-btn"
            onClick={onResetFilters}
          >
            Clear Filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="doctor-table-card">
      <div className="doctor-table-wrap">
        <table className="doctor-table" aria-label="Security Audit Trail Explorer">
          <thead>
            <tr>
              <th scope="col">Timestamp (IST)</th>
              <th scope="col">Event Type</th>
              <th scope="col">Actor User ID</th>
              <th scope="col">Resource Target</th>
              <th scope="col">Outcome</th>
              <th scope="col" className="th-actions">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const eventMeta = getEventBadge(log.event_type);
              const EventIcon = eventMeta.icon;
              const outcomeMeta = getOutcomeBadge(log.outcome);
              const OutcomeIcon = outcomeMeta.icon;

              return (
                <tr
                  key={log.id}
                  className="doctor-table-row clickable-row"
                  onClick={() => onSelectLog(log)}
                >
                  {/* Timestamp */}
                  <td>
                    <div className="appointment-schedule-cell">
                      <span className="audit-timestamp-text">
                        <Clock size={12} className="inline-cell-icon text-cyan" />
                        {formatTimestamp(log.created_at)}
                      </span>
                    </div>
                  </td>

                  {/* Event Type Badge */}
                  <td>
                    <span className={`audit-event-pill ${eventMeta.pillClass}`}>
                      <EventIcon size={12} />
                      <span>{log.event_type}</span>
                    </span>
                  </td>

                  {/* Actor User ID */}
                  <td>
                    <span className="audit-actor-id" title={log.actor_user_id}>
                      {log.actor_user_id.slice(0, 8)}...{log.actor_user_id.slice(-6)}
                    </span>
                  </td>

                  {/* Resource Target */}
                  <td>
                    <div className="audit-resource-cell">
                      <span className="audit-resource-type">
                        {log.resource_type}
                      </span>
                      <span className="audit-resource-id" title={log.resource_id}>
                        {log.resource_id.length > 18
                          ? `${log.resource_id.slice(0, 8)}...${log.resource_id.slice(-6)}`
                          : log.resource_id}
                      </span>
                    </div>
                  </td>

                  {/* Outcome */}
                  <td>
                    <span className={`status-pill ${outcomeMeta.pillClass}`}>
                      <OutcomeIcon size={12} />
                      <span>{outcomeMeta.label}</span>
                    </span>
                  </td>

                  {/* Actions */}
                  <td
                    className="td-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="doctor-view-btn"
                      onClick={() => onSelectLog(log)}
                      title="Inspect forensic payload"
                      aria-label={`Inspect audit log ${log.id}`}
                    >
                      <FileCode2 size={15} />
                      <span>Payload</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

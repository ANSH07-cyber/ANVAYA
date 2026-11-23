import {
  AlertCircle,
  Eye,
  KeyRound,
  Lock,
  SearchX,
  Shield,
  ShieldCheck,
  Stethoscope,
  User,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import type { AdminUserListItem } from "../../../types/admin";

interface UserDirectoryTableProps {
  users: AdminUserListItem[];
  currentUserId?: string;
  isLoading: boolean;
  hasFilters: boolean;
  error?: string | null;
  onResetFilters: () => void;
  onSelectUser: (user: AdminUserListItem) => void;
  onToggleStatus: (user: AdminUserListItem) => void;
  onRetry?: () => void;
}

function getInitials(name: string): string {
  if (!name) return "US";
  const clean = name.replace(/^Dr\.?\s+/i, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "US";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return isoString;
  }
}

function formatRelativeTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return "";
  } catch {
    return "";
  }
}

export default function UserDirectoryTable({
  users,
  currentUserId,
  isLoading,
  hasFilters,
  error,
  onResetFilters,
  onSelectUser,
  onToggleStatus,
  onRetry,
}: UserDirectoryTableProps) {
  // Loading Skeleton State
  if (isLoading && users.length === 0) {
    return (
      <div className="doctor-table-section">
        <div className="doctor-table-container">
          <div className="doctor-table-scroll">
            <table className="doctor-directory-table user-directory-table" aria-busy="true">
              <colgroup>
                <col style={{ width: "28%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "15%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="th-user">User Account</th>
                  <th scope="col" className="th-role">Role</th>
                  <th scope="col" className="th-auth">Authentication</th>
                  <th scope="col" className="th-status">Account Status</th>
                  <th scope="col" className="th-date">Registered</th>
                  <th scope="col" className="th-actions text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="doctor-skeleton-row">
                    <td>
                      <div className="user-identity-card">
                        <div className="doctor-skeleton-avatar shimmer" />
                        <div className="doctor-skeleton-info">
                          <div className="doctor-skeleton-line title shimmer" />
                          <div className="doctor-skeleton-line subtitle shimmer" />
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="doctor-skeleton-cell shimmer" style={{ width: "90px" }} />
                    </td>
                    <td>
                      <div className="doctor-skeleton-cell shimmer" style={{ width: "110px" }} />
                    </td>
                    <td>
                      <div className="doctor-skeleton-cell shimmer" style={{ width: "80px" }} />
                    </td>
                    <td>
                      <div className="doctor-skeleton-cell shimmer" style={{ width: "100px" }} />
                    </td>
                    <td>
                      <div className="doctor-skeleton-cell shimmer" style={{ width: "120px", marginLeft: "auto" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Error State: Ensure API errors NEVER display the misleading "No users registered" empty state
  if (error) {
    return (
      <div className="doctor-table-section">
        <div className="doctor-table-container">
          <div className="doctor-empty-state user-directory-error-card" role="alert">
            <div className="doctor-empty-icon-wrap rose-glow" aria-hidden="true">
              <AlertCircle size={36} />
            </div>
            <h3 className="doctor-empty-title">Unable to Load Users</h3>
            <p className="doctor-empty-desc">{error}</p>
            {onRetry && (
              <button
                type="button"
                className="doctor-empty-reset-btn"
                onClick={onRetry}
              >
                Retry Loading Users
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Empty State: Only shown when there is NO error and users array is empty
  if (users.length === 0) {
    return (
      <div className="doctor-table-section">
        <div className="doctor-table-container">
          <div className="doctor-empty-state" role="status">
            <div className={`doctor-empty-icon-wrap ${hasFilters ? "amber-glow" : "sky-glow"}`} aria-hidden="true">
              {hasFilters ? <SearchX size={36} /> : <Users size={36} />}
            </div>
            <h3 className="doctor-empty-title">
              {hasFilters ? "No Matching Accounts Found" : "No Users Registered"}
            </h3>
            <p className="doctor-empty-desc">
              {hasFilters
                ? "No user accounts match the current filter criteria. Try adjusting your search term, role filter, or status selection."
                : "Platform accounts will appear in this administrative directory as users register."}
            </p>
            {hasFilters && (
              <button
                type="button"
                className="doctor-empty-reset-btn"
                onClick={onResetFilters}
              >
                Clear All Filters
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="doctor-table-section">
      <div className="doctor-table-container">
        <div className="doctor-table-scroll">
          <table className="doctor-directory-table user-directory-table">
            <colgroup>
              <col className="col-user" style={{ width: "28%" }} />
              <col className="col-role" style={{ width: "13%" }} />
              <col className="col-auth" style={{ width: "16%" }} />
              <col className="col-status" style={{ width: "14%" }} />
              <col className="col-date" style={{ width: "14%" }} />
              <col className="col-actions" style={{ width: "15%" }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="th-user">User Account</th>
                <th scope="col" className="th-role">Role</th>
                <th scope="col" className="th-auth">Authentication</th>
                <th scope="col" className="th-status">Account Status</th>
                <th scope="col" className="th-date">Registered</th>
                <th scope="col" className="th-actions text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = currentUserId && user.id === currentUserId;
                const initials = getInitials(user.full_name);
                const relativeTime = formatRelativeTime(user.created_at);

                return (
                  <tr
                    key={user.id}
                    className={`doctor-table-row user-table-row ${!user.is_active ? "is-inactive" : ""}`}
                  >
                    {/* Account Name & Email */}
                    <td className="td-user">
                      <div className="user-identity-card">
                        <div
                          className={`user-avatar-badge user-avatar-${user.role}`}
                          aria-hidden="true"
                        >
                          {initials}
                        </div>
                        <div className="user-identity-meta">
                          <div className="user-name-title-row">
                            <button
                              type="button"
                              className="user-name-link"
                              onClick={() => onSelectUser(user)}
                              title="Inspect account details"
                            >
                              {user.full_name}
                            </button>
                            {isSelf && (
                              <span
                                className="user-self-pill"
                                title="Currently authenticated administrator account"
                              >
                                You
                              </span>
                            )}
                          </div>
                          <span className="user-email-text" title={user.email}>
                            {user.email}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Role Badge */}
                    <td className="td-role">
                      {user.role === "admin" && (
                        <span className="user-role-badge role-admin">
                          <Shield size={13} aria-hidden="true" />
                          Administrator
                        </span>
                      )}
                      {user.role === "doctor" && (
                        <span className="user-role-badge role-doctor">
                          <Stethoscope size={13} aria-hidden="true" />
                          Practitioner
                        </span>
                      )}
                      {user.role === "patient" && (
                        <span className="user-role-badge role-patient">
                          <User size={13} aria-hidden="true" />
                          Patient
                        </span>
                      )}
                      {user.role !== "admin" &&
                        user.role !== "doctor" &&
                        user.role !== "patient" && (
                          <span className="user-role-badge role-generic">
                            {user.role}
                          </span>
                        )}
                    </td>

                    {/* Auth Methods */}
                    <td className="td-auth">
                      <div className="user-auth-badges">
                        {user.has_password && (
                          <span
                            className="user-auth-pill pill-password"
                            title="Email & Password authentication enabled"
                          >
                            <KeyRound size={12} aria-hidden="true" />
                            Password
                          </span>
                        )}
                        {user.has_firebase && (
                          <span
                            className="user-auth-pill pill-firebase"
                            title="Federated Google/Firebase authentication linked"
                          >
                            <ShieldCheck size={12} aria-hidden="true" />
                            Google
                          </span>
                        )}
                        {!user.has_password && !user.has_firebase && (
                          <span className="user-auth-pill pill-none">None</span>
                        )}
                      </div>
                    </td>

                    {/* Account Status */}
                    <td className="td-status">
                      {user.is_active ? (
                        <span className="user-status-pill status-active">
                          <span
                            className="status-dot-pulse"
                            aria-hidden="true"
                          />
                          Active
                        </span>
                      ) : (
                        <span className="user-status-pill status-inactive">
                          <Lock size={12} aria-hidden="true" />
                          Inactive
                        </span>
                      )}
                    </td>

                    {/* Registration Date */}
                    <td className="td-date">
                      <div className="user-date-cell">
                        <span className="user-date-primary">
                          {formatDate(user.created_at)}
                        </span>
                        {relativeTime && (
                          <span className="user-date-relative">
                            {relativeTime}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="td-actions table-actions-cell text-right">
                      <div className="user-action-buttons">
                        <button
                          type="button"
                          className="user-btn-inspect"
                          onClick={() => onSelectUser(user)}
                          title="Inspect account metadata and sessions"
                          aria-label={`Inspect ${user.full_name}`}
                        >
                          <Eye size={14} />
                          <span>Inspect</span>
                        </button>

                        {user.is_active ? (
                          <button
                            type="button"
                            className="user-btn-deactivate"
                            onClick={() => onToggleStatus(user)}
                            disabled={Boolean(isSelf)}
                            title={
                              isSelf
                                ? "Self-deactivation disabled for security"
                                : "Deactivate account and revoke sessions"
                            }
                            aria-label={`Deactivate ${user.full_name}`}
                          >
                            <UserX size={14} />
                            <span>Deactivate</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="user-btn-activate"
                            onClick={() => onToggleStatus(user)}
                            title="Reactivate account"
                            aria-label={`Activate ${user.full_name}`}
                          >
                            <UserCheck size={14} />
                            <span>Activate</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

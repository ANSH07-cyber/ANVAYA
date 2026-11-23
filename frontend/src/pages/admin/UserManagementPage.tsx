import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Shield,
  X,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import AdminLayout from "../../layouts/admin/AdminLayout";
import { adminService } from "../../services/adminService";
import type {
  AdminUserDetailResponse,
  AdminUserListItem,
  AdminUserStatusResponse,
} from "../../types/admin";
import AdminPagination from "./components/AdminPagination";
import UserDetailDrawer from "./components/UserDetailDrawer";
import UserDirectoryTable from "./components/UserDirectoryTable";
import UserSearchAndFilters from "./components/UserSearchAndFilters";
import UserStatusToggleDialog from "./components/UserStatusToggleDialog";
import "./DoctorManagementPage.css";
import "./UserManagementPage.css";

const PAGE_SIZE = 20;

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data && typeof data === "object") {
      if ("detail" in data) {
        const detail = (data as { detail: unknown }).detail;
        if (typeof detail === "string") return detail;
        if (Array.isArray(detail)) {
          return detail
            .map((item) =>
              typeof item === "object" && item && "msg" in item
                ? String(item.msg)
                : JSON.stringify(item),
            )
            .join("; ");
        }
      }
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export default function UserManagementPage() {
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    text: string;
    type: "success" | "error" | "info";
  } | null>(null);

  // Search & Filter State
  const [searchInput, setSearchInput] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Server-side pagination
  const [page, setPage] = useState<number>(0);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // Drawer Inspection State
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Status Change Dialog State
  const [targetUser, setTargetUser] = useState<
    AdminUserListItem | AdminUserDetailResponse | null
  >(null);
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

  // Prevent stale async responses from overwriting newer queries
  const latestRequestIdRef = useRef<number>(0);

  // Debounce search input by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(0); // Reset to first page on search query change
    }, 300);
    return () => clearTimeout(handler);
  }, [searchInput]);

  // Fetch users from backend with active filters
  const fetchUsers = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    setError(null);

    const isActiveParam =
      statusFilter === "active"
        ? true
        : statusFilter === "inactive"
          ? false
          : undefined;

    const roleParam = roleFilter !== "all" ? roleFilter : undefined;
    const searchParam = debouncedSearch.trim() || undefined;

    try {
      const response = await adminService.getUsers({
        search: searchParam,
        role: roleParam,
        is_active: isActiveParam,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });

      // Discard if a newer request was dispatched in the meantime
      if (requestId !== latestRequestIdRef.current) return;

      setUsers(response.items || []);
      setTotalCount(response.total || 0);
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) return;
      setError(
        extractErrorMessage(
          err,
          "Failed to load user accounts directory. Please check network connection or try again.",
        ),
      );
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [debouncedSearch, roleFilter, statusFilter, page]);

  useEffect(() => {
    setIsLoading(true);
    fetchUsers();
  }, [fetchUsers, refreshKey]);

  // Manual refresh handler
  const handleManualRefresh = () => {
    setIsRefreshing(true);
    setRefreshKey((k) => k + 1);
  };

  // Toast autohide
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Filter change handlers
  const handleRoleChange = (role: string) => {
    setRoleFilter(role);
    setPage(0);
  };

  const handleStatusChange = (status: string) => {
    setStatusFilter(status);
    setPage(0);
  };

  const handleResetFilters = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setRoleFilter("all");
    setStatusFilter("all");
    setPage(0);
  };

  // Selection handlers
  const handleSelectUser = (user: AdminUserListItem) => {
    setSelectedUserId(user.id);
    setIsDrawerOpen(true);
  };

  const handleToggleStatus = (
    user: AdminUserListItem | AdminUserDetailResponse,
  ) => {
    setTargetUser(user);
    setIsDialogOpen(true);
  };

  const handleStatusSuccess = (statusRes: AdminUserStatusResponse) => {
    // Show toast
    if (statusRes.is_active) {
      setToast({
        text: `Account for ${statusRes.email} has been successfully reactivated.`,
        type: "success",
      });
    } else {
      const revokedInfo =
        statusRes.revoked_sessions_count > 0
          ? ` (${statusRes.revoked_sessions_count} active sessions revoked)`
          : "";
      setToast({
        text: `Account for ${statusRes.email} has been deactivated${revokedInfo}.`,
        type: "info",
      });
    }

    // Refresh user list
    setRefreshKey((k) => k + 1);
  };

  // Quick statistics from current loaded data (and total count)
  const activeCount = users.filter((u) => u.is_active).length;
  const doctorCount = users.filter((u) => u.role === "doctor").length;
  const patientCount = users.filter((u) => u.role === "patient").length;

  return (
    <AdminLayout
      title="User Management"
      subtitle="Directory of platform accounts, authentication credentials, and access lifecycle controls."
    >
      <div className="user-management-container">
        {/* Toast Notification */}
        {toast && (
          <div
            className={`user-toast-banner toast-${toast.type}`}
            role="status"
          >
            {toast.type === "success" && <CheckCircle2 size={18} />}
            {toast.type === "info" && <Shield size={18} />}
            {toast.type === "error" && <AlertCircle size={18} />}
            <span>{toast.text}</span>
            <button
              type="button"
              className="user-toast-close"
              onClick={() => setToast(null)}
              aria-label="Dismiss toast"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* Header Action Bar & Stat Badges */}
        <div className="user-mgmt-header-bar">
          <div className="user-mgmt-stats-strip">
            <div className="user-stat-card">
              <span className="user-stat-label">Total Registered</span>
              <span className="user-stat-value">{totalCount}</span>
            </div>
            <div className="user-stat-card">
              <span className="user-stat-label">Active on Page</span>
              <span className="user-stat-value text-emerald">
                {activeCount}
              </span>
            </div>
            <div className="user-stat-card">
              <span className="user-stat-label">Doctors</span>
              <span className="user-stat-value text-purple">
                {doctorCount}
              </span>
            </div>
            <div className="user-stat-card">
              <span className="user-stat-label">Patients</span>
              <span className="user-stat-value text-teal">
                {patientCount}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="doctor-header-btn doctor-refresh-btn"
            onClick={handleManualRefresh}
            disabled={isRefreshing || isLoading}
            title="Refresh user accounts directory"
          >
            <RefreshCw
              size={16}
              className={isRefreshing ? "spin-icon" : ""}
            />
            <span>Refresh</span>
          </button>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="doctor-error-banner" role="alert">
            <AlertCircle size={20} className="error-icon" />
            <div className="doctor-error-text">
              <strong>Error Loading Users</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              className="doctor-error-dismiss"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Search, Role, and Status Filters */}
        <UserSearchAndFilters
          searchTerm={searchInput}
          onSearchChange={setSearchInput}
          selectedRole={roleFilter}
          onRoleChange={handleRoleChange}
          selectedStatus={statusFilter}
          onStatusChange={handleStatusChange}
          totalCount={totalCount}
          isLoading={isLoading}
        />

        {/* Main Users Directory Table */}
        <UserDirectoryTable
          users={users}
          currentUserId={currentUser?.id}
          isLoading={isLoading}
          error={error}
          hasFilters={
            searchInput.trim() !== "" ||
            roleFilter !== "all" ||
            statusFilter !== "all"
          }
          onResetFilters={handleResetFilters}
          onSelectUser={handleSelectUser}
          onToggleStatus={handleToggleStatus}
          onRetry={handleManualRefresh}
        />

        {/* Server-Side Pagination */}
        {!error && totalCount > 0 && (
          <AdminPagination
            page={page}
            pageSize={PAGE_SIZE}
            total={totalCount}
            onPageChange={setPage}
            disabled={isLoading}
            itemLabel="accounts"
          />
        )}

        {/* Slide-Over Account Details Drawer */}
        <UserDetailDrawer
          userId={selectedUserId}
          currentUserId={currentUser?.id}
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          onToggleStatus={(detail) => {
            setIsDrawerOpen(false);
            handleToggleStatus(detail);
          }}
        />

        {/* Status Activation/Deactivation Dialog */}
        <UserStatusToggleDialog
          user={targetUser}
          currentUserId={currentUser?.id}
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onSuccess={handleStatusSuccess}
        />
      </div>
    </AdminLayout>
  );
}

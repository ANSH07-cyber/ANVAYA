import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  RefreshCw,
  X,
} from "lucide-react";

import AdminLayout from "../../layouts/admin/AdminLayout";
import { adminService } from "../../services/adminService";
import type {
  AdminAppointmentItem,
  AdminAppointmentStatus,
} from "../../types/admin";
import AdminPagination from "./components/AdminPagination";
import AppointmentDetailDrawer from "./components/AppointmentDetailDrawer";
import AppointmentDirectoryTable from "./components/AppointmentDirectoryTable";
import AppointmentSearchAndFilters from "./components/AppointmentSearchAndFilters";
import "./DoctorManagementPage.css";
import "./AppointmentOversightPage.css";

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

export default function AppointmentOversightPage() {
  const [appointments, setAppointments] = useState<AdminAppointmentItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter State
  const [searchInput, setSearchInput] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<AdminAppointmentStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Server-side pagination
  const [page, setPage] = useState<number>(0);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // Drawer Inspection State
  const [selectedAppointment, setSelectedAppointment] = useState<AdminAppointmentItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Prevent stale async responses
  const latestRequestIdRef = useRef<number>(0);

  // Debounce search input by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(0);
    }, 300);

    return () => clearTimeout(handler);
  }, [searchInput]);

  // Fetch appointments on filter, search, page or manual refresh
  useEffect(() => {
    const requestId = ++latestRequestIdRef.current;
    let isMounted = true;

    adminService
      .getAppointments({
        search: debouncedSearch || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((response) => {
        if (isMounted && requestId === latestRequestIdRef.current) {
          setAppointments(response.items || []);
          setTotalCount(response.total || 0);
          setError(null);
        }
      })
      .catch((err) => {
        if (isMounted && requestId === latestRequestIdRef.current) {
          setError(
            extractErrorMessage(
              err,
              "Failed to load appointments queue. Please check network connectivity or administrator privileges.",
            ),
          );
        }
      })
      .finally(() => {
        if (isMounted && requestId === latestRequestIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [debouncedSearch, statusFilter, dateFrom, dateTo, page, refreshKey]);

  const handleSearchChange = useCallback((newQuery: string) => {
    setSearchInput(newQuery);
  }, []);

  const handleStatusChange = useCallback(
    (newStatus: AdminAppointmentStatus | "all") => {
      setStatusFilter(newStatus);
      setPage(0);
      setIsLoading(true);
    },
    [],
  );

  const handleDateFromChange = useCallback((d: string) => {
    setDateFrom(d);
    setPage(0);
    setIsLoading(true);
  }, []);

  const handleDateToChange = useCallback((d: string) => {
    setDateTo(d);
    setPage(0);
    setIsLoading(true);
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handleResetFilters = useCallback(() => {
    setSearchInput("");
    setDebouncedSearch("");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(0);
    setIsLoading(true);
  }, []);

  const handleSelectAppointment = useCallback(
    (appointment: AdminAppointmentItem) => {
      setSelectedAppointment(appointment);
      setIsDrawerOpen(true);
    },
    [],
  );

  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const hasFilters =
    Boolean(debouncedSearch) || statusFilter !== "all" || Boolean(dateFrom) || Boolean(dateTo);

  return (
    <AdminLayout
      title="Appointments Oversight Studio"
      subtitle="Cross-clinical consultation tracking, queue orchestration, and scheduling governance"
    >
      <div className="doctor-management-container">
        {/* Studio Header Banner */}
        <section
          className="doctor-studio-banner"
          aria-labelledby="appointment-studio-title"
        >
          <div className="doctor-studio-info">
            <span className="doctor-studio-badge">
              <CalendarClock size={13} className="doctor-badge-icon" />
              CLINICAL SCHEDULE & QUEUE GOVERNANCE
            </span>
            <h1 id="appointment-studio-title" className="doctor-studio-title">
              Consultation & Schedule Orchestration
            </h1>
            <p className="doctor-studio-desc">
              Monitor active clinical appointment queues, enforce double-booking prevention,
              inspect consultation lifecycles, and audit scheduled encounters.
            </p>
          </div>

          <div className="doctor-studio-actions">
            <button
              type="button"
              className="doctor-sync-btn"
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              title="Refresh appointments"
            >
              <RefreshCw
                size={15}
                className={isRefreshing ? "spin-icon" : ""}
              />
              <span>{isRefreshing ? "Syncing..." : "Sync"}</span>
            </button>
          </div>
        </section>

        {/* Global Error Banner */}
        {error && (
          <div className="doctor-alert-banner alert-error" role="alert">
            <AlertCircle size={18} className="alert-icon" />
            <div className="alert-content">
              <strong>Error loading appointments:</strong> {error}
            </div>
            <button
              type="button"
              className="alert-dismiss-btn"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* Search & Filters Toolbar */}
        <AppointmentSearchAndFilters
          searchTerm={searchInput}
          onSearchChange={handleSearchChange}
          selectedStatus={statusFilter}
          onStatusChange={handleStatusChange}
          dateFrom={dateFrom}
          onDateFromChange={handleDateFromChange}
          dateTo={dateTo}
          onDateToChange={handleDateToChange}
          totalCount={totalCount}
          isLoading={isLoading}
        />

        {/* Data Table */}
        <AppointmentDirectoryTable
          appointments={appointments}
          isLoading={isLoading}
          hasFilters={hasFilters}
          onResetFilters={handleResetFilters}
          onSelectAppointment={handleSelectAppointment}
        />

        {/* Server-Side Pagination */}
        <AdminPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={totalCount}
          onPageChange={(newPage) => setPage(newPage)}
          disabled={isLoading || isRefreshing}
          itemLabel="appointments"
        />

        {/* Detail Slide-Out Drawer */}
        <AppointmentDetailDrawer
          appointment={selectedAppointment}
          isOpen={isDrawerOpen}
          onClose={handleCloseDrawer}
        />
      </div>
    </AdminLayout>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  FileText,
  RefreshCw,
  X,
} from "lucide-react";

import AdminLayout from "../../layouts/admin/AdminLayout";
import { adminService } from "../../services/adminService";
import type {
  AdminAuditLogItem,
  AuditLogOutcome,
} from "../../types/admin";
import AdminPagination from "./components/AdminPagination";
import AuditLogDetailDrawer from "./components/AuditLogDetailDrawer";
import AuditLogsSearchAndFilters from "./components/AuditLogsSearchAndFilters";
import AuditLogsTable from "./components/AuditLogsTable";
import "./DoctorManagementPage.css";
import "./AuditLogsPage.css";

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

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AdminAuditLogItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters State
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<AuditLogOutcome | "all">("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Server-side pagination
  const [page, setPage] = useState<number>(0);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // Drawer Inspection State
  const [selectedLog, setSelectedLog] = useState<AdminAuditLogItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Prevent stale async responses
  const latestRequestIdRef = useRef<number>(0);

  // Fetch logs on filter, page or manual refresh
  useEffect(() => {
    const requestId = ++latestRequestIdRef.current;
    let isMounted = true;

    adminService
      .getAuditLogs({
        event_type: categoryFilter !== "all" ? categoryFilter : undefined,
        outcome: outcomeFilter !== "all" ? outcomeFilter : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((response) => {
        if (isMounted && requestId === latestRequestIdRef.current) {
          setLogs(response.items || []);
          setTotalCount(response.total || 0);
          setError(null);
        }
      })
      .catch((err) => {
        if (isMounted && requestId === latestRequestIdRef.current) {
          setError(
            extractErrorMessage(
              err,
              "Failed to load audit logs. Please check network connectivity or administrator privileges.",
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
  }, [categoryFilter, outcomeFilter, dateFrom, dateTo, page, refreshKey]);

  const handleCategoryChange = useCallback((newCategory: string) => {
    setCategoryFilter(newCategory);
    setPage(0);
    setIsLoading(true);
  }, []);

  const handleOutcomeChange = useCallback((newOutcome: AuditLogOutcome | "all") => {
    setOutcomeFilter(newOutcome);
    setPage(0);
    setIsLoading(true);
  }, []);

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
    setCategoryFilter("all");
    setOutcomeFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(0);
    setIsLoading(true);
  }, []);

  const handleSelectLog = useCallback((log: AdminAuditLogItem) => {
    setSelectedLog(log);
    setIsDrawerOpen(true);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const hasFilters =
    categoryFilter !== "all" || outcomeFilter !== "all" || Boolean(dateFrom) || Boolean(dateTo);

  return (
    <AdminLayout
      title="Audit Trail Explorer & Security Governance"
      subtitle="Immutable cryptographic log of clinical access, consent lifecycles, and security transactions"
    >
      <div className="doctor-management-container">
        {/* Studio Header Banner */}
        <section
          className="doctor-studio-banner"
          aria-labelledby="audit-studio-title"
        >
          <div className="doctor-studio-info">
            <span className="doctor-studio-badge">
              <FileText size={13} className="doctor-badge-icon" />
              TAMPER-EVIDENT SECURITY & ACCESS FORENSICS
            </span>
            <h1 id="audit-studio-title" className="doctor-studio-title">
              Audit Trail Explorer & Security Governance
            </h1>
            <p className="doctor-studio-desc">
              Examine full-system security audit trails across clinical EHR retrievals,
              patient consent grants and revocations, practitioner onboarding, and administrator events.
            </p>
          </div>

          <div className="doctor-studio-actions">
            <button
              type="button"
              className="doctor-sync-btn"
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              title="Refresh audit ledger"
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
              <strong>Error loading audit ledger:</strong> {error}
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
        <AuditLogsSearchAndFilters
          selectedCategory={categoryFilter}
          onCategoryChange={handleCategoryChange}
          selectedOutcome={outcomeFilter}
          onOutcomeChange={handleOutcomeChange}
          dateFrom={dateFrom}
          onDateFromChange={handleDateFromChange}
          dateTo={dateTo}
          onDateToChange={handleDateToChange}
        />

        {/* Data Table */}
        <AuditLogsTable
          logs={logs}
          isLoading={isLoading}
          hasFilters={hasFilters}
          onResetFilters={handleResetFilters}
          onSelectLog={handleSelectLog}
        />

        {/* Server-Side Pagination */}
        <AdminPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={totalCount}
          onPageChange={(newPage) => setPage(newPage)}
          disabled={isLoading || isRefreshing}
          itemLabel="audit events"
        />

        {/* Detail Slide-Out Drawer */}
        <AuditLogDetailDrawer
          log={selectedLog}
          isOpen={isDrawerOpen}
          onClose={handleCloseDrawer}
        />
      </div>
    </AdminLayout>
  );
}

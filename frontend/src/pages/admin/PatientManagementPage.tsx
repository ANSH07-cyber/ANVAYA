import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  RefreshCw,
  Users,
  X,
} from "lucide-react";

import AdminLayout from "../../layouts/admin/AdminLayout";
import { adminService } from "../../services/adminService";
import type { AdminPatientItem } from "../../types/admin";
import AdminPagination from "./components/AdminPagination";
import PatientDirectoryTable from "./components/PatientDirectoryTable";
import PatientProfileDrawer from "./components/PatientProfileDrawer";
import PatientSearchAndFilters from "./components/PatientSearchAndFilters";
import "./DoctorManagementPage.css";
import "./PatientManagementPage.css";

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

export default function PatientManagementPage() {
  const [patients, setPatients] = useState<AdminPatientItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter State
  const [searchInput, setSearchInput] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [genderFilter, setGenderFilter] = useState<string>("all");
  const [bloodGroupFilter, setBloodGroupFilter] = useState<string>("all");

  // Server-side pagination
  const [page, setPage] = useState<number>(0);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // Drawer Inspection State
  const [selectedPatient, setSelectedPatient] = useState<AdminPatientItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Prevent stale async responses from overwriting newer queries
  const latestRequestIdRef = useRef<number>(0);

  // Debounce search input by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(0);
    }, 300);

    return () => clearTimeout(handler);
  }, [searchInput]);

  // Fetch patients on filter, search, page or manual refresh
  useEffect(() => {
    const requestId = ++latestRequestIdRef.current;
    let isMounted = true;

    adminService
      .getPatients({
        search: debouncedSearch || undefined,
        gender: genderFilter !== "all" ? genderFilter : undefined,
        blood_group: bloodGroupFilter !== "all" ? bloodGroupFilter : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((response) => {
        if (isMounted && requestId === latestRequestIdRef.current) {
          setPatients(response.items || []);
          setTotalCount(response.total || 0);
          setError(null);
        }
      })
      .catch((err) => {
        if (isMounted && requestId === latestRequestIdRef.current) {
          setError(
            extractErrorMessage(
              err,
              "Failed to load patient directory. Please check network connectivity or administrator privileges.",
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
  }, [debouncedSearch, genderFilter, bloodGroupFilter, page, refreshKey]);

  const handleSearchChange = useCallback((newQuery: string) => {
    setSearchInput(newQuery);
  }, []);

  const handleGenderChange = useCallback((newGender: string) => {
    setGenderFilter(newGender);
    setPage(0);
    setIsLoading(true);
  }, []);

  const handleBloodGroupChange = useCallback((newBloodGroup: string) => {
    setBloodGroupFilter(newBloodGroup);
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
    setGenderFilter("all");
    setBloodGroupFilter("all");
    setPage(0);
    setIsLoading(true);
  }, []);

  const handleSelectPatient = useCallback((patient: AdminPatientItem) => {
    setSelectedPatient(patient);
    setIsDrawerOpen(true);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const hasFilters =
    Boolean(debouncedSearch) || genderFilter !== "all" || bloodGroupFilter !== "all";

  return (
    <AdminLayout
      title="Patient Directory & Governance"
      subtitle="Administrative demographic registries, contact profiles, and ABDM health records"
    >
      <div className="doctor-management-container">
        {/* Studio Header Banner */}
        <section
          className="doctor-studio-banner"
          aria-labelledby="patient-studio-title"
        >
          <div className="doctor-studio-info">
            <span className="doctor-studio-badge">
              <Users size={13} className="doctor-badge-icon" />
              PATIENT DEMOGRAPHIC & CONSENT REGISTRY
            </span>
            <h1 id="patient-studio-title" className="doctor-studio-title">
              Patient Governance Console
            </h1>
            <p className="doctor-studio-desc">
              Inspect cross-clinical patient demographic profiles, verified contact
              identities, ABDM consent bindings, and healthcare activity records.
            </p>
          </div>

          <div className="doctor-studio-actions">
            <button
              type="button"
              className="doctor-sync-btn"
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              title="Refresh patient directory"
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
              <strong>Error loading patient data:</strong> {error}
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
        <PatientSearchAndFilters
          searchTerm={searchInput}
          onSearchChange={handleSearchChange}
          selectedGender={genderFilter}
          onGenderChange={handleGenderChange}
          selectedBloodGroup={bloodGroupFilter}
          onBloodGroupChange={handleBloodGroupChange}
          totalCount={totalCount}
          isLoading={isLoading}
        />

        {/* Data Table */}
        <PatientDirectoryTable
          patients={patients}
          isLoading={isLoading}
          hasFilters={hasFilters}
          onResetFilters={handleResetFilters}
          onSelectPatient={handleSelectPatient}
        />

        {/* Server-Side Pagination */}
        <AdminPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={totalCount}
          onPageChange={(newPage) => setPage(newPage)}
          disabled={isLoading || isRefreshing}
          itemLabel="patients"
        />

        {/* Patient Profile Slide-Out Drawer */}
        <PatientProfileDrawer
          patient={selectedPatient}
          isOpen={isDrawerOpen}
          onClose={handleCloseDrawer}
        />
      </div>
    </AdminLayout>
  );
}

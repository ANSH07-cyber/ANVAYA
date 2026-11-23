import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Shield,
  UserPlus,
  X,
} from "lucide-react";

import AdminLayout from "../../layouts/admin/AdminLayout";
import { adminService } from "../../services/adminService";
import type {
  DoctorProfileRead,
  DoctorReviewItem,
  DoctorVerificationStatus,
} from "../../types/admin";
import DoctorDirectoryTable from "./components/DoctorDirectoryTable";
import DoctorOnboardingModal from "./components/DoctorOnboardingModal";
import DoctorPagination from "./components/DoctorPagination";
import DoctorProfileDrawer from "./components/DoctorProfileDrawer";
import DoctorSearchAndFilters from "./components/DoctorSearchAndFilters";
import DoctorVerificationDialog from "./components/DoctorVerificationDialog";
import "./DoctorManagementPage.css";

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

export default function DoctorManagementPage() {
  const [doctors, setDoctors] = useState<DoctorReviewItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter State
  const [searchInput, setSearchInput] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<DoctorVerificationStatus | "all">("all");

  // Server-side pagination
  const [page, setPage] = useState<number>(0);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // Drawer Inspection State
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorReviewItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Verification Transition Dialog State
  const [verificationTarget, setVerificationTarget] = useState<DoctorVerificationStatus | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

  // Practitioner Onboarding Modal State
  const [isOnboardModalOpen, setIsOnboardModalOpen] = useState<boolean>(false);
  const [onboardSuccessMessage, setOnboardSuccessMessage] = useState<string | null>(null);

  // Prevent stale async responses from overwriting newer search/filter queries
  const latestRequestIdRef = useRef<number>(0);

  // Debounce search input by 300ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(0);
    }, 300);

    return () => clearTimeout(handler);
  }, [searchInput]);

  // Fetch doctors on filter, search, page or manual refresh
  useEffect(() => {
    const requestId = ++latestRequestIdRef.current;
    let isMounted = true;

    const filterParam =
      statusFilter === "all" ? undefined : statusFilter;
    const searchParam = debouncedSearch || undefined;

    adminService
      .getDoctors({
        verification_status: filterParam,
        search: searchParam,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((response) => {
        if (isMounted && requestId === latestRequestIdRef.current) {
          setDoctors(response.items || []);
          setTotalCount(response.total || 0);
          setError(null);
        }
      })
      .catch((err) => {
        if (isMounted && requestId === latestRequestIdRef.current) {
          setError(
            extractErrorMessage(
              err,
              "Failed to load practitioner directory. Please check network connectivity or administrator privileges.",
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
  }, [debouncedSearch, statusFilter, page, refreshKey]);

  const handleSearchChange = useCallback((newQuery: string) => {
    setSearchInput(newQuery);
  }, []);

  const handleStatusChange = useCallback(
    (newStatus: DoctorVerificationStatus | "all") => {
      setStatusFilter(newStatus);
      setPage(0);
      setIsLoading(true);
    },
    [],
  );

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    setIsLoading(true);
  }, []);

  const handleResetFilters = useCallback(() => {
    setSearchInput("");
    setDebouncedSearch("");
    setStatusFilter("all");
    setPage(0);
    setIsLoading(true);
  }, []);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    setIsLoading(true);
    setRefreshKey((k) => k + 1);
  };

  const handleRetry = () => {
    setIsLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
  };

  const handleSelectDoctor = useCallback((doctor: DoctorReviewItem) => {
    setSelectedDoctor(doctor);
    setIsDrawerOpen(true);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const handleActionSelect = useCallback((targetStatus: DoctorVerificationStatus) => {
    setVerificationTarget(targetStatus);
    setIsDialogOpen(true);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setIsDialogOpen(false);
    setVerificationTarget(null);
  }, []);

  const handleVerificationSuccess = useCallback((updatedProfile: DoctorProfileRead) => {
    // 1. Update in local directory items
    setDoctors((prev) =>
      prev.map((doc) =>
        doc.id === updatedProfile.id
          ? {
              ...doc,
              verification_status: updatedProfile.verification_status,
            }
          : doc,
      ),
    );

    // 2. Update selected doctor in the drawer so it reflects new state and action triggers
    setSelectedDoctor((prev) =>
      prev && prev.id === updatedProfile.id
        ? {
            ...prev,
            verification_status: updatedProfile.verification_status,
          }
        : prev,
    );

    // 3. Trigger directory refresh to synchronize counts and ordering
    setRefreshKey((k) => k + 1);
  }, []);

  const handleVerificationConflict = useCallback(() => {
    // Re-sync directory from backend on 409 conflict
    setRefreshKey((k) => k + 1);
  }, []);

  const handleOnboardSuccess = useCallback(
    (createdDoctor: DoctorProfileRead, doctorName: string) => {
      setOnboardSuccessMessage(
        `Practitioner "${doctorName}" successfully registered with Pending verification status (DoctorProfile ID: ${createdDoctor.id.slice(0, 8)}…).`,
      );

      // Re-fetch directory so the new practitioner appears in the table
      setRefreshKey((k) => k + 1);
    },
    [],
  );

  const hasActiveFilters = Boolean(searchInput.trim() || statusFilter !== "all");

  return (
    <AdminLayout
      title="Practitioner Management"
      subtitle="Healthcare provider registry, medical licensure verification, and credential oversight"
    >
      <div className="doctor-management-container">
        {/* Top Control & Banner Strip */}
        <section
          className="doctor-studio-banner"
          aria-label="Doctor management controls and platform summary"
        >
          <div className="doctor-studio-info">
            <div className="doctor-studio-badge">
              <Shield size={13} className="doctor-badge-icon" />
              <span>CLINICAL PRACTITIONER GOVERNANCE</span>
            </div>
            <h1 className="doctor-studio-title">Doctor Management Studio</h1>
            <p className="doctor-studio-desc">
              Centralized platform registry for healthcare professionals. Review
              medical licenses, supervise practice authorizations, and track
              credential lifecycle transitions.
            </p>
          </div>

          <div className="doctor-studio-actions">
            <button
              type="button"
              className="doctor-onboard-btn"
              onClick={() => setIsOnboardModalOpen(true)}
              title="Register and onboard a new medical practitioner"
              aria-label="Onboard new practitioner"
            >
              <UserPlus size={16} />
              <span>Onboard Practitioner</span>
            </button>

            <button
              type="button"
              className="doctor-sync-btn"
              onClick={handleManualRefresh}
              disabled={isRefreshing || isLoading}
              title="Synchronize directory with live database"
              aria-label="Refresh practitioner list"
            >
              <RefreshCw
                size={16}
                className={isRefreshing ? "spin-animation" : ""}
              />
              <span>{isRefreshing ? "Synchronizing..." : "Sync Directory"}</span>
            </button>
          </div>
        </section>

        {/* Onboarding Success Banner */}
        {onboardSuccessMessage && (
          <div className="doctor-success-banner" role="status">
            <CheckCircle2 size={20} className="doctor-success-icon" />
            <div className="doctor-success-copy">
              <strong>Practitioner Registered Successfully</strong>
              <p>{onboardSuccessMessage}</p>
            </div>
            <button
              type="button"
              className="doctor-dismiss-btn"
              onClick={() => setOnboardSuccessMessage(null)}
              aria-label="Dismiss success message"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Error Alert Banner */}
        {error && (
          <div className="doctor-error-banner" role="alert">
            <AlertCircle size={20} className="doctor-error-icon" />
            <div className="doctor-error-copy">
              <strong>Directory Sync Error</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              className="doctor-retry-btn"
              onClick={handleRetry}
            >
              Retry
            </button>
          </div>
        )}

        {/* Search & Filter Toolbar */}
        <section
          className="doctor-toolbar-section"
          aria-label="Search and filter practitioners"
        >
          <DoctorSearchAndFilters
            searchTerm={searchInput}
            onSearchChange={handleSearchChange}
            selectedStatus={statusFilter}
            onStatusChange={handleStatusChange}
            totalCount={totalCount}
            isLoading={isLoading}
          />
        </section>

        {/* Directory Data Table */}
        <section
          className="doctor-table-section"
          aria-label="Practitioner directory data table"
        >
          <DoctorDirectoryTable
            doctors={doctors}
            isLoading={isLoading}
            hasFilters={hasActiveFilters}
            onResetFilters={handleResetFilters}
            onSelectDoctor={handleSelectDoctor}
          />

          {/* Pagination Controls */}
          {!isLoading && (
            <DoctorPagination
              page={page}
              pageSize={PAGE_SIZE}
              total={totalCount}
              onPageChange={handlePageChange}
              disabled={isLoading || isRefreshing}
            />
          )}
        </section>

        {/* Practitioner Credential Review Drawer */}
        <DoctorProfileDrawer
          doctor={selectedDoctor}
          isOpen={isDrawerOpen}
          onClose={handleCloseDrawer}
          onActionSelect={handleActionSelect}
        />

        {/* Verification Status Transition Dialog */}
        {isDialogOpen && selectedDoctor && verificationTarget && (
          <DoctorVerificationDialog
            key={`${selectedDoctor.id}-${verificationTarget}`}
            doctor={selectedDoctor}
            targetStatus={verificationTarget}
            isOpen={isDialogOpen}
            onClose={handleCloseDialog}
            onSuccess={handleVerificationSuccess}
            onConflict={handleVerificationConflict}
          />
        )}

        {/* Practitioner Direct Onboarding Modal */}
        {isOnboardModalOpen && (
          <DoctorOnboardingModal
            isOpen={isOnboardModalOpen}
            onClose={() => setIsOnboardModalOpen(false)}
            onSuccess={handleOnboardSuccess}
          />
        )}
      </div>
    </AdminLayout>
  );
}

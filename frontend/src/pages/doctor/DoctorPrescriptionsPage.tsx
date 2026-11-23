import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Pill,
  RefreshCw,
  Search,
  Stethoscope,
  User,
  X,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import DoctorLayout from "../../layouts/DoctorLayout";
import { doctorService } from "../../services/doctorService";
import type {
  DoctorPrescriptionRead,
  DoctorPrescriptionFilterParams,
} from "../../types/doctor";
import DoctorPrescriptionDetailDrawer from "./components/DoctorPrescriptionDetailDrawer";
import "./DoctorPrescriptionsPage.css";

function formatKolkataDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(dateObj);
  } catch {
    return dateStr;
  }
}

function formatKolkataTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return isoString;
  }
}

export default function DoctorPrescriptionsPage() {
  const { user } = useAuth();
  const doctorDisplayName = user?.full_name ? `Dr. ${user.full_name.trim()}` : "Doctor";

  // Data State
  const [prescriptions, setPrescriptions] = useState<DoctorPrescriptionRead[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  // Pagination & Filters State
  const [page, setPage] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(20);
  const [searchInput, setSearchInput] = useState<string>("");
  const [activeSearch, setActiveSearch] = useState<string>("");
  const [appointmentFilter, setAppointmentFilter] = useState<string>("");
  const [patientFilter, setPatientFilter] = useState<string>("");

  // Drawer Detail State
  const [selectedPrescription, setSelectedPrescription] = useState<DoctorPrescriptionRead | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Fetch prescriptions from backend
  useEffect(() => {
    let isMounted = true;

    const params: DoctorPrescriptionFilterParams = {
      limit: pageSize,
      offset: page * pageSize,
    };

    if (activeSearch.trim()) {
      params.search = activeSearch.trim();
    }
    if (appointmentFilter.trim()) {
      params.appointment_id = appointmentFilter.trim();
    }
    if (patientFilter.trim()) {
      params.patient_profile_id = patientFilter.trim();
    }

    doctorService
      .getDoctorPrescriptions(params)
      .then((response) => {
        if (isMounted) {
          setPrescriptions(response.items);
          setTotalCount(response.total);
          setError(null);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
          if (axiosErr?.response?.status === 403) {
            setError("Access restricted. Only verified, approved doctors may view prescription history.");
          } else if (axiosErr?.response?.status === 401) {
            setError("Session expired or unauthorized. Please re-authenticate.");
          } else {
            const detail =
              axiosErr?.response?.data?.detail ||
              "Unable to load prescription history. Please check your network connection and retry.";
            setError(detail);
          }
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [page, pageSize, activeSearch, appointmentFilter, patientFilter, reloadToken]);

  // Handle Search Submission
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setPage(0);
    setActiveSearch(searchInput);
  };

  const handleClearSearch = () => {
    setIsLoading(true);
    setError(null);
    setSearchInput("");
    setActiveSearch("");
    setPage(0);
  };

  const handleClearAllFilters = () => {
    setIsLoading(true);
    setError(null);
    setSearchInput("");
    setActiveSearch("");
    setAppointmentFilter("");
    setPatientFilter("");
    setPage(0);
  };

  // Inspect detail handler
  const handleInspectPrescription = (rx: DoctorPrescriptionRead) => {
    setSelectedPrescription(rx);
    setIsDrawerOpen(true);
  };

  // Summary Metrics
  const metrics = useMemo(() => {
    const totalMedicines = prescriptions.reduce((sum, rx) => sum + (rx.items?.length || 0), 0);
    const uniquePatients = new Set(prescriptions.map((rx) => rx.patient_profile_id)).size;
    return {
      totalMedicines,
      uniquePatients,
    };
  }, [prescriptions]);

  const hasActiveFilters = Boolean(
    activeSearch.trim() || appointmentFilter.trim() || patientFilter.trim()
  );

  const startRecordIndex = totalCount === 0 ? 0 : page * pageSize + 1;
  const endRecordIndex = Math.min((page + 1) * pageSize, totalCount);
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  return (
    <DoctorLayout title="Prescription History">
      <div className="doc-rx-container">
        {/* Header Card */}
        <section className="doc-rx-header-card" aria-label="Prescription Studio Overview">
          <div className="doc-rx-header-top">
            <div className="doc-rx-header-text">
              <div className="doc-rx-kicker">
                <Stethoscope size={13} aria-hidden="true" />
                <span>CLINICAL PRACTICE · DIGITAL PRESCRIPTIONS</span>
              </div>
              <h1 className="doc-rx-title">Doctor Prescription History</h1>
              <p className="doc-rx-subtitle">
                Access and inspect official digital prescriptions issued across your clinical
                encounters. Each prescription is recorded in the patient&apos;s medical history and
                immediately accessible in their portal.
              </p>
            </div>

            <div className="doc-rx-header-actions">
              <button
                type="button"
                className="doc-rx-refresh-btn"
                onClick={() => {
                  setIsLoading(true);
                  setError(null);
                  setReloadToken((t) => t + 1);
                }}
                disabled={isLoading}
                title="Refresh prescription records"
                aria-label="Refresh prescription records"
              >
                <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} aria-hidden="true" />
                <span>Refresh</span>
              </button>

              <Link to="/doctor/appointments" className="doc-rx-new-consult-link">
                <Clock size={14} aria-hidden="true" />
                <span>Appointments Queue</span>
              </Link>
            </div>
          </div>

          {/* Metric Stats Strip */}
          <div className="doc-rx-metrics-grid" aria-label="Prescription statistics">
            <div className="doc-rx-metric-box">
              <div className="doc-rx-metric-icon">
                <FileText size={18} aria-hidden="true" />
              </div>
              <div className="doc-rx-metric-info">
                <span className="doc-rx-metric-value">{totalCount}</span>
                <span className="doc-rx-metric-label">Total Prescriptions</span>
              </div>
            </div>

            <div className="doc-rx-metric-box">
              <div className="doc-rx-metric-icon">
                <Pill size={18} aria-hidden="true" />
              </div>
              <div className="doc-rx-metric-info">
                <span className="doc-rx-metric-value">{metrics.totalMedicines}</span>
                <span className="doc-rx-metric-label">Medicines on This Page</span>
              </div>
            </div>

            <div className="doc-rx-metric-box">
              <div className="doc-rx-metric-icon">
                <User size={18} aria-hidden="true" />
              </div>
              <div className="doc-rx-metric-info">
                <span className="doc-rx-metric-value">{metrics.uniquePatients}</span>
                <span className="doc-rx-metric-label">Unique Patients on This Page</span>
              </div>
            </div>

            <div className="doc-rx-metric-box">
              <div className="doc-rx-metric-icon">
                <CheckCircle2 size={18} aria-hidden="true" />
              </div>
              <div className="doc-rx-metric-info">
                <span className="doc-rx-metric-value" style={{ fontSize: "0.95rem" }}>
                  Read-Only History
                </span>
                <span className="doc-rx-metric-label">Clinical Status</span>
              </div>
            </div>
          </div>
        </section>

        {/* Filter Card */}
        <section className="doc-rx-filter-card" aria-label="Search and filter options">
          <form className="doc-rx-filter-row" onSubmit={handleSearchSubmit}>
            {/* Search Input */}
            <div className="doc-rx-search-wrapper">
              <Search size={16} className="doc-rx-search-icon" aria-hidden="true" />
              <input
                type="text"
                className="doc-rx-search-input"
                placeholder="Search by patient name or medicine name..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search prescriptions by patient name or medicine"
              />
              {searchInput && (
                <button
                  type="button"
                  className="doc-rx-search-clear"
                  onClick={handleClearSearch}
                  aria-label="Clear search input"
                  title="Clear search"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Filter Inputs */}
            <div className="doc-rx-filter-controls">
              <input
                type="text"
                className="doc-rx-input-sm"
                placeholder="Filter by Appointment ID..."
                value={appointmentFilter}
                onChange={(e) => {
                  setIsLoading(true);
                  setAppointmentFilter(e.target.value);
                  setPage(0);
                }}
                aria-label="Filter by appointment UUID"
              />

              <input
                type="text"
                className="doc-rx-input-sm"
                placeholder="Filter by Patient ID..."
                value={patientFilter}
                onChange={(e) => {
                  setIsLoading(true);
                  setPatientFilter(e.target.value);
                  setPage(0);
                }}
                aria-label="Filter by patient UUID"
              />

              {hasActiveFilters && (
                <button
                  type="button"
                  className="doc-rx-clear-filters-btn"
                  onClick={handleClearAllFilters}
                  title="Reset all search filters"
                >
                  Reset Filters
                </button>
              )}
            </div>
          </form>

          {/* Active Filter Indicators */}
          {hasActiveFilters && (
            <div className="doc-rx-active-pills" aria-live="polite">
              <span>Active filters:</span>
              {activeSearch && (
                <span className="doc-rx-pill">
                  Search: &ldquo;{activeSearch}&rdquo;
                  <button
                    type="button"
                    className="doc-rx-pill-remove"
                    onClick={handleClearSearch}
                    aria-label="Remove search filter"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              )}
              {appointmentFilter && (
                <span className="doc-rx-pill">
                  Appointment: {appointmentFilter.slice(0, 8)}...
                  <button
                    type="button"
                    className="doc-rx-pill-remove"
                    onClick={() => {
                      setAppointmentFilter("");
                      setPage(0);
                    }}
                    aria-label="Remove appointment filter"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              )}
              {patientFilter && (
                <span className="doc-rx-pill">
                  Patient ID: {patientFilter.slice(0, 8)}...
                  <button
                    type="button"
                    className="doc-rx-pill-remove"
                    onClick={() => {
                      setPatientFilter("");
                      setPage(0);
                    }}
                    aria-label="Remove patient filter"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>
          )}
        </section>

        {/* Content Section: Table / Loading / Empty / Error */}
        <section className="doc-rx-content-card" aria-label="Prescriptions Table">
          {isLoading ? (
            <div className="doc-rx-skeleton-table" role="status" aria-live="polite">
              <div className="doc-rx-skeleton-row" />
              <div className="doc-rx-skeleton-row" />
              <div className="doc-rx-skeleton-row" />
              <div className="doc-rx-skeleton-row" />
              <div className="doc-rx-skeleton-row" />
            </div>
          ) : error ? (
            <div className="doc-rx-error-state" role="alert">
              <AlertCircle size={36} color="#f87171" aria-hidden="true" />
              <h3>Failed to Load Prescriptions</h3>
              <p>{error}</p>
              <button
                type="button"
                className="doc-rx-refresh-btn"
                onClick={() => {
                  setIsLoading(true);
                  setError(null);
                  setReloadToken((t) => t + 1);
                }}
                style={{ marginTop: 8 }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          ) : prescriptions.length === 0 ? (
            <div className="doc-rx-empty-state">
              <div className="doc-rx-empty-icon">
                {hasActiveFilters ? <Search size={26} /> : <Pill size={26} />}
              </div>
              <h3 className="doc-rx-empty-title">
                {hasActiveFilters ? "No Matching Prescriptions Found" : "No Prescriptions Issued Yet"}
              </h3>
              <p className="doc-rx-empty-desc">
                {hasActiveFilters
                  ? "No prescription records match your active search terms or filters. Try adjusting your query or resetting all filters."
                  : "You have not issued any digital prescriptions yet. When you complete a patient consultation and issue a prescription, it will appear here in your prescription history."}
              </p>
              {hasActiveFilters ? (
                <button
                  type="button"
                  className="doc-rx-clear-filters-btn"
                  onClick={handleClearAllFilters}
                  style={{ marginTop: 8 }}
                >
                  Clear All Filters
                </button>
              ) : (
                <Link
                  to="/doctor/appointments"
                  className="doc-rx-new-consult-link"
                  style={{ marginTop: 8 }}
                >
                  <span>Go to Appointments</span>
                </Link>
              )}
            </div>
          ) : (
            <>
              {/* Prescriptions Table */}
              <div className="doc-rx-table-wrapper">
                <table className="doc-rx-table" aria-label="Prescription History Table">
                  <thead>
                    <tr>
                      <th scope="col">Patient</th>
                      <th scope="col">Encounter Date</th>
                      <th scope="col">Issued Time (IST)</th>
                      <th scope="col">Prescribed Medications</th>
                      <th scope="col">Clinical Notes</th>
                      <th scope="col" style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prescriptions.map((rx) => (
                      <tr key={rx.id}>
                        {/* Patient Cell */}
                        <td>
                          <div className="doc-rx-cell-patient">
                            <span className="doc-rx-patient-name">
                              <User size={14} color="#14b8a6" aria-hidden="true" />
                              {rx.patient_name}
                            </span>
                            <span className="doc-rx-patient-ref" title={rx.patient_profile_id}>
                              ID: {rx.patient_profile_id.slice(0, 8)}...
                            </span>
                          </div>
                        </td>

                        {/* Encounter Date */}
                        <td>
                          <div className="doc-rx-cell-date">
                            <span className="doc-rx-date-primary">
                              {formatKolkataDate(rx.appointment_date)}
                            </span>
                          </div>
                        </td>

                        {/* Issued At (IST) */}
                        <td>
                          <div className="doc-rx-cell-date">
                            <span className="doc-rx-date-primary">
                              {formatKolkataTimestamp(rx.issued_at)}
                            </span>
                          </div>
                        </td>

                        {/* Medications Summary */}
                        <td>
                          <div className="doc-rx-cell-meds">
                            <div className="doc-rx-med-chips">
                              {rx.items?.slice(0, 2).map((med) => (
                                <span key={med.id} className="doc-rx-med-chip" title={`${med.medicine_name} (${med.dosage})`}>
                                  <Pill size={11} aria-hidden="true" />
                                  {med.medicine_name} {med.dosage}
                                </span>
                              ))}
                              {rx.items?.length > 2 && (
                                <span className="doc-rx-med-more">
                                  +{rx.items.length - 2} more
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Notes Cell */}
                        <td>
                          <div className="doc-rx-cell-notes" title={rx.notes || "No notes recorded"}>
                            {rx.notes || <em style={{ color: "#64748b" }}>None recorded</em>}
                          </div>
                        </td>

                        {/* Actions */}
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="doc-rx-inspect-btn"
                            onClick={() => handleInspectPrescription(rx)}
                            title="Inspect official prescription receipt and print"
                            aria-label={`Inspect prescription for ${rx.patient_name}`}
                          >
                            <Eye size={13} aria-hidden="true" />
                            <span>View Details</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="doc-rx-pagination-bar" aria-label="Pagination controls">
                <div className="doc-rx-pagination-info">
                  Showing <strong>{startRecordIndex}</strong> to <strong>{endRecordIndex}</strong> of{" "}
                  <strong>{totalCount}</strong> prescriptions (Page {page + 1} of {totalPages})
                </div>

                <div className="doc-rx-pagination-controls">
                  <label htmlFor="rx-page-size" style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                    Per page:
                  </label>
                  <select
                    id="rx-page-size"
                    className="doc-rx-page-size-select"
                    value={pageSize}
                    onChange={(e) => {
                      setIsLoading(true);
                      setPageSize(Number(e.target.value));
                      setPage(0);
                    }}
                    aria-label="Select prescriptions per page"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>

                  <button
                    type="button"
                    className="doc-rx-page-btn"
                    onClick={() => {
                      setIsLoading(true);
                      setPage((p) => Math.max(0, p - 1));
                    }}
                    disabled={page === 0}
                    aria-label="Go to previous page"
                  >
                    <ChevronLeft size={14} aria-hidden="true" />
                    <span>Previous</span>
                  </button>

                  <button
                    type="button"
                    className="doc-rx-page-btn"
                    onClick={() => {
                      setIsLoading(true);
                      setPage((p) => p + 1);
                    }}
                    disabled={page + 1 >= totalPages}
                    aria-label="Go to next page"
                  >
                    <span>Next</span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Prescription Detail Slide-Out Drawer */}
        <DoctorPrescriptionDetailDrawer
          prescriptionId={selectedPrescription?.id || null}
          initialPrescription={selectedPrescription}
          isOpen={isDrawerOpen}
          onClose={() => {
            setIsDrawerOpen(false);
            setSelectedPrescription(null);
          }}
          doctorName={doctorDisplayName}
        />
      </div>
    </DoctorLayout>
  );
}

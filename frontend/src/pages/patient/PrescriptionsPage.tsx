import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  FileText,
  Pill,
  Search,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import PortalLayout from "../../layouts/PortalLayout";
import { patientNavigation } from "./patientNavigation";
import { patientService } from "../../services/patientService";
import PatientHistoryControls from "./PatientHistoryControls";
import { usePatientHistoryPage } from "./usePatientHistoryPage";
import "./PrescriptionsPage.css";

type PrescriptionFilter = "all" | "recent";

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function PrescriptionsPage() {
  const { user } = useAuth();
  const displayName = user?.full_name?.trim() || "Patient";

  const history = usePatientHistoryPage(user?.id, patientService.getMyPrescriptions, "your prescriptions");
  const { items: prescriptions, loading, error } = history;
  const [filter, setFilter] = useState<PrescriptionFilter>("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const medicines = prescriptions.reduce(
      (total, prescription) => total + prescription.items.length,
      0,
    );

    const currentMonth = new Date();
    const issuedThisMonth = prescriptions.filter((prescription) => {
      const date = new Date(prescription.issued_at);

      return (
        !Number.isNaN(date.getTime()) &&
        date.getMonth() === currentMonth.getMonth() &&
        date.getFullYear() === currentMonth.getFullYear()
      );
    }).length;

    const withInstructions = prescriptions.filter((prescription) =>
      prescription.items.some((item) => Boolean(item.instructions)),
    ).length;

    return {
      total: prescriptions.length,
      medicines,
      issuedThisMonth,
      withInstructions,
    };
  }, [prescriptions]);

  const filteredPrescriptions = useMemo(() => {
    const query = search.trim().toLowerCase();

    return prescriptions
      .filter((prescription) => {
        if (filter === "recent") {
          const issuedDate = new Date(prescription.issued_at);
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 30);

          return !Number.isNaN(issuedDate.getTime()) && issuedDate >= cutoff;
        }

        return true;
      })
      .filter((prescription) => {
        if (!query) return true;

        const prescriptionText = [
          prescription.id,
          prescription.notes ?? "",
          ...prescription.items.flatMap((item) => [
            item.medicine_name,
            item.dosage,
            item.route ?? "",
            item.frequency,
            item.duration,
            item.instructions ?? "",
          ]),
        ];

        return prescriptionText.some((value) =>
          value.toLowerCase().includes(query),
        );
      })
      .sort(
        (a, b) =>
          new Date(b.issued_at).getTime() -
          new Date(a.issued_at).getTime(),
      );
  }, [prescriptions, filter, search]);

  return (
    <PortalLayout
      roleLabel="Patient"
      userName={displayName}
      userMeta="Patient account"
      navItems={patientNavigation}
    >
      <main className="prescriptions-page">
        <section className="prescriptions-heading">
          <div>
            <span className="prescriptions-eyebrow">
              YOUR MEDICATION HISTORY
            </span>
            <h1>My prescriptions</h1>
            <p>
              View your prescribed medicines, dosage details and
              instructions from your healthcare visits.
            </p>
          </div>

          <div className="prescriptions-heading-icon">
            <Pill size={28} />
          </div>
        </section>

        <section className="prescriptions-stats">
          <article className="prescriptions-stat-card">
            <span className="prescriptions-stat-icon teal">
              <FileText size={20} />
            </span>
            <div>
              <small>Total prescriptions</small>
              <strong>{loading || error ? "—" : counts.total}</strong>
            </div>
          </article>

          <article className="prescriptions-stat-card">
            <span className="prescriptions-stat-icon blue">
              <Pill size={20} />
            </span>
            <div>
              <small>Prescribed medicines</small>
              <strong>{loading || error ? "—" : counts.medicines}</strong>
            </div>
          </article>

          <article className="prescriptions-stat-card">
            <span className="prescriptions-stat-icon green">
              <CalendarDays size={20} />
            </span>
            <div>
              <small>Issued this month</small>
              <strong>
                {loading || error ? "—" : counts.issuedThisMonth}
              </strong>
            </div>
          </article>

          <article className="prescriptions-stat-card">
            <span className="prescriptions-stat-icon purple">
              <ClipboardList size={20} />
            </span>
            <div>
              <small>With medicine instructions</small>
              <strong>
                {loading || error ? "—" : counts.withInstructions}
              </strong>
            </div>
          </article>
        </section>

        <section className="prescriptions-content-card">
          <div className="prescriptions-content-heading">
            <div>
              <span className="prescriptions-section-kicker">
                DIGITAL PRESCRIPTIONS
              </span>
              <h2>Prescription history</h2>
              <p>
                Review the medicines and instructions recorded in
                your prescriptions.
              </p>
            </div>

            <ShieldCheck size={23} />
          </div>

          <div className="prescriptions-toolbar">
            <div className="prescriptions-filters">
              <button
                type="button"
                className={`prescriptions-filter ${
                  filter === "all" ? "active" : ""
                }`}
                onClick={() => setFilter("all")}
              >
                All prescriptions
                <span>{loading || error ? "—" : counts.total}</span>
              </button>

              <button
                type="button"
                className={`prescriptions-filter ${
                  filter === "recent" ? "active" : ""
                }`}
                onClick={() => setFilter("recent")}
              >
                Last 30 days
              </button>
            </div>

            <label className="prescriptions-search">
              <Search size={17} />
              <input
                type="search"
                placeholder="Search medicines or instructions..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          <PatientHistoryControls page={history.page} offset={history.offset}
            loadedCount={prescriptions.length} setOffset={history.setOffset} />

          {loading ? (
            <div className="prescriptions-state">
              <div className="prescriptions-spinner" />
              <h3>Loading your prescriptions</h3>
              <p>Retrieving your prescription history securely.</p>
            </div>
          ) : error ? (
            <div className="prescriptions-state">
              <span className="prescriptions-state-icon error">
                <FileText size={26} />
              </span>
              <h3>Unable to load prescriptions</h3>
              <p>{error}</p>
              <button
                type="button"
                className="prescriptions-retry-button"
                onClick={history.reload}
              >
                Refresh page
              </button>
            </div>
          ) : filteredPrescriptions.length === 0 ? (
            <div className="prescriptions-state">
              <span className="prescriptions-state-icon">
                <Pill size={27} />
              </span>
              <h3>
                {search
                  ? "No matching prescriptions on this page"
                  : filter === "recent"
                    ? "No prescriptions from the last 30 days on this page"
                    : history.offset > 0 ? "No entries on this page" : "No prescriptions yet"}
              </h3>
              <p>
                {search
                  ? "Try another medicine name or search term."
                  : "Prescriptions issued during your healthcare visits will appear here."}
              </p>

              {(search || filter !== "all") && (
                <button
                  type="button"
                  className="prescriptions-reset-button"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="prescriptions-list">
              {filteredPrescriptions.map((prescription) => (
                <article
                  className="prescription-card"
                  key={prescription.id}
                >
                  <div className="prescription-card-header">
                    <div className="prescription-card-title">
                      <span className="prescription-card-icon">
                        <Stethoscope size={20} />
                      </span>
                      <div>
                        <span className="prescription-card-kicker">
                          MEDICAL PRESCRIPTION
                        </span>
                        <h3>Prescription details</h3>
                      </div>
                    </div>

                    <div className="prescription-issued-date">
                      <span>ISSUED ON</span>
                      <strong>{formatDate(prescription.issued_at)}</strong>
                    </div>
                  </div>

                  {prescription.notes && (
                    <div className="prescription-notes">
                      <strong>Doctor's notes</strong>
                      <p>{prescription.notes}</p>
                    </div>
                  )}

                  <div className="prescription-medicines-heading">
                    <Pill size={17} />
                    <h4>Prescribed medicines</h4>
                    <span>{prescription.items.length} items</span>
                  </div>

                  {prescription.items.length === 0 ? (
                    <p className="prescription-no-medicines">
                      No medicine items are listed in this prescription.
                    </p>
                  ) : (
                    <div className="prescription-medicines">
                      {prescription.items.map((item) => (
                        <div
                          className="prescription-medicine"
                          key={item.id}
                        >
                          <div className="prescription-medicine-name">
                            <span className="prescription-medicine-number">
                              {item.sort_order + 1}
                            </span>
                            <div>
                              <strong>{item.medicine_name}</strong>
                              <span>{item.dosage}</span>
                            </div>
                          </div>

                          <div className="prescription-medicine-details">
                            <div>
                              <small>Frequency</small>
                              <strong>{item.frequency}</strong>
                            </div>

                            <div>
                              <small>Duration</small>
                              <strong>{item.duration}</strong>
                            </div>

                            <div>
                              <small>Route</small>
                              <strong>{item.route || "Not specified"}</strong>
                            </div>

                            <div>
                              <small>Quantity</small>
                              <strong>{item.quantity || "Not specified"}</strong>
                            </div>
                          </div>

                          {item.instructions && (
                            <div className="prescription-medicine-instructions">
                              <strong>Instructions</strong>
                              <p>{item.instructions}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="prescription-card-footer">
                    <span>Prescription ID: {prescription.id}</span>
                    <span>
                      {prescription.items.length} medicine(s)
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="prescriptions-help-note">
          <ShieldCheck size={19} />
          <div>
            <strong>Your prescription information is protected</strong>
            <p>
              This page displays prescription details retrieved
              through your authenticated patient account.
            </p>
          </div>
          <Link to="/patient">
            Back to overview <ArrowRight size={15} />
          </Link>
        </section>
      </main>
    </PortalLayout>
  );
}

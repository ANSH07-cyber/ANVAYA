
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  FileText,
  HeartPulse,
  Search,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import PortalLayout from "../../layouts/PortalLayout";
import { patientNavigation } from "./patientNavigation";
import { patientService } from "../../services/patientService";
import type { PatientHealthRecord } from "../../types/patient";
import "./HealthRecordsPage.css";

type RecordFilter = "all" | "recent";

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getRecordTitle(record: PatientHealthRecord) {
  return record.chief_complaint || record.diagnosis || "Consultation record";
}

export default function HealthRecordsPage() {
  const { user } = useAuth();
  const displayName = user?.full_name?.trim() || "Patient";

  const [records, setRecords] = useState<PatientHealthRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<RecordFilter>("all");
  const [search, setSearch] = useState("");

  async function loadRecords() {
    setLoading(true);
    setError("");

    try {
      const response = await patientService.getMyHealthRecords();
      setRecords(response.items);
    } catch {
      setError(
        "We couldn't load your health records. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function fetchRecords() {
      try {
        const response = await patientService.getMyHealthRecords();

        if (active) setRecords(response.items);
      } catch {
        if (active) {
          setError(
            "We couldn't load your health records. Please try again.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchRecords();

    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => ({
    total: records.length,
    diagnosed: records.filter((record) => Boolean(record.diagnosis)).length,
    withTreatment: records.filter(
      (record) => Boolean(record.treatment_plan),
    ).length,
    withFollowUp: records.filter(
      (record) => Boolean(record.follow_up_instructions),
    ).length,
  }), [records]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();

    return records
      .filter((record) => {
        if (filter === "recent") {
          const recordDate = new Date(`${record.visit_date}T00:00:00`);
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 30);
          return recordDate >= cutoff;
        }

        return true;
      })
      .filter((record) => {
        if (!query) return true;

        return [
          record.chief_complaint ?? "",
          record.diagnosis ?? "",
          record.symptoms ?? "",
          record.visit_summary,
          record.treatment_plan ?? "",
          record.clinical_notes ?? "",
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort(
        (a, b) =>
          new Date(b.visit_date).getTime() -
          new Date(a.visit_date).getTime(),
      );
  }, [records, filter, search]);

  return (
    <PortalLayout
      roleLabel="Patient"
      userName={displayName}
      userMeta="Patient account"
      navItems={patientNavigation}
    >
      <main className="health-records-page">
        <section className="health-records-heading">
          <div>
            <span className="health-records-eyebrow">
              YOUR PERSONAL HEALTH HISTORY
            </span>
            <h1>My health records</h1>
            <p>
              Access your consultation history, clinical notes and
              treatment information in one secure place.
            </p>
          </div>

          <div className="health-records-heading-icon">
            <HeartPulse size={28} />
          </div>
        </section>

        <section className="health-records-stats">
          <article className="health-records-stat-card">
            <span className="health-records-stat-icon teal">
              <FileText size={20} />
            </span>
            <div>
              <small>Total records</small>
              <strong>
                {loading || error ? "—" : counts.total}
              </strong>
            </div>
          </article>

          <article className="health-records-stat-card">
            <span className="health-records-stat-icon blue">
              <Activity size={20} />
            </span>
            <div>
              <small>With diagnosis</small>
              <strong>
                {loading || error ? "—" : counts.diagnosed}
              </strong>
            </div>
          </article>

          <article className="health-records-stat-card">
            <span className="health-records-stat-icon green">
              <ClipboardList size={20} />
            </span>
            <div>
              <small>Treatment plans</small>
              <strong>
                {loading || error ? "—" : counts.withTreatment}
              </strong>
            </div>
          </article>

          <article className="health-records-stat-card">
            <span className="health-records-stat-icon purple">
              <CalendarDays size={20} />
            </span>
            <div>
              <small>Follow-up instructions</small>
              <strong>
                {loading || error ? "—" : counts.withFollowUp}
              </strong>
            </div>
          </article>
        </section>

        <section className="health-records-content-card">
          <div className="health-records-content-heading">
            <div>
              <span className="health-records-section-kicker">
                MEDICAL HISTORY
              </span>
              <h2>Consultation records</h2>
              <p>
                Review the health information documented during your visits.
              </p>
            </div>
            <ShieldCheck size={23} />
          </div>

          <div className="health-records-toolbar">
            <div className="health-records-filters">
              <button
                type="button"
                className={`health-records-filter ${
                  filter === "all" ? "active" : ""
                }`}
                onClick={() => setFilter("all")}
              >
                All records
                <span>{loading || error ? "—" : counts.total}</span>
              </button>

              <button
                type="button"
                className={`health-records-filter ${
                  filter === "recent" ? "active" : ""
                }`}
                onClick={() => setFilter("recent")}
              >
                Last 30 days
              </button>
            </div>

            <label className="health-records-search">
              <Search size={17} />
              <input
                type="search"
                placeholder="Search health records..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          {loading ? (
            <div className="health-records-state">
              <div className="health-records-spinner" />
              <h3>Loading your health records</h3>
              <p>
                Retrieving your medical history securely.
              </p>
            </div>
          ) : error ? (
            <div className="health-records-state">
              <span className="health-records-state-icon error">
                <Activity size={25} />
              </span>
              <h3>Unable to load health records</h3>
              <p>{error}</p>
              <button
                type="button"
                className="health-records-retry-button"
                onClick={() => void loadRecords()}
              >
                Try again
              </button>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="health-records-state">
              <span className="health-records-state-icon">
                <FileText size={27} />
              </span>
              <h3>
                {search
                  ? "No matching records"
                  : filter === "recent"
                    ? "No records in the last 30 days"
                    : "No health records yet"}
              </h3>
              <p>
                {search
                  ? "Try searching with a different term."
                  : "Your consultation records will appear here when they are added by your healthcare provider."}
              </p>

              {(search || filter !== "all") && (
                <button
                  type="button"
                  className="health-records-reset-button"
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
            <div className="health-records-list">
              {filteredRecords.map((record) => (
                <article
                  className="health-record-card"
                  key={record.id}
                >
                  <div className="health-record-card-top">
                    <div className="health-record-card-icon">
                      <Stethoscope size={21} />
                    </div>

                    <div className="health-record-card-date">
                      <span>VISIT DATE</span>
                      <strong>{formatDate(record.visit_date)}</strong>
                    </div>
                  </div>

                  <h3>{getRecordTitle(record)}</h3>

                  {record.diagnosis && (
                    <div className="health-record-detail">
                      <strong>Diagnosis</strong>
                      <p>{record.diagnosis}</p>
                    </div>
                  )}

                  {record.symptoms && (
                    <div className="health-record-detail">
                      <strong>Symptoms</strong>
                      <p>{record.symptoms}</p>
                    </div>
                  )}

                  {record.visit_summary && (
                    <div className="health-record-detail">
                      <strong>Visit summary</strong>
                      <p>{record.visit_summary}</p>
                    </div>
                  )}

                  {record.treatment_plan && (
                    <div className="health-record-detail">
                      <strong>Treatment plan</strong>
                      <p>{record.treatment_plan}</p>
                    </div>
                  )}

                  {record.follow_up_instructions && (
                    <div className="health-record-detail">
                      <strong>Follow-up instructions</strong>
                      <p>{record.follow_up_instructions}</p>
                    </div>
                  )}

                  {record.clinical_notes && (
                    <div className="health-record-detail">
                      <strong>Clinical notes</strong>
                      <p>{record.clinical_notes}</p>
                    </div>
                  )}

                  <span className="health-record-reference">
                    Record ID: {record.id}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="health-records-help-note">
          <ShieldCheck size={19} />
          <div>
            <strong>Your medical information is private</strong>
            <p>
              These records are retrieved through your authenticated
              patient account.
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

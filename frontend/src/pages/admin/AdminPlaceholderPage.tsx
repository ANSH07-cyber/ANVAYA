import { Link } from "react-router-dom";
import { ArrowLeft, Construction, ShieldCheck } from "lucide-react";
import AdminLayout from "../../layouts/admin/AdminLayout";

interface AdminPlaceholderPageProps {
  title: string;
  stageBadge: string;
  description: string;
  scheduledMilestone: string;
}

export default function AdminPlaceholderPage({
  title,
  stageBadge,
  description,
  scheduledMilestone,
}: AdminPlaceholderPageProps) {
  return (
    <AdminLayout title={title}>
      <div
        style={{
          maxWidth: 680,
          margin: "48px auto",
          padding: 36,
          background: "linear-gradient(180deg, #0b1526 0%, #070d18 100%)",
          border: "1px solid #192a42",
          borderRadius: 20,
          boxShadow: "0 20px 45px rgba(0, 0, 0, 0.4)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 60,
            height: 60,
            borderRadius: 16,
            background: "rgba(14, 165, 233, 0.12)",
            color: "#38bdf8",
            border: "1px solid rgba(14, 165, 233, 0.25)",
            marginBottom: 20,
          }}
        >
          <Construction size={28} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              background: "rgba(20, 184, 166, 0.12)",
              color: "#2dd4bf",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 1.2,
            }}
          >
            <ShieldCheck size={12} />
            {stageBadge}
          </span>
        </div>

        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "#ffffff",
            marginBottom: 12,
            letterSpacing: -0.4,
          }}
        >
          {title}
        </h1>

        <p
          style={{
            color: "#94a3b8",
            fontSize: 14,
            lineHeight: 1.65,
            maxWidth: 520,
            margin: "0 auto 24px",
          }}
        >
          {description}
        </p>

        <div
          style={{
            padding: "12px 18px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            borderRadius: 10,
            color: "#64748b",
            fontSize: 12,
            display: "inline-block",
            marginBottom: 28,
          }}
        >
          Roadmap Status:{" "}
          <strong style={{ color: "#38bdf8" }}>{scheduledMilestone}</strong>
        </div>

        <div>
          <Link
            to="/admin"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: 10,
              background: "linear-gradient(135deg, #0ea5e9 0%, #0d9488 100%)",
              color: "#ffffff",
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 4px 14px rgba(14, 165, 233, 0.3)",
            }}
          >
            <ArrowLeft size={16} />
            Return to Dashboard Overview
          </Link>
        </div>
      </div>
    </AdminLayout>
  );
}


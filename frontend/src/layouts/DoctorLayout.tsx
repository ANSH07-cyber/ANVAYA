import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Activity,
  Calendar,
  CalendarDays,
  Clock,
  FolderHeart,
  LayoutDashboard,
  LogOut,
  Menu,
  Pill,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";

import { useAuth } from "../app/AuthContext";
import { NotificationBell } from "../components/notifications/NotificationBell";
import "./DoctorLayout.css";

interface DoctorNavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
}

const doctorNavItems: DoctorNavItem[] = [
  { label: "Overview", to: "/doctor", icon: LayoutDashboard },
  { label: "Appointments", to: "/doctor/appointments", icon: CalendarDays },
  { label: "Availability", to: "/doctor/availability", icon: Clock },
  { label: "Patient Records", to: "/doctor/patients", icon: FolderHeart },
  { label: "Prescriptions", to: "/doctor/prescriptions", icon: Pill },
  { label: "Practice Profile", to: "/doctor/profile", icon: UserCheck },
];

function getFormattedDate(): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

interface DoctorLayoutProps {
  title?: string;
  children: ReactNode;
}

export default function DoctorLayout({
  title = "Clinical Overview",
  children,
}: DoctorLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) {
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const displayName = user?.full_name
    ? user.full_name.trim().toLowerCase().startsWith("dr.") ||
      user.full_name.trim().toLowerCase().startsWith("dr ")
      ? user.full_name.trim()
      : `Dr. ${user.full_name.trim()}`
    : "Doctor";
  const userInitials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "DR";

  return (
    <div className="doctor-shell">
      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="doctor-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Primary Clinical Sidebar */}
      <aside className={`doctor-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="doctor-brand">
          <div className="doctor-brand-left">
            <div className="doctor-brand-mark">
              <Activity size={22} strokeWidth={2.4} />
            </div>
            <div className="doctor-brand-copy">
              <span className="doctor-brand-name">anvaya</span>
              <span className="doctor-brand-tag">DOCTOR WORKSPACE</span>
            </div>
          </div>

          <button
            type="button"
            className="doctor-sidebar-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <div className="doctor-role-badge">
          <span className="doctor-live-dot" />
          <span>AUTHENTICATED DOCTOR</span>
        </div>

        <nav className="doctor-nav" aria-label="Doctor portal navigation">
          <span className="doctor-nav-section-title">PRACTICE SUITE</span>

          {doctorNavItems.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `doctor-nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom User Card & Direct Logout */}
        <div className="doctor-sidebar-footer">
          <div className="doctor-user-card">
            <div className="doctor-user-avatar">{userInitials}</div>
            <div className="doctor-user-info">
              <span className="doctor-user-name" title={displayName}>
                {displayName}
              </span>
              <span className="doctor-user-role">
                {user?.email || "Clinical Practitioner"}
              </span>
            </div>

            <button
              type="button"
              className="doctor-logout-btn"
              onClick={handleLogout}
              title="Sign out of Doctor Workspace"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main View Area */}
      <div className="doctor-main">
        <header className="doctor-topbar">
          <div className="doctor-topbar-left">
            <button
              type="button"
              className="doctor-mobile-menu-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={20} />
            </button>

            <div className="doctor-breadcrumb">
              <span className="doctor-breadcrumb-portal">Doctor Portal</span>
              <span className="doctor-breadcrumb-divider">/</span>
              <span className="doctor-breadcrumb-current">{title}</span>
            </div>
          </div>

          <div className="doctor-topbar-right">
            <div className="doctor-date-badge">
              <Calendar size={13} />
              <span>{getFormattedDate()}</span>
            </div>

            <div className="doctor-session-status">
              <span className="doctor-live-dot" />
              <span>Active Session</span>
            </div>

            <NotificationBell userRole="doctor" />

            <div className="doctor-topbar-profile">
              <div className="doctor-topbar-avatar">{userInitials}</div>
              <div className="doctor-topbar-profile-info">
                <span className="doctor-topbar-name">{displayName}</span>
                <span className="doctor-topbar-sub">Doctor Workspace</span>
              </div>
            </div>
          </div>
        </header>

        <main className="doctor-content">{children}</main>

        <footer className="doctor-footer">
          <div className="doctor-footer-left">
            <span>© {new Date().getFullYear()} Anvaya Healthcare Platform</span>
            <span className="doctor-footer-sep">·</span>
            <span>Clinical Workspace</span>
          </div>
          <div className="doctor-footer-right">
            <ShieldCheck size={13} color="#0c8b82" />
            <span>Consent-Gated Patient Health Records</span>
          </div>
        </footer>
      </div>
    </div>
  );
}


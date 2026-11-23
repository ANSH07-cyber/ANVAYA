import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Calendar,
  CalendarClock,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Shield,
  Stethoscope,
  UserCog,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "../../app/AuthContext";
import { NotificationBell } from "../../components/notifications/NotificationBell";
import "./AdminLayout.css";

export interface AdminNavItem {
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  badge?: string;
}

const adminNavItems: AdminNavItem[] = [
  { label: "Overview", to: "/admin", icon: LayoutDashboard },
  { label: "User Management", to: "/admin/users", icon: UserCog },
  { label: "Doctor Management", to: "/admin/doctors", icon: Stethoscope },
  { label: "Patient Management", to: "/admin/patients", icon: Users },
  { label: "Appointments", to: "/admin/appointments", icon: CalendarClock },
  { label: "Audit Logs", to: "/admin/audit-logs", icon: FileText },
  { label: "System Settings", to: "/admin/settings", icon: Settings },
];

function getFormattedDate(): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

interface AdminLayoutProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

export default function AdminLayout({
  title = "System Overview",
  subtitle,
  children,
}: AdminLayoutProps) {
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

  const displayName = user?.full_name?.trim() || "Administrator";
  const userInitials = displayName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "AD";

  return (
    <div className="admin-shell">
      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="admin-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Primary Admin Navigation Sidebar */}
      <aside className={`admin-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="admin-brand">
          <div className="admin-brand-left">
            <div className="admin-brand-mark" aria-hidden="true">
              <Shield size={22} strokeWidth={2.4} />
            </div>
            <div className="admin-brand-copy">
              <span className="admin-brand-name">anvaya</span>
              <span className="admin-brand-tag">ADMIN PORTAL</span>
            </div>
          </div>

          <button
            type="button"
            className="admin-sidebar-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        {/* Security & Access Clearance Badge */}
        <div className="admin-role-badge">
          <span className="admin-live-dot" />
          <span>SUPER ADMIN CLEARANCE</span>
        </div>

        {/* Navigation links */}
        <nav className="admin-nav" aria-label="Admin portal navigation">
          <span className="admin-nav-section-title">CONTROL SUITE</span>

          {adminNavItems.map(({ label, to, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              end
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `admin-nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={18} strokeWidth={1.8} />
              <span className="admin-nav-label">{label}</span>
              {badge && <span className="admin-nav-badge">{badge}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom User Card & Direct Logout */}
        <div className="admin-sidebar-footer">
          <div className="admin-user-card">
            <div className="admin-user-avatar">{userInitials}</div>
            <div className="admin-user-info">
              <span className="admin-user-name" title={displayName}>
                {displayName}
              </span>
              <span className="admin-user-role" title={user?.email || "Admin Operator"}>
                {user?.email || "Operations Lead"}
              </span>
            </div>

            <button
              type="button"
              className="admin-logout-btn"
              onClick={handleLogout}
              title="Sign out of Admin Workspace"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main View Area */}
      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button
              type="button"
              className="admin-mobile-menu-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={20} />
            </button>

            <div className="admin-breadcrumb">
              <span className="admin-breadcrumb-portal">Admin Console</span>
              <span className="admin-breadcrumb-divider">/</span>
              <span className="admin-breadcrumb-current">{title}</span>
            </div>
          </div>

          <div className="admin-topbar-right">
            <div className="admin-date-badge">
              <Calendar size={13} />
              <span>{getFormattedDate()}</span>
            </div>

            <div className="admin-session-status">
              <span className="admin-live-dot" />
              <span className="admin-session-text">ADMIN CONSOLE</span>
            </div>

            <NotificationBell userRole="admin" />

            <div className="admin-identity-chip">
              <Shield size={12} className="admin-chip-icon" />
              <span>ROLE: ADMIN</span>
            </div>
          </div>
        </header>

        <main className="admin-content">
          {subtitle && <p className="admin-content-subtitle">{subtitle}</p>}
          {children}
        </main>
      </div>
    </div>
  );
}

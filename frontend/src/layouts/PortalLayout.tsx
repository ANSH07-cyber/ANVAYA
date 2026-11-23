import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  Activity,
  ChevronDown,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import { NotificationBell } from "../components/notifications/NotificationBell";
import "./PortalLayout.css";

export type PortalNavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
};

type PortalLayoutProps = {
  roleLabel: string;
  userName: string;
  userMeta: string;
  navItems: PortalNavItem[];
  children: ReactNode;
};

export default function PortalLayout({
  roleLabel,
  userName,
  userMeta,
  navItems,
  children,
}: PortalLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();

  return (
    <div className="portal-shell">
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`portal-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="portal-brand">
          <div className="portal-brand-mark">
            <Activity size={23} strokeWidth={2.4} />
          </div>

          <div className="portal-brand-copy">
            <span>anvaya</span>
            <small>CARE, CONNECTED.</small>
          </div>

          <button
            className="sidebar-close"
            aria-label="Close sidebar"
            onClick={() => setMobileOpen(false)}
          >
            <X size={19} />
          </button>
        </div>

        <div className="portal-role-label">
          <span className="role-indicator" />
          {roleLabel} WORKSPACE
        </div>

        <nav className="portal-navigation" aria-label="Main navigation">
          <span className="nav-section-label">WORKSPACE</span>

          {navItems.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `portal-nav-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <div className="help-icon">
              <Activity size={17} />
            </div>
            <div>
              <strong>Need assistance?</strong>
              <span>Your health journey matters.</span>
            </div>
          </div>

          <div className="sidebar-user">
            <div className="user-avatar">
              {userName
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>

            <div className="user-details">
              <strong>{userName}</strong>
              <span>{userMeta}</span>
            </div>

            <button
              className="user-settings"
              aria-label="Account settings"
              title="Account settings"
            >
              <Settings size={18} />
            </button>
            <button
              type="button"
              className="user-logout"
              aria-label="Sign out"
              title="Sign out of Patient Workspace"
              onClick={() => void logout()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <section className="portal-main">
        <header className="portal-topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-button"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </button>

            <div className="topbar-breadcrumb">
              <span>Anvaya</span>
              <span className="breadcrumb-divider">/</span>
              <strong>{roleLabel} Portal</strong>
            </div>
          </div>

          <div className="topbar-actions">
            <span className="workspace-status">
              <span />
              Workspace
            </span>

            <NotificationBell userRole={user?.role || "patient"} />

            <button className="topbar-profile" aria-label="Account menu">
              <div className="topbar-avatar">
                {userName.charAt(0).toUpperCase()}
              </div>
              <ChevronDown size={16} />
            </button>
          </div>
        </header>

        <main className="portal-content">{children}</main>

        <footer className="portal-footer">
          <span>© {new Date().getFullYear()} Anvaya Healthcare</span>
          <span>Care, connected with confidence.</span>
        </footer>
      </section>
    </div>
  );
}

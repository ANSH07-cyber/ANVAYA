import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, FileText, LayoutDashboard, Settings, Stethoscope, UserCog, Users } from "lucide-react";
import { useAuth } from "../../app/AuthContext";
import PortalShell, { type PortalNavItem } from "../PortalShell";
import "./AdminLayout.css";

export type AdminNavItem = PortalNavItem;

const adminNavItems: AdminNavItem[] = [
  { label: "Overview", to: "/admin", icon: LayoutDashboard },
  { label: "User Management", to: "/admin/users", icon: UserCog },
  { label: "Doctor Management", to: "/admin/doctors", icon: Stethoscope },
  { label: "Patient Management", to: "/admin/patients", icon: Users },
  { label: "Appointments", to: "/admin/appointments", icon: CalendarClock },
  { label: "Audit Logs", to: "/admin/audit-logs", icon: FileText },
  { label: "System Settings", to: "/admin/settings", icon: Settings },
];

interface AdminLayoutProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

export default function AdminLayout({ title = "System Overview", subtitle, children }: AdminLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <PortalShell
      role="admin"
      label="Admin console"
      title={title}
      name={user?.full_name?.trim() || "Administrator"}
      accountDetail={user?.email || "Administrator"}
      items={adminNavItems}
      onLogout={() => {
        void logout();
        navigate("/login", { replace: true });
      }}
    >
      {subtitle && <p className="admin-content-subtitle">{subtitle}</p>}
      {children}
    </PortalShell>
  );
}

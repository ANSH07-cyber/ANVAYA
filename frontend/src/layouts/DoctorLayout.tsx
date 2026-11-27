import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Clock, FolderHeart, LayoutDashboard, Pill, UserCheck } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import PortalShell, { type PortalNavItem } from "./PortalShell";
import "./DoctorLayout.css";

const doctorNavItems: PortalNavItem[] = [
  { label: "Overview", to: "/doctor", icon: LayoutDashboard },
  { label: "Appointments", to: "/doctor/appointments", icon: CalendarDays, relatedPath: "/doctor/consultation" },
  { label: "Availability", to: "/doctor/availability", icon: Clock },
  { label: "Patient Records", to: "/doctor/patients", icon: FolderHeart },
  { label: "Prescriptions", to: "/doctor/prescriptions", icon: Pill },
  { label: "Practice Profile", to: "/doctor/profile", icon: UserCheck },
];

interface DoctorLayoutProps {
  title?: string;
  children: ReactNode;
}

export default function DoctorLayout({ title = "Clinical Overview", children }: DoctorLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const fullName = user?.full_name.trim();
  const displayName = fullName && !/^dr[.\s]/i.test(fullName) ? `Dr. ${fullName}` : fullName || "Doctor";

  return (
    <PortalShell
      role="doctor"
      label="Clinical workspace"
      title={title}
      name={displayName}
      accountDetail={user?.email || "Practitioner"}
      items={doctorNavItems}
      onLogout={() => {
        void logout();
        navigate("/login", { replace: true });
      }}
    >
      {children}
    </PortalShell>
  );
}

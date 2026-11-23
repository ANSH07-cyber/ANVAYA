import {
  CalendarDays,
  FolderHeart,
  LayoutDashboard,
  Pill,
  ScanFace,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { PortalNavItem } from "../../layouts/PortalLayout";

export const patientNavigation: PortalNavItem[] = [
  { label: "Overview", to: "/patient", icon: LayoutDashboard },
  { label: "Appointments", to: "/patient/appointments", icon: CalendarDays },
  { label: "Find doctors", to: "/patient/doctors", icon: Search },
  { label: "Health records", to: "/patient/records", icon: FolderHeart },
  { label: "Prescriptions", to: "/patient/prescriptions", icon: Pill },
  { label: "Skin health AI", to: "/patient/skin-health", icon: ScanFace },
  { label: "Consent & privacy", to: "/patient/consent", icon: ShieldCheck },
];

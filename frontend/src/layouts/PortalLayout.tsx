import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { CircleUserRound } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import PortalShell, { type PortalNavItem } from "./PortalShell";
import "./PortalLayout.css";

export type { PortalNavItem } from "./PortalShell";

interface PortalLayoutProps {
  roleLabel: string;
  userName: string;
  userMeta: string;
  navItems: PortalNavItem[];
  children: ReactNode;
}

export default function PortalLayout({ roleLabel, userName, userMeta, navItems, children }: PortalLayoutProps) {
  const { logout } = useAuth();
  const { pathname } = useLocation();
  const title = navItems.find((item) => item.to === pathname)?.label ?? "Overview";

  return (
    <PortalShell
      role="patient"
      label={`${roleLabel} portal`}
      title={title}
      name={userName}
      accountDetail={userMeta}
      items={navItems}
      onLogout={() => void logout()}
      headerAction={
        <Link to="/patient/profile-setup" className="workspace-profile-link" title="Your profile" aria-label="Your profile">
          <CircleUserRound size={19} aria-hidden="true" />
          <span>Profile</span>
        </Link>
      }
    >
      {children}
    </PortalShell>
  );
}

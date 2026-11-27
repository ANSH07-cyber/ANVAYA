import { isValidElement, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Activity, LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { Link, useLocation, useNavigationType } from "react-router-dom";
import { NotificationBell } from "../components/notifications/NotificationBell";
import "./PortalShell.css";

export type PortalNavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  badge?: string;
  relatedPath?: string;
};

interface PortalShellProps {
  role: "patient" | "doctor" | "admin";
  label: string;
  title: string;
  name: string;
  accountDetail: string;
  items: PortalNavItem[];
  onLogout: () => void;
  headerAction?: ReactNode;
  children: ReactNode;
}

export default function PortalShell({
  role, label, title, name, accountDetail, items, onLogout, headerAction, children,
}: PortalShellProps) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [openLocation, setOpenLocation] = useState<string | null>(null);
  const isOpen = openLocation === location.key;
  const sidebarId = useId();
  const contentId = useId();
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const pathname = location.pathname.replace(/\/$/, "").toLowerCase();
  const hasPageLandmark = (isValidElement(children) && children.type === "main") || pathname === "/doctor";
  const Content = hasPageLandmark ? "div" : "main";
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  useLayoutEffect(() => {
    if (navigationType !== "POP" && document.activeElement === document.body) {
      contentRef.current?.focus({ preventScroll: true });
    }
  }, [location.pathname, navigationType]);

  useLayoutEffect(() => {
    if (openLocation !== null && !isOpen) setOpenLocation(null);
  }, [isOpen, openLocation]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    closeRef.current?.focus();
    // Keep this query in sync with the shell stylesheet.
    const desktop = window.matchMedia("(min-width: 1024px)");
    const handleResize = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setOpenLocation(null);
        requestAnimationFrame(() => contentRef.current?.focus({ preventScroll: true }));
      }
    };
    desktop.addEventListener("change", handleResize);
    return () => desktop.removeEventListener("change", handleResize);
  }, [isOpen]);

  function dismissNavigation() {
    setOpenLocation(null);
    // React must release inert before focus can return to the trigger.
    requestAnimationFrame(() => menuRef.current?.focus());
  }

  return (
    <div className={`workspace-shell workspace-shell--${role}`} data-nav-open={isOpen || undefined}>
      {!isOpen && (
        <a className="workspace-skip" href={`#${contentId}`} onClick={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
          contentRef.current?.scrollIntoView({ block: "nearest" });
        }}>
          Skip to content
        </a>
      )}

      {isOpen && <div className="workspace-scrim" aria-hidden="true" onClick={dismissNavigation} />}

      <aside
        id={sidebarId}
        className="workspace-sidebar"
        role={isOpen ? "dialog" : undefined}
        aria-modal={isOpen || undefined}
        aria-label={isOpen ? `${label} navigation` : undefined}
        onKeyDown={(event) => {
          if (!isOpen) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dismissNavigation();
          }
          if (event.key === "Tab") {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)"));
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="workspace-brand">
          <span className="workspace-brand-mark" aria-hidden="true"><Activity size={21} /></span>
          <div>
            <strong>Anvaya</strong>
            <span>{label}</span>
          </div>
          <button ref={closeRef} type="button" className="workspace-icon workspace-close" aria-label="Close navigation" onClick={dismissNavigation}>
            <X size={20} />
          </button>
        </div>

        <nav className="workspace-nav" aria-label={`${label} navigation`}>
          {items.map(({ label: itemLabel, to, icon: Icon, badge, relatedPath }) => {
            const isRelated = Boolean(relatedPath && pathname.startsWith(`${relatedPath}/`));
            const isCurrent = pathname === to;
            const active = isCurrent || isRelated;
            return (
              <Link
                key={to}
                to={to}
                className={active ? "workspace-link workspace-link--active" : "workspace-link"}
                aria-current={isCurrent ? "page" : isRelated ? "location" : undefined}
                onClick={(event) => {
                  if (!isOpen || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  setOpenLocation(null);
                  if (isCurrent) {
                    requestAnimationFrame(() => contentRef.current?.focus({ preventScroll: true }));
                  }
                }}
              >
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{itemLabel}</span>
                {badge && <small>{badge}</small>}
              </Link>
            );
          })}
        </nav>

        <div className="workspace-account">
          <span className="workspace-avatar" aria-hidden="true">{initials}</span>
          <div className="workspace-account-text">
            <strong title={name}>{name}</strong>
            <span title={accountDetail}>{accountDetail}</span>
          </div>
          <button type="button" className="workspace-icon" onClick={onLogout} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <div className="workspace-body" inert={isOpen}>
        <header className="workspace-topbar">
          <button
            ref={menuRef}
            type="button"
            className="workspace-icon workspace-menu"
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-controls={sidebarId}
            aria-expanded={isOpen}
            onClick={() => setOpenLocation(location.key)}
          >
            <Menu size={22} />
          </button>
          <div className="workspace-location">
            <span className="workspace-location-role">{label}</span>
            <span className="workspace-location-divider" aria-hidden="true">/</span>
            <strong>{title}</strong>
          </div>
          <div className="workspace-actions">
            {headerAction}
            <NotificationBell userRole={role} />
          </div>
        </header>

        <Content id={contentId} ref={(element) => { contentRef.current = element; }} className="workspace-content" tabIndex={-1} aria-label={hasPageLandmark ? undefined : title}>
          {children}
        </Content>
      </div>
    </div>
  );
}

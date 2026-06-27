import Link from "next/link";
import type { ReactNode } from "react";

type ConsoleSection = "onboarding" | "dashboard" | "request-logs";

type ConsoleShellProps = {
  activeSection: ConsoleSection;
  children: ReactNode;
  tenantId: string;
};

const navigationItems: Array<{
  label: string;
  section: ConsoleSection;
  path: (tenantId: string) => string;
}> = [
  {
    label: "Onboarding",
    section: "onboarding",
    path: (tenantId) => `/tenants/${tenantId}/onboarding`
  },
  {
    label: "Dashboard",
    section: "dashboard",
    path: (tenantId) => `/tenants/${tenantId}/dashboard`
  },
  {
    label: "Request Logs",
    section: "request-logs",
    path: (tenantId) => `/tenants/${tenantId}/request-logs`
  }
];

export function ConsoleShell({ activeSection, children, tenantId }: ConsoleShellProps) {
  return (
    <div className="console-shell">
      <aside className="console-sidebar" aria-label="GateLM console navigation">
        <Link className="console-brand" href="/">
          <span className="console-brand-mark">G</span>
          <span>
            <strong>GateLM</strong>
            <small>Web Console</small>
          </span>
        </Link>

        <nav className="console-nav">
          {navigationItems.map((item) => (
            <Link
              aria-current={item.section === activeSection ? "page" : undefined}
              className="console-nav-link"
              data-active={item.section === activeSection}
              href={item.path(tenantId)}
              key={item.section}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="console-main">
        <header className="console-header">
          <div>
            <p className="console-kicker">tenant</p>
            <h1>{tenantId}</h1>
          </div>
          <div className="console-context">Fixture mode</div>
        </header>
        {children}
      </div>
    </div>
  );
}

"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { formatTenantDisplayName } from "@/lib/formatting/display-identifiers";
import type { Locale } from "@/lib/i18n/locale";

type ConsoleSection = "dashboard" | "management" | "analytics" | "settings";
type ExpandableConsoleSection = "management" | "analytics";

export type ManagementNavItem =
  | "api-keys"
  | "app-tokens"
  | "model-catalog"
  | "policies"
  | "project"
  | "provider";
export type AnalyticsNavItem = "health" | "metrics" | "request-logs";

type ConsoleShellProps = {
  activeSection: ConsoleSection;
  children: ReactNode;
  activeAnalyticsItem?: AnalyticsNavItem;
  activeManagementItem?: ManagementNavItem;
  locale: Locale;
  tenantId: string;
};

type ChildNavigationItem = {
  disabled?: boolean;
  labels: Record<Locale, string>;
  item: AnalyticsNavItem | ManagementNavItem;
  path?: (tenantId: string) => string;
};

const navigationItems: Array<{
  children?: ChildNavigationItem[];
  labels: Record<Locale, string>;
  section: ConsoleSection;
  path?: (tenantId: string) => string;
  planned?: boolean;
}> = [
  {
    labels: {
      en: "Dashboard",
      ko: "대시보드"
    },
    section: "dashboard",
    path: (tenantId) => `/tenants/${tenantId}/dashboard`
  },
  {
    labels: {
      en: "Management",
      ko: "관리"
    },
    children: [
      {
        labels: {
          en: "Project",
          ko: "Project"
        },
        item: "project",
        path: (tenantId) => `/tenants/${tenantId}/projects`
      },
      {
        labels: {
          en: "Providers",
          ko: "Provider"
        },
        item: "provider",
        path: (tenantId) => `/tenants/${tenantId}/provider-connections`
      },
      {
        labels: {
          en: "Model Catalog",
          ko: "Model Catalog"
        },
        item: "model-catalog",
        path: (tenantId) => `/tenants/${tenantId}/model-catalog`
      },
      {
        labels: {
          en: "Policies",
          ko: "정책"
        },
        item: "policies",
        path: (tenantId) => `/tenants/${tenantId}/policies`
      }
    ],
    section: "management"
  },
  {
    labels: {
      en: "Analytics",
      ko: "분석"
    },
    children: [
      {
        labels: {
          en: "Health",
          ko: "Health"
        },
        item: "health",
        path: (tenantId) => `/tenants/${tenantId}/health`
      },
      {
        labels: {
          en: "Metrics",
          ko: "Metrics"
        },
        item: "metrics",
        path: (tenantId) => `/tenants/${tenantId}/metrics`
      },
      {
        labels: {
          en: "Request logs",
          ko: "요청 로그"
        },
        item: "request-logs",
        path: (tenantId) => `/tenants/${tenantId}/request-logs`
      }
    ],
    section: "analytics"
  },
  {
    labels: {
      en: "Settings",
      ko: "설정"
    },
    planned: true,
    section: "settings"
  }
];

const shellText: Record<
  Locale,
  {
    collapseNavigation: string;
    expandNavigation: string;
    language: string;
    planned: string;
    tenant: string;
  }
> = {
  en: {
    collapseNavigation: "Collapse navigation",
    expandNavigation: "Expand navigation",
    language: "Console language",
    planned: "planned",
    tenant: "tenant"
  },
  ko: {
    collapseNavigation: "내비게이션 닫기",
    expandNavigation: "내비게이션 열기",
    language: "콘솔 언어",
    planned: "예정",
    tenant: "테넌트"
  }
};

const openSectionsStorageKey = "gatelm_console_open_sections";
const sidebarCollapsedStorageKey = "gatelm_console_sidebar_collapsed";

export function ConsoleShell({
  activeAnalyticsItem,
  activeManagementItem,
  activeSection,
  children,
  locale,
  tenantId
}: ConsoleShellProps) {
  const text = shellText[locale];
  const tenantLabel = formatTenantDisplayName(tenantId);
  const [openSections, setOpenSections] = useState<ExpandableConsoleSection[]>(() =>
    getActiveOpenSections(activeSection)
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    const storedOpenSections = readStoredOpenSections();
    setOpenSections(mergeOpenSections(storedOpenSections ?? [], getActiveOpenSections(activeSection)));
  }, [activeSection]);

  useEffect(() => {
    const storedCollapsedState = readStoredSidebarCollapsed();

    if (storedCollapsedState !== null) {
      setIsSidebarCollapsed(storedCollapsedState);
    }
  }, []);

  function toggleSidebar() {
    setIsSidebarCollapsed((current) => {
      const next = !current;
      writeStoredSidebarCollapsed(next);
      return next;
    });
  }

  function toggleSection(section: ConsoleSection) {
    if (!isExpandableSection(section)) {
      return;
    }

    setOpenSections((current) => {
      const next = current.includes(section)
        ? current.filter((openSection) => openSection !== section)
        : [...current, section];

      writeStoredOpenSections(next);
      return next;
    });
  }

  function isChildActive(child: ChildNavigationItem) {
    if (child.item === "health" || child.item === "metrics" || child.item === "request-logs") {
      return child.item === activeAnalyticsItem;
    }

    return child.item === activeManagementItem;
  }

  function renderSubnavItems(children: ChildNavigationItem[]) {
    return children.map((child) => {
      const childLabel = child.labels[locale];

      if (child.disabled || !child.path) {
        return (
          <span
            aria-disabled="true"
            className="console-subnav-link"
            data-disabled="true"
            key={child.item}
          >
            {childLabel}
            <small>{text.planned}</small>
          </span>
        );
      }

      return (
        <Link
          aria-current={isChildActive(child) ? "page" : undefined}
          className="console-subnav-link"
          data-active={isChildActive(child)}
          href={child.path(tenantId)}
          key={child.item}
        >
          {childLabel}
        </Link>
      );
    });
  }

  return (
    <div className="console-shell" data-sidebar-collapsed={isSidebarCollapsed}>
      <aside className="console-sidebar" aria-label="GateLM console navigation">
        <div className="console-sidebar-topbar">
          <Link className="console-brand" href="/" aria-label="GateLM Web Console home">
            <span className="console-brand-mark">G</span>
            <span className="console-brand-copy">
              <strong>GateLM</strong>
              <small>Web Console</small>
            </span>
          </Link>
          <button
            aria-expanded={!isSidebarCollapsed}
            aria-label={isSidebarCollapsed ? text.expandNavigation : text.collapseNavigation}
            className="console-sidebar-toggle"
            onClick={toggleSidebar}
            title={isSidebarCollapsed ? text.expandNavigation : text.collapseNavigation}
            type="button"
          >
            <Menu aria-hidden="true" size={18} strokeWidth={2.4} />
          </button>
        </div>

        <nav className="console-nav" aria-hidden={isSidebarCollapsed}>
          {navigationItems.map((item) => {
            const label = item.labels[locale];

            if (!item.path) {
              if (item.children) {
                const isOpen = isExpandableSection(item.section) && openSections.includes(item.section);

                return (
                  <div className="console-nav-group" key={item.section}>
                    <button
                      aria-expanded={isOpen}
                      className="console-nav-link"
                      data-active={item.section === activeSection}
                      data-open={isOpen}
                      onClick={() => toggleSection(item.section)}
                      type="button"
                    >
                      <span>{label}</span>
                    </button>

                    {isOpen ? (
                      <div className="console-subnav" aria-label={`${label} navigation`}>
                        {renderSubnavItems(item.children)}
                      </div>
                    ) : null}
                  </div>
                );
              }

              return (
                <span
                  aria-disabled="true"
                  className="console-nav-link"
                  data-active={item.section === activeSection}
                  data-disabled="true"
                  key={item.section}
                >
                  <span>{label}</span>
                  {item.planned ? <small>{text.planned}</small> : null}
                </span>
              );
            }

            return (
              <div className="console-nav-group" key={item.section}>
                <Link
                  aria-current={item.section === activeSection ? "page" : undefined}
                  className="console-nav-link"
                  data-active={item.section === activeSection}
                  href={item.path(tenantId)}
                >
                  <span>{label}</span>
                </Link>

                {item.children && item.section === activeSection ? (
                  <div className="console-subnav" aria-label={`${label} navigation`}>
                    {renderSubnavItems(item.children)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className="console-mobile-subnavs" aria-hidden={isSidebarCollapsed}>
          {navigationItems.map((item) => {
            const label = item.labels[locale];
            const isOpen =
              item.children &&
              isExpandableSection(item.section) &&
              openSections.includes(item.section);

            if (!item.children || !isOpen) {
              return null;
            }

            return (
              <div className="console-subnav" aria-label={`${label} navigation`} key={item.section}>
                {renderSubnavItems(item.children)}
              </div>
            );
          })}
        </div>
        <div className="console-sidebar-language" aria-hidden={isSidebarCollapsed}>
          <LanguageSwitcher ariaLabel={text.language} locale={locale} />
        </div>
        <div className="console-sidebar-tenant" aria-hidden={isSidebarCollapsed}>
          <strong>{tenantLabel}</strong>
        </div>
      </aside>

      <div className="console-main">
        {children}
      </div>
    </div>
  );
}

function getActiveOpenSections(activeSection: ConsoleSection): ExpandableConsoleSection[] {
  return isExpandableSection(activeSection) ? [activeSection] : [];
}

function isExpandableSection(section: ConsoleSection): section is ExpandableConsoleSection {
  return section === "management" || section === "analytics";
}

function mergeOpenSections(
  ...sectionGroups: Array<ExpandableConsoleSection[]>
): ExpandableConsoleSection[] {
  return Array.from(new Set(sectionGroups.flat()));
}

function readStoredOpenSections(): ExpandableConsoleSection[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(openSectionsStorageKey);

    if (!storedValue) {
      return null;
    }

    const parsedValue = JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return null;
    }

    return mergeOpenSections(parsedValue.filter(isExpandableSection));
  } catch {
    return null;
  }
}

function writeStoredOpenSections(openSections: ExpandableConsoleSection[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(openSectionsStorageKey, JSON.stringify(openSections));
}

function readStoredSidebarCollapsed(): boolean | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storedValue = window.localStorage.getItem(sidebarCollapsedStorageKey);

  if (storedValue === "true") {
    return true;
  }

  if (storedValue === "false") {
    return false;
  }

  return null;
}

function writeStoredSidebarCollapsed(isCollapsed: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(sidebarCollapsedStorageKey, String(isCollapsed));
}

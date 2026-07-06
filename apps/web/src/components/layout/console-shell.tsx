"use client";

import {
  Activity,
  Database,
  FolderKanban,
  House,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  ScrollText,
  Settings as SettingsIcon,
  Users
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { formatTenantDisplayName } from "@/lib/formatting/display-identifiers";
import type { Locale } from "@/lib/i18n/locale";

type ConsoleSection = "dashboard" | "management" | "analytics";
type ExpandableConsoleSection = "management" | "analytics";
type ConsoleTheme = "light" | "dark";

export type ManagementNavItem =
  | "api-keys"
  | "app-tokens"
  | "model-catalog"
  | "policies"
  | "project"
  | "provider"
  | "teams";
export type AnalyticsNavItem = "health" | "request-logs";

const sectionIcons: Record<ConsoleSection, typeof LayoutDashboard> = {
  analytics: Activity,
  dashboard: LayoutDashboard,
  management: FolderKanban
};

const childIcons: Record<AnalyticsNavItem | ManagementNavItem, typeof LayoutDashboard> = {
  "api-keys": SettingsIcon,
  "app-tokens": SettingsIcon,
  health: Activity,
  "model-catalog": Database,
  policies: ScrollText,
  project: FolderKanban,
  provider: Plug,
  "request-logs": ScrollText,
  teams: Users
};

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
          en: "Teams",
          ko: "Teams"
        },
        item: "teams",
        path: (tenantId) => `/tenants/${tenantId}/teams`
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
          en: "Request logs",
          ko: "요청 로그"
        },
        item: "request-logs",
        path: (tenantId) => `/tenants/${tenantId}/request-logs`
      }
    ],
    path: (tenantId) => `/tenants/${tenantId}/request-logs`,
    section: "analytics"
  }
];

const shellText: Record<
  Locale,
  {
    collapseNavigation: string;
    expandNavigation: string;
    language: string;
    landing: string;
    settings: string;
    light: string;
    dark: string;
    logout: string;
    theme: string;
    planned: string;
    tenant: string;
  }
> = {
  en: {
    collapseNavigation: "Collapse navigation",
    expandNavigation: "Expand navigation",
    dark: "Dark",
    language: "Console language",
    landing: "Landing",
    light: "Light",
    logout: "Logout",
    planned: "planned",
    settings: "Tenant settings",
    tenant: "tenant",
    theme: "Theme"
  },
  ko: {
    landing: "랜딩",
    collapseNavigation: "내비게이션 닫기",
    expandNavigation: "내비게이션 열기",
    dark: "다크",
    language: "콘솔 언어",
    light: "라이트",
    logout: "로그아웃",
    planned: "예정",
    settings: "테넌트 설정",
    tenant: "테넌트",
    theme: "테마"
  }
};

const openSectionsStorageKey = "gatelm_console_open_sections";
const sidebarCollapsedStorageKey = "gatelm_console_sidebar_collapsed";
const themeStorageKey = "gatelm_console_theme";

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
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [theme, setTheme] = useState<ConsoleTheme>("light");

  useEffect(() => {
    const storedOpenSections = readStoredOpenSections();
    setOpenSections(mergeOpenSections(storedOpenSections ?? [], getActiveOpenSections(activeSection)));
    setIsMobileNavigationOpen(false);
  }, [activeSection]);

  useEffect(() => {
    const storedCollapsedState = readStoredSidebarCollapsed();

    if (storedCollapsedState !== null) {
      setIsSidebarCollapsed(storedCollapsedState);
    }
  }, []);

  useEffect(() => {
    const initialTheme = readStoredTheme() ?? readDocumentTheme();
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  function toggleSidebar() {
    if (isMobileViewport()) {
      setIsMobileNavigationOpen((current) => !current);
      return;
    }

    setIsSidebarCollapsed((current) => {
      const next = !current;
      writeStoredSidebarCollapsed(next);
      return next;
    });
  }

  function closeMobileNavigation() {
    setIsMobileNavigationOpen(false);
  }

  function selectTheme(nextTheme: ConsoleTheme) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    writeStoredTheme(nextTheme);
  }

  async function logout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    await fetch("/api/auth/logout", {
      credentials: "include",
      method: "POST"
    }).catch(() => undefined);
    window.location.assign("/?view=landing");
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
    if (child.item === "health" || child.item === "request-logs") {
      return child.item === activeAnalyticsItem;
    }

    return child.item === activeManagementItem;
  }

  function renderSubnavItems(children: ChildNavigationItem[]) {
    return children.map((child) => {
      const childLabel = child.labels[locale];
      const ChildIcon = childIcons[child.item];

      if (child.disabled || !child.path) {
        return (
          <span
            aria-disabled="true"
            className="console-subnav-link"
            data-disabled="true"
            key={child.item}
          >
            <ChildIcon aria-hidden="true" size={14} strokeWidth={2.2} />
            <span>{childLabel}</span>
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
          onClick={closeMobileNavigation}
        >
          <ChildIcon aria-hidden="true" size={14} strokeWidth={2.2} />
          <span>{childLabel}</span>
        </Link>
      );
    });
  }

  return (
    <div
      className="console-shell"
      data-mobile-nav-open={isMobileNavigationOpen}
      data-sidebar-collapsed={isSidebarCollapsed}
    >
      <header className="console-mobile-topbar">
        <button
          aria-expanded={isMobileNavigationOpen}
          aria-label={isMobileNavigationOpen ? text.collapseNavigation : text.expandNavigation}
          className="console-sidebar-toggle"
          onClick={toggleSidebar}
          type="button"
        >
          <Menu aria-hidden="true" size={18} strokeWidth={2.4} />
        </button>
        <Link className="console-brand" href="/?view=landing" aria-label="GateLM Web Console home">
          <span className="console-brand-mark">G</span>
          <span className="console-brand-copy">
            <strong>GateLM</strong>
          </span>
        </Link>
        <Link
          aria-label={text.landing}
          className="console-mobile-landing-link"
          href="/?view=landing"
          title={text.landing}
        >
          <House aria-hidden="true" size={17} strokeWidth={2.4} />
          <span>{text.landing}</span>
        </Link>
      </header>
      <button
        aria-label={text.collapseNavigation}
        className="console-mobile-nav-backdrop"
        onClick={closeMobileNavigation}
        type="button"
      />
      <aside className="console-sidebar" aria-label="GateLM console navigation">
        <div className="console-sidebar-topbar">
          <Link className="console-brand" href="/?view=landing" aria-label="GateLM Web Console home">
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

        <Link
          className="console-landing-link"
          href="/?view=landing"
          onClick={closeMobileNavigation}
          title={text.landing}
        >
          <House aria-hidden="true" size={16} strokeWidth={2.4} />
          <span>{text.landing}</span>
        </Link>

        <nav className="console-nav" aria-hidden={isSidebarCollapsed}>
          {navigationItems.map((item) => {
            const label = item.labels[locale];
            const SectionIcon = sectionIcons[item.section];

            if (!item.path) {
              if (item.children) {
                const isOpen = isExpandableSection(item.section) && openSections.includes(item.section);

                return (
                  <div className="console-nav-group" key={item.section}>
                    <button
                      aria-expanded={isOpen}
                      className="console-nav-link"
                      data-open={isOpen}
                      onClick={() => toggleSection(item.section)}
                      type="button"
                    >
                      <SectionIcon aria-hidden="true" size={16} strokeWidth={2.2} />
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
                  <SectionIcon aria-hidden="true" size={16} strokeWidth={2.2} />
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
                  onClick={closeMobileNavigation}
                >
                  <SectionIcon aria-hidden="true" size={16} strokeWidth={2.2} />
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
        <div className="console-sidebar-tenant-wrap" aria-hidden={isSidebarCollapsed}>
          <div className="console-sidebar-tenant">
            <strong>{tenantLabel}</strong>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={text.settings}
                className="console-sidebar-settings-button"
                title={text.settings}
              >
                <SettingsIcon aria-hidden="true" size={16} strokeWidth={2.3} />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                aria-label={text.settings}
                className="console-sidebar-settings-popover"
                sideOffset={8}
              >
                <div className="console-sidebar-settings-row">
                  <span>{text.language}</span>
                  <LanguageSwitcher ariaLabel={text.language} locale={locale} />
                </div>
                <div className="console-sidebar-settings-row">
                  <span>{text.theme}</span>
                  <div className="theme-segmented-control" data-density="compact">
                    <button
                      data-active={theme === "light"}
                      onClick={() => selectTheme("light")}
                      type="button"
                    >
                      {text.light}
                    </button>
                    <button
                      data-active={theme === "dark"}
                      onClick={() => selectTheme("dark")}
                      type="button"
                    >
                      {text.dark}
                    </button>
                  </div>
                </div>
                <div className="console-sidebar-settings-row" data-align="end">
                  <button
                    className="console-sidebar-logout-button"
                    disabled={isLoggingOut}
                    onClick={logout}
                    type="button"
                  >
                    <LogOut aria-hidden="true" size={14} strokeWidth={2.3} />
                    <span>{text.logout}</span>
                  </button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1100px)").matches;
}

function readDocumentTheme(): ConsoleTheme {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: ConsoleTheme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
}

function readStoredTheme(): ConsoleTheme | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storedValue = window.localStorage.getItem(themeStorageKey);

  return storedValue === "dark" || storedValue === "light" ? storedValue : null;
}

function writeStoredTheme(theme: ConsoleTheme) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(themeStorageKey, theme);
}

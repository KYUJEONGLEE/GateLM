"use client";

import {
  Activity,
  Bell,
  Building2,
  ChevronDown,
  FolderKanban,
  KeyRound,
  Globe2,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  ScrollText,
  Settings as SettingsIcon,
  Users
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { GateLMLogo } from "@/components/brand/gatelm-logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { IntentPrefetchLink } from "@/components/navigation/intent-prefetch-link";
import {
  getConsoleNavigationState,
  type ConsoleSection,
  type ManagementNavItem,
  type MonitoringNavItem
} from "@/components/layout/console-navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { formatTenantDisplayName } from "@/lib/formatting/display-identifiers";
import type { Locale } from "@/lib/i18n/locale";

type ConsoleTheme = "light" | "dark";
type CurrentUser = {
  avatarUrl?: string;
  displayName: string;
  email?: string;
  id: string;
  role: string;
  tenantName?: string;
};

const sectionIcons: Record<ConsoleSection, typeof LayoutDashboard> = {
  monitoring: LayoutDashboard,
  management: FolderKanban
};

const childIcons: Record<ManagementNavItem | MonitoringNavItem, typeof LayoutDashboard> = {
  "api-keys": KeyRound,
  "app-tokens": SettingsIcon,
  "chat-app": MessageSquareText,
  employees: Users,
  alerts: Bell,
  analytics: Activity,
  "live-logs": ScrollText,
  overview: LayoutDashboard,
  policies: ScrollText,
  project: FolderKanban,
  provider: Plug,
  "tenant-chat": MessageSquareText,
  tenant: Building2,
  teams: Users
};

type ConsoleShellProps = {
  children: ReactNode;
  activeManagementItem?: ManagementNavItem;
  activeMonitoringItem?: MonitoringNavItem;
  activeSection?: ConsoleSection;
  currentUser: CurrentUser | null;
  locale: Locale;
  tenantId: string;
};

type ChildNavigationItem = {
  badge?: string;
  disabled?: boolean;
  labels: Record<Locale, string>;
  item: ManagementNavItem | MonitoringNavItem;
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
      en: "Monitoring",
      ko: "모니터링"
    },
    children: [
      {
        labels: {
          en: "Overview",
          ko: "대시보드"
        },
        item: "overview",
        path: (tenantId) => `/tenants/${tenantId}/dashboard`
      },
      {
        labels: {
          en: "Live Logs",
          ko: "로그"
        },
        item: "live-logs",
        path: (tenantId) => `/tenants/${tenantId}/request-logs`
      },
      {
        labels: {
          en: "Analytics",
          ko: "분석"
        },
        item: "analytics",
        path: (tenantId) => `/tenants/${tenantId}/analytics`
      }
    ],
    section: "monitoring"
  },
  {
    labels: {
      en: "Management",
      ko: "관리"
    },
    children: [
      {
        labels: {
          en: "Chat App",
          ko: "채팅 앱"
        },
        item: "chat-app",
        path: (tenantId) => `/tenants/${tenantId}/chat-app`
      },
      {
        labels: {
          en: "Project",
          ko: "프로젝트"
        },
        item: "project",
        path: (tenantId) => `/tenants/${tenantId}/projects`
      },
      {
        labels: {
          en: "Employees",
          ko: "직원"
        },
        item: "employees",
        path: (tenantId) => `/tenants/${tenantId}/employees`
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
          en: "API Key Management",
          ko: "API Key 관리"
        },
        item: "api-keys",
        path: (tenantId) => `/tenants/${tenantId}/api-keys`
      }
    ],
    section: "management"
  }
];

const shellText: Record<
  Locale,
  {
    collapseNavigation: string;
    account: string;
    accountActions: string;
    expandNavigation: string;
    language: string;
    landing: string;
    loggingOut: string;
    logout: string;
    navigation: string;
    openUserProfile: string;
    organization: string;
    role: string;
    sessionRequired: string;
    settings: string;
    light: string;
    dark: string;
    theme: string;
    planned: string;
    tenant: string;
    userProfile: string;
  }
> = {
  en: {
    account: "Account",
    accountActions: "Console account actions",
    collapseNavigation: "Collapse navigation",
    expandNavigation: "Expand navigation",
    dark: "Dark",
    language: "Language",
    landing: "Landing",
    light: "Light",
    loggingOut: "Logging out...",
    logout: "Logout",
    navigation: "navigation",
    openUserProfile: "Open user profile menu",
    organization: "Organization",
    planned: "planned",
    role: "Role",
    sessionRequired: "Session required",
    settings: "Settings",
    tenant: "tenant",
    theme: "Theme",
    userProfile: "User profile"
  },
  ko: {
    account: "계정",
    accountActions: "콘솔 계정 메뉴",
    landing: "랜딩",
    collapseNavigation: "내비게이션 닫기",
    expandNavigation: "내비게이션 열기",
    dark: "다크",
    language: "언어",
    light: "라이트",
    loggingOut: "로그아웃 중...",
    logout: "로그아웃",
    navigation: "내비게이션",
    openUserProfile: "사용자 프로필 메뉴 열기",
    organization: "조직",
    planned: "예정",
    role: "역할",
    sessionRequired: "로그인 필요",
    settings: "설정",
    tenant: "테넌트",
    theme: "테마",
    userProfile: "사용자 프로필"
  }
};

const sidebarCollapsedStorageKey = "gatelm_console_sidebar_collapsed";
const themeStorageKey = "gatelm_console_theme";
const userMenuTriggerId = "gatelm-console-user-menu-trigger";

export function ConsoleShell({
  activeManagementItem,
  activeMonitoringItem,
  activeSection,
  children,
  currentUser,
  locale,
  tenantId
}: ConsoleShellProps) {
  const pathname = usePathname();
  const text = shellText[locale];
  const tenantLabel = formatTenantDisplayName(tenantId);
  const navigationState = useMemo(() => getConsoleNavigationState(pathname), [pathname]);
  const resolvedActiveSection = activeSection ?? navigationState.activeSection;
  const resolvedActiveManagementItem =
    activeManagementItem ?? navigationState.activeManagementItem;
  const resolvedActiveMonitoringItem =
    activeMonitoringItem ?? navigationState.activeMonitoringItem;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [theme, setTheme] = useState<ConsoleTheme>("light");

  useEffect(() => {
    setIsMobileNavigationOpen(false);
  }, [pathname]);

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

  function isChildActive(child: ChildNavigationItem) {
    if (isMonitoringNavItem(child.item)) {
      return child.item === resolvedActiveMonitoringItem;
    }

    return child.item === resolvedActiveManagementItem;
  }

  function renderSubnavItems(children: ChildNavigationItem[]) {
    return children.map((child) => {
      const childLabel = child.labels[locale];
      const ChildIcon = childIcons[child.item];

      if (child.disabled || !child.path) {
        return (
          <span
            aria-label={childLabel}
            aria-disabled="true"
            className="console-subnav-link"
            data-disabled="true"
            data-tooltip={childLabel}
            key={child.item}
            title={childLabel}
          >
            <ChildIcon aria-hidden="true" size={14} strokeWidth={2.2} />
            <span>{childLabel}</span>
            {child.badge ? <span className="console-nav-badge">{child.badge}</span> : null}
            <small>{text.planned}</small>
          </span>
        );
      }

      return (
        <IntentPrefetchLink
          aria-label={childLabel}
          aria-current={isChildActive(child) ? "page" : undefined}
          className="console-subnav-link"
          data-active={isChildActive(child)}
          data-tooltip={childLabel}
          href={child.path(tenantId)}
          intentPrefetch={!isSidebarCollapsed}
          key={child.item}
          onClick={closeMobileNavigation}
          title={childLabel}
        >
          <ChildIcon aria-hidden="true" size={14} strokeWidth={2.2} />
          <span>{childLabel}</span>
          {child.badge ? <span className="console-nav-badge">{child.badge}</span> : null}
        </IntentPrefetchLink>
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
          {isMobileNavigationOpen ? (
            <PanelLeftClose aria-hidden="true" size={19} strokeWidth={2.2} />
          ) : (
            <PanelLeftOpen aria-hidden="true" size={19} strokeWidth={2.2} />
          )}
        </button>
        <Link className="console-brand" href="/?view=landing" aria-label="GateLM Web Console home">
          <GateLMLogo />
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
            <GateLMLogo compact={isSidebarCollapsed} />
          </Link>
        </div>

        <nav className="console-nav">
          {navigationItems.map((item) => {
            const label = item.labels[locale];
            const SectionIcon = sectionIcons[item.section];

            if (!item.path) {
              if (item.children) {
                return (
                  <div className="console-nav-group" key={item.section}>
                    <div
                      aria-level={3}
                      className="console-nav-link"
                      data-has-sidebar-toggle={item.section === "monitoring"}
                      data-open="true"
                      data-static="true"
                      role="heading"
                    >
                      <SectionIcon aria-hidden="true" size={16} strokeWidth={2.2} />
                      <span>{label}</span>
                      {item.section === "monitoring" ? (
                        <button
                          aria-expanded={!isSidebarCollapsed}
                          aria-label={
                            isSidebarCollapsed ? text.expandNavigation : text.collapseNavigation
                          }
                          className="console-sidebar-toggle console-nav-sidebar-toggle"
                          onClick={toggleSidebar}
                          title={
                            isSidebarCollapsed ? text.expandNavigation : text.collapseNavigation
                          }
                          type="button"
                        >
                          {isSidebarCollapsed ? (
                            <PanelLeftOpen aria-hidden="true" size={19} strokeWidth={2.2} />
                          ) : (
                            <PanelLeftClose aria-hidden="true" size={19} strokeWidth={2.2} />
                          )}
                        </button>
                      ) : null}
                    </div>

                    <div className="console-subnav" aria-label={`${label} ${text.navigation}`}>
                      {renderSubnavItems(item.children)}
                    </div>
                  </div>
                );
              }

              return (
                <span
                  aria-disabled="true"
                  className="console-nav-link"
                  data-active={item.section === resolvedActiveSection}
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
                  aria-current={item.section === resolvedActiveSection ? "page" : undefined}
                  className="console-nav-link"
                  data-active={item.section === resolvedActiveSection}
                  href={item.path(tenantId)}
                  onClick={closeMobileNavigation}
                >
                  <SectionIcon aria-hidden="true" size={16} strokeWidth={2.2} />
                  <span>{label}</span>
                </Link>

                {item.children && item.section === resolvedActiveSection ? (
                  <div className="console-subnav" aria-label={`${label} ${text.navigation}`}>
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

            if (!item.children) {
              return null;
            }

            return (
              <div
                className="console-subnav"
                aria-label={`${label} ${text.navigation}`}
                key={item.section}
              >
                {renderSubnavItems(item.children)}
              </div>
            );
          })}
        </div>
      </aside>

      <div className="console-main">
        <ConsoleTopbarActions
          currentUser={currentUser}
          isLoggingOut={isLoggingOut}
          locale={locale}
          onLogout={logout}
          onSelectTheme={selectTheme}
          tenantLabel={tenantLabel}
          text={text}
          theme={theme}
        />
        {children}
      </div>
    </div>
  );
}

function ConsoleTopbarActions({
  currentUser,
  isLoggingOut,
  locale,
  onLogout,
  onSelectTheme,
  tenantLabel,
  text,
  theme
}: {
  currentUser: CurrentUser | null;
  isLoggingOut: boolean;
  locale: Locale;
  onLogout: () => Promise<void>;
  onSelectTheme: (theme: ConsoleTheme) => void;
  tenantLabel: string;
  text: (typeof shellText)[Locale];
  theme: ConsoleTheme;
}) {
  const displayUser = currentUser ?? buildPendingCurrentUser(tenantLabel, text);
  const initials = getUserInitials(displayUser.displayName);

  return (
    <div className="console-topbar-actions" aria-label={text.accountActions}>
      <DropdownMenu>
        <DropdownMenuTrigger
          id={userMenuTriggerId}
          className="console-user-trigger"
          aria-label={text.openUserProfile}
        >
          <span className="console-user-avatar" aria-hidden="true">
            {displayUser.avatarUrl ? (
              <span
                className="console-user-avatar-image"
                style={{ backgroundImage: `url(${displayUser.avatarUrl})` }}
              />
            ) : (
              <span>{initials}</span>
            )}
          </span>
          <span className="console-user-copy">
            <strong>{displayUser.displayName}</strong>
            <small>{displayUser.role}</small>
          </span>
          <ChevronDown aria-hidden="true" size={14} strokeWidth={2.4} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label={text.userProfile}
          className="console-user-popover"
          sideOffset={10}
        >
          <div className="console-user-popover-header">
            <span className="console-user-avatar" aria-hidden="true">
              {displayUser.avatarUrl ? (
                <span
                  className="console-user-avatar-image"
                  style={{ backgroundImage: `url(${displayUser.avatarUrl})` }}
                />
              ) : (
                <span>{initials}</span>
              )}
            </span>
            <div>
              <strong>{displayUser.displayName}</strong>
              {displayUser.email ? <span>{displayUser.email}</span> : null}
            </div>
          </div>

          <dl className="console-user-meta">
            <div>
              <dt>{text.role}</dt>
              <dd>{displayUser.role}</dd>
            </div>
            <div>
              <dt>{text.organization}</dt>
              <dd>{displayUser.tenantName ?? tenantLabel}</dd>
            </div>
          </dl>

          <section className="console-user-settings" aria-label={text.settings}>
            <header>
              <SettingsIcon aria-hidden="true" size={14} strokeWidth={2.2} />
              <strong>{text.settings}</strong>
            </header>
            <div className="console-user-settings-row">
              <span className="console-language-icon" title={text.language}>
                <Globe2 aria-hidden="true" size={18} strokeWidth={2.2} />
              </span>
              <LanguageSwitcher ariaLabel={text.language} locale={locale} />
            </div>
            <div className="console-user-settings-row">
              <span>{text.theme}</span>
              <div className="theme-segmented-control" data-density="compact">
                <button
                  data-active={theme === "light"}
                  onClick={() => onSelectTheme("light")}
                  type="button"
                >
                  {text.light}
                </button>
                <button
                  data-active={theme === "dark"}
                  onClick={() => onSelectTheme("dark")}
                  type="button"
                >
                  {text.dark}
                </button>
              </div>
            </div>
          </section>

          <div className="console-user-menu-actions">
            <button
              className="console-user-menu-action"
              disabled={isLoggingOut}
              onClick={() => {
                void onLogout();
              }}
              type="button"
            >
              <LogOut aria-hidden="true" size={14} strokeWidth={2.2} />
              <span>{isLoggingOut ? text.loggingOut : text.logout}</span>
            </button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function buildPendingCurrentUser(
  tenantLabel: string,
  text: (typeof shellText)[Locale]
): CurrentUser {
  return {
    displayName: text.account,
    id: "session-loading",
    role: text.sessionRequired,
    tenantName: tenantLabel
  };
}

function getUserInitials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]?.charAt(0) ?? ""}${parts[1]?.charAt(0) ?? ""}`.toUpperCase();
  }

  return (parts[0]?.charAt(0) || "A").toUpperCase();
}

function isMonitoringNavItem(item: ManagementNavItem | MonitoringNavItem): item is MonitoringNavItem {
  return item === "alerts" || item === "analytics" || item === "live-logs" || item === "overview";
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

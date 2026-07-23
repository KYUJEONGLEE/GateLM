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
  UserRound,
  Users
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { GateLMLogo } from "@/components/brand/gatelm-logo";
import { ChangePasswordDialog } from "@/features/auth/components/change-password-dialog";
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
import type { Locale } from "@/lib/i18n/locale";

type ConsoleTheme = "light" | "dark";
type ConsoleDisplayMode = "default" | "expanded";
type CurrentUser = {
  avatarUrl?: string;
  displayName: string;
  email?: string;
  hasLocalPassword: boolean;
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
          ko: "API Key"
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
    changePassword: string;
    accountActions: string;
    expandNavigation: string;
    language: string;
    landing: string;
    loggingOut: string;
    logout: string;
    navigation: string;
    openUserProfile: string;
    organization: string;
    passwordUnavailable: string;
    role: string;
    sessionRequired: string;
    settings: string;
    display: string;
    defaultDisplay: string;
    expandedDisplay: string;
    light: string;
    dark: string;
    theme: string;
    planned: string;
    tenant: string;
    tenantAdmin: string;
    userProfile: string;
  }
> = {
  en: {
    account: "Account",
    changePassword: "Change password",
    accountActions: "Console account actions",
    collapseNavigation: "Collapse navigation",
    expandNavigation: "Expand navigation",
    dark: "Dark",
    defaultDisplay: "Default",
    display: "Display",
    expandedDisplay: "Expanded",
    language: "Language",
    landing: "Landing",
    light: "Light",
    loggingOut: "Logging out...",
    logout: "Logout",
    navigation: "navigation",
    openUserProfile: "Open user profile menu",
    organization: "Organization",
    passwordUnavailable: "This Google sign-in account does not have a local password.",
    planned: "planned",
    role: "Role",
    sessionRequired: "Session required",
    settings: "Settings",
    tenant: "tenant",
    tenantAdmin: "Tenant Admin",
    theme: "Theme",
    userProfile: "User profile"
  },
  ko: {
    account: "계정",
    changePassword: "비밀번호 변경",
    accountActions: "콘솔 계정 메뉴",
    landing: "랜딩",
    collapseNavigation: "내비게이션 닫기",
    expandNavigation: "내비게이션 열기",
    dark: "다크",
    defaultDisplay: "기본",
    display: "화면",
    expandedDisplay: "확장",
    language: "언어",
    light: "라이트",
    loggingOut: "로그아웃 중...",
    logout: "로그아웃",
    navigation: "내비게이션",
    openUserProfile: "사용자 프로필 메뉴 열기",
    organization: "조직",
    passwordUnavailable: "Google 로그인 계정에는 로컬 비밀번호가 없습니다.",
    planned: "예정",
    role: "역할",
    sessionRequired: "로그인 필요",
    settings: "설정",
    tenant: "테넌트",
    tenantAdmin: "관리자",
    theme: "테마",
    userProfile: "사용자 프로필"
  }
};

const sidebarCollapsedStorageKey = "gatelm_console_sidebar_collapsed";
const displayModeStorageKey = "gatelm_console_display_mode";
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
  const navigationState = useMemo(() => getConsoleNavigationState(pathname), [pathname]);
  const resolvedActiveSection = activeSection ?? navigationState.activeSection;
  const resolvedActiveManagementItem =
    activeManagementItem ?? navigationState.activeManagementItem;
  const resolvedActiveMonitoringItem =
    activeMonitoringItem ?? navigationState.activeMonitoringItem;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isResponsiveCompact, setIsResponsiveCompact] = useState(false);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [displayMode, setDisplayMode] = useState<ConsoleDisplayMode>("default");
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
    const mediaQuery = window.matchMedia("(min-width: 1101px) and (max-width: 1280px)");
    const syncResponsiveCompactState = () => setIsResponsiveCompact(mediaQuery.matches);

    syncResponsiveCompactState();
    mediaQuery.addEventListener("change", syncResponsiveCompactState);
    return () => mediaQuery.removeEventListener("change", syncResponsiveCompactState);
  }, []);

  useEffect(() => {
    const initialTheme = readStoredTheme() ?? readDocumentTheme();
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  useEffect(() => {
    const initialDisplayMode = readStoredDisplayMode() ?? readDocumentDisplayMode();
    setDisplayMode(initialDisplayMode);
    applyDisplayMode(initialDisplayMode);
  }, []);

  function toggleSidebar() {
    if (isMobileViewport()) {
      setIsMobileNavigationOpen((current) => !current);
      return;
    }

    // At split-window widths the rail deliberately stays compact so every
    // primary destination remains available without squeezing page content.
    if (isResponsiveCompact) {
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

  function selectDisplayMode(nextDisplayMode: ConsoleDisplayMode) {
    setDisplayMode(nextDisplayMode);
    applyDisplayMode(nextDisplayMode);
    writeStoredDisplayMode(nextDisplayMode);
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
          intentPrefetch={!sidebarCollapsed}
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

  const sidebarCollapsed = isSidebarCollapsed || isResponsiveCompact;
  const isNavigationExpanded = isMobileNavigationOpen || !sidebarCollapsed;

  return (
    <div
      className="console-shell"
      data-mobile-nav-open={isMobileNavigationOpen}
      data-responsive-compact={isResponsiveCompact}
      data-sidebar-collapsed={sidebarCollapsed}
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
          <GateLMLogo compact={sidebarCollapsed} />
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
                          aria-expanded={isNavigationExpanded}
                          aria-label={
                            isNavigationExpanded
                              ? text.collapseNavigation
                              : text.expandNavigation
                          }
                          className="console-sidebar-toggle console-nav-sidebar-toggle"
                          onClick={toggleSidebar}
                          title={
                            isNavigationExpanded
                              ? text.collapseNavigation
                              : text.expandNavigation
                          }
                          type="button"
                        >
                          {isNavigationExpanded ? (
                            <PanelLeftClose aria-hidden="true" size={19} strokeWidth={2.2} />
                          ) : (
                            <PanelLeftOpen aria-hidden="true" size={19} strokeWidth={2.2} />
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
        <div className="console-mobile-subnavs" aria-hidden={sidebarCollapsed}>
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
          displayMode={displayMode}
          isLoggingOut={isLoggingOut}
          locale={locale}
          onLogout={logout}
          onSelectDisplayMode={selectDisplayMode}
          onSelectTheme={selectTheme}
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
  displayMode,
  isLoggingOut,
  locale,
  onLogout,
  onSelectDisplayMode,
  onSelectTheme,
  text,
  theme
}: {
  currentUser: CurrentUser | null;
  displayMode: ConsoleDisplayMode;
  isLoggingOut: boolean;
  locale: Locale;
  onLogout: () => Promise<void>;
  onSelectDisplayMode: (displayMode: ConsoleDisplayMode) => void;
  onSelectTheme: (theme: ConsoleTheme) => void;
  text: (typeof shellText)[Locale];
  theme: ConsoleTheme;
}) {
  const displayUser = currentUser ?? buildPendingCurrentUser(text);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const displayRole = displayUser.role === "Tenant Admin" ? text.tenantAdmin : displayUser.role;

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
              <UserRound className="console-user-avatar-placeholder" strokeWidth={2} />
            )}
          </span>
          <span className="console-user-copy">
            <strong>{displayUser.displayName}</strong>
            <small>{displayRole}</small>
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
                <UserRound className="console-user-avatar-placeholder" strokeWidth={2} />
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
              <dd>{displayRole}</dd>
            </div>
            <div>
              <dt>{text.organization}</dt>
              <dd>{displayUser.tenantName ?? text.organization}</dd>
            </div>
          </dl>

          <section className="console-user-settings" aria-label={text.settings}>
            <div className="console-user-settings-row">
              <span className="console-language-icon" title={text.language}>
                <Globe2 aria-hidden="true" size={18} strokeWidth={2.2} />
              </span>
              <LanguageSwitcher ariaLabel={text.language} locale={locale} />
            </div>
            <div className="console-user-settings-row console-user-settings-choice-row">
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
            <div className="console-user-settings-row console-user-settings-choice-row">
              <span>{text.display}</span>
              <div
                aria-label={text.display}
                className="theme-segmented-control"
                data-density="compact"
                role="group"
              >
                <button
                  aria-pressed={displayMode === "default"}
                  data-active={displayMode === "default"}
                  onClick={() => onSelectDisplayMode("default")}
                  type="button"
                >
                  {text.defaultDisplay}
                </button>
                <button
                  aria-pressed={displayMode === "expanded"}
                  data-active={displayMode === "expanded"}
                  onClick={() => onSelectDisplayMode("expanded")}
                  type="button"
                >
                  {text.expandedDisplay}
                </button>
              </div>
            </div>
          </section>

          <div className="console-user-menu-actions">
            {currentUser?.hasLocalPassword ? (
              <button
                className="console-user-menu-action"
                onClick={() => setIsPasswordDialogOpen(true)}
                type="button"
              >
                <KeyRound aria-hidden="true" size={14} strokeWidth={2.2} />
                <span>{text.changePassword}</span>
              </button>
            ) : currentUser ? (
              <p className="console-user-menu-note">{text.passwordUnavailable}</p>
            ) : null}
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
      <ChangePasswordDialog
        locale={locale}
        onOpenChange={setIsPasswordDialogOpen}
        open={isPasswordDialogOpen}
      />
    </div>
  );
}

function buildPendingCurrentUser(
  text: (typeof shellText)[Locale]
): CurrentUser {
  return {
    displayName: text.account,
    hasLocalPassword: false,
    id: "session-loading",
    role: text.sessionRequired,
    tenantName: text.organization
  };
}

function isMonitoringNavItem(item: ManagementNavItem | MonitoringNavItem): item is MonitoringNavItem {
  return item === "alerts" || item === "analytics" || item === "live-logs" || item === "overview";
}

function readLocalStorage(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked by browser privacy settings. The UI state still applies in memory.
  }
}

function readStoredSidebarCollapsed(): boolean | null {
  const storedValue = readLocalStorage(sidebarCollapsedStorageKey);

  if (storedValue === "true") {
    return true;
  }

  if (storedValue === "false") {
    return false;
  }

  return null;
}

function writeStoredSidebarCollapsed(isCollapsed: boolean) {
  writeLocalStorage(sidebarCollapsedStorageKey, String(isCollapsed));
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

function readDocumentDisplayMode(): ConsoleDisplayMode {
  if (typeof document === "undefined") {
    return "default";
  }

  return document.documentElement.dataset.presentationMode === "true"
    ? "expanded"
    : "default";
}

function applyDisplayMode(displayMode: ConsoleDisplayMode) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.presentationMode =
    displayMode === "expanded" ? "true" : "false";
}

function readStoredDisplayMode(): ConsoleDisplayMode | null {
  const storedValue = readLocalStorage(displayModeStorageKey);

  return storedValue === "default" || storedValue === "expanded" ? storedValue : null;
}

function writeStoredDisplayMode(displayMode: ConsoleDisplayMode) {
  writeLocalStorage(displayModeStorageKey, displayMode);
}

function applyTheme(theme: ConsoleTheme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
}

function readStoredTheme(): ConsoleTheme | null {
  const storedValue = readLocalStorage(themeStorageKey);

  return storedValue === "dark" || storedValue === "light" ? storedValue : null;
}

function writeStoredTheme(theme: ConsoleTheme) {
  writeLocalStorage(themeStorageKey, theme);
}

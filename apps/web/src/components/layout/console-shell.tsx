"use client";

import {
  Activity,
  Bell,
  ChevronDown,
  CircleHelp,
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
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
type NotificationSeverity = "critical" | "info" | "warning";
type NotificationCategory = "Budget" | "Cache" | "Cost" | "Provider" | "Rate Limit" | "Safety" | "System";

type CurrentUser = {
  avatarUrl?: string;
  displayName: string;
  email?: string;
  id: string;
  role: string;
  tenantName?: string;
};

type AdminNotification = {
  category: NotificationCategory;
  createdAt: string;
  id: string;
  message: string;
  read: boolean;
  severity: NotificationSeverity;
  title: string;
};

export type ManagementNavItem =
  | "api-keys"
  | "app-tokens"
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
    planned: "예정",
    settings: "테넌트 설정",
    tenant: "테넌트",
    theme: "테마"
  }
};

const openSectionsStorageKey = "gatelm_console_open_sections";
const sidebarCollapsedStorageKey = "gatelm_console_sidebar_collapsed";
const themeStorageKey = "gatelm_console_theme";
const notificationReadStorageKey = "gatelm_console_header_notification_read_ids";

// No notification API exists yet; these are preview notifications for the console header demo.
const previewNotificationSeeds: Array<Omit<AdminNotification, "read">> = [
  {
    category: "Budget",
    createdAt: "2m ago",
    id: "budget-usage-preview",
    message: "Monthly budget usage is approaching the configured limit.",
    severity: "warning",
    title: "Budget warning"
  },
  {
    category: "Provider",
    createdAt: "5m ago",
    id: "provider-error-preview",
    message: "Recent gateway requests include provider-side 5xx errors.",
    severity: "critical",
    title: "Provider error"
  },
  {
    category: "Safety",
    createdAt: "8m ago",
    id: "safety-block-preview",
    message: "Secret-like prompt content was blocked by policy.",
    severity: "warning",
    title: "Safety block detected"
  },
  {
    category: "Rate Limit",
    createdAt: "14m ago",
    id: "rate-limit-preview",
    message: "A project is close to its current rate limit window.",
    severity: "info",
    title: "Rate limit warning"
  },
  {
    category: "Cache",
    createdAt: "22m ago",
    id: "cache-opportunity-preview",
    message: "Cache hit rate is lower than expected for repeated traffic.",
    severity: "info",
    title: "Cache opportunity"
  }
];

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
  const [currentUser, setCurrentUser] = useState<CurrentUser>(() => buildFallbackCurrentUser(tenantLabel));
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [theme, setTheme] = useState<ConsoleTheme>("light");

  const notifications = useMemo(
    () =>
      previewNotificationSeeds.map((notification) => ({
        ...notification,
        read: readNotificationIds.includes(notification.id)
      })),
    [readNotificationIds]
  );
  const unreadNotificationCount = notifications.filter((notification) => !notification.read).length;

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

  useEffect(() => {
    setReadNotificationIds(readStoredNotificationIds());
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentUser() {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include"
        });

        if (!isMounted) {
          return;
        }

        if (!response.ok) {
          setCurrentUser(buildFallbackCurrentUser(tenantLabel));
          return;
        }

        const payload = (await response.json()) as unknown;
        setCurrentUser(parseCurrentUser(payload, tenantLabel) ?? buildFallbackCurrentUser(tenantLabel));
      } catch {
        if (isMounted) {
          setCurrentUser(buildFallbackCurrentUser(tenantLabel));
        }
      }
    }

    void loadCurrentUser();

    return () => {
      isMounted = false;
    };
  }, [tenantLabel]);

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

  function markAllNotificationsRead() {
    const nextReadIds = previewNotificationSeeds.map((notification) => notification.id);
    setReadNotificationIds(nextReadIds);
    writeStoredNotificationIds(nextReadIds);
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
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      <div className="console-main">
        <ConsoleTopbarActions
          currentUser={currentUser}
          isLoggingOut={isLoggingOut}
          notifications={notifications}
          onLogout={logout}
          onMarkAllNotificationsRead={markAllNotificationsRead}
          tenantLabel={tenantLabel}
          unreadNotificationCount={unreadNotificationCount}
        />
        {children}
      </div>
    </div>
  );
}

function ConsoleTopbarActions({
  currentUser,
  isLoggingOut,
  notifications,
  onLogout,
  onMarkAllNotificationsRead,
  tenantLabel,
  unreadNotificationCount
}: {
  currentUser: CurrentUser;
  isLoggingOut: boolean;
  notifications: AdminNotification[];
  onLogout: () => Promise<void>;
  onMarkAllNotificationsRead: () => void;
  tenantLabel: string;
  unreadNotificationCount: number;
}) {
  const initials = getUserInitials(currentUser.displayName);

  return (
    <div className="console-topbar-actions" aria-label="Console account actions">
      <button
        aria-label="Help"
        className="console-topbar-icon-button"
        title="Help"
        type="button"
      >
        <CircleHelp aria-hidden="true" size={18} strokeWidth={2.2} />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${unreadNotificationCount} unread notifications`}
          className="console-topbar-icon-button console-notification-trigger"
          title="Notifications"
        >
          <Bell aria-hidden="true" size={18} strokeWidth={2.2} />
          {unreadNotificationCount > 0 ? (
            <span className="console-notification-badge">
              {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
            </span>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label="Notifications"
          className="console-notification-popover"
          sideOffset={10}
        >
          <div className="console-notification-popover-header">
            <div>
              <strong>Notifications</strong>
              <span>{unreadNotificationCount} unread</span>
            </div>
            <button
              disabled={unreadNotificationCount === 0}
              onClick={onMarkAllNotificationsRead}
              type="button"
            >
              Mark all as read
            </button>
          </div>

          <div className="console-notification-list">
            {notifications.slice(0, 5).map((notification) => (
              <article
                className="console-notification-row"
                data-read={notification.read}
                data-severity={notification.severity}
                key={notification.id}
              >
                <span className="console-notification-severity-dot" aria-hidden="true" />
                <div>
                  <div className="console-notification-row-title">
                    <strong>{notification.title}</strong>
                    {!notification.read ? <span aria-label="Unread notification" /> : null}
                  </div>
                  <p>{notification.message}</p>
                  <footer>
                    <span>{notification.category}</span>
                    <small>{notification.createdAt}</small>
                  </footer>
                </div>
              </article>
            ))}
          </div>

          {/* No notifications route exists yet. Keep this disabled until a backend/page is added. */}
          <button className="console-notification-view-all" disabled type="button">
            View all notifications
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className="console-user-trigger" aria-label="Open user profile menu">
          <span className="console-user-avatar" aria-hidden="true">
            {currentUser.avatarUrl ? (
              <span
                className="console-user-avatar-image"
                style={{ backgroundImage: `url(${currentUser.avatarUrl})` }}
              />
            ) : (
              <span>{initials}</span>
            )}
          </span>
          <span className="console-user-copy">
            <strong>{currentUser.displayName}</strong>
            <small>{currentUser.role}</small>
          </span>
          <ChevronDown aria-hidden="true" size={14} strokeWidth={2.4} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label="User profile"
          className="console-user-popover"
          sideOffset={10}
        >
          <div className="console-user-popover-header">
            <span className="console-user-avatar" aria-hidden="true">
              {currentUser.avatarUrl ? (
                <span
                  className="console-user-avatar-image"
                  style={{ backgroundImage: `url(${currentUser.avatarUrl})` }}
                />
              ) : (
                <span>{initials}</span>
              )}
            </span>
            <div>
              <strong>{currentUser.displayName}</strong>
              {currentUser.email ? <span>{currentUser.email}</span> : null}
            </div>
          </div>

          <dl className="console-user-meta">
            <div>
              <dt>Role</dt>
              <dd>{currentUser.role}</dd>
            </div>
            <div>
              <dt>Organization</dt>
              <dd>{currentUser.tenantName ?? tenantLabel}</dd>
            </div>
          </dl>

          <div className="console-user-menu-actions">
            <button className="console-user-menu-action" disabled type="button">
              <SettingsIcon aria-hidden="true" size={14} strokeWidth={2.2} />
              <span>Settings</span>
              <small>Not connected</small>
            </button>
            <button
              className="console-user-menu-action"
              disabled={isLoggingOut}
              onClick={() => {
                void onLogout();
              }}
              type="button"
            >
              <LogOut aria-hidden="true" size={14} strokeWidth={2.2} />
              <span>{isLoggingOut ? "Logging out..." : "Logout"}</span>
            </button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function buildFallbackCurrentUser(tenantLabel: string): CurrentUser {
  return {
    displayName: "Admin",
    id: "demo-admin",
    role: "Super Admin",
    tenantName: tenantLabel
  };
}

function parseCurrentUser(payload: unknown, tenantLabel: string): CurrentUser | null {
  const root = getRecord(payload);
  const data = getRecord(root?.data);
  const user = getRecord(data?.user);

  if (!user) {
    return null;
  }

  const email = readString(user, "email");
  const membership = getPrimaryMembership(data);
  const tenant = getRecord(data?.tenant);
  const displayName =
    readString(user, "displayName") ??
    readString(user, "name") ??
    getDisplayNameFromEmail(email) ??
    "Admin";

  return {
    avatarUrl: readString(user, "avatarUrl") ?? readString(user, "picture") ?? undefined,
    displayName,
    email: email ?? undefined,
    id: readString(user, "id") ?? readString(user, "userId") ?? "current-admin",
    role: formatRoleLabel(readString(membership, "role") ?? readString(user, "role")),
    tenantName: readString(tenant, "name") ?? tenantLabel
  };
}

function getPrimaryMembership(data: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!data) {
    return null;
  }

  const membership = getRecord(data.membership);
  if (membership) {
    return membership;
  }

  if (!Array.isArray(data.memberships)) {
    return null;
  }

  return data.memberships.map(getRecord).find((item): item is Record<string, unknown> => Boolean(item)) ?? null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];

  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
}

function getDisplayNameFromEmail(email: string | null) {
  if (!email) {
    return null;
  }

  const localPart = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!localPart) {
    return null;
  }

  return localPart
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRoleLabel(role: string | null) {
  if (!role) {
    return "Super Admin";
  }

  const normalizedRole = role.trim().toLowerCase();
  if (normalizedRole === "tenant_admin" || normalizedRole === "super_admin") {
    return "Super Admin";
  }

  return normalizedRole
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Super Admin";
}

function getUserInitials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]?.charAt(0) ?? ""}${parts[1]?.charAt(0) ?? ""}`.toUpperCase();
  }

  return (parts[0]?.charAt(0) || "A").toUpperCase();
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

function readStoredNotificationIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(notificationReadStorageKey);
    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function writeStoredNotificationIds(notificationIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(notificationReadStorageKey, JSON.stringify(notificationIds));
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

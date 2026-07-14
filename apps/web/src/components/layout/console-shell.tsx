"use client";

import {
  Activity,
  Bell,
  Building2,
  ChevronDown,
  CircleHelp,
  FolderKanban,
  KeyRound,
  Globe2,
  LayoutDashboard,
  LogOut,
  Maximize2,
  Minimize2,
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
type NotificationSeverity = "critical" | "info" | "warning";
type CurrentUser = {
  avatarUrl?: string;
  displayName: string;
  email?: string;
  id: string;
  role: string;
  tenantName?: string;
};

type AdminNotification = {
  category: string;
  createdAt: string;
  id: string;
  message: string;
  read: boolean;
  severity: NotificationSeverity;
  title: string;
};

type AdminNotificationSeed = Pick<AdminNotification, "id" | "severity"> & {
  content: Record<
    Locale,
    Pick<AdminNotification, "category" | "createdAt" | "message" | "title">
  >;
};

const sectionIcons: Record<ConsoleSection, typeof LayoutDashboard> = {
  monitoring: LayoutDashboard,
  management: FolderKanban
};

const childIcons: Record<ManagementNavItem | MonitoringNavItem, typeof LayoutDashboard> = {
  "api-keys": KeyRound,
  "app-tokens": SettingsIcon,
  employees: Users,
  alerts: Bell,
  analytics: Activity,
  "live-logs": ScrollText,
  overview: LayoutDashboard,
  policies: ScrollText,
  project: FolderKanban,
  provider: Plug,
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
          ko: "개요"
        },
        item: "overview",
        path: (tenantId) => `/tenants/${tenantId}/dashboard`
      },
      {
        labels: {
          en: "Live Logs",
          ko: "실시간 로그"
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
      },
      {
        labels: {
          en: "Alerts",
          ko: "알림"
        },
        item: "alerts",
        path: (tenantId) => `/tenants/${tenantId}/alerts`
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
          en: "Tenant",
          ko: "회사 정책"
        },
        item: "tenant",
        path: (tenantId) => `/tenants/${tenantId}/tenants`
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
          ko: "프로바이더"
        },
        item: "provider",
        path: (tenantId) => `/tenants/${tenantId}/provider-connections`
      },
      {
        labels: {
          en: "API Management",
          ko: "API 관리"
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
    help: string;
    language: string;
    landing: string;
    loggingOut: string;
    logout: string;
    markAllAsRead: string;
    navigation: string;
    notifications: string;
    openUserProfile: string;
    organization: string;
    role: string;
    sessionRequired: string;
    settings: string;
    light: string;
    dark: string;
    presentationMode: string;
    presentationModeOff: string;
    presentationModeOn: string;
    theme: string;
    planned: string;
    tenant: string;
    unread: string;
    unreadNotification: string;
    userProfile: string;
    viewAllNotifications: string;
  }
> = {
  en: {
    account: "Account",
    accountActions: "Console account actions",
    collapseNavigation: "Collapse navigation",
    expandNavigation: "Expand navigation",
    dark: "Dark",
    help: "Help",
    language: "Language",
    landing: "Landing",
    light: "Light",
    loggingOut: "Logging out...",
    logout: "Logout",
    markAllAsRead: "Mark all as read",
    navigation: "navigation",
    notifications: "Notifications",
    openUserProfile: "Open user profile menu",
    organization: "Organization",
    planned: "planned",
    presentationMode: "Expanded layout",
    presentationModeOff: "Expand",
    presentationModeOn: "Standard",
    role: "Role",
    sessionRequired: "Session required",
    settings: "Settings",
    tenant: "tenant",
    theme: "Theme",
    unread: "unread",
    unreadNotification: "Unread notification",
    userProfile: "User profile",
    viewAllNotifications: "View all notifications"
  },
  ko: {
    account: "계정",
    accountActions: "콘솔 계정 메뉴",
    landing: "랜딩",
    collapseNavigation: "내비게이션 닫기",
    expandNavigation: "내비게이션 열기",
    dark: "다크",
    help: "도움말",
    language: "언어",
    light: "라이트",
    loggingOut: "로그아웃 중...",
    logout: "로그아웃",
    markAllAsRead: "모두 읽음으로 표시",
    navigation: "내비게이션",
    notifications: "알림",
    openUserProfile: "사용자 프로필 메뉴 열기",
    organization: "조직",
    planned: "예정",
    presentationMode: "확장 보기",
    presentationModeOff: "확장",
    presentationModeOn: "기본",
    role: "역할",
    sessionRequired: "로그인 필요",
    settings: "설정",
    tenant: "테넌트",
    theme: "테마",
    unread: "읽지 않음",
    unreadNotification: "읽지 않은 알림",
    userProfile: "사용자 프로필",
    viewAllNotifications: "모든 알림 보기"
  }
};

const sidebarCollapsedStorageKey = "gatelm_console_sidebar_collapsed";
const themeStorageKey = "gatelm_console_theme";
const presentationModeStorageKey = "gatelm_console_presentation_mode";
const notificationReadStorageKey = "gatelm_console_header_notification_read_ids";

// No notification API exists yet; these are preview notifications for the console header demo.
const previewNotificationSeeds: AdminNotificationSeed[] = [
  {
    content: {
      en: {
        category: "Budget",
        createdAt: "2m ago",
        message: "Monthly budget usage is approaching the configured limit.",
        title: "Budget warning"
      },
      ko: {
        category: "예산",
        createdAt: "2분 전",
        message: "월간 예산 사용량이 설정된 한도에 가까워지고 있습니다.",
        title: "예산 경고"
      }
    },
    id: "budget-usage-preview",
    severity: "warning"
  },
  {
    content: {
      en: {
        category: "Provider",
        createdAt: "5m ago",
        message: "Recent gateway requests include provider-side 5xx errors.",
        title: "Provider error"
      },
      ko: {
        category: "프로바이더",
        createdAt: "5분 전",
        message: "최근 Gateway 요청에서 프로바이더 측 5xx 오류가 발생했습니다.",
        title: "프로바이더 오류"
      }
    },
    id: "provider-error-preview",
    severity: "critical"
  },
  {
    content: {
      en: {
        category: "Safety",
        createdAt: "8m ago",
        message: "Secret-like prompt content was blocked by policy.",
        title: "Safety block detected"
      },
      ko: {
        category: "안전",
        createdAt: "8분 전",
        message: "비밀정보로 추정되는 프롬프트 내용이 정책에 의해 차단되었습니다.",
        title: "안전 정책 차단 감지"
      }
    },
    id: "safety-block-preview",
    severity: "warning"
  },
  {
    content: {
      en: {
        category: "Rate Limit",
        createdAt: "14m ago",
        message: "A project is close to its current rate limit window.",
        title: "Rate limit warning"
      },
      ko: {
        category: "요청 제한",
        createdAt: "14분 전",
        message: "프로젝트 요청량이 현재 요청 제한에 가까워지고 있습니다.",
        title: "요청 제한 경고"
      }
    },
    id: "rate-limit-preview",
    severity: "info"
  },
  {
    content: {
      en: {
        category: "Cache",
        createdAt: "22m ago",
        message: "Cache hit rate is lower than expected for repeated traffic.",
        title: "Cache opportunity"
      },
      ko: {
        category: "캐시",
        createdAt: "22분 전",
        message: "반복 트래픽의 캐시 적중률이 예상보다 낮습니다.",
        title: "캐시 개선 기회"
      }
    },
    id: "cache-opportunity-preview",
    severity: "info"
  }
];

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
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [theme, setTheme] = useState<ConsoleTheme>("light");
  const [isPresentationMode, setIsPresentationMode] = useState(false);

  const notifications = useMemo(
    () =>
      previewNotificationSeeds.map((notification) => ({
        ...notification.content[locale],
        id: notification.id,
        severity: notification.severity,
        read: readNotificationIds.includes(notification.id)
      })),
    [locale, readNotificationIds]
  );
  const unreadNotificationCount = notifications.filter((notification) => !notification.read).length;

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

  useEffect(() => {
    const initialPresentationMode = readStoredPresentationMode();
    setIsPresentationMode(initialPresentationMode);
    applyPresentationMode(initialPresentationMode);
  }, []);

  useEffect(() => {
    setReadNotificationIds(readStoredNotificationIds());
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

  function togglePresentationMode() {
    setIsPresentationMode((current) => {
      const next = !current;
      applyPresentationMode(next);
      writeStoredPresentationMode(next);
      return next;
    });
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
          isPresentationMode={isPresentationMode}
          isLoggingOut={isLoggingOut}
          locale={locale}
          notifications={notifications}
          onLogout={logout}
          onMarkAllNotificationsRead={markAllNotificationsRead}
          onSelectTheme={selectTheme}
          onTogglePresentationMode={togglePresentationMode}
          tenantLabel={tenantLabel}
          text={text}
          theme={theme}
          unreadNotificationCount={unreadNotificationCount}
        />
        {children}
      </div>
    </div>
  );
}

function ConsoleTopbarActions({
  currentUser,
  isPresentationMode,
  isLoggingOut,
  locale,
  notifications,
  onLogout,
  onMarkAllNotificationsRead,
  onSelectTheme,
  onTogglePresentationMode,
  tenantLabel,
  text,
  theme,
  unreadNotificationCount
}: {
  currentUser: CurrentUser | null;
  isPresentationMode: boolean;
  isLoggingOut: boolean;
  locale: Locale;
  notifications: AdminNotification[];
  onLogout: () => Promise<void>;
  onMarkAllNotificationsRead: () => void;
  onSelectTheme: (theme: ConsoleTheme) => void;
  onTogglePresentationMode: () => void;
  tenantLabel: string;
  text: (typeof shellText)[Locale];
  theme: ConsoleTheme;
  unreadNotificationCount: number;
}) {
  const displayUser = currentUser ?? buildPendingCurrentUser(tenantLabel, text);
  const initials = getUserInitials(displayUser.displayName);

  return (
    <div className="console-topbar-actions" aria-label={text.accountActions}>
      <button
        aria-label={text.help}
        className="console-topbar-icon-button"
        title={text.help}
        type="button"
      >
        <CircleHelp aria-hidden="true" size={18} strokeWidth={2.2} />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${text.notifications}: ${unreadNotificationCount} ${text.unread}`}
          className="console-topbar-icon-button console-notification-trigger"
          title={text.notifications}
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
          aria-label={text.notifications}
          className="console-notification-popover"
          sideOffset={10}
        >
          <div className="console-notification-popover-header">
            <div>
              <strong>{text.notifications}</strong>
              <span>
                {unreadNotificationCount} {text.unread}
              </span>
            </div>
            <button
              disabled={unreadNotificationCount === 0}
              onClick={onMarkAllNotificationsRead}
              type="button"
            >
              {text.markAllAsRead}
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
                    {!notification.read ? <span aria-label={text.unreadNotification} /> : null}
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
            {text.viewAllNotifications}
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className="console-user-trigger" aria-label={text.openUserProfile}>
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
            <div className="console-user-settings-row">
              <span>{text.presentationMode}</span>
              <button
                aria-pressed={isPresentationMode}
                className="console-presentation-mode-button"
                data-active={isPresentationMode}
                onClick={onTogglePresentationMode}
                type="button"
              >
                {isPresentationMode ? (
                  <Minimize2 aria-hidden="true" size={15} strokeWidth={2.2} />
                ) : (
                  <Maximize2 aria-hidden="true" size={15} strokeWidth={2.2} />
                )}
                <span>
                  {isPresentationMode ? text.presentationModeOn : text.presentationModeOff}
                </span>
              </button>
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

function applyPresentationMode(isEnabled: boolean) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.presentationMode = String(isEnabled);
}

function readStoredPresentationMode() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(presentationModeStorageKey) === "true";
}

function writeStoredPresentationMode(isEnabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(presentationModeStorageKey, String(isEnabled));
}

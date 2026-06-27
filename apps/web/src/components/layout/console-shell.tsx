"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import type { Locale } from "@/lib/i18n/locale";

type ConsoleSection = "dashboard" | "management" | "analytics" | "settings";
type ExpandableConsoleSection = "management" | "analytics";

export type ManagementNavItem = "onboarding" | "project" | "application" | "provider";
export type AnalyticsNavItem = "invocation-history";

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
          en: "Onboarding",
          ko: "온보딩"
        },
        item: "onboarding",
        path: (tenantId) => `/tenants/${tenantId}/onboarding`
      },
      {
        disabled: true,
        labels: {
          en: "Project",
          ko: "프로젝트"
        },
        item: "project"
      },
      {
        disabled: true,
        labels: {
          en: "Application",
          ko: "애플리케이션"
        },
        item: "application"
      },
      {
        disabled: true,
        labels: {
          en: "Provider",
          ko: "Provider"
        },
        item: "provider"
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
          en: "Invocation History",
          ko: "호출 이력"
        },
        item: "invocation-history",
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
    fixtureMode: string;
    language: string;
    planned: string;
    tenant: string;
  }
> = {
  en: {
    fixtureMode: "Fixture mode",
    language: "Console language",
    planned: "planned",
    tenant: "tenant"
  },
  ko: {
    fixtureMode: "피스처 모드",
    language: "콘솔 언어",
    planned: "예정",
    tenant: "테넌트"
  }
};

const openSectionsStorageKey = "gatelm_console_open_sections";

export function ConsoleShell({
  activeAnalyticsItem,
  activeManagementItem,
  activeSection,
  children,
  locale,
  tenantId
}: ConsoleShellProps) {
  const text = shellText[locale];
  const [openSections, setOpenSections] = useState<ExpandableConsoleSection[]>(() =>
    getActiveOpenSections(activeSection)
  );

  useEffect(() => {
    const storedOpenSections = readStoredOpenSections();
    setOpenSections(mergeOpenSections(storedOpenSections ?? [], getActiveOpenSections(activeSection)));
  }, [activeSection]);

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
    if (child.item === "invocation-history") {
      return child.item === activeAnalyticsItem;
    }

    return child.item === activeManagementItem;
  }

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
                        {item.children.map((child) => {
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
                        })}
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
                    {item.children.map((child) => {
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
                          aria-current={child.item === activeManagementItem ? "page" : undefined}
                          className="console-subnav-link"
                          data-active={child.item === activeManagementItem}
                          href={child.path(tenantId)}
                          key={child.item}
                        >
                          {childLabel}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="console-main">
        <header className="console-header">
          <div>
            <p className="console-kicker">{text.tenant}</p>
            <h1>{tenantId}</h1>
          </div>
          <div className="console-header-actions">
            <LanguageSwitcher ariaLabel={text.language} locale={locale} />
            <div className="console-context">{text.fixtureMode}</div>
          </div>
        </header>
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

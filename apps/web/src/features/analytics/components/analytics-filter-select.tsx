"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode
} from "react";

type AnalyticsFilterName = "employeeId" | "model" | "projectId" | "provider" | "range";

type AnalyticsFilterState = Record<AnalyticsFilterName, string> & {
  tab: string;
};

type AnalyticsFilterNavigation = {
  cacheKey: string;
  isPending: boolean;
  loadingLabel: string;
  navigateFilter: (name: AnalyticsFilterName, value: string) => void;
  targetCacheKey: string;
};

const AnalyticsFilterNavigationContext = createContext<AnalyticsFilterNavigation | null>(null);

const maxCachedPanels = 8;

type AnalyticsFilterFrameProps = {
  children: ReactNode;
  filterState: AnalyticsFilterState;
  loadingLabel: string;
};

export function AnalyticsFilterFrame({
  children,
  filterState,
  loadingLabel
}: AnalyticsFilterFrameProps) {
  const pathname = usePathname();
  const router = useRouter();
  const cacheKey = analyticsFilterCacheKey(filterState);
  const [isPending, startTransition] = useTransition();
  const [targetCacheKey, setTargetCacheKey] = useState(cacheKey);
  const latestFilterState = useRef(filterState);

  useEffect(() => {
    latestFilterState.current = filterState;
    setTargetCacheKey(cacheKey);
  }, [cacheKey, filterState]);

  const navigateFilter = useCallback((name: AnalyticsFilterName, value: string) => {
    const nextFilterState = {
      ...latestFilterState.current,
      [name]: value
    };
    const nextSearchParams = analyticsFilterSearchParams(nextFilterState);

    latestFilterState.current = nextFilterState;
    setTargetCacheKey(analyticsFilterCacheKey(nextFilterState));

    const query = nextSearchParams.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }, [pathname, router]);

  return (
    <AnalyticsFilterNavigationContext.Provider
      value={{ cacheKey, isPending, loadingLabel, navigateFilter, targetCacheKey }}
    >
      {children}
    </AnalyticsFilterNavigationContext.Provider>
  );
}

type AnalyticsFilterSelectProps = {
  children: ReactNode;
  defaultValue: string;
  name: AnalyticsFilterName;
};

export function AnalyticsFilterSelect({
  children,
  defaultValue,
  name
}: AnalyticsFilterSelectProps) {
  const navigation = useAnalyticsFilterNavigation();

  return (
    <select
      defaultValue={defaultValue}
      name={name}
      onChange={(event) => navigation.navigateFilter(name, event.currentTarget.value)}
    >
      {children}
    </select>
  );
}

export function AnalyticsPanelTransition({ children }: { children: ReactNode }) {
  const navigation = useAnalyticsFilterNavigation();
  const panelCache = useRef(new Map<string, ReactNode>());

  rememberPanel(panelCache.current, navigation.cacheKey, children);

  const cachedTarget = panelCache.current.get(navigation.targetCacheKey);
  const visiblePanel = navigation.isPending && cachedTarget ? cachedTarget : children;

  return (
    <section
      aria-busy={navigation.isPending}
      className="analytics-v3-panel-transition"
      data-loading={navigation.isPending}
    >
      <div className="analytics-v3-panel-transition-content">{visiblePanel}</div>
      {navigation.isPending ? (
        <div aria-live="polite" className="analytics-v3-panel-loading" role="status">
          <span aria-hidden="true" />
          {navigation.loadingLabel}
        </div>
      ) : null}
    </section>
  );
}

function useAnalyticsFilterNavigation() {
  const navigation = useContext(AnalyticsFilterNavigationContext);

  if (!navigation) {
    throw new Error("Analytics filters must be rendered inside AnalyticsFilterFrame.");
  }

  return navigation;
}

function analyticsFilterCacheKey(filterState: AnalyticsFilterState) {
  return [
    filterState.tab,
    filterState.range,
    filterState.projectId,
    filterState.employeeId,
    filterState.provider,
    filterState.model
  ].map(encodeURIComponent).join("|");
}

function analyticsFilterSearchParams(filterState: AnalyticsFilterState) {
  const query = new URLSearchParams({
    range: filterState.range,
    tab: filterState.tab
  });

  appendFilterQuery(query, "projectId", filterState.projectId);
  if (filterState.tab === "usage" || filterState.tab === "cost" || filterState.tab === "security") {
    appendFilterQuery(query, "employeeId", filterState.employeeId);
  }
  if (filterState.tab === "performance") {
    appendFilterQuery(query, "provider", filterState.provider);
    appendFilterQuery(query, "model", filterState.model);
  }

  return query;
}

function appendFilterQuery(query: URLSearchParams, key: string, value: string) {
  if (value) {
    query.set(key, value);
  }
}

function rememberPanel(cache: Map<string, ReactNode>, key: string, panel: ReactNode) {
  cache.delete(key);
  cache.set(key, panel);

  while (cache.size > maxCachedPanels) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}

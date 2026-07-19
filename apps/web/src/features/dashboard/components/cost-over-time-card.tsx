"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DashboardCostDensityEChart,
  DashboardCostOverTimeEChart
} from "@/features/dashboard/components/dashboard-echarts";
import {
  resampleCostOverTimeForDisplay,
  type CostOverTimeRange
} from "@/features/dashboard/cost-over-time-display";
import type { CostOverTimeSummary } from "@/lib/gateway/cost-over-time-types";
import type { Locale } from "@/lib/i18n/locale";

const COST_OVER_TIME_POLLING_INTERVAL_MS = 30000;
const COST_OVER_TIME_FIRST_FAILURE_BACKOFF_MS = 60000;
const COST_OVER_TIME_REPEATED_FAILURE_BACKOFF_MS = 120000;

type CostOverTimeCardFilters = {
  budgetScopeId: string;
  budgetScopeType: string;
  projectId: string;
  range: CostOverTimeRange;
  resolvedBy: string;
  surface: "all" | "project_application" | "tenant_chat";
  tenantId: string;
};

type CostOverTimeCardProps = {
  filters: CostOverTimeCardFilters;
  initialSummary?: CostOverTimeSummary;
  locale: Locale;
  pollingEnabled?: boolean;
  rangeOptions?: Array<{
    active: boolean;
    href: string;
    label: string;
  }>;
  rangeLabel: string;
};

type CostOverTimeStatus = "loading" | "success" | "error";

const costOverTimeText = {
  en: {
    aria: "Cost over time",
    average: "Average interval cost",
    chartAria: "Cost over time chart",
    denseAria: "Dense cost range overview chart",
    denseRange: "Dense range",
    empty: "No cost data for selected range",
    error: "Failed to load cost data",
    loading: "Loading cost data",
    rangeAria: "Cost trend time range",
    spend: "Spend (USD)",
    title: "Cost Trend",
    total: "Total spend"
  },
  ko: {
    aria: "비용 추이",
    average: "평균 구간 비용",
    chartAria: "비용 추이 차트",
    denseAria: "밀집 비용 구간 미리보기 차트",
    denseRange: "밀집 구간",
    empty: "선택한 기간에 비용 데이터가 없습니다",
    error: "비용 데이터를 불러오지 못했습니다",
    loading: "비용 데이터 불러오는 중",
    rangeAria: "비용 추이 시간 범위",
    spend: "사용 비용(USD)",
    title: "비용 추이",
    total: "총 사용 비용"
  }
} as const;

export function CostOverTimeCard({
  filters,
  initialSummary,
  locale,
  pollingEnabled = true,
  rangeOptions = [],
  rangeLabel
}: CostOverTimeCardProps) {
  const text = costOverTimeText[locale];
  const {
    budgetScopeId,
    budgetScopeType,
    projectId,
    range,
    resolvedBy,
    surface,
    tenantId
  } = filters;
  const queryString = useMemo(
    () =>
      buildCostOverTimeQuery({
        budgetScopeId,
        budgetScopeType,
        projectId,
        range,
        resolvedBy,
        surface,
        tenantId
      }),
    [
      budgetScopeId,
      budgetScopeType,
      projectId,
      range,
      resolvedBy,
      surface,
      tenantId
    ]
  );
  const normalizedInitialSummary = useMemo(() => normalizeCostOverTimeSummary(initialSummary), [initialSummary]);
  const [summary, setSummary] = useState<CostOverTimeSummary | undefined>(() => normalizedInitialSummary);
  const [status, setStatus] = useState<CostOverTimeStatus>(normalizedInitialSummary ? "success" : "loading");
  const latestSummaryRef = useRef<CostOverTimeSummary | undefined>(normalizedInitialSummary);
  const latestSummarySignatureRef = useRef(getCostOverTimeSummarySignature(normalizedInitialSummary));
  const displayedSummary = pollingEnabled ? summary : normalizedInitialSummary;
  const displayedStatus = pollingEnabled
    ? status
    : displayedSummary
      ? "success"
      : "loading";
  const renderedSummary = useMemo(
    () => displayedSummary
      ? resampleCostOverTimeForDisplay(displayedSummary, range)
      : undefined,
    [displayedSummary, range]
  );
  const hasCostData = renderedSummary?.points.some((point) => point.spendUsd > 0) ?? false;
  const totalSpendUsd =
    renderedSummary?.points.reduce((sum, point) => sum + point.spendUsd, 0) ?? 0;
  const bucketContext = formatCostBucketContext(
    rangeLabel,
    renderedSummary?.bucketInterval,
    locale
  );
  const denseIntervalLabel = formatCostBucketInterval(
    renderedSummary?.bucketInterval,
    locale
  );

  useEffect(() => {
    latestSummaryRef.current = summary;
    latestSummarySignatureRef.current = getCostOverTimeSummarySignature(summary);
  }, [summary]);

  useEffect(() => {
    setSummary(normalizedInitialSummary);
    latestSummaryRef.current = normalizedInitialSummary;
    latestSummarySignatureRef.current = getCostOverTimeSummarySignature(normalizedInitialSummary);
    setStatus(normalizedInitialSummary ? "success" : "loading");
  }, [normalizedInitialSummary, queryString]);

  useEffect(() => {
    if (!pollingEnabled) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let failureCount = 0;
    let inFlight = false;
    let timeoutId: number | undefined;

    function isDocumentHidden() {
      return document.visibilityState === "hidden";
    }

    function getNextPollingDelay() {
      if (failureCount === 0) {
        return COST_OVER_TIME_POLLING_INTERVAL_MS;
      }

      return failureCount === 1
        ? COST_OVER_TIME_FIRST_FAILURE_BACKOFF_MS
        : COST_OVER_TIME_REPEATED_FAILURE_BACKOFF_MS;
    }

    function clearScheduledRefresh() {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    }

    function scheduleNextRefresh() {
      clearScheduledRefresh();

      if (cancelled || isDocumentHidden()) {
        return;
      }

      timeoutId = window.setTimeout(() => {
        void refreshCostData(false);
      }, getNextPollingDelay());
    }

    function handleVisibilityChange() {
      if (cancelled) {
        return;
      }

      if (isDocumentHidden()) {
        clearScheduledRefresh();
        return;
      }

      void refreshCostData(false);
    }

    async function refreshCostData(showLoading: boolean) {
      if (inFlight || isDocumentHidden()) {
        return;
      }

      inFlight = true;
      if (showLoading && !latestSummaryRef.current) {
        setStatus("loading");
      }

      try {
        const response = await fetch(`/api/dashboard/cost-over-time?${queryString}`, {
          cache: "no-store",
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Failed to load cost data");
        }

        const payload = (await response.json().catch(() => ({}))) as { data?: CostOverTimeSummary };
        const nextSummary = normalizeCostOverTimeSummary(payload.data);
        if (!nextSummary) {
          throw new Error("Cost data is missing");
        }

        if (!cancelled) {
          failureCount = 0;
          const nextSummarySignature = getCostOverTimeSummarySignature(nextSummary);
          latestSummaryRef.current = nextSummary;

          if (nextSummarySignature !== latestSummarySignatureRef.current) {
            latestSummarySignatureRef.current = nextSummarySignature;
            setSummary(nextSummary);
          }

          setStatus("success");
        }
      } catch {
        failureCount += 1;

        if (!cancelled && !latestSummaryRef.current) {
          setStatus("error");
        }
      } finally {
        inFlight = false;
        scheduleNextRefresh();
      }
    }

    if (normalizedInitialSummary) {
      scheduleNextRefresh();
    } else {
      void refreshCostData(true);
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      clearScheduledRefresh();
      controller.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [normalizedInitialSummary, pollingEnabled, queryString]);

  return (
    <section className="dashboard-cost-over-time-panel" aria-label={text.aria}>
      <div className="dashboard-cost-over-time-header">
        <div className="dashboard-cost-over-time-title">
          <h2>{text.title}</h2>
          <p>{bucketContext}</p>
        </div>
        <div className="dashboard-cost-over-time-header-side">
          {rangeOptions.length > 0 ? (
            <nav aria-label={text.rangeAria} className="dashboard-cost-range-tabs">
              {rangeOptions.map((option) => (
                <Link
                  aria-current={option.active ? "page" : undefined}
                  data-active={option.active}
                  href={option.href}
                  key={option.label}
                >
                  {option.label}
                </Link>
              ))}
            </nav>
          ) : null}
          {hasCostData && renderedSummary ? (
            <div className="dashboard-cost-over-time-legend">
              <span data-kind="spend">{text.spend}</span>
              <span data-kind="average">
                {text.average}: {formatUsd(renderedSummary.averageSpendUsd)}
              </span>
            </div>
          ) : null}
        </div>
        <div className="dashboard-cost-over-time-metrics" aria-label={text.title}>
          <div data-kind="total">
            <span>{text.total}</span>
            <strong>{formatUsd(totalSpendUsd)}</strong>
          </div>
          <div data-kind="average">
            <span>{text.average}</span>
            <strong>{formatUsd(renderedSummary?.averageSpendUsd ?? 0)}</strong>
          </div>
        </div>
      </div>
      {displayedStatus === "loading" && !displayedSummary ? (
        <div className="dashboard-cost-over-time-skeleton" aria-label={text.loading} />
      ) : displayedStatus === "error" && !displayedSummary ? (
        <div className="dashboard-cost-over-time-state">{text.error}</div>
      ) : hasCostData && renderedSummary ? (
        <div className="dashboard-cost-chart-stack">
          <DashboardCostOverTimeEChart
            ariaLabel={text.chartAria}
            averageSpendUsd={renderedSummary.averageSpendUsd}
            points={renderedSummary.points}
          />
          <div className="dashboard-cost-density-panel">
            <div className="dashboard-cost-density-header">
              <strong>{text.denseRange}</strong>
              <span>{denseIntervalLabel ?? rangeLabel}</span>
            </div>
            <DashboardCostDensityEChart
              ariaLabel={text.denseAria}
              points={renderedSummary.points}
            />
          </div>
        </div>
      ) : (
        <div className="dashboard-cost-over-time-state">{text.empty}</div>
      )}
    </section>
  );
}

function buildCostOverTimeQuery(filters: CostOverTimeCardFilters) {
  const query = new URLSearchParams({
    range: filters.range,
    tenantId: filters.tenantId
  });

  setOptionalQuery(query, "budgetScopeId", filters.budgetScopeId);
  setOptionalQuery(query, "budgetScopeType", filters.budgetScopeType);
  setOptionalQuery(query, "projectId", filters.projectId);
  setOptionalQuery(query, "resolvedBy", filters.resolvedBy);
  setOptionalQuery(query, "surface", filters.surface);

  return query.toString();
}

function setOptionalQuery(query: URLSearchParams, key: string, value: string) {
  const normalized = value.trim();
  if (normalized) {
    query.set(key, normalized);
  }
}

function formatUsd(value: number) {
  const normalized = Number.isFinite(value) ? value : 0;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 3,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(normalized);
}

function formatCostBucketContext(
  rangeLabel: string,
  bucketInterval: string | undefined,
  locale: Locale
) {
  const intervalLabel = formatCostBucketInterval(bucketInterval, locale, true);

  return intervalLabel ? `${rangeLabel} · ${intervalLabel}` : rangeLabel;
}

function formatCostBucketInterval(
  bucketInterval: string | undefined,
  locale: Locale,
  includeUnit = false
) {
  const intervalLabels: Record<string, { en: string; ko: string }> = {
    "1s": { en: includeUnit ? "1-second buckets" : "1 sec", ko: includeUnit ? "1초 단위" : "1초" },
    "5s": { en: includeUnit ? "5-second buckets" : "5 sec", ko: includeUnit ? "5초 단위" : "5초" },
    "7s": { en: includeUnit ? "7-second buckets" : "7 sec", ko: includeUnit ? "7초 단위" : "7초" },
    "15s": { en: includeUnit ? "15-second buckets" : "15 sec", ko: includeUnit ? "15초 단위" : "15초" },
    "1m": { en: includeUnit ? "1-minute buckets" : "1 min", ko: includeUnit ? "1분 단위" : "1분" },
    "5m": { en: includeUnit ? "5-minute buckets" : "5 min", ko: includeUnit ? "5분 단위" : "5분" },
    "1h": { en: includeUnit ? "hourly buckets" : "1 hour", ko: includeUnit ? "1시간 단위" : "1시간" },
    "1d": { en: includeUnit ? "daily buckets" : "1 day", ko: includeUnit ? "1일 단위" : "1일" }
  };

  return bucketInterval ? intervalLabels[bucketInterval]?.[locale] : undefined;
}

function normalizeCostOverTimeSummary(summary: CostOverTimeSummary | undefined): CostOverTimeSummary | undefined {
  if (!summary || !Array.isArray(summary.points)) {
    return undefined;
  }

  return {
    ...summary,
    averageSpendUsd: normalizeNonNegativeNumber(summary.averageSpendUsd),
    points: summary.points
      .filter((point) => point && typeof point.bucket === "string" && typeof point.label === "string")
      .map((point) => ({
        ...point,
        spendUsd: normalizeNonNegativeNumber(point.spendUsd)
      }))
  };
}

function getCostOverTimeSummarySignature(summary: CostOverTimeSummary | undefined) {
  if (!summary) {
    return "";
  }

  return JSON.stringify({
    averageSpendUsd: summary.averageSpendUsd,
    bucketInterval: summary.bucketInterval ?? null,
    expectedBucketCount: summary.expectedBucketCount ?? null,
    period: summary.period,
    points: summary.points.map((point) => [
      point.bucket,
      point.label,
      point.spendUsd
    ])
  });
}

function normalizeNonNegativeNumber(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

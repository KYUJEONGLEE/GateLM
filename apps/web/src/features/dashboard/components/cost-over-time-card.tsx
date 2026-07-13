"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardCostOverTimeEChart } from "@/features/dashboard/components/dashboard-echarts";
import type { CostOverTimeSummary } from "@/lib/gateway/cost-over-time-types";
import type { Locale } from "@/lib/i18n/locale";

const COST_OVER_TIME_POLLING_INTERVAL_MS = 3000;
const COST_OVER_TIME_FIRST_FAILURE_BACKOFF_MS = 10000;
const COST_OVER_TIME_REPEATED_FAILURE_BACKOFF_MS = 20000;

type CostOverTimeRange = "5m" | "15m" | "1h" | "1d" | "1w";

type CostOverTimeCardFilters = {
  budgetScopeId: string;
  budgetScopeType: string;
  projectId: string;
  range: CostOverTimeRange;
  resolvedBy: string;
  tenantId: string;
};

type CostOverTimeCardProps = {
  filters: CostOverTimeCardFilters;
  initialSummary?: CostOverTimeSummary;
  locale: Locale;
  rangeLabel: string;
};

type CostOverTimeStatus = "loading" | "success" | "error";

export function CostOverTimeCard({
  filters,
  initialSummary,
  locale,
  rangeLabel
}: CostOverTimeCardProps) {
  const text = locale === "ko"
    ? {
        aria: "시간별 비용",
        average: "평균",
        chartAria: "시간별 비용 차트",
        empty: "선택한 기간에 비용 데이터가 없습니다",
        error: "비용 데이터를 불러오지 못했습니다",
        loading: "비용 데이터 불러오는 중",
        spend: "사용 비용(USD)",
        subtitle: "시간별 비용 추이",
        title: "시간별 비용"
      }
    : {
        aria: "Cost over time",
        average: "Average",
        chartAria: "Cost over time chart",
        empty: "No cost data for selected range",
        error: "Failed to load cost data",
        loading: "Loading cost data",
        spend: "Spend (USD)",
        subtitle: "Hourly cost trend",
        title: "Cost Over Time"
      };
  const {
    budgetScopeId,
    budgetScopeType,
    projectId,
    range,
    resolvedBy,
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
        tenantId
      }),
    [
      budgetScopeId,
      budgetScopeType,
      projectId,
      range,
      resolvedBy,
      tenantId
    ]
  );
  const normalizedInitialSummary = useMemo(() => normalizeCostOverTimeSummary(initialSummary), [initialSummary]);
  const [summary, setSummary] = useState<CostOverTimeSummary | undefined>(() => normalizedInitialSummary);
  const [status, setStatus] = useState<CostOverTimeStatus>(normalizedInitialSummary ? "success" : "loading");
  const latestSummaryRef = useRef<CostOverTimeSummary | undefined>(normalizedInitialSummary);
  const latestSummarySignatureRef = useRef(getCostOverTimeSummarySignature(normalizedInitialSummary));
  const hasCostData = summary?.points.some((point) => point.spendUsd > 0) ?? false;

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
  }, [normalizedInitialSummary, queryString]);

  return (
    <section className="dashboard-cost-over-time-panel" aria-label={text.aria}>
      <div className="dashboard-cost-over-time-header">
        <div>
          <h2>{text.title}</h2>
          <p>{text.subtitle}</p>
        </div>
        <span>{formatCostGranularity(summary, locale)}</span>
      </div>
      <div className="dashboard-cost-over-time-legend">
        <span data-kind="spend">{text.spend}</span>
        <span data-kind="average">{text.average}: {formatUsd(summary?.averageSpendUsd ?? 0)}</span>
        <strong>{rangeLabel}</strong>
      </div>
      {status === "loading" && !summary ? (
        <div className="dashboard-cost-over-time-skeleton" aria-label={text.loading} />
      ) : status === "error" && !summary ? (
        <div className="dashboard-cost-over-time-state">{text.error}</div>
      ) : hasCostData && summary ? (
        <DashboardCostOverTimeEChart
          ariaLabel={text.chartAria}
          averageSpendUsd={summary.averageSpendUsd}
          points={summary.points}
        />
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

  return query.toString();
}

function setOptionalQuery(query: URLSearchParams, key: string, value: string) {
  const normalized = value.trim();
  if (normalized) {
    query.set(key, normalized);
  }
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(Number.isFinite(value) ? value : 0);
}

function formatCostGranularity(summary: CostOverTimeSummary | undefined, locale: Locale) {
  if (summary?.bucketInterval === "7s") {
    return locale === "ko" ? "7초 단위" : "7-second";
  }

  if (summary?.period === "day") {
    return locale === "ko" ? "일간" : "Daily";
  }

  return locale === "ko" ? "시간별" : "Hourly";
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

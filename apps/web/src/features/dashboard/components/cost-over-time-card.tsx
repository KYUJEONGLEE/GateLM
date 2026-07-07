"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardCostOverTimeEChart } from "@/features/dashboard/components/dashboard-echarts";
import type { CostOverTimeSummary } from "@/lib/gateway/cost-over-time-types";

const COST_OVER_TIME_POLLING_INTERVAL_MS = 3000;

type CostOverTimeRange = "15m" | "1h" | "1d" | "1w";

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
  rangeLabel: string;
};

type CostOverTimeStatus = "loading" | "success" | "error";

export function CostOverTimeCard({
  filters,
  initialSummary,
  rangeLabel
}: CostOverTimeCardProps) {
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
  const hasCostData = summary?.points.some((point) => point.spendUsd > 0) ?? false;

  useEffect(() => {
    latestSummaryRef.current = summary;
  }, [summary]);

  useEffect(() => {
    setSummary(normalizedInitialSummary);
    latestSummaryRef.current = normalizedInitialSummary;
    setStatus(normalizedInitialSummary ? "success" : "loading");
  }, [normalizedInitialSummary, queryString]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let inFlight = false;

    async function refreshCostData(showLoading: boolean) {
      if (inFlight) {
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
          latestSummaryRef.current = nextSummary;
          setSummary(nextSummary);
          setStatus("success");
        }
      } catch {
        if (!cancelled && !latestSummaryRef.current) {
          setStatus("error");
        }
      } finally {
        inFlight = false;
      }
    }

    void refreshCostData(!normalizedInitialSummary);
    const intervalId = window.setInterval(() => {
      void refreshCostData(false);
    }, COST_OVER_TIME_POLLING_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [normalizedInitialSummary, queryString]);

  return (
    <section className="dashboard-cost-over-time-panel" aria-label="Cost over time">
      <div className="dashboard-cost-over-time-header">
        <div>
          <h2>Cost Over Time</h2>
          <p>시간별 비용 추이</p>
        </div>
        <span>{summary?.period === "day" ? "Daily" : "Hourly"}</span>
      </div>
      <div className="dashboard-cost-over-time-legend">
        <span data-kind="spend">Spend (USD)</span>
        <span data-kind="average">Average: {formatUsd(summary?.averageSpendUsd ?? 0)}</span>
        <strong>{rangeLabel}</strong>
      </div>
      {status === "loading" && !summary ? (
        <div className="dashboard-cost-over-time-skeleton" aria-label="Loading cost data" />
      ) : status === "error" && !summary ? (
        <div className="dashboard-cost-over-time-state">Failed to load cost data</div>
      ) : hasCostData && summary ? (
        <DashboardCostOverTimeEChart
          ariaLabel="Cost over time chart"
          averageSpendUsd={summary.averageSpendUsd}
          points={summary.points}
        />
      ) : (
        <div className="dashboard-cost-over-time-state">No cost data for selected range</div>
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

function normalizeNonNegativeNumber(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

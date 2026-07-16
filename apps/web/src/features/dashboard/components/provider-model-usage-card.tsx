"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DashboardPieEChart } from "@/features/dashboard/components/dashboard-echarts";
import { formatPercent } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

export type ProviderModelUsageProvider = "openai" | "anthropic" | "google" | "mock" | "unknown";

export type ProviderModelUsageRow = {
  costMicroUsd: number;
  model: string;
  provider: ProviderModelUsageProvider;
  providerLabel: string;
};

type ProviderModelUsageLegendRow = {
  color: string;
  costMicroUsd: number;
  label: string;
};

const usageColors = ["#3b82f6", "#2dd4bf", "#34d399", "#f59e0b", "#8b5cf6"];
const MAX_DIRECT_USAGE_ROWS = 4;
const providerModelUsageText = {
  en: {
    allProviders: "All Providers",
    aria: "Provider Usage",
    chartAria: "Provider cost usage donut chart",
    details: "View details",
    empty: "No provider cost for selected project",
    filterAria: "Filter provider cost usage by provider",
    others: "Others",
    totalCost: "Total cost",
    title: "Provider Usage"
  },
  ko: {
    allProviders: "전체 Provider",
    aria: "Provider 사용량",
    chartAria: "Provider 비용 사용량 도넛 차트",
    details: "자세히 보기",
    empty: "선택한 프로젝트에 Provider 비용이 없습니다",
    filterAria: "Provider별 비용 사용량 필터링",
    others: "기타",
    totalCost: "총 비용",
    title: "Provider 사용량"
  }
} as const;

export function ProviderModelUsageCard({
  detailsHref,
  locale,
  rows
}: {
  detailsHref: string;
  locale: Locale;
  rows: ProviderModelUsageRow[];
}) {
  const text = providerModelUsageText[locale];
  const providerOptions = useMemo(
    () => [
      { label: text.allProviders, value: "" },
      ...Array.from(new Set(rows.map((row) => row.providerLabel)))
        .sort((left, right) => left.localeCompare(right))
        .map((providerLabel) => ({ label: providerLabel, value: providerLabel }))
    ],
    [rows, text.allProviders]
  );
  const [providerFilter, setProviderFilter] = useState("");
  const activeProviderFilter = rows.some((row) => row.providerLabel === providerFilter)
    ? providerFilter
    : "";
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) => activeProviderFilter === "" || row.providerLabel === activeProviderFilter
      ),
    [activeProviderFilter, rows]
  );
  const legendRows = useMemo(
    () => buildLegendRows(filteredRows, text.others, activeProviderFilter === ""),
    [activeProviderFilter, filteredRows, text.others]
  );
  const totalCostMicroUsd = legendRows.reduce((sum, row) => sum + row.costMicroUsd, 0);

  return (
    <section className="dashboard-provider-usage-panel" aria-label={text.aria}>
      <div className="dashboard-provider-usage-header">
        <h2>{text.title}</h2>
        <select
          aria-label={text.filterAria}
          onChange={(event) => setProviderFilter(event.target.value)}
          value={activeProviderFilter}
        >
          {providerOptions.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {totalCostMicroUsd > 0 ? (
        <div className="dashboard-provider-usage-body">
          <div className="dashboard-provider-usage-chart">
            <div className="dashboard-provider-usage-chart-shell">
              <DashboardPieEChart
                ariaLabel={text.chartAria}
                rows={legendRows.map((row) => ({
                  color: row.color,
                  label: row.label,
                  value: row.costMicroUsd
                }))}
                showCenterTitle={false}
                totalLabel={text.totalCost}
                valueFormatter={formatMicroUsd}
              />
              <div className="dashboard-provider-usage-center" aria-hidden="true">
                <span>{text.totalCost}</span>
                <strong>{formatMicroUsdSummary(totalCostMicroUsd)}</strong>
              </div>
            </div>
          </div>
          <div className="dashboard-provider-usage-list">
            {legendRows.map((row) => (
              <div className="dashboard-provider-usage-row" key={row.label}>
                <span className="dashboard-provider-usage-dot" style={{ backgroundColor: row.color }} />
                <strong>{row.label}</strong>
                <span>{formatPercent(row.costMicroUsd / totalCostMicroUsd)}</span>
                <em>{formatMicroUsd(row.costMicroUsd)}</em>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="dashboard-provider-usage-empty">
          {text.empty}
        </div>
      )}
      <Link className="dashboard-provider-usage-details" href={detailsHref}>
        {text.details}
        <ChevronRight aria-hidden="true" size={16} />
      </Link>
    </section>
  );
}

function buildLegendRows(
  rows: ProviderModelUsageRow[],
  othersLabel: string,
  groupByProvider: boolean
): ProviderModelUsageLegendRow[] {
  const displayRows = groupByProvider
    ? Array.from(
        rows.reduce((groups, row) => {
          const current = groups.get(row.providerLabel) ?? 0;
          groups.set(row.providerLabel, current + row.costMicroUsd);
          return groups;
        }, new Map<string, number>())
      ).map(([label, costMicroUsd]) => ({ label, costMicroUsd }))
    : rows.map((row) => ({ label: row.model, costMicroUsd: row.costMicroUsd }));
  const sortedRows = displayRows
    .filter((row) => row.costMicroUsd > 0)
    .sort((first, second) => second.costMicroUsd - first.costMicroUsd);
  const topRows = sortedRows.slice(0, MAX_DIRECT_USAGE_ROWS).map((row, index) => ({
    color: usageColors[index] ?? usageColors[0],
    costMicroUsd: row.costMicroUsd,
    label: row.label
  }));
  const otherCostMicroUsd = sortedRows
    .slice(MAX_DIRECT_USAGE_ROWS)
    .reduce((sum, row) => sum + row.costMicroUsd, 0);

  if (otherCostMicroUsd > 0) {
    topRows.push({
      color: usageColors[4] ?? usageColors[0],
      costMicroUsd: otherCostMicroUsd,
      label: othersLabel
    });
  }

  return topRows;
}

function formatMicroUsd(value: number) {
  const dollars = value / 1_000_000;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: dollars > 0 && dollars < 1 ? 6 : 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(Number.isFinite(dollars) ? dollars : 0);
}

function formatMicroUsdSummary(value: number) {
  const dollars = value / 1_000_000;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(Number.isFinite(dollars) ? dollars : 0);
}

"use client";

import { useMemo, useState } from "react";
import { DashboardPieEChart } from "@/features/dashboard/components/dashboard-echarts";
import { formatInteger, formatPercent } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

export type ProviderModelUsageProvider = "openai" | "anthropic" | "google" | "mock" | "unknown";

export type ProviderModelUsageRow = {
  model: string;
  provider: ProviderModelUsageProvider;
  providerLabel: string;
  requestCount: number;
};

type ProviderModelUsageLegendRow = {
  color: string;
  label: string;
  requestCount: number;
};

const usageColors = ["#3b82f6", "#2dd4bf", "#34d399", "#f59e0b", "#8b5cf6"];
const MAX_DIRECT_USAGE_ROWS = 3;
const providerModelUsageText = {
  en: {
    allProviders: "All Providers",
    aria: "Provider / Model Usage",
    chartAria: "Provider model usage donut chart",
    empty: "No provider/model usage for selected project",
    filterAria: "Filter provider model usage by provider",
    mock: "Mock",
    others: "Others",
    requests: "Requests",
    title: "Provider / Model Usage"
  },
  ko: {
    allProviders: "전체 Provider",
    aria: "모델 사용량",
    chartAria: "프로바이더별 모델 사용량 도넛 차트",
    empty: "선택한 프로젝트에 Provider 또는 모델 사용량이 없습니다",
    filterAria: "Provider으로 모델 사용량 필터링",
    mock: "모의 Provider",
    others: "기타",
    requests: "요청",
    title: "모델 사용량"
  }
} as const;

export function ProviderModelUsageCard({
  locale,
  rows
}: {
  locale: Locale;
  rows: ProviderModelUsageRow[];
}) {
  const text = providerModelUsageText[locale];
  const providerOptions: Array<{ label: string; value: "" | ProviderModelUsageProvider }> = [
    { label: text.allProviders, value: "" },
    { label: "OpenAI", value: "openai" },
    { label: "Anthropic", value: "anthropic" },
    { label: "Google", value: "google" },
    { label: text.mock, value: "mock" }
  ];
  const [providerFilter, setProviderFilter] = useState<"" | ProviderModelUsageProvider>("");
  const filteredRows = useMemo(
    () => rows.filter((row) => providerFilter === "" || row.provider === providerFilter),
    [providerFilter, rows]
  );
  const legendRows = useMemo(
    () => buildLegendRows(filteredRows, text.others),
    [filteredRows, text.others]
  );
  const totalRequests = legendRows.reduce((sum, row) => sum + row.requestCount, 0);

  return (
    <section className="dashboard-provider-usage-panel" aria-label={text.aria}>
      <div className="dashboard-provider-usage-header">
        <h2>{text.title}</h2>
        <select
          aria-label={text.filterAria}
          onChange={(event) => setProviderFilter(event.target.value as "" | ProviderModelUsageProvider)}
          value={providerFilter}
        >
          {providerOptions.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {totalRequests > 0 ? (
        <div className="dashboard-provider-usage-body">
          <div className="dashboard-provider-usage-chart">
            <div className="dashboard-provider-usage-chart-shell">
              <DashboardPieEChart
                ariaLabel={text.chartAria}
                rows={legendRows.map((row) => ({
                  color: row.color,
                  label: row.label,
                  value: row.requestCount
                }))}
                showCenterTitle={false}
                totalLabel={text.requests}
              />
              <div className="dashboard-provider-usage-center" aria-hidden="true">
                <strong>{formatInteger(totalRequests)}</strong>
                <span>{text.requests}</span>
              </div>
            </div>
          </div>
          <div className="dashboard-provider-usage-list">
            {legendRows.map((row) => (
              <div className="dashboard-provider-usage-row" key={row.label}>
                <span className="dashboard-provider-usage-dot" style={{ backgroundColor: row.color }} />
                <strong>{row.label}</strong>
                <span>{formatPercent(row.requestCount / totalRequests)}</span>
                <em>({formatInteger(row.requestCount)})</em>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="dashboard-provider-usage-empty">
          {text.empty}
        </div>
      )}
    </section>
  );
}

function buildLegendRows(
  rows: ProviderModelUsageRow[],
  othersLabel: string
): ProviderModelUsageLegendRow[] {
  const sortedRows = [...rows]
    .filter((row) => row.requestCount > 0)
    .sort((first, second) => second.requestCount - first.requestCount);
  const topRows = sortedRows.slice(0, MAX_DIRECT_USAGE_ROWS).map((row, index) => ({
    color: usageColors[index] ?? usageColors[0],
    label: `${row.providerLabel} / ${row.model}`,
    requestCount: row.requestCount
  }));
  const othersCount = sortedRows
    .slice(MAX_DIRECT_USAGE_ROWS)
    .reduce((sum, row) => sum + row.requestCount, 0);

  if (othersCount > 0) {
    topRows.push({
      color: usageColors[4] ?? usageColors[0],
      label: othersLabel,
      requestCount: othersCount
    });
  }

  return topRows;
}

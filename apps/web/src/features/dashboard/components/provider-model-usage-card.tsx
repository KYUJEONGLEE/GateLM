"use client";

import { useMemo, useState } from "react";
import { DashboardPieEChart } from "@/features/dashboard/components/dashboard-echarts";
import { formatInteger, formatPercent } from "@/lib/formatting/formatters";

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

const providerOptions: Array<{ label: string; value: "" | ProviderModelUsageProvider }> = [
  { label: "All Providers", value: "" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Google", value: "google" },
  { label: "Mock", value: "mock" }
];

const usageColors = ["#3b82f6", "#2dd4bf", "#34d399", "#f59e0b", "#8b5cf6"];
const MAX_DIRECT_USAGE_ROWS = 3;

export function ProviderModelUsageCard({
  rows
}: {
  rows: ProviderModelUsageRow[];
}) {
  const [providerFilter, setProviderFilter] = useState<"" | ProviderModelUsageProvider>("");
  const filteredRows = useMemo(
    () => rows.filter((row) => providerFilter === "" || row.provider === providerFilter),
    [providerFilter, rows]
  );
  const legendRows = useMemo(() => buildLegendRows(filteredRows), [filteredRows]);
  const totalRequests = legendRows.reduce((sum, row) => sum + row.requestCount, 0);

  return (
    <section className="dashboard-provider-usage-panel" aria-label="Provider / Model Usage">
      <div className="dashboard-provider-usage-header">
        <h2>Provider / Model Usage</h2>
        <select
          aria-label="Filter provider model usage by provider"
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
                ariaLabel="Provider model usage donut chart"
                rows={legendRows.map((row) => ({
                  color: row.color,
                  label: row.label,
                  value: row.requestCount
                }))}
                showCenterTitle={false}
                totalLabel="Requests"
              />
              <div className="dashboard-provider-usage-center" aria-hidden="true">
                <strong>{formatInteger(totalRequests)}</strong>
                <span>Requests</span>
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
          No provider/model usage for selected project
        </div>
      )}
    </section>
  );
}

function buildLegendRows(rows: ProviderModelUsageRow[]): ProviderModelUsageLegendRow[] {
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
      label: "Others",
      requestCount: othersCount
    });
  }

  return topRows;
}

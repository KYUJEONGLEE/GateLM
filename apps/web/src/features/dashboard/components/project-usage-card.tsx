"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { DashboardPieEChart } from "@/features/dashboard/components/dashboard-echarts";
import { formatPercent } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

export type ProjectUsageRow = {
  costMicroUsd: number;
  projectId: string;
  projectName: string;
};

type ProjectUsageLegendRow = ProjectUsageRow & {
  color: string;
};

const usageColors = ["#3b82f6", "#2dd4bf", "#34d399", "#f59e0b", "#8b5cf6"];
const MAX_DIRECT_USAGE_ROWS = 4;
const projectUsageText = {
  en: {
    allProjects: "All projects",
    aria: "Usage by Project",
    chartAria: "Project cost usage donut chart",
    details: "View details",
    empty: "No project cost in the last 5 minutes",
    others: "Others",
    totalCost: "Total cost",
    title: "Usage by Project"
  },
  ko: {
    allProjects: "전체 프로젝트",
    aria: "프로젝트별 사용량",
    chartAria: "프로젝트별 비용 사용량 도넛 차트",
    details: "자세히 보기",
    empty: "최근 5분 동안 프로젝트 비용이 없습니다",
    others: "기타",
    totalCost: "총 비용",
    title: "프로젝트별 사용량"
  }
} as const;

export function ProjectUsageCard({
  detailsHref,
  locale,
  rows
}: {
  detailsHref: string;
  locale: Locale;
  rows: ProjectUsageRow[];
}) {
  const text = projectUsageText[locale];
  const legendRows = useMemo(
    () => buildLegendRows(rows, text.others),
    [rows, text.others]
  );
  const totalCostMicroUsd = legendRows.reduce((sum, row) => sum + row.costMicroUsd, 0);

  return (
    <section className="dashboard-provider-usage-panel" aria-label={text.aria}>
      <div className="dashboard-provider-usage-header">
        <h2>{text.title}</h2>
        <span className="dashboard-provider-usage-scope">{text.allProjects}</span>
      </div>

      {totalCostMicroUsd > 0 ? (
        <div className="dashboard-provider-usage-body">
          <div className="dashboard-provider-usage-chart">
            <div className="dashboard-provider-usage-chart-shell">
              <DashboardPieEChart
                ariaLabel={text.chartAria}
                rows={legendRows.map((row) => ({
                  color: row.color,
                  label: row.projectName,
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
              <div className="dashboard-provider-usage-row" key={row.projectId}>
                <span className="dashboard-provider-usage-dot" style={{ backgroundColor: row.color }} />
                <div className="dashboard-provider-usage-project-icon" aria-hidden="true">
                  {projectInitial(row.projectName)}
                </div>
                <strong>{row.projectName}</strong>
                <span>{formatPercent(row.costMicroUsd / totalCostMicroUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="dashboard-provider-usage-empty">{text.empty}</div>
      )}
      <Link className="dashboard-provider-usage-details" href={detailsHref}>
        {text.details}
        <ChevronRight aria-hidden="true" size={16} />
      </Link>
    </section>
  );
}

function buildLegendRows(rows: ProjectUsageRow[], othersLabel: string): ProjectUsageLegendRow[] {
  const sortedRows = rows
    .filter((row) => row.costMicroUsd > 0)
    .sort((first, second) => second.costMicroUsd - first.costMicroUsd);
  const topRows = sortedRows.slice(0, MAX_DIRECT_USAGE_ROWS).map((row, index) => ({
    ...row,
    color: usageColors[index] ?? usageColors[0]
  }));
  const otherCostMicroUsd = sortedRows
    .slice(MAX_DIRECT_USAGE_ROWS)
    .reduce((sum, row) => sum + row.costMicroUsd, 0);

  if (otherCostMicroUsd > 0) {
    topRows.push({
      color: usageColors[4] ?? usageColors[0],
      costMicroUsd: otherCostMicroUsd,
      projectId: "__others__",
      projectName: othersLabel
    });
  }

  return topRows;
}

function projectInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "P";
}

function formatMicroUsd(value: number) {
  const dollars = value / 1_000_000;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 3,
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

"use client";

import { useMemo } from "react";
import type { AnalyticsValueRow } from "@/features/analytics/analytics-read-model";
import type { AnalyticsRequestVolumePoint } from "@/features/analytics/analytics-usage-merge";
import {
  AnalyticsEChart,
  type AnalyticsEChartOption,
  analyticsTooltip,
  compactAxisNumber,
  useAnalyticsChartTheme
} from "@/features/analytics/components/analytics-echart";
import type { CostOverTimePoint } from "@/lib/gateway/cost-over-time-types";
import type { AnalyticsLatencyDistributionPoint } from "@/lib/gateway/live-analytics-performance";
import { formatMicroUsdCurrency } from "@/lib/formatting/formatters";

export type AnalyticsValueKind = "count" | "micro-usd" | "milliseconds" | "tokens";

const palette = ["#0f8f66", "#2563eb", "#d97706", "#dc4c4c", "#64748b"];
const outcomeColors: Record<string, string> = {
  blocked: "#dc4c4c",
  bypass: "#64748b",
  cache: "#0f8f66",
  cache_hit: "#0f8f66",
  cancelled: "#64748b",
  completed: "#0f8f66",
  eligible: "#2563eb",
  failed: "#dc4c4c",
  fallback: "#d97706",
  guardrail: "#dc4c4c",
  hit: "#0f8f66",
  miss: "#d97706",
  pii_masked: "#2563eb",
  prompt: "#2563eb",
  completion: "#0f8f66",
  provider: "#2563eb",
  rate_limited: "#d97706"
};

export function AnalyticsRankedBarChart({
  ariaLabel,
  className = "analytics-v3-ranked-chart",
  kind = "count",
  maxRows = 5,
  orientation = "horizontal",
  outlierMultiplier,
  presentation = false,
  rows
}: {
  ariaLabel: string;
  className?: string;
  kind?: AnalyticsValueKind;
  maxRows?: number;
  orientation?: "horizontal" | "vertical";
  outlierMultiplier?: number;
  presentation?: boolean;
  rows: AnalyticsValueRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const isVertical = orientation === "vertical";
  const activeRows = useMemo(() => rows.filter((row) => row.value > 0), [rows]);
  const visibleRows = useMemo(() => activeRows.slice(0, maxRows), [activeRows, maxRows]);
  const outlierThreshold = useMemo(
    () =>
      outlierMultiplier && activeRows.length > 0
        ? (activeRows.reduce((sum, row) => sum + row.value, 0) / activeRows.length) *
          outlierMultiplier
        : null,
    [activeRows, outlierMultiplier]
  );
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 360,
      grid: isVertical
        ? { bottom: presentation ? 92 : 74, left: 76, right: 24, top: 48 }
        : {
            bottom: presentation ? 28 : 24,
            left: presentation ? 178 : 132,
            right: presentation ? 102 : 82,
            top: 12
          },
      tooltip: analyticsTooltip(tooltipUnit(kind), theme),
      xAxis: isVertical
        ? {
            axisLabel: {
              color: theme.label,
              fontSize: presentation ? 17 : 14,
              fontWeight: 800,
              formatter: (value: string) =>
                value.length > 9 ? `${value.slice(0, 9)}…` : value,
              interval: 0,
              overflow: "truncate",
              width: 96
            },
            axisLine: { lineStyle: { color: theme.border } },
            axisTick: { show: false },
            data: visibleRows.map((row) => row.label),
            type: "category"
          }
        : {
            axisLabel: {
              color: theme.axis,
              fontSize: presentation ? 17 : 13,
              fontWeight: 700,
              formatter: (value: number) => formatValue(value, kind, true)
            },
            axisLine: { lineStyle: { color: theme.border } },
            axisTick: { show: false },
            minInterval: kind === "count" || kind === "tokens" ? 1 : undefined,
            splitLine: { lineStyle: { color: theme.grid } },
            type: "value"
          },
      yAxis: isVertical
        ? {
            axisLabel: {
              color: theme.axis,
              fontSize: presentation ? 17 : 13,
              fontWeight: 700,
              formatter: (value: number) => formatValue(value, kind, true)
            },
            axisLine: { show: false },
            axisTick: { show: false },
            minInterval: kind === "count" || kind === "tokens" ? 1 : undefined,
            splitLine: { lineStyle: { color: theme.grid } },
            type: "value"
          }
        : {
            axisLabel: {
              color: theme.label,
              fontSize: presentation ? 19 : 14,
              fontWeight: 800,
              margin: 13,
              overflow: "truncate",
              width: presentation ? 154 : 112
            },
            axisLine: { show: false },
            axisTick: { show: false },
            data: visibleRows.map((row) => row.label),
            inverse: true,
            type: "category"
          },
      series: [
        {
          barMaxWidth: isVertical ? (presentation ? 62 : 54) : presentation ? 26 : 18,
          data: visibleRows.map((row, index) => ({
            itemStyle: {
              borderRadius: isVertical ? [5, 5, 0, 0] : [0, 3, 3, 0],
              color:
                outlierThreshold === null
                  ? (outcomeColors[row.id] ?? palette[index] ?? palette[0])
                  : row.value >= outlierThreshold
                    ? palette[3]
                    : palette[0]
            },
            value: row.value
          })),
          label: {
            color: theme.label,
            fontSize: presentation ? 20 : 14,
            fontWeight: 900,
            formatter: ({ value }: { value: number }) => formatValue(value, kind, false),
            position: isVertical ? "top" : "right",
            show: true
          },
          type: "bar"
        }
      ]
    }),
    [isVertical, kind, outlierThreshold, presentation, theme, visibleRows]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className={className} option={option} />;
}

export function AnalyticsEmployeeTokenBarChart({
  ariaLabel,
  maxRows = 10,
  rows,
  totalValue
}: {
  ariaLabel: string;
  maxRows?: number;
  rows: AnalyticsValueRow[];
  totalValue?: number;
}) {
  const theme = useAnalyticsChartTheme();
  const visibleRows = useMemo(
    () =>
      [...rows]
        .filter((row) => row.value > 0)
        .sort(
          (left, right) =>
            right.value - left.value || left.label.localeCompare(right.label)
        )
        .slice(0, maxRows),
    [maxRows, rows]
  );
  const employeeTokenTotal =
    totalValue ?? visibleRows.reduce((sum, row) => sum + row.value, 0);
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 360,
      grid: { bottom: 74, left: 76, right: 24, top: 48 },
      tooltip: analyticsTooltip(" tokens", theme),
      xAxis: {
        axisLabel: {
          color: theme.label,
          fontSize: 14,
          fontWeight: 800,
          formatter: (value: string) => value.length > 9 ? `${value.slice(0, 9)}…` : value,
          interval: 0,
          overflow: "truncate",
          width: 96
        },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
        data: visibleRows.map((row) => row.label),
        type: "category"
      },
      yAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 13,
          fontWeight: 700,
          formatter: compactAxisNumber
        },
        axisLine: { show: false },
        axisTick: { show: false },
        minInterval: 1,
        splitLine: { lineStyle: { color: theme.grid } },
        type: "value"
      },
      series: [
        {
          barMaxWidth: 54,
          data: visibleRows.map((row) => ({
            itemStyle: {
              borderRadius: [5, 5, 0, 0],
              color:
                employeeTokenTotal > 0 && row.value / employeeTokenTotal >= 0.15
                  ? "#dc4c4c"
                  : "#0f8f66"
            },
            value: row.value
          })),
          label: {
            color: theme.label,
            fontSize: 14,
            fontWeight: 900,
            formatter: ({ value }: { value: number }) => formatValue(value, "tokens", false),
            position: "top",
            show: true
          },
          type: "bar"
        }
      ]
    }),
    [employeeTokenTotal, theme, visibleRows]
  );

  return (
    <AnalyticsEChart
      ariaLabel={ariaLabel}
      className="analytics-v3-employee-token-chart"
      option={option}
    />
  );
}

export function AnalyticsCompositionChart({
  ariaLabel,
  rows
}: {
  ariaLabel: string;
  rows: AnalyticsValueRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const visibleRows = useMemo(() => rows.filter((row) => row.value > 0).slice(0, 6), [rows]);
  const total = visibleRows.reduce((sum, row) => sum + row.value, 0);
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 360,
      grid: { bottom: 20, left: 4, right: 4, top: 20 },
      tooltip: analyticsTooltip(" requests", theme),
      xAxis: {
        axisLabel: { color: theme.axis, fontSize: 13, fontWeight: 700, formatter: compactAxisNumber },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
        minInterval: 1,
        splitLine: { show: false },
        type: "value"
      },
      yAxis: {
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        data: ["requests"],
        type: "category"
      },
      series: visibleRows.map((row, index) => ({
        barMaxWidth: 56,
        data: [row.value],
        itemStyle: {
          borderRadius:
            index === 0
              ? [5, 0, 0, 5]
              : index === visibleRows.length - 1
                ? [0, 5, 5, 0]
                : 0,
          color: outcomeColors[row.id] ?? palette[index] ?? palette[0]
        },
        label: {
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 900,
          formatter: ({ value }: { value: number }) =>
            total > 0 && value / total >= 0.13 ? `${Math.round((value / total) * 100)}%` : "",
          position: "inside",
          show: true
        },
        name: row.label,
        stack: "requests",
        type: "bar"
      }))
    }),
    [theme, total, visibleRows]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-v3-composition-chart" option={option} />;
}

export function AnalyticsCostTrendChart({
  ariaLabel,
  points
}: {
  ariaLabel: string;
  points: CostOverTimePoint[];
}) {
  const theme = useAnalyticsChartTheme();
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 360,
      grid: { bottom: 34, left: 68, right: 24, top: 24 },
      tooltip: {
        ...analyticsTooltip(" USD", theme),
        valueFormatter: (value: unknown) => formatUsd(Number(value ?? 0))
      },
      xAxis: {
        axisLabel: { color: theme.axis, fontSize: 13, fontWeight: 700, hideOverlap: true },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
        boundaryGap: false,
        data: points.map((point) => point.label),
        type: "category"
      },
      yAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 13,
          fontWeight: 700,
          formatter: (value: number) => formatUsd(value)
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: theme.grid } },
        type: "value"
      },
      series: [
        {
          areaStyle: { color: "rgba(37, 99, 235, 0.08)" },
          data: points.map((point) => point.spendUsd),
          itemStyle: { color: "#2563eb" },
          lineStyle: { color: "#2563eb", width: 3 },
          name: "Provider spend",
          showSymbol: points.length <= 12,
          smooth: 0.14,
          symbolSize: 7,
          type: "line"
        }
      ]
    }),
    [points, theme]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-v3-main-chart" option={option} />;
}

export function AnalyticsLatencyTrendChart({
  ariaLabel,
  points
}: {
  ariaLabel: string;
  points: AnalyticsLatencyDistributionPoint[];
}) {
  const theme = useAnalyticsChartTheme();
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 360,
      color: ["#0f8f66", "#2563eb", "#dc4c4c"],
      grid: { bottom: 34, left: 66, right: 24, top: 48 },
      legend: {
        data: ["p50", "p95", "p99"],
        icon: "circle",
        itemHeight: 8,
        itemWidth: 8,
        right: 4,
        textStyle: { color: theme.label, fontSize: 13, fontWeight: 800 },
        top: 0
      },
      tooltip: analyticsTooltip(" ms", theme),
      xAxis: {
        axisLabel: { color: theme.axis, fontSize: 13, fontWeight: 700, hideOverlap: true },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
        boundaryGap: false,
        data: points.map((point) => point.label),
        type: "category"
      },
      yAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 13,
          fontWeight: 700,
          formatter: (value: number) => `${compactAxisNumber(value)} ms`
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: theme.grid } },
        type: "value"
      },
      series: [
        latencySeries("p50", points.map((point) => point.p50LatencyMs)),
        latencySeries("p95", points.map((point) => point.p95LatencyMs)),
        latencySeries("p99", points.map((point) => point.p99LatencyMs))
      ]
    }),
    [points, theme]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-v3-main-chart" option={option} />;
}

export function AnalyticsRequestVolumeChart({
  ariaLabel,
  points
}: {
  ariaLabel: string;
  points: AnalyticsRequestVolumePoint[];
}) {
  const theme = useAnalyticsChartTheme();
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 360,
      grid: { bottom: 34, left: 60, right: 24, top: 24 },
      tooltip: analyticsTooltip(" requests", theme),
      xAxis: {
        axisLabel: { color: theme.axis, fontSize: 13, fontWeight: 700, hideOverlap: true },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
        boundaryGap: false,
        data: points.map((point) => point.label),
        type: "category"
      },
      yAxis: {
        axisLabel: { color: theme.axis, fontSize: 13, fontWeight: 700, formatter: compactAxisNumber },
        axisLine: { show: false },
        axisTick: { show: false },
        minInterval: 1,
        splitLine: { lineStyle: { color: theme.grid } },
        type: "value"
      },
      series: [
        {
          areaStyle: { color: "rgba(37, 99, 235, 0.08)" },
          data: points.map((point) => point.requests),
          itemStyle: { color: "#2563eb" },
          lineStyle: { color: "#2563eb", width: 3 },
          name: "Requests",
          showSymbol: points.length <= 12,
          smooth: 0.14,
          symbolSize: 7,
          type: "line"
        }
      ]
    }),
    [points, theme]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-v3-main-chart" option={option} />;
}

function latencySeries(name: string, data: Array<number | null>) {
  return {
    data,
    emphasis: { focus: "series" },
    lineStyle: { width: 3 },
    name,
    showSymbol: data.length <= 12,
    smooth: 0.14,
    symbolSize: 7,
    type: "line"
  };
}

function formatValue(value: number, kind: AnalyticsValueKind, compact: boolean) {
  if (kind === "micro-usd") {
    return formatMicroUsdCurrency(value);
  }
  if (kind === "milliseconds") {
    return `${compact ? compactAxisNumber(value) : Math.round(value)} ms`;
  }
  if (kind === "tokens") {
    return compactAxisNumber(value);
  }
  return compact ? compactAxisNumber(value) : new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
    minimumFractionDigits: 0,
    style: "currency"
  }).format(Number.isFinite(value) ? value : 0);
}

function tooltipUnit(kind: AnalyticsValueKind) {
  if (kind === "milliseconds") {
    return " ms";
  }
  if (kind === "tokens") {
    return " tokens";
  }
  if (kind === "micro-usd") {
    return " micro USD";
  }
  return " requests";
}

"use client";

import { useMemo } from "react";
import type { CostOverTimePoint } from "@/lib/gateway/cost-over-time-types";
import type { AnalyticsLatencyDistributionPoint } from "@/lib/gateway/live-analytics-performance";
import type { AnalyticsValueRow } from "@/features/analytics/analytics-read-model";
import {
  AnalyticsEChart,
  type AnalyticsEChartOption,
  analyticsTooltip,
  compactAxisNumber,
  useAnalyticsChartTheme
} from "@/features/analytics/components/analytics-echart";

export type AnalyticsValueKind = "count" | "micro-usd" | "milliseconds" | "tokens";

const palette = ["#10a37f", "#2563eb", "#7c3aed", "#f59e0b", "#64748b"];
const outcomeColors: Record<string, string> = {
  blocked: "#dc2626",
  bypass: "#64748b",
  cache_hit: "#10a37f",
  fallback: "#7c3aed",
  guardrail: "#dc2626",
  hit: "#10a37f",
  miss: "#f59e0b",
  pii_masked: "#2563eb",
  provider: "#2563eb",
  rate_limited: "#f59e0b",
  cache: "#10a37f"
};

export function AnalyticsRankedBarChart({
  ariaLabel,
  className = "analytics-v2-ranked-chart",
  kind = "count",
  maxRows = 5,
  rows
}: {
  ariaLabel: string;
  className?: string;
  kind?: AnalyticsValueKind;
  maxRows?: number;
  rows: AnalyticsValueRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const visibleRows = useMemo(() => rows.slice(0, maxRows), [maxRows, rows]);
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 320,
      grid: { bottom: 22, left: 144, right: 86, top: 8 },
      tooltip: analyticsTooltip(tooltipUnit(kind), theme),
      xAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 13,
          fontWeight: 700,
          formatter: (value: number) => formatValue(value, kind, true)
        },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
        minInterval: kind === "count" || kind === "tokens" ? 1 : undefined,
        splitLine: { lineStyle: { color: theme.grid } },
        type: "value"
      },
      yAxis: {
        axisLabel: {
          color: theme.label,
          fontSize: 15,
          fontWeight: 800,
          margin: 14,
          overflow: "truncate",
          width: 124
        },
        axisLine: { show: false },
        axisTick: { show: false },
        data: visibleRows.map((row) => row.label),
        inverse: true,
        type: "category"
      },
      series: [
        {
          barMaxWidth: 22,
          data: visibleRows.map((row, index) => ({
            itemStyle: {
              borderRadius: [0, 5, 5, 0],
              color: outcomeColors[row.id] ?? palette[index] ?? palette[0]
            },
            value: row.value
          })),
          label: {
            color: theme.label,
            fontSize: 15,
            fontWeight: 900,
            formatter: ({ value }: { value: number }) => formatValue(value, kind, false),
            position: "right",
            show: true
          },
          type: "bar"
        }
      ]
    }),
    [kind, theme, visibleRows]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className={className} option={option} />;
}

export function AnalyticsDonutChart({
  ariaLabel,
  className = "analytics-v2-donut-chart",
  kind = "count",
  rows
}: {
  ariaLabel: string;
  className?: string;
  kind?: AnalyticsValueKind;
  rows: AnalyticsValueRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const visibleRows = useMemo(() => rows.filter((row) => row.value > 0).slice(0, 5), [rows]);
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 320,
      color: visibleRows.map((row, index) => outcomeColors[row.id] ?? palette[index] ?? palette[0]),
      legend: {
        bottom: 0,
        data: visibleRows.map((row) => row.label),
        icon: "circle",
        itemGap: 16,
        itemHeight: 9,
        itemWidth: 9,
        textStyle: { color: theme.label, fontSize: 14, fontWeight: 800 }
      },
      series: [
        {
          avoidLabelOverlap: true,
          center: ["50%", "42%"],
          data: visibleRows.map((row) => ({ name: row.label, value: row.value })),
          emphasis: {
            label: {
              color: theme.label,
              fontSize: 18,
              fontWeight: 900,
              formatter: ({ value }: { value: number }) => formatValue(value, kind, false),
              show: true
            },
            scaleSize: 7
          },
          itemStyle: { borderColor: theme.tooltipBackground, borderWidth: 3 },
          label: { show: false },
          radius: ["53%", "76%"],
          type: "pie"
        }
      ],
      tooltip: {
        backgroundColor: theme.tooltipBackground,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        confine: true,
        textStyle: { color: theme.tooltipText, fontSize: 14, fontWeight: 800 },
        trigger: "item",
        valueFormatter: (value: unknown) => formatValue(Number(value ?? 0), kind, false)
      }
    }),
    [kind, theme, visibleRows]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className={className} option={option} />;
}

export function AnalyticsDispositionChart({
  ariaLabel,
  rows
}: {
  ariaLabel: string;
  rows: AnalyticsValueRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 360,
      grid: { bottom: 6, left: 0, right: 0, top: 6 },
      tooltip: analyticsTooltip(" requests", theme),
      xAxis: { max: total || 1, show: false, type: "value" },
      yAxis: { data: ["Gateway"], show: false, type: "category" },
      series: rows.map((row, index) => ({
        barWidth: 54,
        data: [row.value],
        itemStyle: {
          borderRadius:
            index === 0
              ? [7, 0, 0, 7]
              : index === rows.length - 1
                ? [0, 7, 7, 0]
                : 0,
          color: outcomeColors[row.id] ?? palette[index] ?? palette[0]
        },
        label: {
          color: "#ffffff",
          fontSize: 14,
          fontWeight: 900,
          formatter: ({ value }: { value: number }) =>
            total > 0 && value / total >= 0.12 ? `${Math.round((value / total) * 100)}%` : "",
          position: "inside",
          show: true
        },
        name: row.label,
        stack: "requests",
        type: "bar"
      }))
    }),
    [rows, theme, total]
  );

  return (
    <AnalyticsEChart
      ariaLabel={ariaLabel}
      className="analytics-v2-disposition-chart"
      option={option}
    />
  );
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
      animationDuration: 320,
      grid: { bottom: 30, left: 62, right: 18, top: 18 },
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
          areaStyle: { color: "rgba(16, 163, 127, 0.12)" },
          data: points.map((point) => point.spendUsd),
          itemStyle: { color: "#10a37f" },
          lineStyle: { color: "#10a37f", width: 3 },
          name: "Spend",
          showSymbol: points.length <= 12,
          smooth: 0.18,
          symbolSize: 7,
          type: "line"
        }
      ]
    }),
    [points, theme]
  );

  return (
    <AnalyticsEChart
      ariaLabel={ariaLabel}
      className="analytics-v2-trend-chart"
      option={option}
    />
  );
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
      animationDuration: 320,
      color: ["#10a37f", "#2563eb", "#dc2626"],
      grid: { bottom: 30, left: 58, right: 18, top: 38 },
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

  return (
    <AnalyticsEChart
      ariaLabel={ariaLabel}
      className="analytics-v2-trend-chart"
      option={option}
    />
  );
}

export function AnalyticsRequestVolumeChart({
  ariaLabel,
  points
}: {
  ariaLabel: string;
  points: AnalyticsLatencyDistributionPoint[];
}) {
  const theme = useAnalyticsChartTheme();
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 320,
      grid: { bottom: 30, left: 54, right: 18, top: 18 },
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
          areaStyle: { color: "rgba(37, 99, 235, 0.10)" },
          data: points.map((point) => point.requests),
          itemStyle: { color: "#2563eb" },
          lineStyle: { color: "#2563eb", width: 3 },
          name: "Requests",
          showSymbol: points.length <= 12,
          smooth: 0.18,
          symbolSize: 7,
          type: "line"
        }
      ]
    }),
    [points, theme]
  );

  return (
    <AnalyticsEChart
      ariaLabel={ariaLabel}
      className="analytics-v2-trend-chart"
      option={option}
    />
  );
}

function latencySeries(name: string, data: Array<number | null>) {
  return {
    data,
    emphasis: { focus: "series" },
    lineStyle: { width: 3 },
    name,
    showSymbol: data.length <= 12,
    smooth: 0.18,
    symbolSize: 7,
    type: "line"
  };
}

function formatValue(value: number, kind: AnalyticsValueKind, compact: boolean) {
  if (kind === "micro-usd") {
    return formatUsd(value / 1_000_000);
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

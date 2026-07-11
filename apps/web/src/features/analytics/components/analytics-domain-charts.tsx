"use client";

import { useMemo } from "react";
import {
  AnalyticsEChart,
  type AnalyticsEChartOption,
  analyticsTooltip,
  compactAxisNumber,
  useAnalyticsChartTheme
} from "@/features/analytics/components/analytics-echart";

export type AnalyticsDomainChartRow = {
  color?: string;
  id: string;
  label: string;
  value: number;
};

export type AnalyticsChartValueKind = "count" | "milliseconds" | "tokens" | "usd";

const chartColors = ["#10a37f", "#3b82f6", "#f59e0b", "#8b5cf6"];

export function AnalyticsDomainBarChart({
  ariaLabel,
  rows,
  valueKind
}: {
  ariaLabel: string;
  rows: AnalyticsDomainChartRow[];
  valueKind: AnalyticsChartValueKind;
}) {
  const theme = useAnalyticsChartTheme();
  const visibleRows = useMemo(() => rows.slice(0, 4), [rows]);
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 380,
      grid: {
        bottom: 26,
        left: 170,
        right: 78,
        top: 10
      },
      tooltip: analyticsTooltip(tooltipSuffix(valueKind), theme),
      xAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 16,
          fontWeight: 700,
          formatter: (value: number) => formatChartValue(value, valueKind, true)
        },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
        minInterval: valueKind === "count" || valueKind === "tokens" ? 1 : undefined,
        splitLine: { lineStyle: { color: theme.grid } },
        type: "value"
      },
      yAxis: {
        axisLabel: {
          color: theme.label,
          fontSize: 18,
          fontWeight: 800,
          margin: 16,
          overflow: "truncate",
          width: 148
        },
        axisLine: { show: false },
        axisTick: { show: false },
        data: visibleRows.map((row) => row.label),
        inverse: true,
        type: "category"
      },
      series: [
        {
          barMaxWidth: 26,
          data: visibleRows.map((row, index) => ({
            itemStyle: {
              borderRadius: [0, 7, 7, 0],
              color: row.color ?? chartColors[index] ?? chartColors[0]
            },
            value: row.value
          })),
          label: {
            color: theme.label,
            fontSize: 18,
            fontWeight: 900,
            formatter: ({ value }: { value: number }) =>
              formatChartValue(value, valueKind, false),
            position: "right",
            show: true
          },
          type: "bar"
        }
      ]
    }),
    [theme, valueKind, visibleRows]
  );

  return (
    <AnalyticsEChart
      ariaLabel={ariaLabel}
      className="analytics-domain-bar-chart"
      option={option}
    />
  );
}

export function AnalyticsDomainDonutChart({
  ariaLabel,
  rows,
  valueKind = "count"
}: {
  ariaLabel: string;
  rows: AnalyticsDomainChartRow[];
  valueKind?: AnalyticsChartValueKind;
}) {
  const theme = useAnalyticsChartTheme();
  const visibleRows = useMemo(() => rows.slice(0, 4), [rows]);
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 380,
      color: visibleRows.map(
        (row, index) => row.color ?? chartColors[index] ?? chartColors[0]
      ),
      legend: {
        bottom: 2,
        data: visibleRows.map((row) => row.label),
        icon: "circle",
        itemGap: 18,
        itemHeight: 11,
        itemWidth: 11,
        textStyle: {
          color: theme.label,
          fontSize: 17,
          fontWeight: 800
        }
      },
      series: [
        {
          data: visibleRows.map((row) => ({ name: row.label, value: row.value })),
          emphasis: {
            label: {
              color: theme.label,
              fontSize: 20,
              fontWeight: 900,
              formatter: ({ value }: { value: number }) =>
                formatChartValue(value, valueKind, false),
              show: true
            },
            scaleSize: 8
          },
          label: { show: false },
          radius: ["48%", "72%"],
          center: ["50%", "43%"],
          type: "pie"
        }
      ],
      tooltip: analyticsTooltip(tooltipSuffix(valueKind), theme)
    }),
    [theme, valueKind, visibleRows]
  );

  return (
    <AnalyticsEChart
      ariaLabel={ariaLabel}
      className="analytics-domain-donut-chart"
      option={option}
    />
  );
}

function formatChartValue(value: number, kind: AnalyticsChartValueKind, compact: boolean) {
  if (kind === "usd") {
    return new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
      minimumFractionDigits: 0,
      notation: compact && value >= 1000 ? "compact" : "standard",
      style: "currency"
    }).format(value);
  }
  if (kind === "milliseconds") {
    return `${compact ? compactAxisNumber(value) : Math.round(value)} ms`;
  }
  if (kind === "tokens") {
    return compact ? compactAxisNumber(value) : `${compactAxisNumber(value)}`;
  }
  return compact ? compactAxisNumber(value) : `${Math.round(value)}`;
}

function tooltipSuffix(kind: AnalyticsChartValueKind) {
  if (kind === "milliseconds") {
    return " ms";
  }
  if (kind === "tokens") {
    return " tokens";
  }
  if (kind === "usd") {
    return " USD";
  }
  return " requests";
}

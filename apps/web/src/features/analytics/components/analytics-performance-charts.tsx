"use client";

import { useMemo } from "react";
import {
  AnalyticsEChart,
  type AnalyticsEChartOption,
  analyticsTooltip,
  compactAxisNumber,
  useAnalyticsChartTheme
} from "@/features/analytics/components/analytics-echart";

export type AnalyticsProviderLatencyChartRow = {
  label: string;
  value: number;
};

export type AnalyticsLatencyDistributionChartPoint = {
  label: string;
  p50: number | null;
  p95: number | null;
  p99: number | null;
};

export function AnalyticsProviderLatencyBarChart({
  ariaLabel,
  rows
}: {
  ariaLabel: string;
  rows: AnalyticsProviderLatencyChartRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animation: false,
      color: ["#8b5cf6"],
      grid: {
        bottom: 26,
        left: 58,
        right: 26,
        top: 12
      },
      tooltip: analyticsTooltip(" ms", theme),
      xAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 14,
          fontWeight: 700,
          formatter: compactAxisNumber
        },
        axisLine: {
          lineStyle: {
            color: theme.border
          }
        },
        axisTick: {
          show: false
        },
        splitLine: {
          lineStyle: {
            color: theme.grid
          }
        },
        type: "value"
      },
      yAxis: {
        axisLabel: {
          color: theme.label,
          fontSize: 14,
          fontWeight: 800
        },
        axisLine: {
          show: false
        },
        axisTick: {
          show: false
        },
        data: rows.map((row) => row.label),
        inverse: true,
        type: "category"
      },
      series: [
        {
          barMaxWidth: 12,
          data: rows.map((row) => Number(row.value.toFixed(2))),
          itemStyle: {
            borderRadius: [0, 999, 999, 0],
            color: "#8b5cf6"
          },
          type: "bar"
        }
      ]
    }),
    [rows, theme]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-provider-latency-chart" option={option} />;
}

export function AnalyticsLatencyDistributionLineChart({
  ariaLabel,
  points
}: {
  ariaLabel: string;
  points: AnalyticsLatencyDistributionChartPoint[];
}) {
  const theme = useAnalyticsChartTheme();
  const xAxisLabelInterval = readableCategoryInterval(points.length);
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animation: false,
      color: ["#3b82f6", "#10b981", "#f97316"],
      grid: {
        bottom: 28,
        left: 54,
        right: 18,
        top: 42
      },
      legend: {
        data: ["p50", "p95", "p99"],
        icon: "circle",
        itemHeight: 7,
        itemWidth: 7,
        right: 6,
        textStyle: {
          color: theme.label,
          fontSize: 14,
          fontWeight: 800
        },
        top: 0
      },
      tooltip: analyticsTooltip(" ms", theme),
      xAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 14,
          fontWeight: 700,
          hideOverlap: true,
          interval: xAxisLabelInterval
        },
        axisLine: {
          lineStyle: {
            color: theme.border
          }
        },
        axisTick: {
          show: false
        },
        boundaryGap: false,
        data: points.map((point) => point.label),
        type: "category"
      },
      yAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 14,
          fontWeight: 700,
          formatter: compactAxisNumber
        },
        axisLine: {
          show: false
        },
        axisTick: {
          show: false
        },
        splitLine: {
          lineStyle: {
            color: theme.grid
          }
        },
        type: "value"
      },
      series: [
        analyticsLineSeries("p50", points.map((point) => point.p50)),
        analyticsLineSeries("p95", points.map((point) => point.p95)),
        analyticsLineSeries("p99", points.map((point) => point.p99))
      ]
    }),
    [points, theme, xAxisLabelInterval]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-latency-distribution-chart" option={option} />;
}

function analyticsLineSeries(name: string, data: Array<number | null>) {
  return {
    data: data.map((value) => (typeof value === "number" ? Number(value.toFixed(2)) : null)),
    emphasis: {
      focus: "series"
    },
    lineStyle: {
      width: 3
    },
    name,
    showSymbol: true,
    smooth: 0.22,
    symbolSize: 7,
    type: "line"
  };
}

function readableCategoryInterval(count: number) {
  if (count <= 8) {
    return 0;
  }

  return Math.max(0, Math.ceil(count / 6) - 1);
}

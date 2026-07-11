"use client";

import { useMemo } from "react";
import {
  AnalyticsEChart,
  type AnalyticsEChartOption,
  analyticsTooltip,
  compactAxisNumber,
  useAnalyticsChartTheme
} from "@/features/analytics/components/analytics-echart";

export type PolicyImpactChartRow = {
  color: string;
  label: string;
  value: number;
};

export function PolicyImpactOutcomeChart({
  ariaLabel,
  rows
}: {
  ariaLabel: string;
  rows: PolicyImpactChartRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 420,
      grid: {
        bottom: 26,
        containLabel: false,
        left: 170,
        right: 64,
        top: 8
      },
      tooltip: analyticsTooltip(" requests", theme),
      xAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 17,
          fontWeight: 700,
          formatter: compactAxisNumber
        },
        axisLine: {
          lineStyle: { color: theme.border }
        },
        axisTick: { show: false },
        minInterval: 1,
        splitLine: {
          lineStyle: { color: theme.grid }
        },
        type: "value"
      },
      yAxis: {
        axisLabel: {
          color: theme.label,
          fontSize: 20,
          fontWeight: 800,
          margin: 18
        },
        axisLine: { show: false },
        axisTick: { show: false },
        data: rows.map((row) => row.label),
        inverse: true,
        type: "category"
      },
      series: [
        {
          barMaxWidth: 28,
          data: rows.map((row) => ({
            itemStyle: {
              borderRadius: [0, 7, 7, 0],
              color: row.color
            },
            value: row.value
          })),
          label: {
            color: theme.label,
            fontSize: 20,
            fontWeight: 900,
            formatter: ({ value }: { value: number }) => compactAxisNumber(value),
            position: "right",
            show: true
          },
          type: "bar"
        }
      ]
    }),
    [rows, theme]
  );

  return (
    <AnalyticsEChart
      ariaLabel={ariaLabel}
      className="analytics-impact-outcome-chart"
      option={option}
    />
  );
}

export function PolicyImpactModelShareChart({
  ariaLabel,
  rows
}: {
  ariaLabel: string;
  rows: PolicyImpactChartRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 420,
      color: rows.map((row) => row.color),
      legend: {
        bottom: 2,
        data: rows.map((row) => row.label),
        icon: "circle",
        itemGap: 18,
        itemHeight: 11,
        itemWidth: 11,
        textStyle: {
          color: theme.label,
          fontSize: 18,
          fontWeight: 800
        }
      },
      series: [
        {
          avoidLabelOverlap: true,
          data: rows.map((row) => ({
            name: row.label,
            value: row.value
          })),
          emphasis: {
            label: {
              fontSize: 22,
              fontWeight: 900,
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
      tooltip: analyticsTooltip(" requests", theme)
    }),
    [rows, theme]
  );

  return (
    <AnalyticsEChart
      ariaLabel={ariaLabel}
      className="analytics-impact-model-chart"
      option={option}
    />
  );
}

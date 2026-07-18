"use client";

import { useMemo } from "react";
import type { AnalyticsV5Evidence } from "@/features/analytics/analytics-v5-evidence";
import type { AnalyticsValueRow } from "@/features/analytics/analytics-read-model";
import {
  AnalyticsEChart,
  type AnalyticsEChartOption,
  analyticsTooltip,
  compactAxisNumber,
  useAnalyticsChartTheme
} from "@/features/analytics/components/analytics-echart";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import type { LiveAnalyticsRange } from "@/lib/gateway/live-analytics-performance";
import type { Locale } from "@/lib/i18n/locale";

const palette = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#94a3b8"];
const routingDifficultyColors: Record<string, string> = {
  complex: "#3b82f6",
  "project_application:complex": "#3b82f6",
  "project_application:simple": "#10b981",
  simple: "#10b981",
  "tenant_chat:economy": "#f59e0b",
  "tenant_chat:high_quality": "#8b5cf6",
  "tenant_chat:standard": "#06b6d4",
  other: "#94a3b8"
};
const MODEL_LEGEND_MAX_LENGTH = 22;

export type AnalyticsV5ProjectUsageRow = {
  costMicroUsd: number;
  id: string;
  label: string;
  requestCount: number;
};

export function AnalyticsV5ModelTrafficChart({
  ariaLabel,
  evidence,
  locale,
  range
}: {
  ariaLabel: string;
  evidence: AnalyticsV5Evidence;
  locale: Locale;
  range: LiveAnalyticsRange;
}) {
  const theme = useAnalyticsChartTheme();
  const labels = useMemo(
    () => evidence.modelTraffic.bucketStarts.map((value) => formatBucket(value, range, locale)),
    [evidence.modelTraffic.bucketStarts, locale, range]
  );
  const seriesRows = useMemo(
    () => evidence.modelTraffic.series.map((series) => ({
      ...series,
      displayLabel: series.id === "Other" && locale === "ko"
        ? "기타"
        : formatModelDisplayName(series.label)
    })),
    [evidence.modelTraffic.series, locale]
  );
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 420,
      color: palette,
      grid: { bottom: 38, left: 64, right: 24, top: 62 },
      legend: {
        data: seriesRows.map((series) => series.displayLabel),
        formatter: truncateModelLegendLabel,
        icon: "roundRect",
        itemGap: 18,
        itemHeight: 11,
        itemWidth: 22,
        left: 0,
        right: 0,
        textStyle: { color: theme.label, fontSize: 17, fontWeight: 750 },
        top: 4,
        type: "scroll"
      },
      tooltip: analyticsTooltip(" requests", theme),
      xAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 14,
          fontWeight: 700,
          hideOverlap: true
        },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
        boundaryGap: false,
        data: labels,
        type: "category"
      },
      yAxis: {
        axisLabel: {
          color: theme.axis,
          fontSize: 14,
          fontWeight: 700,
          formatter: compactAxisNumber
        },
        axisLine: { show: false },
        axisTick: { show: false },
        minInterval: 1,
        splitLine: { lineStyle: { color: theme.grid } },
        type: "value"
      },
      series: seriesRows.map((series, index) => ({
        data: series.values,
        emphasis: { focus: "series" },
        itemStyle: { color: palette[index] },
        lineStyle: { color: palette[index], width: 3 },
        name: series.displayLabel,
        showSymbol: labels.length <= 15,
        smooth: 0.2,
        symbol: "circle",
        symbolSize: 7,
        type: "line"
      }))
    }),
    [labels, seriesRows, theme]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-v5-model-flow-chart" option={option} />;
}

export function AnalyticsV5ModelShareChart({
  ariaLabel,
  rows
}: {
  ariaLabel: string;
  rows: AnalyticsValueRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const visibleRows = useMemo(() => rows.filter((row) => row.value > 0).slice(0, 5), [rows]);
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 420,
      color: palette,
      legend: {
        bottom: 0,
        formatter: truncateModelLegendLabel,
        icon: "circle",
        itemGap: 16,
        itemHeight: 12,
        itemWidth: 12,
        left: "center",
        right: 0,
        textStyle: { color: theme.label, fontSize: 19, fontWeight: 750 },
        type: "scroll"
      },
      series: [
        {
          avoidLabelOverlap: true,
          data: visibleRows.map((row) => ({
            name: formatModelDisplayName(row.label),
            value: row.value
          })),
          emphasis: { scaleSize: 7 },
          itemStyle: {
            borderColor: theme.tooltipBackground,
            borderWidth: 3
          },
          label: { show: false },
          center: ["50%", "45%"],
          radius: ["50%", "78%"],
          type: "pie"
        }
      ],
      tooltip: {
        ...analyticsTooltip(" requests", theme),
        trigger: "item"
      }
    }),
    [theme, visibleRows]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-v5-model-share-chart" option={option} />;
}

export function AnalyticsV5RoutingDifficultyChart({
  ariaLabel,
  locale,
  rows
}: {
  ariaLabel: string;
  locale: Locale;
  rows: AnalyticsValueRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const visibleRows = useMemo(() => rows.filter((row) => row.value > 0), [rows]);
  const total = useMemo(
    () => visibleRows.reduce((sum, row) => sum + row.value, 0),
    [visibleRows]
  );
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 420,
      grid: { bottom: 24, containLabel: false, left: 112, right: 88, top: 18 },
      tooltip: analyticsTooltip(locale === "ko" ? "건" : " requests", theme),
      xAxis: {
        axisLabel: { color: theme.axis, fontSize: 14, fontWeight: 700, formatter: compactAxisNumber },
        axisLine: { show: false },
        axisTick: { show: false },
        minInterval: 1,
        splitLine: { lineStyle: { color: theme.grid } },
        type: "value"
      },
      yAxis: {
        axisLabel: { color: theme.label, fontSize: 16, fontWeight: 800 },
        axisLine: { show: false },
        axisTick: { show: false },
        data: visibleRows.map((row) => row.label),
        inverse: true,
        type: "category"
      },
      series: [
        {
          barMaxWidth: 30,
          data: visibleRows.map((row) => ({
            itemStyle: {
              borderRadius: [0, 5, 5, 0],
              color: routingDifficultyColors[row.id] ?? routingDifficultyColors.other
            },
            share: safeRatio(row.value, total),
            value: row.value
          })),
          emphasis: { focus: "self" },
          label: {
            color: theme.label,
            fontSize: 15,
            fontWeight: 800,
            formatter: routingValueLabel,
            position: "right",
            show: true
          },
          type: "bar"
        }
      ]
    }),
    [locale, theme, total, visibleRows]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-v5-routing-difficulty-chart" option={option} />;
}

function truncateModelLegendLabel(value: string) {
  if (value.length <= MODEL_LEGEND_MAX_LENGTH) {
    return value;
  }

  return `${value.slice(0, MODEL_LEGEND_MAX_LENGTH - 3)}...`;
}

export function AnalyticsV5ProjectUsageChart({
  ariaLabel,
  locale,
  rows
}: {
  ariaLabel: string;
  locale: Locale;
  rows: AnalyticsV5ProjectUsageRow[];
}) {
  const theme = useAnalyticsChartTheme();
  const option = useMemo<AnalyticsEChartOption>(
    () => ({
      animationDuration: 420,
      grid: { bottom: 24, containLabel: false, left: 172, right: 154, top: 18 },
      tooltip: analyticsTooltip(locale === "ko" ? "건" : " requests", theme),
      xAxis: {
        axisLabel: { color: theme.axis, fontSize: 14, fontWeight: 700, formatter: compactAxisNumber },
        axisLine: { show: false },
        axisTick: { show: false },
        minInterval: 1,
        splitLine: { lineStyle: { color: theme.grid } },
        type: "value"
      },
      yAxis: {
        axisLabel: {
          color: theme.label,
          fontSize: 16,
          fontWeight: 800,
          overflow: "truncate",
          width: 148
        },
        axisLine: { show: false },
        axisTick: { show: false },
        data: rows.map((row) => row.label),
        inverse: true,
        type: "category"
      },
      series: [
        {
          barMaxWidth: 30,
          data: rows.map((row) => ({
            costMicroUsd: row.costMicroUsd,
            itemStyle: { borderRadius: [0, 5, 5, 0], color: "#10b981" },
            value: row.requestCount
          })),
          emphasis: { focus: "self" },
          label: {
            color: theme.label,
            fontSize: 15,
            fontWeight: 800,
            formatter: projectUsageValueLabel,
            position: "right",
            show: true
          },
          type: "bar"
        }
      ]
    }),
    [locale, rows, theme]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-v5-project-usage-chart" option={option} />;
}

function formatBucket(value: string, range: LiveAnalyticsRange, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  if (range === "1w") {
    return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
      day: "numeric",
      month: "numeric"
    }).format(date);
  }

  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: range === "1d" ? undefined : "2-digit"
  }).format(date);
}

function routingValueLabel(params: { data?: { share?: number }; value?: number }) {
  return `${formatInteger(params.value)} · ${formatPercent(params.data?.share)}`;
}

function projectUsageValueLabel(params: { data?: { costMicroUsd?: number }; value?: number }) {
  return `${formatInteger(params.value)} · ${formatMicroUsd(params.data?.costMicroUsd)}`;
}

function formatInteger(value: number | undefined) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0);
}

function formatPercent(value: number | undefined) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    style: "percent"
  }).format(value ?? 0);
}

function formatMicroUsd(value: number | undefined) {
  const dollars = (value ?? 0) / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: dollars > 0 && dollars < 1 ? 4 : 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(dollars);
}

function safeRatio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

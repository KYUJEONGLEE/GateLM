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
        icon: "roundRect",
        itemHeight: 9,
        itemWidth: 18,
        left: 0,
        textStyle: { color: theme.label, fontSize: 14, fontWeight: 700 },
        top: 4
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
        icon: "circle",
        itemHeight: 8,
        itemWidth: 8,
        left: "center",
        textStyle: { color: theme.label, fontSize: 13, fontWeight: 700 }
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
          radius: ["48%", "72%"],
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

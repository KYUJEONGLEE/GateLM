"use client";

import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef } from "react";
import { formatInteger, formatPercent } from "@/lib/formatting/formatters";

echarts.use([
  BarChart,
  GridComponent,
  LegendComponent,
  LineChart,
  PieChart,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer
]);

type EChartOption = Parameters<ReturnType<typeof echarts.init>["setOption"]>[0];

const chartAxisColor = "#64748b";
const chartBorderColor = "#d8dee6";
const chartForegroundColor = "#111827";

export type DashboardLineSeries = {
  color: string;
  data: number[];
  name: string;
};

export type DashboardPieRow = {
  color: string;
  label: string;
  value: number;
};

export function DashboardLineEChart({
  ariaLabel,
  labels,
  series
}: {
  ariaLabel: string;
  labels: string[];
  series: DashboardLineSeries[];
}) {
  const option = useMemo<EChartOption>(
    () => ({
      animation: false,
      color: series.map((row) => row.color),
      grid: {
        bottom: 28,
        containLabel: true,
        left: 10,
        right: 18,
        top: 36
      },
      legend: {
        show: false
      },
      tooltip: {
        axisPointer: {
          type: "line"
        },
        backgroundColor: "rgba(17, 24, 39, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 1,
        confine: true,
        extraCssText: "box-shadow: 0 14px 30px rgba(15, 23, 42, 0.24); border-radius: 8px;",
        textStyle: {
          color: "#f8fafc",
          fontSize: 12,
          fontWeight: 800
        },
        trigger: "axis",
        valueFormatter: (value: unknown) => formatInteger(Number(value ?? 0))
      },
      xAxis: {
        axisLabel: {
          color: chartAxisColor,
          fontSize: 11,
          fontWeight: 700,
          hideOverlap: true
        },
        axisLine: {
          lineStyle: {
            color: chartBorderColor
          }
        },
        axisTick: {
          show: false
        },
        boundaryGap: false,
        data: labels,
        type: "category"
      },
      yAxis: {
        axisLabel: {
          color: chartAxisColor,
          fontSize: 11,
          formatter: compactAxisNumber
        },
        axisLine: {
          show: false
        },
        axisTick: {
          show: false
        },
        minInterval: 1,
        splitLine: {
          lineStyle: {
            color: chartBorderColor,
            opacity: 0.78
          }
        },
        type: "value"
      },
      series: series.map((row) => ({
        data: row.data,
        blur: {
          lineStyle: {
            opacity: 1
          }
        },
        emphasis: {
          focus: "none"
        },
        lineStyle: {
          width: 3
        },
        name: row.name,
        progressive: 4000,
        progressiveThreshold: 3000,
        sampling: "lttb",
        showSymbol: false,
        smooth: 0.22,
        type: "line"
      }))
    }),
    [labels, series]
  );

  return <DashboardEChart ariaLabel={ariaLabel} className="dashboard-line-chart" option={option} />;
}

export function DashboardPieEChart({
  ariaLabel,
  rows,
  totalLabel = "requests"
}: {
  ariaLabel: string;
  rows: DashboardPieRow[];
  totalLabel?: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const option = useMemo<EChartOption>(
    () => ({
      animation: false,
      color: rows.map((row) => row.color),
      grid: {
        containLabel: true
      },
      title: {
        left: "center",
        subtext: totalLabel,
        subtextStyle: {
          color: chartAxisColor,
          fontSize: 11,
          fontWeight: 800
        },
        text: formatInteger(total),
        textStyle: {
          color: chartForegroundColor,
          fontSize: 24,
          fontWeight: 900
        },
        top: "center"
      },
      tooltip: {
        backgroundColor: "rgba(17, 24, 39, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 1,
        confine: true,
        extraCssText: "box-shadow: 0 14px 30px rgba(15, 23, 42, 0.24); border-radius: 8px;",
        formatter: (params: unknown) => {
          const item = Array.isArray(params) ? params[0] : params;
          if (!isTooltipRecord(item)) {
            return "";
          }

          return `${String(item.name)}<br/>${formatInteger(Number(item.value ?? 0))} (${formatPercent(Number(item.percent ?? 0) / 100)})`;
        },
        textStyle: {
          color: "#f8fafc",
          fontSize: 12,
          fontWeight: 800
        },
        trigger: "item"
      },
      series: [
        {
          avoidLabelOverlap: true,
          data: rows.map((row) => ({
            name: row.label,
            value: row.value
          })),
          emphasis: {
            scale: false
          },
          label: {
            show: false
          },
          labelLine: {
            show: false
          },
          minAngle: 2,
          radius: ["54%", "80%"],
          type: "pie"
        }
      ]
    }),
    [rows, total, totalLabel]
  );

  return <DashboardEChart ariaLabel={ariaLabel} className="dashboard-pie-chart" option={option} />;
}

function DashboardEChart({
  ariaLabel,
  className,
  option
}: {
  ariaLabel: string;
  className: string;
  option: EChartOption;
}) {
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) {
      return;
    }

    const chart = echarts.init(node, undefined, {
      renderer: "canvas",
      useDirtyRect: false
    });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, {
      lazyUpdate: true,
      notMerge: true
    });
  }, [option]);

  return <div aria-label={ariaLabel} className={className} ref={nodeRef} role="img" />;
}

function compactAxisNumber(value: string | number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return String(value);
  }

  if (Math.abs(numericValue) >= 1_000_000) {
    return `${Number((numericValue / 1_000_000).toFixed(1))}m`;
  }

  if (Math.abs(numericValue) >= 1_000) {
    return `${Number((numericValue / 1_000).toFixed(1))}k`;
  }

  return String(numericValue);
}

function isTooltipRecord(value: unknown): value is {
  name?: unknown;
  percent?: unknown;
  value?: unknown;
} {
  return typeof value === "object" && value !== null;
}

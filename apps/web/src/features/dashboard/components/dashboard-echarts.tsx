"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatInteger, formatPercent } from "@/lib/formatting/formatters";

type EChartOption = Record<string, unknown>;
type EChartInstance = {
  dispose: () => void;
  resize: () => void;
  setOption: (option: EChartOption, options?: unknown) => void;
};
type EChartsRuntime = {
  init: (
    node: HTMLDivElement,
    theme?: string | null,
    options?: Record<string, unknown>
  ) => EChartInstance;
  use: (components: unknown[]) => void;
};

const chartAxisColor = "#64748b";
const chartBorderColor = "#d8dee6";
const chartForegroundColor = "#111827";
let dashboardEchartsRuntimePromise: Promise<EChartsRuntime> | null = null;

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

export type DashboardCostPoint = {
  label: string;
  spendUsd: number;
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
  centerSubtextColor = chartAxisColor,
  centerTextColor = chartForegroundColor,
  rows,
  showCenterTitle = true,
  totalLabel = "requests"
}: {
  ariaLabel: string;
  centerSubtextColor?: string;
  centerTextColor?: string;
  rows: DashboardPieRow[];
  showCenterTitle?: boolean;
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
        show: showCenterTitle,
        subtext: totalLabel,
        subtextStyle: {
          color: centerSubtextColor,
          fontSize: 11,
          fontWeight: 800
        },
        text: formatInteger(total),
        textStyle: {
          color: centerTextColor,
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
    [centerSubtextColor, centerTextColor, rows, showCenterTitle, total, totalLabel]
  );

  return <DashboardEChart ariaLabel={ariaLabel} className="dashboard-pie-chart" option={option} />;
}

export function DashboardCostOverTimeEChart({
  ariaLabel,
  averageSpendUsd,
  points
}: {
  ariaLabel: string;
  averageSpendUsd: number;
  points: DashboardCostPoint[];
}) {
  const labels = points.map((point) => point.label);
  const values = points.map((point) => point.spendUsd);
  const averageValues = points.map(() => averageSpendUsd);
  const xAxisLabelInterval = readableCategoryInterval(labels.length);
  const option = useMemo<EChartOption>(
    () => ({
      animation: false,
      color: ["#3b82f6", "#94a3b8"],
      grid: {
        bottom: 26,
        left: 50,
        right: 14,
        top: 24
      },
      legend: {
        show: false
      },
      tooltip: {
        axisPointer: {
          type: "shadow"
        },
        backgroundColor: "rgba(17, 24, 39, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 1,
        confine: true,
        extraCssText: "box-shadow: 0 14px 30px rgba(15, 23, 42, 0.24); border-radius: 8px;",
        formatter: (params: unknown) => formatCostTooltip(params, averageSpendUsd),
        textStyle: {
          color: "#f8fafc",
          fontSize: 13,
          fontWeight: 800
        },
        trigger: "axis"
      },
      xAxis: {
        axisLabel: {
          color: "#94a3b8",
          fontSize: 12,
          fontWeight: 700,
          hideOverlap: true,
          interval: xAxisLabelInterval
        },
        axisLine: {
          lineStyle: {
            color: "rgba(148, 163, 184, 0.34)"
          }
        },
        axisTick: {
          show: false
        },
        data: labels,
        type: "category"
      },
      yAxis: {
        axisLabel: {
          color: "#94a3b8",
          fontSize: 12,
          formatter: formatCostAxisValue
        },
        axisLine: {
          show: false
        },
        axisTick: {
          show: false
        },
        splitLine: {
          lineStyle: {
            color: "rgba(148, 163, 184, 0.18)"
          }
        },
        type: "value"
      },
      series: [
        {
          barMaxWidth: 34,
          data: values,
          emphasis: {
            focus: "none"
          },
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: "#3b82f6"
          },
          label: {
            color: "#cbd5e1",
            formatter: (params: unknown) => {
              if (!isTooltipRecord(params)) {
                return "";
              }

              return formatCostUsd(Number(params.value ?? 0));
            },
            fontSize: 12,
            fontWeight: 800,
            position: "top",
            show: values.length <= 8
          },
          name: "Spend",
          type: "bar"
        },
        {
          data: averageValues,
          emphasis: {
            focus: "none"
          },
          lineStyle: {
            color: "#94a3b8",
            type: "dashed",
            width: 2
          },
          name: "Average",
          showSymbol: false,
          symbol: "none",
          type: "line"
        }
      ]
    }),
    [averageSpendUsd, averageValues, labels, values, xAxisLabelInterval]
  );

  return <DashboardEChart ariaLabel={ariaLabel} className="dashboard-cost-over-time-chart" option={option} />;
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
  const chartRef = useRef<EChartInstance | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const optionRef = useRef(option);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    optionRef.current = option;
    chartRef.current?.setOption(option, {
      lazyUpdate: true,
      notMerge: true
    });
  }, [option]);

  useEffect(() => {
    let isDisposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const node = nodeRef.current;
    if (!node) {
      return;
    }

    void loadDashboardEchartsRuntime().then((runtime) => {
      if (isDisposed) {
        return;
      }

      const chart = runtime.init(node, null, {
        renderer: "canvas",
        useDirtyRect: false
      });
      chartRef.current = chart;
      chart.setOption(optionRef.current, {
        lazyUpdate: true,
        notMerge: true
      });
      setIsReady(true);

      resizeObserver = new ResizeObserver(() => {
        chart.resize();
      });
      resizeObserver.observe(node);
    }).catch(() => undefined);

    return () => {
      isDisposed = true;
      resizeObserver?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return (
    <div
      aria-label={ariaLabel}
      className={className}
      data-chart-state={isReady ? "ready" : "loading"}
      ref={nodeRef}
      role="img"
    />
  );
}

function loadDashboardEchartsRuntime() {
  dashboardEchartsRuntimePromise ??= Promise.all([
    import("echarts/core"),
    import("echarts/charts"),
    import("echarts/components"),
    import("echarts/renderers")
  ]).then(([core, charts, components, renderers]) => {
    core.use([
      charts.BarChart,
      charts.LineChart,
      charts.PieChart,
      components.GridComponent,
      components.LegendComponent,
      components.TitleComponent,
      components.TooltipComponent,
      renderers.CanvasRenderer
    ]);

    return core as unknown as EChartsRuntime;
  });

  return dashboardEchartsRuntimePromise;
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

function formatCostAxisValue(value: string | number) {
  return formatCostUsd(Number(value ?? 0));
}

function readableCategoryInterval(count: number) {
  if (count <= 8) {
    return 0;
  }

  return Math.max(0, Math.ceil(count / 6) - 1);
}

function formatCostUsd(value: number) {
  if (!Number.isFinite(value)) {
    return "$0.00";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(value);
}

function formatCostTooltip(params: unknown, averageSpendUsd: number) {
  const items = Array.isArray(params) ? params : [params];
  const spend = items.find((item) => isTooltipRecord(item) && item.seriesName === "Spend");
  const label = isTooltipRecord(spend) ? String(spend.axisValueLabel ?? spend.name ?? "") : "";
  const spendValue = isTooltipRecord(spend) ? Number(spend.value ?? 0) : 0;

  return [
    label,
    `Spend: ${formatCostUsd(spendValue)}`,
    `Average: ${formatCostUsd(averageSpendUsd)}`
  ].filter(Boolean).join("<br/>");
}

function isTooltipRecord(value: unknown): value is {
  axisValueLabel?: unknown;
  name?: unknown;
  percent?: unknown;
  seriesName?: unknown;
  value?: unknown;
} {
  return typeof value === "object" && value !== null;
}

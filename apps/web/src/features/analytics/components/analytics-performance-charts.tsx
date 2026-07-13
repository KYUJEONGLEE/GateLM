"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

const axisColor = "#95a3b7";
const gridColor = "rgba(148, 163, 184, 0.14)";
const tooltipBackground = "rgba(8, 13, 22, 0.96)";
let analyticsEchartsRuntimePromise: Promise<EChartsRuntime> | null = null;

export function AnalyticsProviderLatencyBarChart({
  ariaLabel,
  rows
}: {
  ariaLabel: string;
  rows: AnalyticsProviderLatencyChartRow[];
}) {
  const option = useMemo<EChartOption>(
    () => ({
      animation: false,
      color: ["#8b5cf6"],
      grid: {
        bottom: 26,
        left: 58,
        right: 26,
        top: 12
      },
      tooltip: analyticsTooltip("ms"),
      xAxis: {
        axisLabel: {
          color: axisColor,
          fontSize: 14,
          fontWeight: 700,
          formatter: compactAxisNumber
        },
        axisLine: {
          lineStyle: {
            color: "rgba(148, 163, 184, 0.24)"
          }
        },
        axisTick: {
          show: false
        },
        splitLine: {
          lineStyle: {
            color: gridColor
          }
        },
        type: "value"
      },
      yAxis: {
        axisLabel: {
          color: "#d7dee9",
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
    [rows]
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
  const xAxisLabelInterval = readableCategoryInterval(points.length);
  const option = useMemo<EChartOption>(
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
          color: "#cbd5e1",
          fontSize: 14,
          fontWeight: 800
        },
        top: 0
      },
      tooltip: analyticsTooltip("ms"),
      xAxis: {
        axisLabel: {
          color: axisColor,
          fontSize: 14,
          fontWeight: 700,
          hideOverlap: true,
          interval: xAxisLabelInterval
        },
        axisLine: {
          lineStyle: {
            color: "rgba(148, 163, 184, 0.24)"
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
          color: axisColor,
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
            color: gridColor
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
    [points, xAxisLabelInterval]
  );

  return <AnalyticsEChart ariaLabel={ariaLabel} className="analytics-latency-distribution-chart" option={option} />;
}

function AnalyticsEChart({
  ariaLabel,
  className,
  option
}: {
  ariaLabel: string;
  className: string;
  option: EChartOption;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartInstance | null>(null);
  const optionRef = useRef(option);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    optionRef.current = option;
    chartRef.current?.setOption(option, true);
  }, [option]);

  useEffect(() => {
    let isDisposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    void loadAnalyticsEchartsRuntime().then((runtime) => {
      if (isDisposed) {
        return;
      }

      const chart = runtime.init(container, null, { renderer: "canvas" });
      chartRef.current = chart;
      chart.setOption(optionRef.current, true);
      setIsReady(true);

      resizeObserver = new ResizeObserver(() => chart.resize());
      resizeObserver.observe(container);
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
      className={`analytics-echart ${className}`}
      data-chart-state={isReady ? "ready" : "loading"}
      ref={containerRef}
      role="img"
    />
  );
}

function loadAnalyticsEchartsRuntime() {
  analyticsEchartsRuntimePromise ??= Promise.all([
    import("echarts/core"),
    import("echarts/charts"),
    import("echarts/components"),
    import("echarts/renderers")
  ]).then(([core, charts, components, renderers]) => {
    core.use([
      charts.BarChart,
      charts.LineChart,
      components.GridComponent,
      components.LegendComponent,
      components.TooltipComponent,
      renderers.CanvasRenderer
    ]);

    return core as unknown as EChartsRuntime;
  });

  return analyticsEchartsRuntimePromise;
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

function analyticsTooltip(unit: string) {
  return {
    axisPointer: {
      type: "line"
    },
    backgroundColor: tooltipBackground,
    borderColor: "rgba(148, 163, 184, 0.22)",
    borderWidth: 1,
    confine: true,
    extraCssText: "box-shadow: 0 18px 42px rgba(0, 0, 0, 0.42); border-radius: 8px;",
    textStyle: {
      color: "#f8fafc",
      fontSize: 14,
      fontWeight: 800
    },
    trigger: "axis",
    valueFormatter: (value: unknown) => `${formatNumber(Number(value ?? 0))} ${unit}`
  };
}

function compactAxisNumber(value: number) {
  if (Math.abs(value) >= 1000) {
    return `${Number((value / 1000).toFixed(1))}K`;
  }
  return `${Math.round(value)}`;
}

function readableCategoryInterval(count: number) {
  if (count <= 8) {
    return 0;
  }

  return Math.max(0, Math.ceil(count / 6) - 1);
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}

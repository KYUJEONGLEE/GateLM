"use client";

import { useEffect, useRef, useState } from "react";

export type AnalyticsEChartOption = Record<string, unknown>;

type EChartInstance = {
  dispose: () => void;
  resize: () => void;
  setOption: (option: AnalyticsEChartOption, options?: unknown) => void;
};

type EChartsRuntime = {
  init: (
    node: HTMLDivElement,
    theme?: string | null,
    options?: Record<string, unknown>
  ) => EChartInstance;
  use: (components: unknown[]) => void;
};

export type AnalyticsChartTheme = {
  axis: string;
  border: string;
  grid: string;
  label: string;
  tooltipBackground: string;
  tooltipBorder: string;
  tooltipText: string;
};

const analyticsChartThemes: Record<"light" | "dark", AnalyticsChartTheme> = {
  light: {
    axis: "#64748b",
    border: "rgba(100, 116, 139, 0.28)",
    grid: "rgba(100, 116, 139, 0.14)",
    label: "#334155",
    tooltipBackground: "rgba(255, 255, 255, 0.98)",
    tooltipBorder: "rgba(100, 116, 139, 0.26)",
    tooltipText: "#0f172a"
  },
  dark: {
    axis: "#9aa4b2",
    border: "rgba(148, 163, 184, 0.24)",
    grid: "rgba(148, 163, 184, 0.14)",
    label: "#d7dee9",
    tooltipBackground: "rgba(8, 13, 22, 0.96)",
    tooltipBorder: "rgba(148, 163, 184, 0.22)",
    tooltipText: "#f8fafc"
  }
};

let analyticsEchartsRuntimePromise: Promise<EChartsRuntime> | null = null;

export function AnalyticsEChart({
  ariaLabel,
  className,
  option
}: {
  ariaLabel: string;
  className: string;
  option: AnalyticsEChartOption;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartInstance | null>(null);
  const optionRef = useRef(option);
  const [isReady, setIsReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const resolvedOption = reduceMotion ? { ...option, animation: false } : option;
    optionRef.current = resolvedOption;
    chartRef.current?.setOption(resolvedOption, true);
  }, [option, reduceMotion]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let isDisposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    void loadAnalyticsEchartsRuntime()
      .then((runtime) => {
        if (isDisposed) {
          return;
        }

        const chart = runtime.init(container, null, { renderer: "svg" });
        chartRef.current = chart;
        chart.setOption(optionRef.current, true);
        setIsReady(true);

        resizeObserver = new ResizeObserver(() => chart.resize());
        resizeObserver.observe(container);
      })
      .catch(() => undefined);

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

export function useAnalyticsChartTheme() {
  const [themeName, setThemeName] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = () => {
      setThemeName(root.dataset.theme === "dark" ? "dark" : "light");
    };
    const observer = new MutationObserver(updateTheme);

    updateTheme();
    observer.observe(root, {
      attributeFilter: ["data-theme"],
      attributes: true
    });

    return () => observer.disconnect();
  }, []);

  return analyticsChartThemes[themeName];
}

export function analyticsTooltip(unit: string, theme: AnalyticsChartTheme) {
  return {
    axisPointer: {
      type: "line"
    },
    backgroundColor: theme.tooltipBackground,
    borderColor: theme.tooltipBorder,
    borderWidth: 1,
    confine: true,
    extraCssText: "box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28); border-radius: 8px;",
    textStyle: {
      color: theme.tooltipText,
      fontSize: 16,
      fontWeight: 800
    },
    trigger: "axis",
    valueFormatter: (value: unknown) => `${formatChartNumber(Number(value ?? 0))}${unit}`
  };
}

export function compactAxisNumber(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${Number((value / 1_000_000_000).toFixed(1))}B`;
  }
  if (absolute >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}M`;
  }
  if (absolute >= 1_000) {
    return `${Number((value / 1_000).toFixed(1))}K`;
  }

  return `${Math.round(value)}`;
}

export function formatAnalyticsRps(value: number) {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }
  if (Math.abs(value) >= 1_000) {
    return compactAxisNumber(value);
  }
  if (Math.abs(value) < 0.0001) {
    return value > 0 ? "<0.0001" : ">-0.0001";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
    maximumSignificantDigits: 3
  }).format(value);
}

export function formatChartNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
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
      charts.PieChart,
      components.GridComponent,
      components.LegendComponent,
      components.MarkLineComponent,
      components.TooltipComponent,
      renderers.SVGRenderer
    ]);

    return core as unknown as EChartsRuntime;
  });

  return analyticsEchartsRuntimePromise;
}

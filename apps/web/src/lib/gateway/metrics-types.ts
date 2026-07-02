export type MetricsFamilyStatus = "missing" | "present";

export type MetricsSample = {
  labels: Record<string, string>;
  metricName: string;
  unsafeLabelNames: string[];
  value: string;
};

export type MetricsFamily = {
  help: string | null;
  name: string;
  sampleCount: number;
  samples: MetricsSample[];
  status: MetricsFamilyStatus;
  type: string | null;
};

export type GatewayMetricsModel = {
  checkedAt: string;
  families: MetricsFamily[];
  loadError: string | null;
  meta: {
    httpStatus: number | null;
  };
  routeTenantId: string;
  summary: {
    forbiddenLabelNames: string[];
    missingFamilyCount: number;
    presentFamilyCount: number;
    seriesCount: number;
  };
};

import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import type { LiveAnalyticsRange } from "@/lib/gateway/live-analytics-performance";
import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";

type AnalyticsV5InvocationRecord = Pick<
  LiveInvocationLogRecord,
  "createdAt" | "modelRef" | "requestedModel"
>;

export type AnalyticsV5ModelSeries = {
  id: string;
  label: string;
  total: number;
  values: number[];
};

export type AnalyticsV5Evidence = {
  modelTraffic: {
    bucketStarts: string[];
    series: AnalyticsV5ModelSeries[];
  };
};

const bucketCountByRange: Record<LiveAnalyticsRange, number> = {
  "15m": 15,
  "1h": 12,
  "1d": 24,
  "1w": 7
};

const MAX_MODEL_SERIES = 5;

export function buildAnalyticsV5Evidence(
  records: AnalyticsV5InvocationRecord[],
  input: { from: string; range: LiveAnalyticsRange; to: string }
): AnalyticsV5Evidence {
  const fromMs = Date.parse(input.from);
  const toMs = Date.parse(input.to);
  const bucketCount = bucketCountByRange[input.range];
  const intervalMs = Math.max(1, (toMs - fromMs) / bucketCount);
  const usableRecords = records.filter((record) => {
    const createdAt = Date.parse(record.createdAt);
    return Number.isFinite(createdAt) && createdAt >= fromMs && createdAt < toMs;
  });
  const modelTotals = new Map<string, number>();

  usableRecords.forEach((record) => {
    const model = normalizedModel(record);
    if (model) {
      modelTotals.set(model, (modelTotals.get(model) ?? 0) + 1);
    }
  });

  const rankedModels = [...modelTotals.entries()]
    .sort((left, right) => right[1] - left[1]);
  const visibleModelNames = rankedModels.length > MAX_MODEL_SERIES
    ? rankedModels.slice(0, MAX_MODEL_SERIES - 1).map(([model]) => model)
    : rankedModels.map(([model]) => model);
  const includesOther = rankedModels.length > MAX_MODEL_SERIES;
  const seriesNames = includesOther ? [...visibleModelNames, "Other"] : visibleModelNames;
  const valuesBySeries = new Map(seriesNames.map((model) => [model, Array(bucketCount).fill(0) as number[]]));

  usableRecords.forEach((record) => {
    const model = normalizedModel(record);
    if (!model) {
      return;
    }

    const createdAt = Date.parse(record.createdAt);
    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor((createdAt - fromMs) / intervalMs)));
    const seriesName = visibleModelNames.includes(model) ? model : includesOther ? "Other" : model;
    const values = valuesBySeries.get(seriesName);
    if (values) {
      values[bucketIndex] += 1;
    }
  });

  return {
    modelTraffic: {
      bucketStarts: Array.from({ length: bucketCount }, (_, index) =>
        new Date(fromMs + intervalMs * index).toISOString()),
      series: seriesNames.map((model) => ({
        id: model,
        label: model,
        total: valuesBySeries.get(model)?.reduce((sum, value) => sum + value, 0) ?? 0,
        values: valuesBySeries.get(model) ?? []
      }))
    }
  };
}

function normalizedModel(record: AnalyticsV5InvocationRecord) {
  const model = record.modelRef?.trim() || record.requestedModel?.trim();
  return model ? formatModelDisplayName(model) : null;
}

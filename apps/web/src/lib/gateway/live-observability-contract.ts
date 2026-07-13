import type { InvocationLogRecord as LegacyInvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";

export const routingCategories = [
  "general",
  "code",
  "translation",
  "summarization",
  "reasoning"
] as const;

export type RoutingCategory = (typeof routingCategories)[number];
export type RoutingDifficulty = "simple" | "complex";

export type RequestRoutingSummary = {
  requestedModel: string | null;
  category: RoutingCategory;
  difficulty: RoutingDifficulty;
  modelRef: string | null;
  routingReason: string | null;
};

export type ProviderAttempt = {
  providerId: string;
  modelId: string;
  outcome: string;
  latencyMs: number | null;
  sanitizedErrorCode: string | null;
};

export type DashboardRoutingSummary = {
  category: RoutingCategory;
  difficulty: RoutingDifficulty;
  routingReason: string;
  requestCount: number;
};

export type ModelCostRow = {
  provider: string;
  model: string;
  requestCount: number;
  totalTokens: number;
  costMicroUsd: number;
  costUsd: string;
};

export type ProviderModelAggregate = {
  provider: string;
  model: string;
  requestCount: number;
  p95ProviderLatencyMs: number;
};

type RetainedInvocationLogKey = {
  [Key in keyof LegacyInvocationLogRecord]-?: Key extends `selected${string}`
    ? never
    : Key extends `requested${"Provider"}` | `prompt${"Category"}`
      ? never
      : Key;
}[keyof LegacyInvocationLogRecord];

export type LiveInvocationLogRecord = Pick<LegacyInvocationLogRecord, RetainedInvocationLogKey> & {
  category: RoutingCategory;
  difficulty: RoutingDifficulty;
  modelRef: string | null;
  providerAttempt: ProviderAttempt | null;
};

export function normalizeRequestRouting(value: unknown): RequestRoutingSummary {
  const record = toRecord(value);
  return {
    requestedModel: nullableString(record.requestedModel),
    category: normalizeRoutingCategory(record.category),
    difficulty: normalizeRoutingDifficulty(record.difficulty),
    modelRef: nullableString(record.modelRef),
    routingReason: nullableString(record.routingReason)
  };
}

export function normalizeRequestDetailRouting(
  requestedModel: unknown,
  routingEvidence: unknown
): RequestRoutingSummary {
  return normalizeRequestRouting({
    ...toRecord(routingEvidence),
    requestedModel
  });
}

export function normalizeProviderAttempt(value: unknown): ProviderAttempt | null {
  const record = toRecord(value);
  const providerId = nullableString(record.providerId);
  const modelId = nullableString(record.modelId);

  if (!providerId || !modelId) {
    return null;
  }

  return {
    providerId,
    modelId,
    outcome: nullableString(record.outcome) ?? "unknown",
    latencyMs: nullableNonNegativeNumber(record.latencyMs),
    sanitizedErrorCode: nullableString(record.sanitizedErrorCode)
  };
}

export function normalizeDashboardRoutingSummaries(value: unknown): DashboardRoutingSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const record = toRecord(item);
    return {
      category: normalizeRoutingCategory(record.category),
      difficulty: normalizeRoutingDifficulty(record.difficulty),
      routingReason: nullableString(record.routingReason) ?? "not-set",
      requestCount: nonNegativeInteger(record.requestCount)
    };
  });
}

export function normalizeModelCostRows(value: unknown): ModelCostRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const record = toRecord(item);
    const provider = nullableString(record.provider);
    const model = nullableString(record.model);
    if (!provider || !model) {
      return [];
    }

    const costMicroUsd = nonNegativeNumber(record.costMicroUsd);
    return [{
      provider,
      model,
      requestCount: nonNegativeInteger(record.requestCount),
      totalTokens: nonNegativeInteger(record.totalTokens),
      costMicroUsd,
      costUsd: nullableString(record.costUsd) ?? (costMicroUsd / 1_000_000).toFixed(6)
    }];
  });
}

export function normalizeProviderModelAggregates(value: unknown): ProviderModelAggregate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const record = toRecord(item);
    const provider = nullableString(record.provider);
    const model = nullableString(record.model);
    if (!provider || !model) {
      return [];
    }

    return [{
      provider,
      model,
      requestCount: nonNegativeInteger(record.requestCount),
      p95ProviderLatencyMs: nonNegativeNumber(record.p95ProviderLatencyMs)
    }];
  });
}

export function normalizeRoutingCategory(value: unknown): RoutingCategory {
  return typeof value === "string" && (routingCategories as readonly string[]).includes(value)
    ? value as RoutingCategory
    : "general";
}

export function normalizeRoutingDifficulty(value: unknown): RoutingDifficulty {
  return value === "complex" ? "complex" : "simple";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function nullableNonNegativeNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : nonNegativeNumber(value);
}

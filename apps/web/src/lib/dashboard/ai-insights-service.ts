import "server-only";

import {
  buildMockAiInsights,
  type AiInsightResponse,
  type AiInsightsRecentRequest,
  type AiInsightsRequest,
  normalizeAiInsightContent
} from "@/lib/dashboard/ai-insights-types";

type AiInsightsProviderConfig = {
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  model: string;
  provider: string;
  timeoutMs: number;
};

const DEFAULT_AI_INSIGHTS_MODEL = "gpt-5.5";
const DEFAULT_AI_INSIGHTS_TIMEOUT_MS = 8_000;
const MAX_AI_INSIGHTS_TIMEOUT_MS = 20_000;
const MIN_AI_INSIGHTS_TIMEOUT_MS = 1_000;

const aiInsightsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "signals", "recommendations", "policyDraft", "notes"],
  properties: {
    summary: {
      type: "string",
      maxLength: 560
    },
    signals: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "level", "reason"],
        properties: {
          label: { type: "string", maxLength: 80 },
          level: { type: "string", enum: ["Low", "Medium", "High"] },
          reason: { type: "string", maxLength: 180 }
        }
      }
    },
    recommendations: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "text", "priority"],
        properties: {
          category: { type: "string", enum: ["Routing", "Cache", "Reliability", "Safety", "Cost"] },
          text: { type: "string", maxLength: 220 },
          priority: { type: "string", enum: ["Low", "Medium", "High"] }
        }
      }
    },
    policyDraft: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string", maxLength: 220 }
    },
    notes: {
      type: "array",
      maxItems: 4,
      items: { type: "string", maxLength: 220 }
    }
  }
} as const;

export function normalizeAiInsightsRequest(value: unknown): AiInsightsRequest | null {
  const record = asRecord(value);
  const summaryRecord = asRecord(record?.summary);

  if (!record || !summaryRecord) {
    return null;
  }

  return {
    projectId: normalizeOptionalText(record.projectId, 120),
    projectName: normalizeOptionalText(record.projectName, 120),
    recentRequests: normalizeRecentRequests(record.recentRequests),
    summary: {
      avgLatencyMs: normalizeNonNegativeNumber(summaryRecord.avgLatencyMs),
      cacheHitRate: normalizeRate(summaryRecord.cacheHitRate),
      monthToDateSpendUsd: normalizeNonNegativeNumber(summaryRecord.monthToDateSpendUsd),
      p95LatencyMs: normalizeNonNegativeNumber(summaryRecord.p95LatencyMs),
      successRate: normalizeRate(summaryRecord.successRate),
      totalRequests: normalizeNonNegativeNumber(summaryRecord.totalRequests)
    },
    tenantId: normalizeOptionalText(record.tenantId, 120),
    timeRange: normalizeText(record.timeRange, 80) || "selected range"
  };
}

export async function createDashboardAiInsights(request: AiInsightsRequest): Promise<AiInsightResponse> {
  const generatedAt = new Date().toISOString();

  if (request.summary.totalRequests <= 0) {
    return buildMockAiInsights(request, {
      generatedAt,
      mode: "mock",
      notes: ["분석할 요청 데이터가 부족해 provider를 호출하지 않았습니다."]
    });
  }

  const config = getProviderConfig();

  if (!config.enabled || !config.apiKey) {
    return buildMockAiInsights(request, {
      generatedAt,
      mode: "mock",
      notes: ["AI Insights live mode is disabled or no server-side API key is configured."]
    });
  }

  if (config.provider !== "openai") {
    return buildMockAiInsights(request, {
      generatedAt,
      mode: "mock",
      notes: [`AI Insights provider '${config.provider}' is not supported yet. Showing mock insight.`]
    });
  }

  try {
    const content = await callOpenAiResponses(config, request);

    return {
      ...content,
      generatedAt: new Date().toISOString(),
      mode: "live",
      notes: [
        ...(content.notes ?? []),
        "Aggregated dashboard metrics only. No raw prompt, raw response, or provider secret was sent."
      ]
    };
  } catch (error) {
    console.warn("AI insights provider call failed", {
      reason: safeProviderFailureReason(error)
    });

    return buildMockAiInsights(request, {
      generatedAt: new Date().toISOString(),
      mode: "fallback",
      notes: ["Live AI provider failed or returned invalid JSON. Showing safe fallback insight."]
    });
  }
}

async function callOpenAiResponses(
  config: AiInsightsProviderConfig,
  request: AiInsightsRequest
): Promise<Omit<AiInsightResponse, "generatedAt" | "mode">> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/responses`, {
      body: JSON.stringify({
        input: buildUserPrompt(request),
        instructions: buildSystemPrompt(),
        max_output_tokens: 900,
        model: config.model,
        store: false,
        text: {
          format: {
            description: "Operational dashboard insight for GateLM administrators.",
            name: "gatelm_ai_insights",
            schema: aiInsightsJsonSchema,
            strict: true,
            type: "json_schema"
          }
        }
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`provider_status_${response.status}`);
    }

    const payload = await response.json().catch(() => {
      throw new Error("provider_json_decode_failed");
    });
    const outputText = extractOpenAiResponseText(payload);

    if (!outputText) {
      throw new Error("provider_text_missing");
    }

    const parsed = JSON.parse(outputText) as unknown;
    const normalized = normalizeAiInsightContent(parsed);

    if (!normalized) {
      throw new Error("provider_schema_invalid");
    }

    return normalized;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSystemPrompt() {
  return [
    "You are an LLMOps Gateway operations dashboard analyst.",
    "Analyze only the provided aggregate metrics and sanitized recent request summaries.",
    "Never infer from raw prompts or raw responses; they are intentionally unavailable.",
    "Focus on cost, latency, cache, routing, reliability, and safety.",
    "Do not exaggerate. If the evidence is weak, say so briefly.",
    "Return Korean text inside a single JSON object that matches the provided schema.",
    "Do not include markdown, code fences, secrets, credentials, raw provider errors, or any extra keys."
  ].join(" ");
}

function buildUserPrompt(request: AiInsightsRequest) {
  const safePayload = {
    projectId: request.projectId ?? null,
    projectName: request.projectName ?? null,
    recentRequests: request.recentRequests.map((row) => ({
      cacheStatus: row.cacheStatus ?? null,
      costUsd: row.costUsd ?? 0,
      latencyMs: row.latencyMs ?? 0,
      model: row.model ?? null,
      projectName: row.projectName ?? null,
      provider: row.provider ?? null,
      requestId: row.requestId,
      safetyAction: row.safetyAction ?? null,
      statusCode: row.statusCode ?? 0,
      timestamp: row.timestamp,
      totalTokens: row.totalTokens ?? 0
    })),
    summary: request.summary,
    timeRange: request.timeRange
  };

  return `Analyze this sanitized GateLM dashboard data and return JSON only: ${JSON.stringify(safePayload)}`;
}

function extractOpenAiResponseText(payload: unknown) {
  const record = asRecord(payload);
  if (!record) {
    return "";
  }

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const output = Array.isArray(record.output) ? record.output : [];
  const textParts: string[] = [];

  for (const outputItem of output) {
    const outputRecord = asRecord(outputItem);
    const content = Array.isArray(outputRecord?.content) ? outputRecord.content : [];

    for (const contentItem of content) {
      const contentRecord = asRecord(contentItem);
      if (typeof contentRecord?.text === "string") {
        textParts.push(contentRecord.text);
      }
    }
  }

  return textParts.join("").trim();
}

function getProviderConfig(): AiInsightsProviderConfig {
  return {
    apiKey: optionalEnv("AI_INSIGHTS_API_KEY") ?? optionalEnv("OPENAI_API_KEY") ?? "",
    baseUrl: trimTrailingSlash(optionalEnv("AI_INSIGHTS_BASE_URL") ?? "https://api.openai.com/v1"),
    enabled: parseBooleanEnv("AI_INSIGHTS_ENABLED", true),
    model: optionalEnv("AI_INSIGHTS_MODEL") ?? DEFAULT_AI_INSIGHTS_MODEL,
    provider: (optionalEnv("AI_INSIGHTS_PROVIDER") ?? "openai").toLowerCase(),
    timeoutMs: clampTimeout(optionalEnv("AI_INSIGHTS_TIMEOUT_MS"))
  };
}

function normalizeRecentRequests(value: unknown): AiInsightsRecentRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 10).flatMap((item) => {
    const record = asRecord(item);
    const requestId = normalizeText(record?.requestId, 160);
    const timestamp = normalizeText(record?.timestamp, 80);

    if (!requestId || !timestamp) {
      return [];
    }

    return [{
      cacheStatus: normalizeOptionalText(record?.cacheStatus, 40) ?? undefined,
      costUsd: normalizeNonNegativeNumber(record?.costUsd),
      latencyMs: normalizeNonNegativeNumber(record?.latencyMs),
      model: normalizeOptionalText(record?.model, 120) ?? undefined,
      projectName: normalizeOptionalText(record?.projectName, 120) ?? undefined,
      provider: normalizeOptionalText(record?.provider, 80) ?? undefined,
      requestId,
      safetyAction: normalizeOptionalText(record?.safetyAction, 40) ?? undefined,
      statusCode: normalizeNonNegativeNumber(record?.statusCode),
      timestamp,
      totalTokens: normalizeNonNegativeNumber(record?.totalTokens)
    }];
  });
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseBooleanEnv(name: string, defaultValue: boolean) {
  const value = optionalEnv(name);
  if (!value) {
    return defaultValue;
  }

  return !["0", "false", "no", "off", "disabled"].includes(value.toLowerCase());
}

function clampTimeout(value: string | undefined) {
  const parsed = Number(value ?? DEFAULT_AI_INSIGHTS_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AI_INSIGHTS_TIMEOUT_MS;
  }

  return Math.min(MAX_AI_INSIGHTS_TIMEOUT_MS, Math.max(MIN_AI_INSIGHTS_TIMEOUT_MS, parsed));
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function safeProviderFailureReason(error: unknown) {
  if (error instanceof Error && /^provider_[a-z0-9_]+$/i.test(error.message)) {
    return error.message;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return "provider_timeout";
  }

  return "provider_unavailable";
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  const text = normalizeText(value, maxLength);
  return text || null;
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function normalizeNonNegativeNumber(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, parsed);
}

function normalizeRate(value: unknown) {
  const parsed = normalizeNonNegativeNumber(value);
  return Math.min(1, parsed);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

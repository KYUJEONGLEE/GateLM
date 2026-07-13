import type { LiveRequestRow } from "@/lib/gateway/live-requests-types";
import type { Locale } from "@/lib/i18n/locale";

export type AiInsightMode = "fallback" | "live" | "mock";
export type AiInsightLevel = "High" | "Low" | "Medium";
export type AiInsightCategory = "Cache" | "Cost" | "Reliability" | "Routing" | "Safety";
export type AiInsightPriority = "High" | "Low" | "Medium";

export type AiInsightsRequest = {
  projectId?: string | null;
  projectName?: string | null;
  recentRequests: AiInsightsRecentRequest[];
  summary: {
    avgLatencyMs: number;
    cacheHitRate?: number;
    monthToDateSpendUsd: number;
    p95LatencyMs?: number;
    successRate: number;
    totalRequests: number;
  };
  tenantId?: string | null;
  timeRange: string;
};

export type AiInsightsRecentRequest = {
  cacheStatus?: string;
  costUsd?: number;
  latencyMs?: number;
  model?: string;
  projectName?: string;
  provider?: string;
  requestId: string;
  safetyAction?: string;
  statusCode?: number;
  timestamp: string;
  totalTokens?: number;
};

export type AiInsightSignal = {
  label: string;
  level: AiInsightLevel;
  reason?: string;
};

export type AiInsightRecommendation = {
  category: AiInsightCategory;
  priority: AiInsightPriority;
  text: string;
};

export type AiInsightResponse = {
  generatedAt: string;
  mode: AiInsightMode;
  notes?: string[];
  policyDraft: string[];
  recommendations: AiInsightRecommendation[];
  signals: AiInsightSignal[];
  summary: string;
};

const insightLevels = ["High", "Low", "Medium"] as const;
const insightCategories = ["Cache", "Cost", "Reliability", "Routing", "Safety"] as const;
const insightPriorities = ["High", "Low", "Medium"] as const;

type MockInsightOptions = {
  generatedAt?: string;
  locale?: Locale;
  mode?: Extract<AiInsightMode, "fallback" | "mock">;
  notes?: string[];
};

export function toAiInsightsRecentRequests(rows: LiveRequestRow[] | undefined): AiInsightsRecentRequest[] {
  return (rows ?? []).slice(0, 5).map((row) => ({
    cacheStatus: row.cacheStatus,
    costUsd: normalizeNonNegativeNumber(row.costUsd),
    latencyMs: normalizeNonNegativeNumber(row.latencyMs),
    model: row.model,
    projectName: row.projectName,
    provider: row.providerLabel,
    requestId: row.requestId,
    safetyAction: row.safetyAction,
    statusCode: normalizeNonNegativeNumber(row.statusCode),
    timestamp: row.timestamp,
    totalTokens: normalizeNonNegativeNumber(row.totalTokens)
  }));
}

export function buildMockAiInsights(
  request: AiInsightsRequest,
  options: MockInsightOptions = {}
): AiInsightResponse {
  const summary = normalizeSummary(request.summary);
  const scopeLabel = request.projectName ? `${request.projectName} 프로젝트` : "전체 프로젝트";
  const failedRecentCount = request.recentRequests.filter((row) => (row.statusCode ?? 0) >= 500).length;
  const blockedRecentCount = request.recentRequests.filter(
    (row) => row.safetyAction === "BLOCKED" || row.statusCode === 403
  ).length;
  const cacheHitCount = request.recentRequests.filter((row) => row.cacheStatus === "HIT").length;
  const reliabilityRisk = summary.successRate < 0.95 || failedRecentCount > 0
    ? "High"
    : summary.successRate < 0.985
      ? "Medium"
      : "Low";
  const latencyRisk = summary.avgLatencyMs >= 1_500 || (summary.p95LatencyMs ?? 0) >= 3_000
    ? "High"
    : summary.avgLatencyMs >= 800 || (summary.p95LatencyMs ?? 0) >= 1_500
      ? "Medium"
      : "Low";
  const costRisk = summary.monthToDateSpendUsd >= 50
    ? "High"
    : summary.monthToDateSpendUsd >= 10
      ? "Medium"
      : "Low";
  const cacheOpportunity = summary.cacheHitRate < 0.2 && cacheHitCount === 0
    ? "High"
    : summary.cacheHitRate < 0.5
      ? "Medium"
      : "Low";

  if (options.locale === "en") {
    const englishScopeLabel = request.projectName
      ? `${request.projectName} project`
      : "All projects";

    return {
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      mode: options.mode ?? "mock",
      notes: options.notes ?? ["Uses aggregate metrics and recent request summaries only. Raw prompts and responses are excluded."],
      policyDraft: [
        `Consider low-cost routing first for simple ${request.projectName ?? "support"} requests.`,
        "Keep a fallback route available for provider errors.",
        blockedRecentCount > 0
          ? "Recent blocked requests were found. Keep the safety policy enabled and review detector summaries."
          : "Keep request-side safety checks enabled for high-risk input patterns."
      ],
      recommendations: [
        {
          category: reliabilityRisk === "High" ? "Reliability" : "Routing",
          priority: reliabilityRisk,
          text: reliabilityRisk === "High"
            ? "Review recent failed requests before increasing traffic."
            : "Success is stable. Keep the current routing rules and review cost opportunities."
        },
        {
          category: costRisk === "High" ? "Cost" : "Routing",
          priority: costRisk,
          text: costRisk === "High"
            ? "Month-to-date cost is rising. Review the highest-cost models by project first."
            : "Repeated simple requests may be candidates for low-cost routing."
        },
        {
          category: cacheOpportunity === "High" ? "Cache" : "Safety",
          priority: cacheOpportunity,
          text: cacheOpportunity === "High"
            ? "Cache hit rate is low. Separate repeated FAQ-style requests as exact-cache candidates."
            : "Keep the current safety and cache policies while monitoring recent request distribution."
        }
      ],
      signals: [
        {
          label: "Cost risk",
          level: costRisk,
          reason: `Month-to-date cost is $${summary.monthToDateSpendUsd.toFixed(2)}.`
        },
        {
          label: "Latency risk",
          level: latencyRisk,
          reason: `Average ${Math.round(summary.avgLatencyMs)} ms, p95 ${Math.round(summary.p95LatencyMs ?? 0)} ms.`
        },
        {
          label: "Reliability risk",
          level: reliabilityRisk,
          reason: `${(summary.successRate * 100).toFixed(1)}% success rate with ${failedRecentCount} recent 5xx requests.`
        }
      ],
      summary: buildEnglishSummaryText({
        failedRecentCount,
        request,
        scopeLabel: englishScopeLabel,
        summary
      })
    };
  }

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    mode: options.mode ?? "mock",
    notes: options.notes ?? ["집계 지표와 최근 요청 요약만 사용했습니다. raw prompt/response는 포함하지 않습니다."],
    policyDraft: [
      `단순 ${request.projectName ? request.projectName : "지원"} 요청은 저비용 모델 우선 라우팅 후보로 검토하세요.`,
      "프로바이더 오류에 대비해 fallback 경로를 유지하세요.",
      blockedRecentCount > 0
        ? "최근 차단 요청이 있으므로 안전 정책을 유지하고 detector 요약을 확인하세요."
        : "고위험 입력 패턴은 request-side safety 검사를 유지하세요."
    ],
    recommendations: [
      {
        category: reliabilityRisk === "High" ? "Reliability" : "Routing",
        priority: reliabilityRisk,
        text: reliabilityRisk === "High"
          ? "최근 실패 요청을 먼저 확인한 뒤 트래픽을 늘리는 것이 좋습니다."
          : "성공률이 안정적이면 현재 라우팅 규칙을 유지하고 비용 후보만 점검하세요."
      },
      {
        category: costRisk === "High" ? "Cost" : "Routing",
        priority: costRisk,
        text: costRisk === "High"
          ? "월 누적 비용이 높아지고 있으므로 프로젝트별 비용 상위 모델을 먼저 확인하세요."
          : "반복적인 단순 요청은 저비용 모델 우선 라우팅 후보로 볼 수 있습니다."
      },
      {
        category: cacheOpportunity === "High" ? "Cache" : "Safety",
        priority: cacheOpportunity,
        text: cacheOpportunity === "High"
          ? "캐시 적중이 낮습니다. 반복 FAQ형 요청이 있다면 exact cache 후보로 분리하세요."
          : "현재 안전 정책과 캐시 정책은 유지하면서 최근 요청 분포를 계속 확인하세요."
      }
    ],
    signals: [
      {
        label: "비용 위험도",
        level: costRisk,
        reason: `이번 달 누적 비용은 $${summary.monthToDateSpendUsd.toFixed(2)}입니다.`
      },
      {
        label: "지연 위험도",
        level: latencyRisk,
        reason: `평균 ${Math.round(summary.avgLatencyMs)}ms, p95 ${Math.round(summary.p95LatencyMs ?? 0)}ms 기준입니다.`
      },
      {
        label: "안정성 위험도",
        level: reliabilityRisk,
        reason: `성공률 ${(summary.successRate * 100).toFixed(1)}%, 최근 500 계열 ${failedRecentCount}건입니다.`
      }
    ],
    summary: buildSummaryText({
      failedRecentCount,
      request,
      scopeLabel,
      summary
    })
  };
}

function buildEnglishSummaryText({
  failedRecentCount,
  request,
  scopeLabel,
  summary
}: {
  failedRecentCount: number;
  request: AiInsightsRequest;
  scopeLabel: string;
  summary: ReturnType<typeof normalizeSummary>;
}) {
  if (summary.totalRequests <= 0) {
    return `${scopeLabel} does not have enough request data yet. Send a few Gateway requests and analyze again.`;
  }

  if (summary.successRate < 0.95 || failedRecentCount > 0) {
    return `Analyzed ${formatCompactNumber(summary.totalRequests)} requests for ${scopeLabel}. Review recent failures before increasing traffic.`;
  }

  return `Analyzed ${formatCompactNumber(summary.totalRequests)} requests for ${scopeLabel}. Traffic was generally stable over ${request.timeRange}; review cost and cache efficiency together.`;
}

export function isAiInsightResponse(value: unknown): value is AiInsightResponse {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  return (
    isAiInsightMode(record.mode) &&
    typeof record.generatedAt === "string" &&
    typeof record.summary === "string" &&
    isSignalArray(record.signals) &&
    isRecommendationArray(record.recommendations) &&
    isStringArray(record.policyDraft) &&
    (record.notes === undefined || isStringArray(record.notes))
  );
}

export function normalizeAiInsightContent(value: unknown): Omit<AiInsightResponse, "generatedAt" | "mode"> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const signals = normalizeSignals(record.signals);
  const recommendations = normalizeRecommendations(record.recommendations);
  const policyDraft = normalizeStringList(record.policyDraft, 5);
  const summary = normalizeText(record.summary, 560);

  if (!summary || signals.length === 0 || recommendations.length === 0 || policyDraft.length === 0) {
    return null;
  }

  return {
    notes: normalizeStringList(record.notes, 4),
    policyDraft,
    recommendations,
    signals,
    summary
  };
}

function buildSummaryText({
  failedRecentCount,
  request,
  scopeLabel,
  summary
}: {
  failedRecentCount: number;
  request: AiInsightsRequest;
  scopeLabel: string;
  summary: ReturnType<typeof normalizeSummary>;
}) {
  if (summary.totalRequests <= 0) {
    return `${scopeLabel}에서 아직 분석할 요청 데이터가 부족합니다. Gateway 요청을 몇 개 보낸 뒤 다시 분석하세요.`;
  }

  if (summary.successRate < 0.95 || failedRecentCount > 0) {
    return `${scopeLabel} 기준 ${formatCompactNumber(summary.totalRequests)}건을 분석했습니다. 최근 실패 요청이 있어 트래픽 확대 전 원인 확인이 필요합니다.`;
  }

  return `${scopeLabel} 기준 ${formatCompactNumber(summary.totalRequests)}건을 분석했습니다. ${request.timeRange} 동안 트래픽은 대체로 안정적이며 비용과 캐시 효율을 함께 점검할 수 있습니다.`;
}

function normalizeSummary(summary: AiInsightsRequest["summary"]) {
  return {
    avgLatencyMs: normalizeNonNegativeNumber(summary.avgLatencyMs),
    cacheHitRate: clampRate(summary.cacheHitRate ?? 0),
    monthToDateSpendUsd: normalizeNonNegativeNumber(summary.monthToDateSpendUsd),
    p95LatencyMs: normalizeNonNegativeNumber(summary.p95LatencyMs),
    successRate: clampRate(summary.successRate),
    totalRequests: normalizeNonNegativeNumber(summary.totalRequests)
  };
}

function normalizeSignals(value: unknown): AiInsightSignal[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 5).flatMap((item) => {
    const record = asRecord(item);
    const label = normalizeText(record?.label, 80);
    const level = normalizeInsightLevel(record?.level);
    const reason = normalizeText(record?.reason, 180);

    if (!label || !level) {
      return [];
    }

    return [{ label, level, reason: reason || undefined }];
  });
}

function normalizeRecommendations(value: unknown): AiInsightRecommendation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 5).flatMap((item) => {
    const record = asRecord(item);
    const category = normalizeCategory(record?.category);
    const priority = normalizePriority(record?.priority);
    const text = normalizeText(record?.text, 220);

    if (!category || !priority || !text) {
      return [];
    }

    return [{ category, priority, text }];
  });
}

function normalizeStringList(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, limit)
    .map((item) => normalizeText(item, 220))
    .filter(Boolean);
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function isSignalArray(value: unknown): value is AiInsightSignal[] {
  return Array.isArray(value) && value.every((item) => {
    const record = asRecord(item);
    return Boolean(record && typeof record.label === "string" && isInsightLevel(record.level));
  });
}

function isRecommendationArray(value: unknown): value is AiInsightRecommendation[] {
  return Array.isArray(value) && value.every((item) => {
    const record = asRecord(item);
    return Boolean(
      record &&
      isCategory(record.category) &&
      isPriority(record.priority) &&
      typeof record.text === "string"
    );
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAiInsightMode(value: unknown): value is AiInsightMode {
  return value === "fallback" || value === "live" || value === "mock";
}

function normalizeInsightLevel(value: unknown): AiInsightLevel | null {
  return isInsightLevel(value) ? value : null;
}

function isInsightLevel(value: unknown): value is AiInsightLevel {
  return insightLevels.includes(value as AiInsightLevel);
}

function normalizeCategory(value: unknown): AiInsightCategory | null {
  return isCategory(value) ? value : null;
}

function isCategory(value: unknown): value is AiInsightCategory {
  return insightCategories.includes(value as AiInsightCategory);
}

function normalizePriority(value: unknown): AiInsightPriority | null {
  return isPriority(value) ? value : null;
}

function isPriority(value: unknown): value is AiInsightPriority {
  return insightPriorities.includes(value as AiInsightPriority);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeNonNegativeNumber(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function clampRate(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 1,
    notation: "compact"
  }).format(value);
}

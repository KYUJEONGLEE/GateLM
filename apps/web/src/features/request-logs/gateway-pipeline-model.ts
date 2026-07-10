import type {
  DomainOutcome,
  InvocationLogRecord
} from "@/lib/fixtures/v1-observability-fixtures";

export type GatewayPipelineStageId =
  | "request"
  | "authentication"
  | "guardrails"
  | "decision"
  | "cache"
  | "adapter"
  | "provider";

export type GatewayPipelineTone =
  | "success"
  | "policy"
  | "warning"
  | "error"
  | "skipped"
  | "neutral";

export type GatewayPipelineStage = {
  description: string;
  emphasized?: boolean;
  id: GatewayPipelineStageId;
  statusLabel: string;
  title: string;
  tone: GatewayPipelineTone;
};

export type GatewayPipelineFallback = {
  outcome: string;
  reason: string | null;
  tone: GatewayPipelineTone;
};

export type GatewayPipelineFlow = {
  cacheOutcome: string;
  route: "provider" | "cache" | "stopped";
  stopStageId: GatewayPipelineStageId;
};

export type GatewayPipelineModel = {
  fallback: GatewayPipelineFallback | null;
  flow: GatewayPipelineFlow;
  stages: GatewayPipelineStage[];
};

type ProviderCallState = "called" | "not_called" | "unknown";

const successOutcomes = new Set([
  "allowed",
  "authenticated",
  "passed",
  "selected",
  "snapshot_active",
  "success",
  "written"
]);
const skippedOutcomes = new Set([
  "bypassed",
  "not_called",
  "not_checked",
  "not_started",
  "not_used",
  "skipped"
]);
const errorOutcomes = new Set([
  "blocked",
  "denied",
  "error",
  "failed",
  "invalid_api_key",
  "invalid_app_token",
  "no_snapshot",
  "scope_mismatch",
  "timeout",
  "unauthorized"
]);
const warningOutcomes = new Set([
  "degraded",
  "masked",
  "masking_applied",
  "queued",
  "rate_limited",
  "redacted",
  "warned"
]);
const hiddenFallbackOutcomes = new Set([
  ...skippedOutcomes,
  "disabled",
  "not_needed"
]);
const providerReachedOutcomes = new Set([
  "error",
  "failed",
  "success",
  "timeout",
  "unauthorized"
]);

export function buildGatewayPipelineModel(
  record: InvocationLogRecord
): GatewayPipelineModel {
  const outcomes = record.domainOutcomes;
  const authOutcome = normalizedOutcome(outcomes?.auth);
  const runtimeOutcome = normalizedOutcome(outcomes?.runtime);
  const routingOutcome = normalizedOutcome(outcomes?.routing);
  const providerOutcome = normalizedOutcome(outcomes?.provider);
  const fallbackOutcome = normalizedOutcome(outcomes?.fallback);
  const cacheOutcome =
    normalizedOutcome(outcomes?.cache) || record.cacheStatus.toLowerCase();
  const callState = providerCallState(record, providerOutcome);

  const stages: GatewayPipelineStage[] = [
      {
        description: "요청을 성공적으로 수신했습니다.",
        id: "request",
        statusLabel: "RECEIVED",
        title: "Request",
        tone: "success"
      },
      authenticationStage(authOutcome, runtimeOutcome),
      guardrailsStage(record),
      decisionStage(record, routingOutcome),
      cacheStage(cacheOutcome),
      adapterStage(record, callState),
      providerStage(record, providerOutcome, callState)
    ];

  return {
    fallback: fallbackModel(outcomes?.fallback, fallbackOutcome),
    flow: buildPipelineFlow(stages, cacheOutcome),
    stages
  };
}

function buildPipelineFlow(
  stages: GatewayPipelineStage[],
  cacheOutcome: string
): GatewayPipelineFlow {
  const mainStages = stages.filter((pipelineStage) => pipelineStage.id !== "cache");
  const earlyTerminal = mainStages
    .filter((pipelineStage) =>
      pipelineStage.id === "authentication" ||
      pipelineStage.id === "guardrails" ||
      pipelineStage.id === "decision"
    )
    .find(isTerminalStage);

  if (earlyTerminal) {
    return {
      cacheOutcome,
      route: "stopped",
      stopStageId: earlyTerminal.id
    };
  }

  const adapter = stages.find((pipelineStage) => pipelineStage.id === "adapter");
  const provider = stages.find((pipelineStage) => pipelineStage.id === "provider");
  const providerReached = Boolean(adapter && isReachedStage(adapter));
  const cacheReached = cacheOutcome === "hit" ||
    (cacheOutcome === "error" && !providerReached);

  if (cacheReached) {
    return {
      cacheOutcome,
      route: "cache",
      stopStageId: "cache"
    };
  }

  if (providerReached && adapter) {
    return {
      cacheOutcome,
      route: "provider",
      stopStageId: isTerminalStage(adapter)
        ? adapter.id
        : provider && isReachedStage(provider) ? "provider" : adapter.id
    };
  }

  const stopStage = [...mainStages]
    .reverse()
    .find((pipelineStage) =>
      pipelineStage.id !== "adapter" &&
      pipelineStage.id !== "provider" &&
      isReachedStage(pipelineStage)
    ) ?? mainStages[0];

  return {
    cacheOutcome,
    route: "stopped",
    stopStageId: stopStage.id
  };
}

function isReachedStage(stage: GatewayPipelineStage) {
  return stage.tone !== "skipped" && stage.tone !== "neutral";
}

function isTerminalStage(stage: GatewayPipelineStage) {
  return stage.tone === "error" ||
    stage.statusLabel === "RATE LIMITED" ||
    stage.statusLabel === "QUEUED";
}

function authenticationStage(
  authOutcome: string,
  runtimeOutcome: string
): GatewayPipelineStage {
  const tone = mergeOutcomeTones([authOutcome, runtimeOutcome]);

  if (tone === "success") {
    return {
      description: "API 키 인증 및 사용자 정보 구성 완료",
      id: "authentication",
      statusLabel: outcomeLabel(authOutcome || runtimeOutcome),
      title: "Authentication & Context",
      tone
    };
  }

  return {
    description:
      tone === "error"
        ? "인증 또는 실행 컨텍스트 구성에 실패했습니다."
        : "인증 및 컨텍스트 결과를 확인할 수 없습니다.",
    id: "authentication",
    statusLabel: outcomeLabel(authOutcome || runtimeOutcome),
    title: "Authentication & Context",
    tone
  };
}

function guardrailsStage(record: InvocationLogRecord): GatewayPipelineStage {
  const rateLimit = normalizedOutcome(record.domainOutcomes?.rateLimit);
  const budget = normalizedOutcome(record.domainOutcomes?.budget);
  const safety = normalizedOutcome(record.domainOutcomes?.safety);
  const outcomes = [rateLimit, budget, safety].filter(Boolean);
  const appliedOutcomes = outcomes.filter((outcome) => !skippedOutcomes.has(outcome));
  const tone = appliedOutcomes.length > 0
    ? mergeOutcomeTones(appliedOutcomes)
    : "skipped";

  if (rateLimit === "rate_limited") {
    return stage("guardrails", "Guardrails", "RATE LIMITED", "요청 제한 정책에 따라 처리가 중단되었습니다.", "warning");
  }
  if (budget === "blocked") {
    return stage("guardrails", "Guardrails", "BLOCKED", "예산 정책에 따라 요청이 차단되었습니다.", "error");
  }
  if (safety === "blocked") {
    return stage("guardrails", "Guardrails", "BLOCKED", "안전 정책에 따라 요청이 차단되었습니다.", "error");
  }
  if (rateLimit === "queued") {
    return stage("guardrails", "Guardrails", "QUEUED", "요청 제한 처리 대기열에 진입했습니다.", "warning");
  }
  if (budget === "warned" || budget === "degraded") {
    return stage(
      "guardrails",
      "Guardrails",
      outcomeLabel(budget),
      "예산 정책 경고가 요청에 적용되었습니다.",
      "warning"
    );
  }
  if (warningOutcomes.has(safety)) {
    return stage("guardrails", "Guardrails", outcomeLabel(safety), "안전 정책이 요청에 적용되었습니다.", "policy");
  }
  if (tone === "success") {
    return stage("guardrails", "Guardrails", "PASSED", "예산, 요청 제한, 안전 정책 검증 완료", "success");
  }

  return stage(
    "guardrails",
    "Guardrails",
    outcomeLabel(outcomes.find(Boolean) ?? ""),
    "일부 정책 결과를 확인할 수 없습니다.",
    tone
  );
}

function decisionStage(
  record: InvocationLogRecord,
  routingOutcome: string
): GatewayPipelineStage {
  const tone = outcomeTone(routingOutcome);
  const description =
    routingDescription(record.routingReason) ||
    (tone === "success" ? "표준 라우팅 수행" : "라우팅 결과를 확인할 수 없습니다.");

  return {
    description,
    id: "decision",
    statusLabel: outcomeLabel(routingOutcome),
    title: "Decision",
    tone: tone === "success" ? "policy" : tone
  };
}

function routingDescription(reason: string | null | undefined) {
  const normalized = reason?.trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "pinned" || normalized === "pinned_model") {
    return "고정 모델 라우팅";
  }
  if (normalized === "standard" || normalized === "standard routing") {
    return "표준 라우팅 수행";
  }
  return reason?.trim() ?? "";
}

function cacheStage(cacheOutcome: string): GatewayPipelineStage {
  if (cacheOutcome === "hit") {
    return stage("cache", "Cached Response", "CACHE HIT", "캐시 응답 반환", "success");
  }
  if (cacheOutcome === "miss") {
    return stage("cache", "Cached Response", "CACHE MISS", "캐시 응답 미사용", "skipped");
  }
  if (cacheOutcome === "store_skipped") {
    return stage("cache", "Cached Response", "STORE SKIPPED", "캐시 저장 미수행", "skipped");
  }
  if (cacheOutcome === "error") {
    return stage("cache", "Cached Response", "ERROR", "캐시 처리에 실패했습니다.", "error");
  }
  if (skippedOutcomes.has(cacheOutcome) || cacheOutcome === "bypass") {
    return stage("cache", "Cached Response", outcomeLabel(cacheOutcome), "캐시 응답 미사용", "skipped");
  }

  return stage("cache", "Cached Response", outcomeLabel(cacheOutcome), "캐시 결과를 확인할 수 없습니다.", "neutral");
}

function adapterStage(
  record: InvocationLogRecord,
  callState: ProviderCallState
): GatewayPipelineStage {
  const errorStage = record.errorStage?.toLowerCase() ?? "";

  if (errorStage.includes("adapter")) {
    return stage("adapter", "Provider Adapter", "FAILED", "프로바이더 어댑터 호출 실패", "error", true);
  }
  if (callState === "not_called") {
    return stage("adapter", "Provider Adapter", "SKIPPED", "프로바이더 어댑터 호출 안 함", "skipped", true);
  }
  if (callState === "called") {
    return stage("adapter", "Provider Adapter", "CALLED", "프로바이더 어댑터 호출됨", "policy", true);
  }

  return stage("adapter", "Provider Adapter", "UNKNOWN", "어댑터 호출 여부를 확인할 수 없습니다.", "neutral", true);
}

function providerStage(
  record: InvocationLogRecord,
  providerOutcome: string,
  callState: ProviderCallState
): GatewayPipelineStage {
  if (callState === "not_called") {
    return stage("provider", "LLM Provider", "NOT CALLED", "프로바이더 호출 안 함", "skipped", true);
  }
  if (callState === "unknown") {
    return stage("provider", "LLM Provider", "UNKNOWN", "프로바이더 호출 여부를 확인할 수 없습니다.", "neutral", true);
  }

  const tone = outcomeTone(providerOutcome);
  let description = "프로바이더 결과를 확인할 수 없습니다.";

  if (tone === "success") {
    description = "프로바이더 응답 수신 성공";
  } else if (tone === "error") {
    description = "프로바이더 호출 실패";
  } else if (tone === "skipped") {
    description = "프로바이더 호출 안 함";
  }

  const providerIdentity = [record.selectedProvider, record.selectedModel]
    .filter(Boolean)
    .join(" / ");

  return {
    description: providerIdentity ? description + " · " + providerIdentity : description,
    emphasized: true,
    id: "provider",
    statusLabel: outcomeLabel(providerOutcome),
    title: "LLM Provider",
    tone
  };
}

function providerCallState(
  record: InvocationLogRecord,
  providerOutcome: string
): ProviderCallState {
  if (skippedOutcomes.has(providerOutcome) || providerOutcome === "not_called") {
    return "not_called";
  }
  if (providerReachedOutcomes.has(providerOutcome)) {
    return "called";
  }
  if (record.providerCalled === false) {
    return "not_called";
  }
  if (
    record.providerCalled === true ||
    record.providerLatencyMs !== null
  ) {
    return "called";
  }
  return "unknown";
}

function fallbackModel(
  fallback: DomainOutcome | undefined,
  fallbackOutcome: string
): GatewayPipelineFallback | null {
  if (!fallbackOutcome || hiddenFallbackOutcomes.has(fallbackOutcome)) {
    return null;
  }

  return {
    outcome: outcomeLabel(fallbackOutcome),
    reason: fallback?.reason?.trim() || null,
    tone: outcomeTone(fallbackOutcome)
  };
}

function stage(
  id: GatewayPipelineStageId,
  title: string,
  statusLabel: string,
  description: string,
  tone: GatewayPipelineTone,
  emphasized = false
): GatewayPipelineStage {
  return { description, emphasized, id, statusLabel, title, tone };
}

function normalizedOutcome(outcome: DomainOutcome | undefined) {
  return outcome?.outcome?.trim().toLowerCase() ?? "";
}

function mergeOutcomeTones(outcomes: string[]): GatewayPipelineTone {
  const tones = outcomes.map(outcomeTone);

  if (tones.includes("error")) {
    return "error";
  }
  if (tones.includes("warning") || tones.includes("policy")) {
    return "policy";
  }
  if (tones.length > 0 && tones.every((tone) => tone === "success")) {
    return "success";
  }
  if (tones.length > 0 && tones.every((tone) => tone === "skipped")) {
    return "skipped";
  }
  return "neutral";
}

function outcomeTone(outcome: string): GatewayPipelineTone {
  if (!outcome) {
    return "neutral";
  }
  if (successOutcomes.has(outcome)) {
    return "success";
  }
  if (skippedOutcomes.has(outcome)) {
    return "skipped";
  }
  if (errorOutcomes.has(outcome)) {
    return "error";
  }
  if (warningOutcomes.has(outcome)) {
    return outcome === "masked" || outcome === "masking_applied" || outcome === "redacted"
      ? "policy"
      : "warning";
  }
  return "neutral";
}

function outcomeLabel(outcome: string) {
  return outcome ? outcome.replaceAll("_", " ").toUpperCase() : "UNKNOWN";
}

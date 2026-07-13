import {
  BrainCircuit,
  Database,
  Inbox,
  KeyRound,
  PlugZap,
  Route,
  ShieldCheck
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  buildGatewayPipelineModel,
  type GatewayPipelineStageId
} from "@/features/request-logs/gateway-pipeline-model";
import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";
import type { Locale } from "@/lib/i18n/locale";

const stageIcons: Record<
  GatewayPipelineStageId,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  request: Inbox,
  authentication: KeyRound,
  guardrails: ShieldCheck,
  decision: Route,
  cache: Database,
  adapter: PlugZap,
  provider: BrainCircuit
};

const fullProviderPath =
  "M 83 150 L 250 150 L 417 150 L 583 150 L 750 150 L 917 150";
const cacheFlowPath =
  "M 83 150 L 250 150 L 417 150 L 583 150 C 583 95 600 58 667 58";
const cacheBranchPath = "M 583 150 C 583 95 600 58 667 58";
const providerPaths: Record<GatewayPipelineStageId, string> = {
  request: "M 83 150 L 84 150",
  authentication: "M 83 150 L 250 150",
  guardrails: "M 83 150 L 250 150 L 417 150",
  decision: "M 83 150 L 250 150 L 417 150 L 583 150",
  cache: cacheFlowPath,
  adapter:
    "M 83 150 L 250 150 L 417 150 L 583 150 L 750 150",
  provider: fullProviderPath
};
const successfulPrefixPaths: Record<GatewayPipelineStageId, string> = {
  request: providerPaths.request,
  authentication: providerPaths.request,
  guardrails: providerPaths.authentication,
  decision: providerPaths.guardrails,
  cache: providerPaths.decision,
  adapter: providerPaths.decision,
  provider: providerPaths.adapter
};
const terminalSegmentPaths: Partial<Record<GatewayPipelineStageId, string>> = {
  authentication: "M 83 150 L 250 150",
  guardrails: "M 250 150 L 417 150",
  decision: "M 417 150 L 583 150",
  adapter: "M 583 150 L 750 150",
  provider: "M 750 150 L 917 150"
};

const stageTitles: Record<Locale, Record<GatewayPipelineStageId, string>> = {
  en: {
    request: "Request",
    authentication: "Authentication & Context",
    guardrails: "Guardrails",
    decision: "Decision",
    cache: "Cached Response",
    adapter: "Provider Adapter",
    provider: "LLM Provider"
  },
  ko: {
    request: "요청 수신",
    authentication: "인증 및 컨텍스트",
    guardrails: "정책 검증",
    decision: "라우팅 결정",
    cache: "캐시 응답",
    adapter: "프로바이더 어댑터",
    provider: "LLM 프로바이더"
  }
};

const koreanStatusLabels: Record<string, string> = {
  "ALLOWED": "허용",
  "AUTHENTICATED": "인증 완료",
  "RECEIVED": "수신 완료",
  "PASSED": "통과",
  "SELECTED": "선택 완료",
  "SNAPSHOT ACTIVE": "활성 스냅샷",
  "LAST KNOWN SAFE USED": "마지막 정상 스냅샷 사용",
  "STALE SNAPSHOT USED": "이전 스냅샷 사용",
  "CACHE HIT": "캐시 적중",
  "CACHE MISS": "캐시 미스",
  "STORE SKIPPED": "저장 생략",
  "CALLED": "호출됨",
  "SUCCESS": "성공",
  "FAILED": "실패",
  "ERROR": "오류",
  "BLOCKED": "차단",
  "DENIED": "거부",
  "INVALID API KEY": "API 키 오류",
  "INVALID APP TOKEN": "앱 토큰 오류",
  "SCOPE MISMATCH": "범위 불일치",
  "NO SNAPSHOT": "스냅샷 없음",
  "UNAUTHORIZED": "인증 실패",
  "TIMEOUT": "시간 초과",
  "WARNED": "경고",
  "DEGRADED": "제한 모드",
  "REDACTED": "마스킹됨",
  "MASKED": "마스킹됨",
  "MASKING APPLIED": "마스킹 적용",
  "RATE LIMITED": "요청 제한",
  "QUEUED": "대기 중",
  "SKIPPED": "건너뜀",
  "NOT CALLED": "호출 안 함",
  "NOT CHECKED": "확인 안 함",
  "NOT NEEDED": "불필요",
  "NOT STARTED": "시작 안 함",
  "NOT USED": "미사용",
  "DISABLED": "비활성",
  "BYPASS": "우회",
  "BYPASSED": "우회",
  "COMPLETED": "완료",
  "STARTED": "시작됨",
  "CANCELLED": "취소됨",
  "DEFERRED": "지연 기록",
  "INTERRUPTED": "중단",
  "NONE": "없음",
  "WRITTEN": "기록 완료",
  "UNKNOWN": "확인 불가"
};

export function GatewayPipeline({
  locale,
  record
}: {
  locale: Locale;
  record: LiveInvocationLogRecord;
}) {
  const model = buildGatewayPipelineModel(record);
  const cacheStage = model.stages.find((pipelineStage) => pipelineStage.id === "cache");
  const stopStage = model.stages.find(
    (pipelineStage) => pipelineStage.id === model.flow.stopStageId
  );
  const motionPath = model.flow.route === "cache"
    ? cacheFlowPath
    : providerPaths[model.flow.stopStageId];
  const shouldAnimate = model.flow.stopStageId !== "request";
  const hasTerminalStop = stopStage ? isTerminalStop(stopStage) : false;
  const activePath = hasTerminalStop
    ? successfulPrefixPaths[model.flow.stopStageId]
    : motionPath;
  const terminalPath = hasTerminalStop
    ? terminalSegmentPaths[model.flow.stopStageId]
    : undefined;

  return (
    <section
      aria-labelledby="gateway-pipeline-title"
      className="gateway-pipeline"
      data-cache-outcome={model.flow.cacheOutcome || "unknown"}
      data-route={model.flow.route}
    >
      <div className="gateway-pipeline-heading">
        <div>
          <h3 id="gateway-pipeline-title">
            {locale === "ko" ? "요청 흐름" : "Request flow"}
          </h3>
          <small>
            {locale === "ko"
              ? "실제 처리 결과를 따라 요청이 이동한 경로입니다."
              : "The route this request followed through the gateway."}
          </small>
        </div>
      </div>

      <div className="gateway-pipeline-scene">
        <svg
          aria-hidden="true"
          className="gateway-pipeline-route-map"
          preserveAspectRatio="none"
          viewBox="0 0 1000 300"
        >
          <path
            className="gateway-pipeline-ambient-path"
            d="M 0 224 C 155 150 254 292 415 219 C 573 146 694 265 1000 196"
          />
          <path
            className="gateway-pipeline-ambient-path is-secondary"
            d="M 0 252 C 172 183 287 292 446 242 C 650 178 758 260 1000 226"
          />
          <path className="gateway-pipeline-path-base" d={fullProviderPath} />
          <path
            className="gateway-pipeline-cache-branch"
            d={cacheBranchPath}
            data-active={model.flow.route === "cache" || undefined}
            data-tone={cacheStage?.tone ?? "neutral"}
          />
          <path
            className="gateway-pipeline-path-active"
            d={activePath}
          />
          {terminalPath ? (
            <path
              className="gateway-pipeline-path-terminal"
              d={terminalPath}
              data-tone={stopStage?.tone ?? "error"}
            />
          ) : null}
          {shouldAnimate ? (
            <path
              className="gateway-pipeline-flow-dot"
              data-tone={stopStage?.tone ?? "neutral"}
              d={motionPath}
              pathLength="1"
            />
          ) : null}
        </svg>

        <ol className="gateway-pipeline-stages">
          {model.stages.map((pipelineStage) => {
            const Icon = stageIcons[pipelineStage.id];
            const reached = pipelineStage.tone !== "skipped" &&
              pipelineStage.tone !== "neutral";
            const statusLabel = pipelineStage.id === "cache" &&
              model.flow.cacheOutcome === "miss"
              ? locale === "ko" ? "미사용" : "Not used"
              : displayStatus(pipelineStage.statusLabel, locale);

            return (
              <li
                className="gateway-pipeline-stage"
                data-reached={reached || undefined}
                data-stage={pipelineStage.id}
                data-tone={pipelineStage.tone}
                key={pipelineStage.id}
              >
                <span className="gateway-pipeline-status">
                  {statusLabel}
                </span>
                <span className="gateway-pipeline-icon">
                  <Icon aria-hidden="true" />
                </span>
                <strong data-emphasized={pipelineStage.emphasized || undefined}>
                  {stageTitles[locale][pipelineStage.id]}
                </strong>
              </li>
            );
          })}
        </ol>

        {model.flow.cacheOutcome !== "miss" ? (
          <span
            className="gateway-pipeline-cache-label"
            data-route={model.flow.route}
          >
            {cacheRouteLabel(model.flow.cacheOutcome, locale)}
          </span>
        ) : null}
      </div>

      {model.fallback ? (
        <div className="gateway-pipeline-fallback" data-tone={model.fallback.tone}>
          <strong>
            {locale === "ko" ? "대체 경로" : "Fallback"} · {displayStatus(model.fallback.outcome, locale)}
          </strong>
          <span>
            {model.fallback.reason ??
              (locale === "ko"
                ? "대체 경로 결과는 확인되지만 프로바이더 식별 정보는 제공되지 않습니다."
                : "The fallback outcome is known, but its provider identity is unavailable.")}
          </span>
        </div>
      ) : null}
    </section>
  );
}

function displayStatus(status: string, locale: Locale) {
  return locale === "ko" ? koreanStatusLabels[status] ?? status : status;
}

function isTerminalStop(stage: { statusLabel: string; tone: string }) {
  return stage.tone === "error" ||
    stage.statusLabel === "RATE LIMITED" ||
    stage.statusLabel === "QUEUED";
}

function cacheRouteLabel(cacheOutcome: string, locale: Locale) {
  const normalized = cacheOutcome.trim().toLowerCase();

  if (locale === "en") {
    if (normalized === "hit") return "Cache hit";
    if (normalized === "miss") return "Cache miss";
    if (normalized === "error") return "Cache error";
    if (normalized === "store_skipped") return "Cache store skipped";
    if (["bypass", "bypassed", "not_checked", "not_used", "skipped"].includes(normalized)) {
      return "Cache bypassed";
    }
    return "Cache outcome unavailable";
  }

  if (normalized === "hit") return "캐시 적중";
  if (normalized === "miss") return "캐시 미스";
  if (normalized === "error") return "캐시 오류";
  if (normalized === "store_skipped") return "캐시 저장 생략";
  if (["bypass", "bypassed", "not_checked", "not_used", "skipped"].includes(normalized)) {
    return "캐시 우회";
  }
  return "캐시 결과 미확인";
}

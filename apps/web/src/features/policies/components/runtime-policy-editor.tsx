"use client";

import { Save, UploadCloud } from "lucide-react";
import dynamic from "next/dynamic";
import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  getRuntimePolicyDraftValues,
  isRuntimePolicyModelRoleProfile,
  type RuntimePolicyConfig,
  type RuntimePolicyDraftValues
} from "@/lib/control-plane/runtime-policy-types";
import type { Locale } from "@/lib/i18n/locale";
import type {
  OneTimeApiKeyState,
  PolicySection,
  RuntimePolicyEditorProps,
  RuntimePolicyEditorText,
  SubmitState
} from "./runtime-policy-editor-types";
import {
  areRuntimePolicyDraftValuesEqual,
  getSelectedRoutingProviderConnections,
  getWritableRuntimePolicyDraftValues,
  hasResolvableRoutingMatrix,
  mergeDraftValuesWithProviderConnections
} from "./runtime-policy-editor-utils";
import {
  PolicyPanelFallback,
  PolicyPanelFallbackGroup
} from "./runtime-policy-panel-fallback";
import type { BudgetPolicyPanelProps } from "./runtime-policy-panels/budget-panel";
import type { CachePolicyPanelProps } from "./runtime-policy-panels/cache-panel";
import type { RateLimitPolicyPanelProps } from "./runtime-policy-panels/rate-limit-panel";
import type { RoutingPolicyPanelProps } from "./runtime-policy-panels/routing-panel";
import type { SafetyPolicyPanelProps } from "./runtime-policy-panels/safety-panel";
import type { StreamingPolicyPanelProps } from "./runtime-policy-panels/streaming-panel";

const policySections: PolicySection[] = [
  "routing",
  "budget",
  "rateLimit",
  "cache",
  "safety",
  "streaming"
];

const RuntimePolicyMovedBudgetContext = createContext<ReactNode>(null);

export function RuntimePolicyMovedBudgetSlot() {
  return useContext(RuntimePolicyMovedBudgetContext);
}

const BudgetPolicyPanel = dynamic<BudgetPolicyPanelProps>(() =>
  import("./runtime-policy-panels/budget-panel").then((module) => module.BudgetPolicyPanel),
  {
    loading: () => <PolicyPanelFallback heading="Budget policy" />
  }
);
const CachePolicyPanel = dynamic<CachePolicyPanelProps>(() =>
  import("./runtime-policy-panels/cache-panel").then((module) => module.CachePolicyPanel),
  {
    loading: () => (
      <PolicyPanelFallbackGroup
        panels={[
          { heading: "Exact cache" },
          { heading: "Semantic cache" }
        ]}
      />
    )
  }
);
const RateLimitPolicyPanel = dynamic<RateLimitPolicyPanelProps>(() =>
  import("./runtime-policy-panels/rate-limit-panel").then((module) => module.RateLimitPolicyPanel),
  {
    loading: () => <PolicyPanelFallback heading="Rate limit" />
  }
);
const RoutingPolicyPanel = dynamic<RoutingPolicyPanelProps>(() =>
  import("./runtime-policy-panels/routing-panel").then((module) => module.RoutingPolicyPanel),
  {
    loading: () => (
      <PolicyPanelFallbackGroup
        panels={[
          { heading: "카테고리별 모델 설정" },
          { heading: "Advanced routing", lineCount: 1 },
          { heading: "Provider catalog" }
        ]}
      />
    )
  }
);
const SafetyPolicyPanel = dynamic<SafetyPolicyPanelProps>(() =>
  import("./runtime-policy-panels/safety-panel").then((module) => module.SafetyPolicyPanel),
  {
    loading: () => (
      <PolicyPanelFallbackGroup
        panels={[
          { heading: "Safety detectors", lineCount: 4, wide: true },
          { heading: "Prompt capture" },
          { heading: "Response capture" }
        ]}
      />
    )
  }
);
const StreamingPolicyPanel = dynamic<StreamingPolicyPanelProps>(() =>
  import("./runtime-policy-panels/streaming-panel").then((module) => module.StreamingPolicyPanel),
  {
    loading: () => <PolicyPanelFallback heading="Streaming" />
  }
);
function getPolicyTabId(section: PolicySection) {
  return `policy-tab-${section}`;
}
function getPolicyPanelId(section: PolicySection) {
  return `policy-panel-${section}`;
}
function getDefaultPolicySection(
  hasGeneralSection: boolean,
  hasEmployeeSection: boolean
): PolicySection {
  if (hasGeneralSection) {
    return "general";
  }

  return hasEmployeeSection ? "employees" : "routing";
}

function getPolicySectionLabel(section: PolicySection, text: RuntimePolicyEditorText) {
  switch (section) {
    case "general":
      return text.general;
    case "employees":
      return text.employees;
    case "safety":
      return text.safetyTab;
    case "routing":
      return text.routing;
    case "budget":
      return text.budgetTab;
    case "rateLimit":
      return text.rateLimitTab;
    case "cache":
      return text.cacheTab;
    case "streaming":
      return text.streaming;
  }
}

const policyText: Record<Locale, RuntimePolicyEditorText> = {
  en: {
    activeConfig: "Active config",
    activeApiKeyMissing:
      "Runtime policy save and publish require an active API Key for this project.",
    apiKeyIssueFailed: "API Key issue failed.",
    apiKeyIssued:
      "Active API Key prepared. Store the plaintext now; it will not be displayed again.",
    budget: "Budget policy",
    budgetEnforcement: "Enforcement",
    budgetPolicyEnabled: "Use budget policy",
    budgetPolicyHint: "Controls what happens when the project budget is exceeded.",
    budgetTab: "Budget",
    budgetWarning: "Warning threshold",
    blockAction: "Block",
    cache: "Exact cache",
    cacheEnabled: "Cache enabled",
    cacheEnabledHint:
      "Reuse completed responses for identical requests before a Provider call.",
    cacheSettings: "Cache settings",
    cacheSection: "Cache",
    cacheTab: "Cache",
    cacheTtl: "TTL seconds",
    catalogVersion: "Catalog version",
    configVersion: "Config version",
    completionPrice: "Completion micro USD",
    detectorNames: {
      api_key: "API key",
      authorization_header: "Authorization header",
      email: "Email address",
      jwt: "JWT",
      organization_name: "Organization name",
      person_name: "Person name",
      phone_number: "Phone number",
      postal_address: "Postal address",
      private_key: "Private key",
      resident_registration_number: "Resident registration number"
    },
    detectors: "Safety detectors",
    detectorType: "Detector",
    close: "Close",
    details: "Details",
    disabled: "Disabled",
    edit: "Edit",
    enabled: "Enabled",
    employees: "Employees",
    fixtureFallback: "Control Plane unavailable. Showing fixture values.",
    general: "General",
    jsonMode: "JSON",
    limit: "Limit",
    logSafeCaptureHint:
      "Stores only the post-masking log-safe prompt in Request Detail when enabled.",
    mandatoryProtection: "Sensitive data protection",
    mandatoryProtectionHint: "These detectors cannot be disabled.",
    maxBucketTokens: "Max bucket tokens",
    mode: "Mode",
    model: "Model",
    models: "Models",
    noProviderModels: "No configured models",
    placeholder: "Placeholder",
    policyDetails: "Policy details",
    pricing: "Pricing rules",
    pricingVersion: "Pricing version",
    privacyMasking: "Personal data masking",
    promptCapture: "Prompt capture",
    promptCaptureEnabled: "Log-safe capture",
    promptCaptureMaxChars: "Max characters",
    promptPrice: "Prompt micro USD",
    provider: "Provider",
    providerConnectionMissing:
      "Connect at least one provider with configured models before saving or publishing this policy.",
    providerCount: "Providers",
    providerCatalog: "Provider catalog",
    publish: "Publish active config",
    publishedAt: "Published",
    history: "Runtime history",
    rateLimit: "Rate limit",
    rateLimitInfo:
      "Rate limit prevents request bursts. Each request uses one token, and tokens refill every second by the configured amount. Tokens never accumulate above the max bucket size; when tokens run out, the request is blocked before the Provider call.",
    rateLimitTab: "Rate Limit",
    redactAction: "Redact",
    refillRate: "Refill tokens / sec",
    remove: "Remove",
    rollback: "Rollback",
    routing: "Routing",
    routingAuthoringRequired:
      "This saved policy uses the previous per-category routing format. It remains active until you explicitly convert it; draft save and publish are blocked meanwhile.",
    routingComplexModel: "Complex model",
    routingConvert: "Convert to global Simple/Complex policy",
    routingFallbackModel: "Fallback model (optional)",
    routingFallbackNone: "No fallback",
    routingMockWarning:
      "This policy still uses the Mock model. Replace it before using a live provider path.",
    routingRoleDescription:
      "Simple is the low-cost/default role. Complex is the high-cost role. One optional fallback is shared by every route.",
    routingRoleHint:
      "When enabled, requests are classified into the existing category and difficulty matrix, then resolved through these global roles.",
    routingRoleModels: "Routing role models",
    routingSimpleModel: "Simple model",
    runtimeSnapshot: "RuntimeSnapshot",
    responseCapture: "Response capture",
    responseCaptureHint:
      "Backend policy is preserved for publish, but raw response content is not displayed in this console.",
    responseCaptureMaxChars: "Max characters",
    saveDraft: "Save draft",
    safetyTab: "Safety",
    issueApiKey: "Issue API Key",
    issuingApiKey: "Issuing...",
    snapshotState: "Snapshot state",
    snapshotVersion: "Snapshot version",
    semanticCache: "Semantic cache",
    semanticCacheDisabled: "disabled",
    semanticCacheEvidenceOnly: "evidence only",
    semanticCacheNote:
      "Current Control Plane derives semantic cache evidence mode from the cache policy. It is not a live response path.",
    streaming: "Streaming",
    streamingNote:
      "Streaming is a v2 thin slice. Request-side safety completes before streaming starts, and stream=true bypasses Exact Cache until a streaming cache contract is defined.",
    streamingUnavailable: "No active RuntimeSnapshot streaming state returned.",
    templateFallback:
      "This application does not have an active policy yet. Configure and publish this policy to enable the Gateway path.",
    title: "Policies",
    tokens: "Context tokens",
    unsavedChanges: "Unsaved changes"
  },
  ko: {
    activeConfig: "활성 설정",
    activeApiKeyMissing:
      "런타임 정책을 저장하고 게시하려면 이 프로젝트의 활성 API 키가 필요합니다.",
    apiKeyIssueFailed: "API Key 발급에 실패했습니다.",
    apiKeyIssued:
      "활성 API 키가 준비되었습니다. 원문은 지금 저장해야 하며 다시 표시되지 않습니다.",
    budget: "예산 정책",
    budgetEnforcement: "초과 처리",
    budgetPolicyEnabled: "예산 정책 사용",
    budgetPolicyHint: "프로젝트 예산 초과 시 동작을 제어합니다.",
    budgetTab: "예산",
    budgetWarning: "경고 임계값",
    blockAction: "차단",
    cache: "정확 일치 캐시",
    cacheEnabled: "캐시 사용",
    cacheEnabledHint:
      "동일한 요청은 Provider 호출 전에 기존 응답을 재사용합니다.",
    cacheSettings: "캐시 설정",
    cacheSection: "캐시",
    cacheTab: "캐시",
    cacheTtl: "TTL 초",
    catalogVersion: "카탈로그 버전",
    configVersion: "설정 버전",
    completionPrice: "출력 단가(마이크로 USD)",
    detectorNames: {
      api_key: "API 키",
      authorization_header: "인증 헤더",
      email: "이메일",
      jwt: "JWT",
      organization_name: "조직명",
      person_name: "이름",
      phone_number: "전화번호",
      postal_address: "주소",
      private_key: "개인 키",
      resident_registration_number: "주민등록번호"
    },
    detectors: "안전 탐지 항목",
    detectorType: "탐지 유형",
    close: "닫기",
    details: "상세보기",
    disabled: "비활성화",
    edit: "편집",
    enabled: "사용",
    employees: "직원",
    fixtureFallback: "Control Plane을 사용할 수 없어 예시 값을 표시 중입니다.",
    general: "일반",
    jsonMode: "JSON",
    limit: "한도",
    logSafeCaptureHint:
      "켜져 있을 때 요청 상세에 마스킹 이후의 안전한 프롬프트만 저장합니다.",
    mandatoryProtection: "중요 민감정보 보호",
    mandatoryProtectionHint: "이 항목은 사용 중지할 수 없습니다.",
    maxBucketTokens: "최대 버킷 토큰",
    mode: "모드",
    model: "모델",
    models: "모델",
    noProviderModels: "설정된 모델 없음",
    placeholder: "치환 문구",
    policyDetails: "정책 상세",
    pricing: "가격 정책",
    pricingVersion: "가격 정책 버전",
    privacyMasking: "개인정보 마스킹",
    promptCapture: "프롬프트 캡처",
    promptCaptureEnabled: "로그 안전 캡처",
    promptCaptureMaxChars: "최대 글자 수",
    promptPrice: "입력 단가(마이크로 USD)",
    provider: "프로바이더",
    providerConnectionMissing:
      "정책을 저장하거나 게시하려면 모델이 설정된 프로바이더를 하나 이상 연결해야 합니다.",
    providerCount: "프로바이더",
    providerCatalog: "프로바이더 카탈로그",
    publish: "활성 설정 게시",
    publishedAt: "게시 시각",
    history: "런타임 이력",
    rateLimit: "요청 제한",
    rateLimitInfo:
      "요청 폭주를 막기 위한 제한입니다. 요청 1건은 토큰 1개를 사용하고, 토큰은 매초 설정한 수만큼 다시 채워집니다. 최대 버킷 토큰 수를 넘어서 쌓이지 않으며, 토큰이 부족하면 프로바이더 호출 전에 차단됩니다.",
    rateLimitTab: "요청 제한",
    redactAction: "마스킹",
    refillRate: "초당 충전 토큰",
    remove: "삭제",
    rollback: "되돌리기",
    routing: "라우팅",
    routingAuthoringRequired:
      "이 정책은 이전 카테고리별 라우팅 형식으로 저장되어 있습니다. 명시적으로 전환하기 전까지 기존 정책은 유지되며 임시 저장과 발행은 차단됩니다.",
    routingComplexModel: "Complex 모델",
    routingConvert: "전역 Simple/Complex 정책으로 전환",
    routingFallbackModel: "Fallback 모델 (선택)",
    routingFallbackNone: "Fallback 없음",
    routingMockWarning:
      "현재 정책에 Mock 모델이 포함되어 있습니다. 실제 Provider 경로를 사용하기 전에 교체하세요.",
    routingRoleDescription:
      "Simple은 low-cost/default 역할, Complex는 high-cost 역할입니다. 선택한 fallback 하나를 모든 경로가 공유합니다.",
    routingRoleHint:
      "활성화하면 기존 카테고리·난이도 분류 결과를 전역 Simple/Complex 역할에 연결합니다.",
    routingRoleModels: "라우팅 역할 모델",
    routingSimpleModel: "Simple 모델",
    runtimeSnapshot: "런타임 스냅샷",
    responseCapture: "응답 캡처",
    responseCaptureHint:
      "백엔드 정책은 게시 시 보존하지만, 이 콘솔에서는 응답 원문을 표시하지 않습니다.",
    responseCaptureMaxChars: "최대 글자 수",
    saveDraft: "임시 저장",
    safetyTab: "안전",
    issueApiKey: "API Key 발급",
    issuingApiKey: "발급 중...",
    snapshotState: "스냅샷 상태",
    snapshotVersion: "스냅샷 버전",
    semanticCache: "의미 기반 캐시",
    semanticCacheDisabled: "비활성화",
    semanticCacheEvidenceOnly: "증거 전용",
    semanticCacheNote:
      "현재 Control Plane은 캐시 정책에서 의미 기반 캐시 증거 모드를 파생합니다. 실시간 응답 경로는 아닙니다.",
    streaming: "스트리밍",
    streamingNote:
      "스트리밍은 v2 최소 범위 기능입니다. 요청 안전 검사가 스트리밍 시작 전에 완료되고, stream=true 요청은 스트리밍 캐시 계약 전까지 정확 일치 캐시를 우회합니다.",
    streamingUnavailable: "활성 런타임 스냅샷의 스트리밍 상태가 없습니다.",
    templateFallback:
      "이 애플리케이션에는 아직 활성 정책이 없습니다. 정책을 설정하고 게시하면 Gateway 경로에 적용됩니다.",
    title: "정책",
    tokens: "컨텍스트 토큰",
    unsavedChanges: "저장되지 않은 변경사항"
  }
};

function getPolicyPanelFallback(section: PolicySection, text: RuntimePolicyEditorText) {
  switch (section) {
    case "budget":
      return <PolicyPanelFallback heading={text.budget} />;
    case "cache":
      return (
        <PolicyPanelFallbackGroup
          panels={[
            { heading: text.cache },
            { heading: text.semanticCache }
          ]}
        />
      );
    case "rateLimit":
      return <PolicyPanelFallback heading={text.rateLimit} />;
    case "routing":
      return (
        <PolicyPanelFallbackGroup
          panels={[
            { heading: "Auto routing", lineCount: 1 },
            { heading: "카테고리 × 난이도 모델 설정" },
            { heading: text.providerCatalog }
          ]}
        />
      );
    case "safety":
      return (
        <PolicyPanelFallbackGroup
          panels={[
            { heading: text.detectors, lineCount: 4, wide: true },
            { heading: text.promptCapture }
          ]}
        />
      );
    case "streaming":
      return <PolicyPanelFallback heading={text.streaming} />;
    case "employees":
    case "general":
      return null;
  }
}
export function RuntimePolicyEditor({
  apiKeyReadiness,
  breadcrumbItems,
  children,
  employeeSection,
  generalBudgetPanelPlacement = "afterChildren",
  generalFooter,
  hideStreamingTab = false,
  locale,
  model,
  moveBudgetToGeneral = false
}: RuntimePolicyEditorProps) {
  const router = useRouter();
  const text = policyText[locale];
  const hasGeneralSection = Boolean(children || generalFooter);
  const hasEmployeeSection = Boolean(employeeSection);
  const shouldMoveBudgetToGeneral = moveBudgetToGeneral && hasGeneralSection;
  const shouldRenderMovedBudgetInChildSlot =
    shouldMoveBudgetToGeneral && generalBudgetPanelPlacement === "childSlot";
  const shouldRenderMovedBudgetAfterChildren =
    shouldMoveBudgetToGeneral && generalBudgetPanelPlacement === "afterChildren";
  const [activeApiKeyCount, setActiveApiKeyCount] = useState(
    apiKeyReadiness?.activeApiKeyCount ?? 1
  );
  const [draftValues, setDraftValues] = useState<RuntimePolicyDraftValues>(() =>
    getWritableRuntimePolicyDraftValues(model.activeConfig)
  );
  const [savedDraftValues, setSavedDraftValues] = useState<RuntimePolicyDraftValues>(() =>
    getWritableRuntimePolicyDraftValues(model.activeConfig)
  );
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const [activePolicySection, setActivePolicySection] = useState<PolicySection>(
    () => getDefaultPolicySection(hasGeneralSection, hasEmployeeSection)
  );
  const [isIssuingApiKey, setIsIssuingApiKey] = useState(false);
  const [oneTimeApiKey, setOneTimeApiKey] = useState<OneTimeApiKeyState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const visiblePolicySections = useMemo(
    () => {
      const policySectionsForContext = shouldMoveBudgetToGeneral
        ? policySections.filter((section) => section !== "budget")
        : policySections;
      const sections: PolicySection[] = [];
      if (hasGeneralSection) {
        sections.push("general");
      }
      if (hasEmployeeSection) {
        sections.push("employees");
      }
      sections.push(...policySectionsForContext);

      return hideStreamingTab
        ? sections.filter((section) => section !== "streaming")
        : sections;
    },
    [hasEmployeeSection, hasGeneralSection, hideStreamingTab, shouldMoveBudgetToGeneral]
  );
  useEffect(() => {
    const activeSectionUnavailable =
      (!hasGeneralSection && activePolicySection === "general") ||
      (!hasEmployeeSection && activePolicySection === "employees") ||
      (shouldMoveBudgetToGeneral && activePolicySection === "budget");

    if (activeSectionUnavailable) {
      setActivePolicySection(
        getDefaultPolicySection(hasGeneralSection, hasEmployeeSection)
      );
    }
  }, [activePolicySection, hasEmployeeSection, hasGeneralSection, shouldMoveBudgetToGeneral]);
  useEffect(() => {
    const nextDraftValues = getWritableRuntimePolicyDraftValues(model.activeConfig);
    setDraftValues(nextDraftValues);
    setSavedDraftValues(nextDraftValues);
  }, [model.activeConfig, model.applicationId, model.providerConnections.available]);
  const hasUnsavedChanges = useMemo(
    () => !areRuntimePolicyDraftValuesEqual(draftValues, savedDraftValues),
    [draftValues, savedDraftValues]
  );
  const hasActiveApiKey = activeApiKeyCount > 0;
  const selectedRoutingProviderConnections = getSelectedRoutingProviderConnections(
    draftValues,
    model.providerConnections.available
  );
  const hasRoutingCandidates = hasResolvableRoutingMatrix(
    draftValues.routingPolicy,
    model.providerConnections.available
  );
  const hasRoutingAuthoringProfile = isRuntimePolicyModelRoleProfile(
    draftValues.routingPolicy.routes
  );

  async function submitPolicy(action: "save-draft" | "publish") {
    if (!hasActiveApiKey) {
      setSubmitState({
        message: text.activeApiKeyMissing,
        status: "error"
      });
      return;
    }

    if (!hasRoutingCandidates) {
      setSubmitState({
        message: text.providerConnectionMissing,
        status: "error"
      });
      return;
    }

    if (!hasRoutingAuthoringProfile) {
      setSubmitState({
        message: text.routingAuthoringRequired,
        status: "error"
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitState({ message: "", status: "idle" });

    if (selectedRoutingProviderConnections.length > 0) {
      const providerConnectionResponse = await fetch("/api/control-plane/application-providers", {
        body: JSON.stringify({
          applicationId: model.applicationId,
          providerConnectionIds: selectedRoutingProviderConnections.map(
            (providerConnection) => providerConnection.id
          )
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const providerConnectionPayload = (await providerConnectionResponse
        .json()
        .catch(() => ({}))) as {
        error?: string;
      };

      if (!providerConnectionResponse.ok) {
        setSubmitState({
          message: providerConnectionPayload.error ?? "Application provider update failed.",
          status: "error"
        });
        setIsSubmitting(false);
        return;
      }
    }

    const submitValues =
      selectedRoutingProviderConnections.length > 0
        ? mergeDraftValuesWithProviderConnections(
            draftValues,
            selectedRoutingProviderConnections
          )
        : draftValues;

    const response = await fetch("/api/control-plane/runtime-config", {
      body: JSON.stringify({
        action,
        applicationId: model.applicationId,
        values: submitValues
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      runtimeConfig?: RuntimePolicyConfig;
    };

    if (!response.ok || !payload.runtimeConfig) {
      setSubmitState({
        message: payload.error ?? "Runtime policy update failed.",
        status: "error"
      });
      setIsSubmitting(false);
      return;
    }

    setSubmitState({
      message: action === "save-draft" ? "Draft saved." : "Active config published.",
      runtimeConfig: payload.runtimeConfig,
      status: "success"
    });
    const nextDraftValues = getRuntimePolicyDraftValues(payload.runtimeConfig);
    setDraftValues(nextDraftValues);
    setSavedDraftValues(nextDraftValues);
    setIsSubmitting(false);
    if (action === "publish") {
      router.refresh();
    }
  }

  async function issueRuntimeApiKey() {
    setIsIssuingApiKey(true);
    setSubmitState({ message: "", status: "idle" });
    setOneTimeApiKey(null);

    const projectName = apiKeyReadiness?.projectName ?? "Project";
    const response = await fetch("/api/control-plane/api-keys", {
      body: JSON.stringify({
        action: "issue",
        values: {
          displayName: `${projectName} Runtime API Key`,
          expiresAt: "",
          projectId: apiKeyReadiness?.projectId,
          scopes: "gateway:invoke"
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as {
      apiKey?: OneTimeApiKeyState["apiKey"];
      error?: string;
    };

    if (!response.ok || !payload.apiKey) {
      setSubmitState({
        message: payload.error ?? text.apiKeyIssueFailed,
        status: "error"
      });
      setIsIssuingApiKey(false);
      return;
    }

    setActiveApiKeyCount((current) => Math.max(1, current + 1));
    setOneTimeApiKey({
      apiKey: payload.apiKey,
      projectName
    });
    setSubmitState({
      message: text.apiKeyIssued,
      status: "success"
    });
    setIsIssuingApiKey(false);
    router.refresh();
  }

  function renderBudgetPolicyPanel(projectPanel = false) {
    return (
      <Suspense
        fallback={
          <PolicyPanelFallback
            className={projectPanel ? "project-policy-budget-panel" : ""}
            heading={text.budget}
          />
        }
      >
        <BudgetPolicyPanel
          draftValues={draftValues}
          onDraftValuesChange={setDraftValues}
          projectPanel={projectPanel}
          text={text}
        />
      </Suspense>
    );
  }

  function renderActivePolicyPanel() {
    if (activePolicySection === "general") {
      return null;
    }

    const content = renderPolicyPanelContent(activePolicySection);

    if (!content) {
      return null;
    }

    return (
      <section className="policy-layout policy-settings-list">
        <div
          aria-labelledby={getPolicyTabId(activePolicySection)}
          className="policy-tab-panel"
          id={getPolicyPanelId(activePolicySection)}
          role="tabpanel"
          tabIndex={0}
        >
          {content}
        </div>
      </section>
    );
  }

  function renderPolicyPanelContent(section: PolicySection) {
    if (activePolicySection !== section) {
      return null;
    }

    switch (section) {
      case "budget":
        return renderBudgetPolicyPanel(false);
      case "cache":
        return (
          <Suspense fallback={getPolicyPanelFallback("cache", text)}>
            <CachePolicyPanel
              draftValues={draftValues}
              onDraftValuesChange={setDraftValues}
              text={text}
            />
          </Suspense>
        );
      case "rateLimit":
        return (
          <Suspense fallback={getPolicyPanelFallback("rateLimit", text)}>
            <RateLimitPolicyPanel
              draftValues={draftValues}
              onDraftValuesChange={setDraftValues}
              text={text}
            />
          </Suspense>
        );
      case "routing":
        return (
          <Suspense fallback={getPolicyPanelFallback("routing", text)}>
            <RoutingPolicyPanel
              draftValues={draftValues}
              onDraftValuesChange={setDraftValues}
              providerCatalog={model.providerCatalog}
              providers={model.activeConfig.providers}
              text={text}
            />
          </Suspense>
        );
      case "safety":
        return (
          <Suspense fallback={getPolicyPanelFallback("safety", text)}>
            <SafetyPolicyPanel
              draftValues={draftValues}
              onDraftValuesChange={setDraftValues}
              text={text}
            />
          </Suspense>
        );
      case "streaming":
        return (
          <Suspense fallback={getPolicyPanelFallback("streaming", text)}>
            <StreamingPolicyPanel runtimeSnapshot={model.runtimeSnapshot} text={text} />
          </Suspense>
        );
      case "employees":
        return employeeSection;
      case "general":
        return null;
    }
  }

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          {breadcrumbItems ? <Breadcrumb items={breadcrumbItems} /> : null}
          <h2>{text.title}</h2>
        </div>
      </section>

      {model.source === "fixture" ? (
        <Alert variant="warning">
          <AlertDescription>
            {text.fixtureFallback} {model.loadError}
          </AlertDescription>
        </Alert>
      ) : null}
      {model.source === "template" ? (
        <Alert variant="warning">
          <AlertDescription>{text.templateFallback}</AlertDescription>
        </Alert>
      ) : null}
      {!hasActiveApiKey ? (
        <div className="policy-alert runtime-credential-alert" data-status="error">
          <span>
            {text.activeApiKeyMissing}
            {apiKeyReadiness?.loadError ? ` ${apiKeyReadiness.loadError}` : ""}
          </span>
          <Button
            disabled={isIssuingApiKey}
            onClick={() => void issueRuntimeApiKey()}
            type="button"
            variant="outline"
          >
            {isIssuingApiKey ? text.issuingApiKey : text.issueApiKey}
          </Button>
        </div>
      ) : null}
      {oneTimeApiKey ? (
        <div className="one-time-secret">
          <div>
            <p className="console-kicker">{oneTimeApiKey.projectName}</p>
            <h4>API Key</h4>
            <p>{oneTimeApiKey.apiKey.warning || text.apiKeyIssued}</p>
          </div>
          <code>{oneTimeApiKey.apiKey.plaintext}</code>
        </div>
      ) : null}
      {!hasRoutingCandidates ? (
        <div className="policy-alert runtime-credential-alert" data-status="error">
          <span>{text.providerConnectionMissing}</span>
        </div>
      ) : null}
      {!hasRoutingAuthoringProfile ? (
        <div className="policy-alert runtime-credential-alert" data-status="error">
          <span>{text.routingAuthoringRequired}</span>
        </div>
      ) : null}
      {submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="policy-section-toolbar">
        <div className="policy-section-tabs" aria-label="Policy sections" role="tablist">
          {visiblePolicySections.map((section) => {
            const label = getPolicySectionLabel(section, text);
            const isActive = activePolicySection === section;

            return (
              <button
                aria-controls={getPolicyPanelId(section)}
                aria-selected={isActive}
                data-active={isActive}
                id={getPolicyTabId(section)}
                key={section}
                onClick={() => setActivePolicySection(section)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            );
          })}
        </div>
        {activePolicySection !== "employees" ? (
          <div className="policy-actions">
            <Button
              aria-label={
                hasUnsavedChanges
                  ? `${text.saveDraft}: ${text.unsavedChanges}`
                  : text.saveDraft
              }
              className="policy-draft-button"
              data-unsaved={hasUnsavedChanges}
              disabled={
                isSubmitting ||
                !hasActiveApiKey ||
                !hasRoutingCandidates ||
                !hasRoutingAuthoringProfile
              }
              onClick={() => void submitPolicy("save-draft")}
              type="button"
              variant="outline"
            >
              <Save aria-hidden="true" />
              {text.saveDraft}
            </Button>
            <Button
              disabled={
                isSubmitting ||
                !hasActiveApiKey ||
                !hasRoutingCandidates ||
                !hasRoutingAuthoringProfile
              }
              onClick={() => void submitPolicy("publish")}
              type="button"
            >
              <UploadCloud aria-hidden="true" />
              {text.publish}
            </Button>
          </div>
        ) : null}
      </div>

      {hasGeneralSection && activePolicySection === "general" ? (
        <section className="policy-general-layout">
          <div
            aria-labelledby={getPolicyTabId("general")}
            className="policy-tab-panel"
            id={getPolicyPanelId("general")}
            role="tabpanel"
            tabIndex={0}
          >
            <RuntimePolicyMovedBudgetContext.Provider
              value={shouldRenderMovedBudgetInChildSlot ? renderBudgetPolicyPanel(true) : null}
            >
              {children}
            </RuntimePolicyMovedBudgetContext.Provider>
            {shouldRenderMovedBudgetAfterChildren ? renderBudgetPolicyPanel(true) : null}
            {generalFooter}
          </div>
        </section>
      ) : null}

      {renderActivePolicyPanel()}
    </main>
  );
}

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
import { getPreferredRuntimePolicyRouteModel } from "@/lib/control-plane/runtime-policy-model-selection";
import {
  getRuntimePolicyDraftValues,
  type RuntimePolicyConfig,
  type RuntimePolicyDraftValues
} from "@/lib/control-plane/runtime-policy-types";
import type { Locale } from "@/lib/i18n/locale";
import type {
  OneTimeApiKeyState,
  PolicySection,
  RoutingPriorityRoute,
  RuntimePolicyEditorProps,
  RuntimePolicyEditorText,
  SubmitState
} from "./runtime-policy-editor-types";
import {
  areRuntimePolicyDraftValuesEqual,
  getRoutingProviderOptions,
  getSelectedRoutingProviderConnections,
  getSelectedRoutingProviderNames,
  getWritableRuntimePolicyDraftValues,
  groupRoutingModelsByProvider,
  hasRoutingModelSelection,
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
          { heading: "Routing" },
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
    defaultRoute: "Default route",
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
    fallbackRoute: "Fallback route",
    fixtureFallback: "Control Plane unavailable. Showing fixture values.",
    general: "General",
    highQualityRoute: "High-quality route",
    jsonMode: "JSON",
    limit: "Limit",
    lowCostRoute: "Low-cost route",
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
    routingAdvanced: "Routing advanced",
    runtimeSnapshot: "RuntimeSnapshot",
    responseCapture: "Response capture",
    responseCaptureHint:
      "Backend policy is preserved for publish, but raw response content is not displayed in this console.",
    responseCaptureMaxChars: "Max characters",
    saveDraft: "Save draft",
    safetyTab: "Safety",
    issueApiKey: "Issue API Key",
    issuingApiKey: "Issuing...",
    shortPrompt: "Short prompt threshold",
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
    activeConfig: "Active config",
    activeApiKeyMissing:
      "Runtime policy 저장과 게시에는 이 프로젝트의 active API Key가 필요합니다.",
    apiKeyIssueFailed: "API Key 발급에 실패했습니다.",
    apiKeyIssued:
      "Active API Key가 준비되었습니다. 원문은 지금 저장해야 하며 다시 표시되지 않습니다.",
    budget: "Budget policy",
    budgetEnforcement: "Enforcement",
    budgetPolicyEnabled: "예산 정책 사용",
    budgetPolicyHint: "프로젝트 예산 초과 시 동작을 제어합니다.",
    budgetTab: "Budget",
    budgetWarning: "Warning threshold",
    blockAction: "차단",
    cache: "Exact cache",
    cacheEnabled: "캐시 사용",
    cacheEnabledHint:
      "동일한 요청은 Provider 호출 전에 기존 응답을 재사용합니다.",
    cacheSettings: "캐시 설정",
    cacheSection: "캐시",
    cacheTab: "Cache",
    cacheTtl: "TTL 초",
    catalogVersion: "Catalog version",
    configVersion: "Config version",
    completionPrice: "Completion micro USD",
    defaultRoute: "Default route",
    detectorNames: {
      api_key: "API 키",
      authorization_header: "Authorization 헤더",
      email: "이메일",
      jwt: "JWT",
      organization_name: "조직명",
      person_name: "이름",
      phone_number: "전화번호",
      postal_address: "주소",
      private_key: "Private Key",
      resident_registration_number: "주민등록번호"
    },
    detectors: "Safety detector",
    detectorType: "Detector",
    close: "닫기",
    details: "상세보기",
    disabled: "비활성화",
    edit: "편집",
    enabled: "사용",
    employees: "직원",
    fallbackRoute: "Fallback route",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 값을 표시 중입니다.",
    general: "일반",
    highQualityRoute: "High-quality route",
    jsonMode: "JSON",
    limit: "한도",
    lowCostRoute: "Low-cost route",
    logSafeCaptureHint:
      "켜져 있을 때 Request Detail에 masking 이후 log-safe prompt만 저장합니다.",
    mandatoryProtection: "중요 민감정보 보호",
    mandatoryProtectionHint: "이 항목은 사용 중지할 수 없습니다.",
    maxBucketTokens: "최대 버킷 토큰",
    mode: "모드",
    model: "Model",
    models: "Models",
    noProviderModels: "설정된 model 없음",
    placeholder: "Placeholder",
    policyDetails: "정책 상세",
    pricing: "Pricing rules",
    pricingVersion: "Pricing version",
    privacyMasking: "개인정보 마스킹",
    promptCapture: "프롬프트 캡처",
    promptCaptureEnabled: "로그 안전 캡처",
    promptCaptureMaxChars: "최대 글자 수",
    promptPrice: "Prompt micro USD",
    provider: "Provider",
    providerConnectionMissing:
      "정책을 저장하거나 게시하려면 model이 설정된 provider를 하나 이상 연결해야 합니다.",
    providerCount: "Providers",
    providerCatalog: "Provider catalog",
    publish: "Active config 게시",
    publishedAt: "게시 시각",
    history: "Runtime history",
    rateLimit: "Rate limit",
    rateLimitInfo:
      "요청 폭주를 막기 위한 제한입니다. 요청 1건은 토큰 1개를 사용하고, 토큰은 매초 설정한 수만큼 다시 채워집니다. 최대 버킷 토큰 수를 넘어서 쌓이지 않으며, 토큰이 부족하면 Provider 호출 전에 차단됩니다.",
    rateLimitTab: "Rate Limit",
    redactAction: "마스킹",
    refillRate: "초당 충전 토큰",
    remove: "삭제",
    rollback: "Rollback",
    routing: "Routing",
    routingAdvanced: "Routing advanced",
    runtimeSnapshot: "RuntimeSnapshot",
    responseCapture: "응답 캡처",
    responseCaptureHint:
      "백엔드 정책은 게시 시 보존하지만, 이 콘솔에서는 raw response 원문을 표시하지 않습니다.",
    responseCaptureMaxChars: "최대 글자 수",
    saveDraft: "Draft 저장",
    safetyTab: "Safety",
    issueApiKey: "API Key 발급",
    issuingApiKey: "발급 중...",
    shortPrompt: "Short prompt 기준",
    snapshotState: "Snapshot state",
    snapshotVersion: "Snapshot version",
    semanticCache: "Semantic cache",
    semanticCacheDisabled: "disabled",
    semanticCacheEvidenceOnly: "evidence only",
    semanticCacheNote:
      "현재 Control Plane은 cache policy에서 semantic cache evidence mode를 파생합니다. 실시간 응답 경로는 아닙니다.",
    streaming: "Streaming",
    streamingNote:
      "Streaming은 v2 thin slice입니다. request-side safety가 streaming 시작 전에 완료되고, stream=true 요청은 streaming cache 계약 전까지 Exact Cache를 우회합니다.",
    streamingUnavailable: "활성 RuntimeSnapshot streaming 상태가 없습니다.",
    templateFallback:
      "이 애플리케이션에는 아직 활성 정책이 없습니다. 정책을 설정하고 게시하면 Gateway 경로에 적용됩니다.",
    title: "정책",
    tokens: "Context tokens",
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
            { heading: text.routing },
            { heading: text.routingAdvanced, lineCount: 1 },
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
    getWritableRuntimePolicyDraftValues(
      model.activeConfig,
      model.providerConnections.available
    )
  );
  const [savedDraftValues, setSavedDraftValues] = useState<RuntimePolicyDraftValues>(() =>
    getWritableRuntimePolicyDraftValues(
      model.activeConfig,
      model.providerConnections.available
    )
  );
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const [activePolicySection, setActivePolicySection] = useState<PolicySection>(
    hasGeneralSection ? "general" : "routing"
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
    if (!hasGeneralSection && activePolicySection === "general") {
      setActivePolicySection("routing");
    }
    if (!hasEmployeeSection && activePolicySection === "employees") {
      setActivePolicySection(hasGeneralSection ? "general" : "routing");
    }
    if (shouldMoveBudgetToGeneral && activePolicySection === "budget") {
      setActivePolicySection(hasGeneralSection ? "general" : "routing");
    }
  }, [activePolicySection, hasEmployeeSection, hasGeneralSection, shouldMoveBudgetToGeneral]);
  useEffect(() => {
    const nextDraftValues = getWritableRuntimePolicyDraftValues(
      model.activeConfig,
      model.providerConnections.available
    );
    setDraftValues(nextDraftValues);
    setSavedDraftValues(nextDraftValues);
  }, [model.activeConfig, model.applicationId, model.providerConnections.available]);
  const hasUnsavedChanges = useMemo(
    () => !areRuntimePolicyDraftValuesEqual(draftValues, savedDraftValues),
    [draftValues, savedDraftValues]
  );
  const hasActiveApiKey = activeApiKeyCount > 0;
  const modelOptionsByProvider = useMemo(
    () => groupRoutingModelsByProvider(draftValues.models, model.providerConnections.available),
    [draftValues.models, model.providerConnections.available]
  );
  const routingProviderOptions = useMemo(
    () =>
      getRoutingProviderOptions(model.providerConnections.available, draftValues.models, [
        draftValues.routingDefaultProvider,
        draftValues.routingHighQualityProvider,
        draftValues.routingLowCostProvider,
        draftValues.routingFallbackProvider
      ]),
    [
      draftValues.models,
      draftValues.routingDefaultProvider,
      draftValues.routingFallbackProvider,
      draftValues.routingHighQualityProvider,
      draftValues.routingLowCostProvider,
      model.providerConnections.available
    ]
  );
  const selectedRoutingProviderNames = getSelectedRoutingProviderNames(draftValues);
  const selectedRoutingProviderConnections = getSelectedRoutingProviderConnections(
    draftValues,
    model.providerConnections.available
  );
  const hasRoutingCandidates =
    routingProviderOptions.length > 0 &&
    selectedRoutingProviderNames.length > 0 &&
    selectedRoutingProviderConnections.length === selectedRoutingProviderNames.length &&
    hasRoutingModelSelection(
      draftValues.routingDefaultProvider,
      draftValues.routingDefaultModel,
      modelOptionsByProvider
    ) &&
    hasRoutingModelSelection(
      draftValues.routingHighQualityProvider,
      draftValues.routingHighQualityModel,
      modelOptionsByProvider
    ) &&
    hasRoutingModelSelection(
      draftValues.routingLowCostProvider,
      draftValues.routingLowCostModel,
      modelOptionsByProvider
    ) &&
    hasRoutingModelSelection(
      draftValues.routingFallbackProvider,
      draftValues.routingFallbackModel,
      modelOptionsByProvider
    );

  function updateRoutingProvider(route: RoutingPriorityRoute, provider: string) {
    setDraftValues((current) => {
      const nextModel =
        getPreferredRuntimePolicyRouteModel(current.models, provider, route)?.model ??
        modelOptionsByProvider.get(provider)?.[0]?.model ??
        "";

      if (route === "default") {
        return {
          ...current,
          routingDefaultModel: nextModel,
          routingDefaultProvider: provider
        };
      }

      return {
        ...current,
        ...(route === "highQuality"
          ? {
              routingHighQualityModel: nextModel,
              routingHighQualityProvider: provider
            }
          : route === "lowCost"
            ? {
                routingLowCostModel: nextModel,
                routingLowCostProvider: provider
              }
            : {
                routingFallbackModel: nextModel,
                routingFallbackProvider: provider
              })
      };
    });
  }

  function updateRoutingModel(route: RoutingPriorityRoute, modelName: string) {
    setDraftValues((current) => {
      if (route === "default") {
        return {
          ...current,
          routingDefaultModel: modelName
        };
      }

      return {
        ...current,
        ...(route === "highQuality"
          ? { routingHighQualityModel: modelName }
          : route === "lowCost"
            ? { routingLowCostModel: modelName }
            : { routingFallbackModel: modelName })
      };
    });
  }

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

    setIsSubmitting(true);
    setSubmitState({ message: "", status: "idle" });

    if (selectedRoutingProviderConnections.length !== selectedRoutingProviderNames.length) {
      setSubmitState({
        message: text.providerConnectionMissing,
        status: "error"
      });
      setIsSubmitting(false);
      return;
    }

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

    const submitValues = mergeDraftValuesWithProviderConnections(
      draftValues,
      selectedRoutingProviderConnections
    );

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
              modelOptionsByProvider={modelOptionsByProvider}
              onModelChange={updateRoutingModel}
              onProviderChange={updateRoutingProvider}
              onShortPromptChange={(value: number) =>
                setDraftValues((current) => ({
                  ...current,
                  routingShortPromptMaxChars: value
                }))
              }
              providerCatalog={model.providerCatalog}
              providerOptions={routingProviderOptions}
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
              disabled={isSubmitting || !hasActiveApiKey || !hasRoutingCandidates}
              onClick={() => void submitPolicy("save-draft")}
              type="button"
              variant="outline"
            >
              <Save aria-hidden="true" />
              {text.saveDraft}
            </Button>
            <Button
              disabled={isSubmitting || !hasActiveApiKey || !hasRoutingCandidates}
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

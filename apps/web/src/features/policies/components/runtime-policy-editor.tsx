"use client";

import { Save, UploadCloud } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { getProviderConnectionFamily } from "@/features/provider-connections/components/provider-family-icon";
import type { OneTimeApiKeyResponse } from "@/lib/control-plane/api-keys-types";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import { applyPrimaryRuntimePolicyRouteSelection } from "@/lib/control-plane/runtime-policy-model-selection";
import {
  getRuntimePolicyDraftValues,
  type RuntimePolicyConfig,
  type RuntimePolicyDraftValues,
  type RuntimePolicyModelConfig,
  type RuntimePolicyModel
} from "@/lib/control-plane/runtime-policy-types";
import type { Locale } from "@/lib/i18n/locale";
import {
  PolicyDetailModalFallback,
  PolicyPanelFallback,
  PolicyPanelFallbackGroup
} from "./runtime-policy-panel-fallback";

type RuntimePolicyEditorProps = {
  apiKeyReadiness?: RuntimePolicyApiKeyReadiness;
  breadcrumbItems?: BreadcrumbItem[];
  children?: ReactNode;
  generalFooter?: ReactNode;
  hideStreamingTab?: boolean;
  locale: Locale;
  model: RuntimePolicyModel;
  moveBudgetToGeneral?: boolean;
};

type RuntimePolicyApiKeyReadiness = {
  activeApiKeyCount: number;
  loadError: string | null;
  projectId: string;
  projectName: string;
};

type SubmitState =
  | {
      message: string;
      status: "error" | "idle" | "success";
    }
  | {
      message: string;
      runtimeConfig: RuntimePolicyConfig;
      status: "success";
    };

type OneTimeApiKeyState = {
  apiKey: OneTimeApiKeyResponse;
  projectName: string;
};

export type PolicySection =
  | "general"
  | "safety"
  | "routing"
  | "budget"
  | "rateLimit"
  | "cache"
  | "streaming";

export type RoutingProviderOption = {
  displayName: string;
  family: string;
  provider: string;
  providerId: string;
};

export type RoutingPriorityRoute = "default" | "fallback" | "lowCost";

type PolicySectionLabelText = {
  budgetTab: string;
  cacheTab: string;
  general: string;
  rateLimitTab: string;
  routing: string;
  safetyTab: string;
  streaming: string;
};

const policySections: PolicySection[] = [
  "routing",
  "budget",
  "rateLimit",
  "cache",
  "safety",
  "streaming"
];

const BudgetPolicyPanel = lazy(() =>
  import("./runtime-policy-editor-panels/budget-policy-panel").then((module) => ({
    default: module.BudgetPolicyPanel
  }))
);
const CachePolicyPanel = lazy(() =>
  import("./runtime-policy-editor-panels/cache-policy-panel").then((module) => ({
    default: module.CachePolicyPanel
  }))
);
const RateLimitPolicyPanel = lazy(() =>
  import("./runtime-policy-editor-panels/rate-limit-policy-panel").then((module) => ({
    default: module.RateLimitPolicyPanel
  }))
);
const RoutingPolicyPanel = lazy(() =>
  import("./runtime-policy-editor-panels/routing-policy-panel").then((module) => ({
    default: module.RoutingPolicyPanel
  }))
);
const SafetyPolicyPanel = lazy(() =>
  import("./runtime-policy-editor-panels/safety-policy-panel").then((module) => ({
    default: module.SafetyPolicyPanel
  }))
);
const StreamingPolicyPanel = lazy(() =>
  import("./runtime-policy-editor-panels/streaming-policy-panel").then((module) => ({
    default: module.StreamingPolicyPanel
  }))
);
const RuntimePolicyDetailModal = lazy(() =>
  import("./runtime-policy-detail-modal").then((module) => ({
    default: module.RuntimePolicyDetailModal
  }))
);

function getPolicyTabId(section: PolicySection) {
  return `policy-tab-${section}`;
}

function getPolicyPanelId(section: PolicySection) {
  return `policy-panel-${section}`;
}

function getPolicySectionLabel(section: PolicySection, text: PolicySectionLabelText) {
  switch (section) {
    case "general":
      return text.general;
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

const policyText: Record<
  Locale,
  {
    activeConfig: string;
    activeApiKeyMissing: string;
    apiKeyIssueFailed: string;
    apiKeyIssued: string;
    budget: string;
    budgetEnforcement: string;
    budgetTab: string;
    budgetWarning: string;
    cache: string;
    cacheEnabled: string;
    cacheSection: string;
    cacheTab: string;
    cacheTtl: string;
    catalogVersion: string;
    configVersion: string;
    completionPrice: string;
    defaultRoute: string;
    detectors: string;
    detectorType: string;
    close: string;
    details: string;
    disabled: string;
    enabled: string;
    fallbackRoute: string;
    fixtureFallback: string;
    general: string;
    jsonMode: string;
    limit: string;
    lowCostRoute: string;
    logSafeCaptureHint: string;
    mandatoryProtection: string;
    mandatoryProtectionHint: string;
    maxBucketTokens: string;
    mode: string;
    model: string;
    models: string;
    noProviderModels: string;
    placeholder: string;
    policyDetails: string;
    pricing: string;
    pricingVersion: string;
    promptCapture: string;
    promptCaptureEnabled: string;
    promptCaptureMaxChars: string;
    promptPrice: string;
    provider: string;
    providerConnectionMissing: string;
    providerCount: string;
    providerCatalog: string;
    publish: string;
    publishedAt: string;
    history: string;
    rateLimit: string;
    rateLimitInfo: string;
    rateLimitTab: string;
    refillRate: string;
    remove: string;
    rollback: string;
    routing: string;
    routingAdvanced: string;
    runtimeSnapshot: string;
    responseCapture: string;
    responseCaptureHint: string;
    responseCaptureMaxChars: string;
    saveDraft: string;
    safetyTab: string;
    issueApiKey: string;
    issuingApiKey: string;
    shortPrompt: string;
    snapshotState: string;
    snapshotVersion: string;
    semanticCache: string;
    semanticCacheDisabled: string;
    semanticCacheEvidenceOnly: string;
    semanticCacheNote: string;
    streaming: string;
    streamingNote: string;
    streamingUnavailable: string;
    templateFallback: string;
    title: string;
    tokens: string;
  }
> = {
  en: {
    activeConfig: "Active config",
    activeApiKeyMissing:
      "Runtime policy save and publish require an active API Key for this project.",
    apiKeyIssueFailed: "API Key issue failed.",
    apiKeyIssued:
      "Active API Key prepared. Store the plaintext now; it will not be displayed again.",
    budget: "Budget policy",
    budgetEnforcement: "Enforcement",
    budgetTab: "Budget",
    budgetWarning: "Warning threshold",
    cache: "Exact cache",
    cacheEnabled: "Cache enabled",
    cacheSection: "Cache",
    cacheTab: "Cache",
    cacheTtl: "TTL seconds",
    catalogVersion: "Catalog version",
    configVersion: "Config version",
    completionPrice: "Completion micro USD",
    defaultRoute: "Default route",
    detectors: "Safety detectors",
    detectorType: "Detector",
    close: "Close",
    details: "Details",
    disabled: "Disabled",
    enabled: "Enabled",
    fallbackRoute: "Fallback route",
    fixtureFallback: "Control Plane unavailable. Showing fixture values.",
    general: "General",
    jsonMode: "JSON",
    limit: "Limit",
    lowCostRoute: "Low-cost route",
    logSafeCaptureHint:
      "Stores only the post-masking log-safe prompt in Request Detail when enabled.",
    mandatoryProtection: "Mandatory sensitive data protection: always active",
    mandatoryProtectionHint:
      "API key, JWT, Authorization header, private key, and RRN stay protected regardless of PII masking settings.",
    maxBucketTokens: "Max bucket tokens",
    mode: "Mode",
    model: "Model",
    models: "Models",
    noProviderModels: "No configured models",
    placeholder: "Placeholder",
    policyDetails: "Policy details",
    pricing: "Pricing rules",
    pricingVersion: "Pricing version",
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
    tokens: "Context tokens"
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
    budgetTab: "Budget",
    budgetWarning: "Warning threshold",
    cache: "Exact cache",
    cacheEnabled: "캐시 사용",
    cacheSection: "캐시",
    cacheTab: "Cache",
    cacheTtl: "TTL 초",
    catalogVersion: "Catalog version",
    configVersion: "Config version",
    completionPrice: "Completion micro USD",
    defaultRoute: "Default route",
    detectors: "Safety detector",
    detectorType: "Detector",
    close: "닫기",
    details: "상세보기",
    disabled: "비활성화",
    enabled: "사용",
    fallbackRoute: "Fallback route",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 값을 표시 중입니다.",
    general: "일반",
    jsonMode: "JSON",
    limit: "한도",
    lowCostRoute: "Low-cost route",
    logSafeCaptureHint:
      "켜져 있을 때 Request Detail에 masking 이후 log-safe prompt만 저장합니다.",
    mandatoryProtection: "중요 민감정보 보호: 항상 활성화",
    mandatoryProtectionHint:
      "API key, JWT, Authorization header, private key, 주민등록번호는 PII masking 설정과 관계없이 항상 보호됩니다.",
    maxBucketTokens: "최대 버킷 토큰",
    mode: "모드",
    model: "Model",
    models: "Models",
    noProviderModels: "설정된 model 없음",
    placeholder: "Placeholder",
    policyDetails: "정책 상세",
    pricing: "Pricing rules",
    pricingVersion: "Pricing version",
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
    tokens: "Context tokens"
  }
};

export type RuntimePolicyEditorText = (typeof policyText)["en"];

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
            { heading: text.promptCapture },
            { heading: text.responseCapture }
          ]}
        />
      );
    case "streaming":
      return <PolicyPanelFallback heading={text.streaming} />;
    case "general":
      return null;
  }
}

export function RuntimePolicyEditor({
  apiKeyReadiness,
  breadcrumbItems,
  children,
  generalFooter,
  hideStreamingTab = false,
  locale,
  model,
  moveBudgetToGeneral = false
}: RuntimePolicyEditorProps) {
  const router = useRouter();
  const text = policyText[locale];
  const hasGeneralSection = Boolean(children || generalFooter);
  const shouldMoveBudgetToGeneral = moveBudgetToGeneral && hasGeneralSection;
  const [activeApiKeyCount, setActiveApiKeyCount] = useState(
    apiKeyReadiness?.activeApiKeyCount ?? 1
  );
  const [draftValues, setDraftValues] = useState<RuntimePolicyDraftValues>(() =>
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
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isIssuingApiKey, setIsIssuingApiKey] = useState(false);
  const [oneTimeApiKey, setOneTimeApiKey] = useState<OneTimeApiKeyState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  const visiblePolicySections = useMemo(
    () => {
      const policySectionsForContext = shouldMoveBudgetToGeneral
        ? policySections.filter((section) => section !== "budget")
        : policySections;
      const sections: PolicySection[] = hasGeneralSection
        ? ["general", ...policySectionsForContext]
        : [...policySectionsForContext];

      return hideStreamingTab
        ? sections.filter((section) => section !== "streaming")
        : sections;
    },
    [hasGeneralSection, hideStreamingTab, shouldMoveBudgetToGeneral]
  );
  useEffect(() => {
    if (!hasGeneralSection && activePolicySection === "general") {
      setActivePolicySection("routing");
    }
    if (shouldMoveBudgetToGeneral && activePolicySection === "budget") {
      setActivePolicySection(hasGeneralSection ? "general" : "routing");
    }
  }, [activePolicySection, hasGeneralSection, shouldMoveBudgetToGeneral]);
  useEffect(() => {
    setDraftValues(
      getWritableRuntimePolicyDraftValues(
        model.activeConfig,
        model.providerConnections.available
      )
    );
  }, [model.activeConfig, model.applicationId, model.providerConnections.available]);
  const displayConfig =
    submitState.status === "success" && "runtimeConfig" in submitState
      ? submitState.runtimeConfig
      : model.activeConfig;
  const hasActiveApiKey = activeApiKeyCount > 0;
  const modelOptionsByProvider = useMemo(
    () => groupRoutingModelsByProvider(draftValues.models, model.providerConnections.available),
    [draftValues.models, model.providerConnections.available]
  );
  const routingProviderOptions = useMemo(
    () =>
      getRoutingProviderOptions(model.providerConnections.available, draftValues.models, [
        draftValues.routingDefaultProvider,
        draftValues.routingLowCostProvider,
        draftValues.routingFallbackProvider
      ]),
    [
      draftValues.models,
      draftValues.routingDefaultProvider,
      draftValues.routingFallbackProvider,
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
    const nextModel = modelOptionsByProvider.get(provider)?.[0]?.model ?? "";

    setDraftValues((current) => {
      if (route === "default") {
        return applyPrimaryRuntimePolicyRouteSelection(current, {
          model: nextModel,
          provider
        });
      }

      return {
        ...current,
        ...(route === "lowCost"
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
        return applyPrimaryRuntimePolicyRouteSelection(current, {
          model: modelName,
          provider: current.routingDefaultProvider
        });
      }

      return {
        ...current,
        ...(route === "lowCost"
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
    setDraftValues(getRuntimePolicyDraftValues(payload.runtimeConfig));
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
      apiKey?: OneTimeApiKeyResponse;
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

  async function rollbackPolicy(targetConfigVersion: string) {
    setRollbackTarget(targetConfigVersion);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/runtime-config", {
      body: JSON.stringify({
        action: "rollback",
        applicationId: model.applicationId,
        targetConfigVersion
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
        message: payload.error ?? "Runtime policy rollback failed.",
        status: "error"
      });
      setRollbackTarget(null);
      return;
    }

    setSubmitState({
      message: `Rolled back from ${targetConfigVersion}.`,
      runtimeConfig: payload.runtimeConfig,
      status: "success"
    });
    setDraftValues(getRuntimePolicyDraftValues(payload.runtimeConfig));
    setRollbackTarget(null);
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
              onShortPromptChange={(value) =>
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
        <div className="policy-actions">
          <Button onClick={() => setIsDetailOpen(true)} type="button" variant="outline">
            {text.details}
          </Button>
          <Button
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

      {hasGeneralSection ? (
        <section className="policy-general-layout" hidden={activePolicySection !== "general"}>
          <div
            aria-labelledby={getPolicyTabId("general")}
            className="policy-tab-panel"
            id={getPolicyPanelId("general")}
            role="tabpanel"
            tabIndex={0}
          >
            {children}
            {shouldMoveBudgetToGeneral ? renderBudgetPolicyPanel(true) : null}
            {generalFooter}
          </div>
        </section>
      ) : null}

      <section
        className="policy-layout policy-settings-list"
        hidden={activePolicySection === "general"}
      >
        <div
          aria-labelledby={getPolicyTabId("safety")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "safety"}
          id={getPolicyPanelId("safety")}
          role="tabpanel"
          tabIndex={0}
        >
          {renderPolicyPanelContent("safety")}
        </div>

        <div
          aria-labelledby={getPolicyTabId("routing")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "routing"}
          id={getPolicyPanelId("routing")}
          role="tabpanel"
          tabIndex={0}
        >
          {renderPolicyPanelContent("routing")}
        </div>

        {!shouldMoveBudgetToGeneral ? (
          <div
            aria-labelledby={getPolicyTabId("budget")}
            className="policy-tab-panel"
            hidden={activePolicySection !== "budget"}
            id={getPolicyPanelId("budget")}
            role="tabpanel"
            tabIndex={0}
          >
            {renderPolicyPanelContent("budget")}
          </div>
        ) : null}

        <div
          aria-labelledby={getPolicyTabId("rateLimit")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "rateLimit"}
          id={getPolicyPanelId("rateLimit")}
          role="tabpanel"
          tabIndex={0}
        >
          {renderPolicyPanelContent("rateLimit")}
        </div>

        <div
          aria-labelledby={getPolicyTabId("cache")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "cache"}
          id={getPolicyPanelId("cache")}
          role="tabpanel"
          tabIndex={0}
        >
          {renderPolicyPanelContent("cache")}
        </div>

        {hideStreamingTab ? null : (
          <div
            aria-labelledby={getPolicyTabId("streaming")}
            className="policy-tab-panel"
            hidden={activePolicySection !== "streaming"}
            id={getPolicyPanelId("streaming")}
            role="tabpanel"
            tabIndex={0}
          >
            {renderPolicyPanelContent("streaming")}
          </div>
        )}

      </section>

      {isDetailOpen ? (
        <div className="modal-backdrop" onClick={() => setIsDetailOpen(false)} role="presentation">
          <Suspense
            fallback={
              <PolicyDetailModalFallback
                onClose={() => setIsDetailOpen(false)}
                text={text}
              />
            }
          >
            <RuntimePolicyDetailModal
              displayConfig={displayConfig}
              isSubmitting={isSubmitting}
              model={model}
              onClose={() => setIsDetailOpen(false)}
              onRollback={(configVersion) => void rollbackPolicy(configVersion)}
              rollbackTarget={rollbackTarget}
              text={text}
            />
          </Suspense>
        </div>
      ) : null}
    </main>
  );
}

function getWritableRuntimePolicyDraftValues(
  config: RuntimePolicyConfig,
  providerConnections: ProviderConnectionRecord[]
) {
  return normalizeDraftRoutingForProviderConnections(
    getRuntimePolicyDraftValues(config),
    providerConnections
  );
}

function normalizeDraftRoutingForProviderConnections(
  values: RuntimePolicyDraftValues,
  providerConnections: ProviderConnectionRecord[]
): RuntimePolicyDraftValues {
  const modelOptionsByProvider = groupRoutingModelsByProvider(values.models, providerConnections);
  const runtimeModels = getProviderConnectionRuntimeModels(providerConnections);
  const firstActiveModel = runtimeModels.find((model) => model.status === "active") ?? runtimeModels[0];

  if (!firstActiveModel) {
    return values;
  }

  const defaultRouteAvailable = hasRoutingModelSelection(
    values.routingDefaultProvider,
    values.routingDefaultModel,
    modelOptionsByProvider
  );
  const lowCostRouteAvailable = hasRoutingModelSelection(
    values.routingLowCostProvider,
    values.routingLowCostModel,
    modelOptionsByProvider
  );
  const fallbackRouteAvailable = hasRoutingModelSelection(
    values.routingFallbackProvider,
    values.routingFallbackModel,
    modelOptionsByProvider
  );

  if (defaultRouteAvailable && lowCostRouteAvailable && fallbackRouteAvailable) {
    return values;
  }

  return {
    ...values,
    routingDefaultModel: defaultRouteAvailable
      ? values.routingDefaultModel
      : firstActiveModel.model,
    routingDefaultProvider: defaultRouteAvailable
      ? values.routingDefaultProvider
      : firstActiveModel.provider,
    routingFallbackModel: fallbackRouteAvailable
      ? values.routingFallbackModel
      : firstActiveModel.model,
    routingFallbackProvider: fallbackRouteAvailable
      ? values.routingFallbackProvider
      : firstActiveModel.provider,
    routingLowCostModel: lowCostRouteAvailable
      ? values.routingLowCostModel
      : firstActiveModel.model,
    routingLowCostProvider: lowCostRouteAvailable
      ? values.routingLowCostProvider
      : firstActiveModel.provider
  };
}

function groupModelsByProvider(models: RuntimePolicyModelConfig[]) {
  const groups = new Map<string, RuntimePolicyModelConfig[]>();

  for (const model of models) {
    const modelsForProvider = groups.get(model.provider) ?? [];
    modelsForProvider.push(model);
    groups.set(model.provider, modelsForProvider);
  }

  return groups;
}

function groupRoutingModelsByProvider(
  _models: RuntimePolicyModelConfig[],
  providerConnections: ProviderConnectionRecord[]
) {
  return groupModelsByProvider(getProviderConnectionRuntimeModels(providerConnections));
}

function getRoutingProviderOptions(
  providerConnections: ProviderConnectionRecord[],
  _models: RuntimePolicyModelConfig[],
  selectedProviders: Array<string | null | undefined>
): RoutingProviderOption[] {
  const providerOptions = new Map<string, RoutingProviderOption>();

  for (const providerConnection of providerConnections) {
    const providerName = normalizePolicyText(providerConnection.provider);
    const displayName = normalizePolicyText(providerConnection.displayName) || providerName;

    if (providerName && getProviderConnectionModels(providerConnection).length > 0) {
      providerOptions.set(providerName, {
        displayName,
        family: getProviderConnectionFamily(providerConnection),
        provider: providerName,
        providerId: providerConnection.id
      });
    }
  }

  for (const provider of selectedProviders) {
    const providerName = normalizePolicyText(provider);
    const providerConnection = providerConnections.find(
      (connection) => normalizePolicyText(connection.provider) === providerName
    );

    if (
      providerName &&
      !providerOptions.has(providerName) &&
      providerConnection
    ) {
      providerOptions.set(providerName, {
        displayName: normalizePolicyText(providerConnection.displayName) || providerName,
        family: getProviderConnectionFamily(providerConnection),
        provider: providerName,
        providerId: `selected-provider-${providerName}`
      });
    }
  }

  return Array.from(providerOptions.values());
}

function getSelectedRoutingProviderConnections(
  values: RuntimePolicyDraftValues,
  providerConnections: ProviderConnectionRecord[]
) {
  const providerConnectionsByProvider = new Map(
    providerConnections.map((providerConnection) => [
      normalizePolicyText(providerConnection.provider),
      providerConnection
    ])
  );

  return getSelectedRoutingProviderNames(values)
    .map((provider) => providerConnectionsByProvider.get(provider))
    .filter(
      (providerConnection): providerConnection is ProviderConnectionRecord =>
        Boolean(providerConnection && getProviderConnectionModels(providerConnection).length > 0)
    );
}

function getSelectedRoutingProviderNames(values: RuntimePolicyDraftValues) {
  return Array.from(
    new Set(
      [
        values.routingDefaultProvider,
        values.routingLowCostProvider,
        values.routingFallbackProvider
      ]
        .map((provider) => normalizePolicyText(provider))
        .filter(Boolean)
    )
  );
}

function mergeDraftValuesWithProviderConnections(
  values: RuntimePolicyDraftValues,
  providerConnections: ProviderConnectionRecord[]
): RuntimePolicyDraftValues {
  const providerModels = getProviderConnectionRuntimeModels(providerConnections);
  const models = mergeRuntimePolicyModels([], providerModels);
  const providerModelKeys = new Set(
    providerModels.map((model) => runtimePolicyModelKey(model.provider, model.model))
  );

  return {
    ...values,
    models,
    pricingRules: mergeRuntimePolicyPricingRules(
      values.pricingRules.filter((pricingRule) =>
        providerModelKeys.has(runtimePolicyModelKey(pricingRule.provider, pricingRule.model))
      ),
      providerModels
    )
  };
}

function getProviderConnectionRuntimeModels(providerConnections: ProviderConnectionRecord[]) {
  return providerConnections.flatMap((providerConnection) =>
    getProviderConnectionModels(providerConnection).map((modelName) =>
      toRuntimePolicyModelConfig(providerConnection, modelName)
    )
  );
}

function toRuntimePolicyModelConfig(
  providerConnection: ProviderConnectionRecord,
  modelName: string
): RuntimePolicyModelConfig {
  return {
    contextWindowTokens: 128000,
    displayName: modelName,
    model: modelName,
    provider: providerConnection.provider,
    status: providerConnection.status === "ACTIVE" ? "active" : "disabled",
    supportsJsonMode: true,
    supportsStreaming: true
  };
}

function mergeRuntimePolicyModels(
  models: RuntimePolicyModelConfig[],
  nextModels: RuntimePolicyModelConfig[]
) {
  const merged = new Map<string, RuntimePolicyModelConfig>();

  for (const model of [...models, ...nextModels]) {
    const provider = normalizePolicyText(model.provider);
    const modelName = normalizePolicyText(model.model);

    if (provider && modelName) {
      merged.set(`${provider}::${modelName}`, {
        ...model,
        displayName: normalizePolicyText(model.displayName) || modelName,
        model: modelName,
        provider
      });
    }
  }

  return Array.from(merged.values());
}

function runtimePolicyModelKey(provider: unknown, model: unknown) {
  return `${normalizePolicyText(provider)}::${normalizePolicyText(model)}`;
}

function mergeRuntimePolicyPricingRules(
  pricingRules: RuntimePolicyDraftValues["pricingRules"],
  models: RuntimePolicyModelConfig[]
) {
  const merged = new Map<string, RuntimePolicyDraftValues["pricingRules"][number]>();

  for (const pricingRule of pricingRules) {
    const provider = normalizePolicyText(pricingRule.provider);
    const model = normalizePolicyText(pricingRule.model);

    if (provider && model) {
      merged.set(`${provider}::${model}`, {
        ...pricingRule,
        model,
        provider
      });
    }
  }

  for (const model of models) {
    const provider = normalizePolicyText(model.provider);
    const modelName = normalizePolicyText(model.model);
    const key = `${provider}::${modelName}`;

    if (provider && modelName && !merged.has(key)) {
      merged.set(key, {
        completionTokenMicroUsd: 10,
        model: modelName,
        pricingVersion: "default",
        promptTokenMicroUsd: 10,
        provider
      });
    }
  }

  return Array.from(merged.values());
}

function hasRoutingModelSelection(
  provider: string | null | undefined,
  model: string | null | undefined,
  modelOptionsByProvider: Map<string, RuntimePolicyModelConfig[]>
) {
  const trimmedProvider = normalizePolicyText(provider);
  const trimmedModel = normalizePolicyText(model);

  if (!trimmedProvider || !trimmedModel) {
    return false;
  }

  return Boolean(
    modelOptionsByProvider
      .get(trimmedProvider)
      ?.some(
        (option) =>
          normalizePolicyText(option.model) === trimmedModel && option.status === "active"
      )
  );
}

function getProviderConnectionModels(providerConnection: ProviderConnectionRecord) {
  const models = providerConnection.providerConfig?.models;

  if (!Array.isArray(models)) {
    return [];
  }

  return Array.from(
    new Set(
      models
        .map((model) => (typeof model === "string" ? model.trim() : ""))
        .filter(Boolean)
    )
  );
}

function normalizePolicyText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

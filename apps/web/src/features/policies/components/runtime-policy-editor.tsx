"use client";

import { Save, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  getProviderConnectionFamily,
  ProviderFamilyIcon
} from "@/features/provider-connections/components/provider-family-icon";
import type { OneTimeApiKeyResponse } from "@/lib/control-plane/api-keys-types";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import {
  getRateLimitRefillTokensPerSecond,
  getRateLimitWindowSeconds,
  getRuntimePolicyDraftValues,
  type RuntimePolicyConfig,
  type RuntimePolicyDetector,
  type RuntimePolicyDraftValues,
  type RuntimePolicyHistoryItem,
  type RuntimePolicyModelConfig,
  type RuntimePolicyModel,
  type RuntimePolicySnapshot
} from "@/lib/control-plane/runtime-policy-types";
import { formatDateTime } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type RuntimePolicyEditorProps = {
  apiKeyReadiness?: RuntimePolicyApiKeyReadiness;
  breadcrumbItems?: BreadcrumbItem[];
  locale: Locale;
  model: RuntimePolicyModel;
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

type PolicySection =
  | "safety"
  | "routing"
  | "budget"
  | "rateLimit"
  | "cache"
  | "streaming";

type RoutingProviderOption = {
  displayName: string;
  family: string;
  provider: string;
  providerId: string;
};

type RoutingPriorityRoute = "default" | "fallback" | "lowCost";

type PolicySectionLabelText = {
  budgetTab: string;
  cacheTab: string;
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

function getPolicyTabId(section: PolicySection) {
  return `policy-tab-${section}`;
}

function getPolicyPanelId(section: PolicySection) {
  return `policy-panel-${section}`;
}

function getPolicySectionLabel(section: PolicySection, text: PolicySectionLabelText) {
  switch (section) {
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
    general: "General",
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

export function RuntimePolicyEditor({
  apiKeyReadiness,
  breadcrumbItems,
  locale,
  model
}: RuntimePolicyEditorProps) {
  const router = useRouter();
  const text = policyText[locale];
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
  const [activePolicySection, setActivePolicySection] = useState<PolicySection>("routing");
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isIssuingApiKey, setIsIssuingApiKey] = useState(false);
  const [oneTimeApiKey, setOneTimeApiKey] = useState<OneTimeApiKeyState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
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
  const providerOptions = model.activeConfig.providers;
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

    setDraftValues((current) => ({
      ...current,
      ...(route === "default"
        ? {
            routingDefaultModel: nextModel,
            routingDefaultProvider: provider
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
    }));
  }

  function updateRoutingModel(route: RoutingPriorityRoute, modelName: string) {
    setDraftValues((current) => ({
      ...current,
      ...(route === "default"
        ? { routingDefaultModel: modelName }
        : route === "lowCost"
          ? { routingLowCostModel: modelName }
          : { routingFallbackModel: modelName })
    }));
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

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          {breadcrumbItems ? <Breadcrumb items={breadcrumbItems} /> : null}
          <p className="console-kicker">management</p>
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
        {policySections.map((section) => {
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

      <section className="policy-layout policy-settings-list">
        <div
          aria-labelledby={getPolicyTabId("safety")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "safety"}
          id={getPolicyPanelId("safety")}
          role="tabpanel"
          tabIndex={0}
        >
          <article className="console-panel policy-editor-panel wide-panel">
            <div className="panel-heading">
              <h3>{text.detectors}</h3>
            </div>
            <div className="policy-alert" data-status="warning">
              <strong>{text.mandatoryProtection}</strong>
              {" "}
              <span>{text.mandatoryProtectionHint}</span>
            </div>
            <div className="policy-detector-list">
              {draftValues.detectors.map((detector, index) => (
                <DetectorEditor
                  detector={detector}
                  key={detector.type}
                  labels={text}
                  onChange={(nextDetector) =>
                    setDraftValues((current) => ({
                      ...current,
                      detectors: current.detectors.map((item, itemIndex) =>
                        itemIndex === index ? nextDetector : item
                      )
                    }))
                  }
                />
              ))}
            </div>
          </article>

          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.promptCapture}</h3>
            </div>
            <label className="policy-toggle-row">
              <Switch
                checked={draftValues.promptCaptureEnabled}
                onCheckedChange={(checked) =>
                  setDraftValues((current) => ({
                    ...current,
                    promptCaptureEnabled: checked
                  }))
                }
              />
              <span>{text.promptCaptureEnabled}</span>
            </label>
            <p className="project-muted">{text.logSafeCaptureHint}</p>
            <PolicyNumberField
              label={text.promptCaptureMaxChars}
              max={20000}
              min={1}
              onChange={(value) =>
                setDraftValues((current) => ({
                  ...current,
                  promptCaptureMaxChars: value
                }))
              }
              value={draftValues.promptCaptureMaxChars}
            />
          </article>

          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.responseCapture}</h3>
            </div>
            <label aria-disabled="true" className="policy-toggle-row">
              <Switch checked={draftValues.responseCaptureEnabled} disabled readOnly />
              <span>
                {draftValues.responseCaptureEnabled ? text.enabled : text.disabled}
              </span>
            </label>
            <p className="project-muted">{text.responseCaptureHint}</p>
            <dl className="policy-summary-list">
              <div>
                <dt>{text.responseCaptureMaxChars}</dt>
                <dd>{draftValues.responseCaptureMaxChars}</dd>
              </div>
            </dl>
          </article>
        </div>

        <div
          aria-labelledby={getPolicyTabId("routing")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "routing"}
          id={getPolicyPanelId("routing")}
          role="tabpanel"
          tabIndex={0}
        >
          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.routing}</h3>
            </div>
            <RoutingPriorityTable
              modelOptionsByProvider={modelOptionsByProvider}
              onModelChange={updateRoutingModel}
              onProviderChange={updateRoutingProvider}
              providerOptions={routingProviderOptions}
              rows={[
                {
                  priority: "High",
                  provider: draftValues.routingLowCostProvider,
                  route: "lowCost",
                  selectedModel: draftValues.routingLowCostModel
                },
                {
                  priority: "Default",
                  provider: draftValues.routingDefaultProvider,
                  route: "default",
                  selectedModel: draftValues.routingDefaultModel
                },
                {
                  priority: "Fallback",
                  provider: draftValues.routingFallbackProvider,
                  route: "fallback",
                  selectedModel: draftValues.routingFallbackModel
                }
              ]}
              text={{
                model: text.model,
                noProviderModels: text.noProviderModels,
                provider: text.provider
              }}
            />
          </article>

          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.routingAdvanced}</h3>
            </div>
            <PolicyNumberField
              label={text.shortPrompt}
              max={100000}
              min={1}
              onChange={(value) =>
                setDraftValues((current) => ({
                  ...current,
                  routingShortPromptMaxChars: value
                }))
              }
              value={draftValues.routingShortPromptMaxChars}
            />
          </article>
        </div>

        <div
          aria-labelledby={getPolicyTabId("budget")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "budget"}
          id={getPolicyPanelId("budget")}
          role="tabpanel"
          tabIndex={0}
        >
          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.budget}</h3>
            </div>
            <label className="policy-toggle-row">
              <Switch
                checked={draftValues.budgetEnabled}
                onCheckedChange={(checked) =>
                  setDraftValues((current) => ({
                    ...current,
                    budgetEnabled: checked,
                    budgetEnforcementMode: checked
                      ? current.budgetEnforcementMode === "disabled"
                        ? "warn"
                        : current.budgetEnforcementMode
                      : "disabled"
                  }))
                }
              />
              <span>{text.enabled}</span>
            </label>
            <label className="policy-field">
              <span>{text.budgetEnforcement}</span>
              <select
                disabled={!draftValues.budgetEnabled}
                onChange={(event) =>
                  setDraftValues((current) => ({
                    ...current,
                    budgetEnforcementMode:
                      event.target.value === "block" || event.target.value === "warn"
                        ? event.target.value
                        : "disabled"
                  }))
                }
                value={draftValues.budgetEnforcementMode}
              >
                <option value="warn">warn</option>
                <option value="block">block</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
            <PolicyNumberField
              label={text.budgetWarning}
              max={100}
              min={0}
              onChange={(value) =>
                setDraftValues((current) => ({
                  ...current,
                  budgetWarningThresholdPercent: value
                }))
              }
              value={draftValues.budgetWarningThresholdPercent}
            />
          </article>
        </div>

        <div
          aria-labelledby={getPolicyTabId("rateLimit")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "rateLimit"}
          id={getPolicyPanelId("rateLimit")}
          role="tabpanel"
          tabIndex={0}
        >
          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.rateLimit}</h3>
            </div>
            <label className="policy-toggle-row">
              <Switch
                checked={draftValues.rateLimitEnabled}
                onCheckedChange={(checked) =>
                  setDraftValues((current) => ({
                    ...current,
                    rateLimitEnabled: checked
                  }))
                }
              />
              <span>{text.enabled}</span>
            </label>
            <PolicyNumberField
              label={text.refillRate}
              max={100000}
              min={1}
              onChange={(value) =>
                setDraftValues((current) => ({
                  ...current,
                  rateLimitRefillTokensPerSecond: value,
                  rateLimitWindowSeconds: getRateLimitWindowSeconds(
                    current.rateLimitLimit,
                    value
                  )
                }))
              }
              value={draftValues.rateLimitRefillTokensPerSecond}
            />
            <PolicyNumberField
              label={text.maxBucketTokens}
              max={100000}
              min={1}
              onChange={(value) =>
                setDraftValues((current) => ({
                  ...current,
                  rateLimitLimit: value,
                  rateLimitWindowSeconds: getRateLimitWindowSeconds(
                    value,
                    current.rateLimitRefillTokensPerSecond
                  )
                }))
              }
              value={draftValues.rateLimitLimit}
            />
          </article>
        </div>

        <div
          aria-labelledby={getPolicyTabId("cache")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "cache"}
          id={getPolicyPanelId("cache")}
          role="tabpanel"
          tabIndex={0}
        >
          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.cache}</h3>
            </div>
            <label className="policy-toggle-row">
              <Switch
                checked={draftValues.cacheEnabled}
                onCheckedChange={(checked) =>
                  setDraftValues((current) => ({
                    ...current,
                    cacheEnabled: checked
                  }))
                }
              />
              <span>{text.cacheEnabled}</span>
            </label>
            <PolicyNumberField
              label={text.cacheTtl}
              max={86400}
              min={1}
              onChange={(value) =>
                setDraftValues((current) => ({
                  ...current,
                  cacheTtlSeconds: value
                }))
              }
              value={draftValues.cacheTtlSeconds}
            />
          </article>

          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.semanticCache}</h3>
            </div>
            <label aria-disabled="true" className="policy-toggle-row">
              <Switch checked={draftValues.cacheEnabled} disabled readOnly />
              <span>
                {draftValues.cacheEnabled
                  ? text.semanticCacheEvidenceOnly
                  : text.semanticCacheDisabled}
              </span>
            </label>
            <dl className="policy-summary-list">
              <div>
                <dt>{text.mode}</dt>
                <dd>
                  {draftValues.cacheEnabled
                    ? text.semanticCacheEvidenceOnly
                    : text.semanticCacheDisabled}
                </dd>
              </div>
            </dl>
            <p className="project-muted">{text.semanticCacheNote}</p>
          </article>
        </div>

        <div
          aria-labelledby={getPolicyTabId("streaming")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "streaming"}
          id={getPolicyPanelId("streaming")}
          role="tabpanel"
          tabIndex={0}
        >
          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.streaming}</h3>
            </div>
            {model.runtimeSnapshot.loadError ? (
              <Alert variant="warning">
                <AlertDescription>{model.runtimeSnapshot.loadError}</AlertDescription>
              </Alert>
            ) : null}
            {model.runtimeSnapshot.snapshot ? (
              <dl className="policy-summary-list">
                <div>
                  <dt>{text.enabled}</dt>
                  <dd>{formatEnabled(model.runtimeSnapshot.snapshot.policies?.streaming?.enabled)}</dd>
                </div>
                <div>
                  <dt>thin slice</dt>
                  <dd>
                    {formatEnabled(
                      model.runtimeSnapshot.snapshot.policies?.streaming?.thinSliceOnly
                    )}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="project-muted">{text.streamingUnavailable}</p>
            )}
            <p className="project-muted">{text.streamingNote}</p>
          </article>
        </div>

      </section>

      {isDetailOpen ? (
        <div className="modal-backdrop" onClick={() => setIsDetailOpen(false)} role="presentation">
          <section
            aria-labelledby="policy-detail-title"
            aria-modal="true"
            className="modal-panel policy-detail-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="panel-heading">
              <h3 id="policy-detail-title">{text.policyDetails}</h3>
              <Button onClick={() => setIsDetailOpen(false)} type="button" variant="outline">
                {text.close}
              </Button>
            </div>

            <div className="policy-detail-layout">
              <article className="console-panel policy-editor-panel">
                <div className="panel-heading">
                  <h3>{text.runtimeSnapshot}</h3>
                </div>
                {model.runtimeSnapshot.loadError ? (
                  <Alert variant="warning">
                    <AlertDescription>{model.runtimeSnapshot.loadError}</AlertDescription>
                  </Alert>
                ) : null}
                {model.runtimeSnapshot.snapshot ? (
                  <RuntimeSnapshotDetail snapshot={model.runtimeSnapshot.snapshot} text={text} />
                ) : (
                  <dl className="policy-summary-list">
                    <div>
                      <dt>{text.snapshotState}</dt>
                      <dd>unavailable</dd>
                    </div>
                  </dl>
                )}
              </article>

              <article className="console-panel policy-editor-panel">
                <div className="panel-heading">
                  <h3>{text.providerCatalog}</h3>
                </div>
                {model.providerCatalog.loadError ? (
                  <Alert variant="warning">
                    <AlertDescription>{model.providerCatalog.loadError}</AlertDescription>
                  </Alert>
                ) : null}
                {model.providerCatalog.canonicalLoadError ? (
                  <Alert variant="warning">
                    <AlertDescription>{model.providerCatalog.canonicalLoadError}</AlertDescription>
                  </Alert>
                ) : null}
                {model.providerCatalog.summary ? (
                  <dl className="policy-summary-list">
                    <div>
                      <dt>{text.catalogVersion}</dt>
                      <dd>{model.providerCatalog.summary.catalogVersion}</dd>
                    </div>
                    <div>
                      <dt>{text.providerCount}</dt>
                      <dd>
                        {model.providerCatalog.summary.providerCount} / {text.models}:{" "}
                        {model.providerCatalog.summary.modelCount}
                      </dd>
                    </div>
                    <div>
                      <dt>canonical by-id</dt>
                      <dd>
                        {model.providerCatalog.canonicalVerified === null
                          ? "not_checked"
                          : model.providerCatalog.canonicalVerified
                            ? "verified"
                            : "mismatch"}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <dl className="policy-summary-list">
                    <div>
                      <dt>active catalog</dt>
                      <dd>unavailable</dd>
                    </div>
                    <div>
                      <dt>canonical by-id</dt>
                      <dd>not_checked</dd>
                    </div>
                  </dl>
                )}
                <dl className="policy-summary-list">
                  {providerOptions.map((provider) => (
                    <div key={provider.providerId}>
                      <dt>
                        {provider.displayName} / {provider.provider}
                      </dt>
                      <dd>
                        {provider.status} / {provider.resolver} / {provider.models.join(", ")}
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>

              <article className="console-panel policy-editor-panel wide-panel">
                <div className="panel-heading">
                  <h3>{text.history}</h3>
                </div>
                {model.history.loadError ? (
                  <Alert variant="warning">
                    <AlertDescription>{model.history.loadError}</AlertDescription>
                  </Alert>
                ) : null}
                {model.history.items.length > 0 ? (
                  <RuntimeHistoryTable
                    activeConfigVersion={displayConfig.configVersion}
                    isSubmitting={isSubmitting || rollbackTarget !== null}
                    items={model.history.items}
                    onRollback={(configVersion) => void rollbackPolicy(configVersion)}
                    rollbackTarget={rollbackTarget}
                    text={text}
                  />
                ) : (
                  <p className="empty-state">No runtime config history returned.</p>
                )}
              </article>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function RuntimeSnapshotDetail({
  snapshot,
  text
}: {
  snapshot: RuntimePolicySnapshot;
  text: (typeof policyText)[Locale];
}) {
  return (
    <div className="runtime-snapshot-detail">
      <dl className="policy-summary-list">
        <div>
          <dt>{text.snapshotState}</dt>
          <dd>{snapshot.runtimeState}</dd>
        </div>
        <div>
          <dt>{text.snapshotVersion}</dt>
          <dd>{snapshot.runtimeSnapshotVersion}</dd>
        </div>
        <div>
          <dt>lookup key</dt>
          <dd>
            {snapshot.lookupKey.tenantId} / {snapshot.lookupKey.projectId} /{" "}
            {snapshot.lookupKey.applicationId}
          </dd>
        </div>
        <div>
          <dt>budget scope</dt>
          <dd>
            {snapshot.budgetResolution.budgetScopeType}:{snapshot.budgetResolution.budgetScopeId} /{" "}
            {snapshot.budgetResolution.resolvedBy}
          </dd>
        </div>
        <div>
          <dt>{text.providerCatalog}</dt>
          <dd>
            {snapshot.providerCatalogRef.catalogId} / v
            {snapshot.providerCatalogRef.catalogVersion}
          </dd>
        </div>
      </dl>

      <dl className="policy-summary-list">
        <div>
          <dt>{text.budget}</dt>
          <dd>
            {formatEnabled(snapshot.policies.budget.enabled)} /{" "}
            {snapshot.policies.budget.enforcementMode} / warning{" "}
            {snapshot.policies.budget.warningThresholdPercent}%
          </dd>
        </div>
        <div>
          <dt>{text.rateLimit}</dt>
          <dd>
            {formatEnabled(snapshot.policies.rateLimit.enabled)} /{" "}
            {snapshot.policies.rateLimit.scope} / {text.maxBucketTokens}:{" "}
            {snapshot.policies.rateLimit.limit} / {text.refillRate}:{" "}
            {getRateLimitRefillTokensPerSecond(
              snapshot.policies.rateLimit.limit,
              snapshot.policies.rateLimit.windowSeconds
            )}
          </dd>
        </div>
        <div>
          <dt>{text.routing}</dt>
          <dd>
            {snapshot.policies.routing.defaultProvider}:{snapshot.policies.routing.defaultModel} /{" "}
            {snapshot.policies.routing.defaultRequestedModel} / auto{" "}
            {formatEnabled(snapshot.policies.routing.autoModelEnabled)}
          </dd>
        </div>
        <div>
          <dt>{text.fallbackRoute}</dt>
          <dd>
            {formatEnabled(snapshot.policies.fallback.enabled)} /{" "}
            {snapshot.policies.fallback.fallbackProvider ?? "none"}:
            {snapshot.policies.fallback.fallbackModel ?? "none"} / reasons{" "}
            {formatList(snapshot.policies.fallback.allowedReasons)}
          </dd>
        </div>
        <div>
          <dt>{text.cache}</dt>
          <dd>
            exact {formatEnabled(snapshot.policies.cache.exactCacheEnabled)} / semantic{" "}
            {snapshot.policies.cache.semanticCacheMode}
          </dd>
        </div>
        <div>
          <dt>{text.promptCapture}</dt>
          <dd>
            {formatEnabled(snapshot.policies.promptCapture?.enabled ?? false)} /{" "}
            {snapshot.policies.promptCapture?.mode ?? "disabled"} / max{" "}
            {snapshot.policies.promptCapture?.maxChars ?? 8000}
          </dd>
        </div>
        <div>
          <dt>{text.detectors}</dt>
          <dd>
            {formatEnabled(snapshot.policies.safety.enabled)} / {snapshot.policies.safety.mode} / request-side{" "}
            {formatEnabled(snapshot.policies.safety.requestSideRequired)} / detectors{" "}
            {formatDetectorSet(snapshot.policies.safety.detectorSet)}
          </dd>
        </div>
        <div>
          <dt>{text.streaming}</dt>
          <dd>
            {formatEnabled(snapshot.policies?.streaming?.enabled)} / thin slice{" "}
            {formatEnabled(snapshot.policies?.streaming?.thinSliceOnly)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function formatEnabled(value?: boolean | null) {
  return value ? "enabled" : "disabled";
}

function formatDetectorSet(detectorSet: RuntimePolicySnapshot["policies"]["safety"]["detectorSet"]) {
  if (!detectorSet || detectorSet.length === 0) {
    return "none";
  }

  return detectorSet
    .map((detector) => `${detector.detectorType}:${detector.action}`)
    .join(", ");
}

function formatList(values: string[] | undefined) {
  return values && values.length > 0 ? values.join(", ") : "none";
}

function RuntimeHistoryTable({
  activeConfigVersion,
  isSubmitting,
  items,
  onRollback,
  rollbackTarget,
  text
}: {
  activeConfigVersion: string;
  isSubmitting: boolean;
  items: RuntimePolicyHistoryItem[];
  onRollback: (configVersion: string) => void;
  rollbackTarget: string | null;
  text: (typeof policyText)[Locale];
}) {
  return (
    <div className="table-wrap">
      <table className="data-table policy-config-table">
        <thead>
          <tr>
            <th>{text.configVersion}</th>
            <th>{text.mode}</th>
            <th>{text.publishedAt}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isActive = item.configVersion === activeConfigVersion;
            const isRollingBack = rollbackTarget === item.configVersion;

            return (
              <tr key={item.id}>
                <td>
                  <strong className="provider-name">{item.configVersion}</strong>
                  <span className="project-muted">
                    {item.effectiveAt ? formatDateTime(item.effectiveAt) : "-"}
                  </span>
                </td>
                <td>{item.publishState}</td>
                <td>{item.publishedAt ? formatDateTime(item.publishedAt) : "-"}</td>
                <td>
                  <div className="project-row-actions">
                    <Button
                      disabled={isSubmitting || isActive || !item.canRollback}
                      onClick={() => onRollback(item.configVersion)}
                      type="button"
                      variant="outline"
                    >
                      {isRollingBack ? "..." : text.rollback}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RoutingPriorityTable({
  modelOptionsByProvider,
  onModelChange,
  onProviderChange,
  providerOptions,
  rows,
  text
}: {
  modelOptionsByProvider: Map<string, RuntimePolicyModelConfig[]>;
  onModelChange: (route: RoutingPriorityRoute, model: string) => void;
  onProviderChange: (route: RoutingPriorityRoute, provider: string) => void;
  providerOptions: RoutingProviderOption[];
  rows: Array<{
    priority: string;
    provider: string;
    route: RoutingPriorityRoute;
    selectedModel: string;
  }>;
  text: {
    model: string;
    noProviderModels: string;
    provider: string;
  };
}) {
  return (
    <div className="policy-routing-table" role="table" aria-label="Routing priority">
      <div className="policy-routing-table-head" role="row">
        <span role="columnheader">Priority</span>
        <span role="columnheader">{text.provider}</span>
        <span role="columnheader">{text.model}</span>
      </div>
      {rows.map((row) => (
        <RoutingPriorityRow
          key={row.route}
          modelOptionsByProvider={modelOptionsByProvider}
          onModelChange={onModelChange}
          onProviderChange={onProviderChange}
          providerOptions={providerOptions}
          row={row}
          text={text}
        />
      ))}
    </div>
  );
}

function RoutingPriorityRow({
  modelOptionsByProvider,
  onModelChange,
  onProviderChange,
  providerOptions,
  row,
  text
}: {
  modelOptionsByProvider: Map<string, RuntimePolicyModelConfig[]>;
  onModelChange: (route: RoutingPriorityRoute, model: string) => void;
  onProviderChange: (route: RoutingPriorityRoute, provider: string) => void;
  providerOptions: RoutingProviderOption[];
  row: {
    priority: string;
    provider: string;
    route: RoutingPriorityRoute;
    selectedModel: string;
  };
  text: {
    model: string;
    noProviderModels: string;
    provider: string;
  };
}) {
  const selectedProvider = getRoutingProviderOption(providerOptions, row.provider);
  const modelOptions = modelOptionsByProvider.get(row.provider) ?? [];
  const hasProviderOptions = providerOptions.length > 0;
  const selectedModelAvailable = modelOptions.some((option) => option.model === row.selectedModel);

  return (
    <div className="policy-routing-table-row" role="row">
      <div className="policy-routing-priority" role="cell">
        {row.priority}
      </div>
      <label className="policy-routing-provider-cell">
        <span className="sr-only">{row.priority} {text.provider}</span>
        {selectedProvider ? (
          <ProviderFamilyIcon
            className="policy-routing-provider-icon"
            family={selectedProvider.family}
            size={26}
          />
        ) : (
          <span className="policy-routing-provider-icon" aria-hidden="true">
            -
          </span>
        )}
        <select
          aria-label={`${row.priority} ${text.provider}`}
          disabled={!hasProviderOptions}
          onChange={(event) => onProviderChange(row.route, event.target.value)}
          value={hasProviderOptions ? row.provider : ""}
        >
          {!hasProviderOptions ? <option value="">{text.noProviderModels}</option> : null}
          {providerOptions.map((option) => (
            <option key={option.providerId} value={option.provider}>
              {option.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="policy-routing-model-cell">
        <span className="sr-only">{row.priority} {text.model}</span>
        <select
          aria-label={`${row.priority} ${text.model}`}
          disabled={modelOptions.length === 0}
          onChange={(event) => onModelChange(row.route, event.target.value)}
          value={modelOptions.length === 0 || !selectedModelAvailable ? "" : row.selectedModel}
        >
          {modelOptions.length === 0 ? <option value="">{text.noProviderModels}</option> : null}
          {modelOptions.length > 0 && !selectedModelAvailable ? (
            <option value="">Select a registered model</option>
          ) : null}
          {modelOptions.map((option) => (
            <option key={`${option.provider}:${option.model}`} value={option.model}>
              {option.displayName || option.model}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function getRoutingProviderOption(
  providerOptions: RoutingProviderOption[],
  provider: string
) {
  return providerOptions.find((option) => option.provider === provider) ?? null;
}

function PolicyNumberField({
  label,
  max,
  min,
  onChange,
  readOnly = false,
  value
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  readOnly?: boolean;
  value: number;
}) {
  return (
    <label className="policy-field">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(parseBoundedInteger(event.target.value, min, max))}
        readOnly={readOnly}
        type="number"
        value={value}
      />
    </label>
  );
}

function DetectorEditor({
  detector,
  labels,
  onChange
}: {
  detector: RuntimePolicyDetector;
  labels: (typeof policyText)["en"];
  onChange: (detector: RuntimePolicyDetector) => void;
}) {
  const isMandatory = isMandatorySafetyDetector(detector.type);
  const actionValue = isMandatory ? "block" : detector.action;

  return (
    <div
      className="policy-detector-row"
      data-detector-type={detector.type}
      data-mandatory={isMandatory}
    >
      <label className="policy-toggle-row">
        <Switch
          aria-label={`${detector.type} ${labels.enabled}`}
          checked={isMandatory || detector.enabled}
          disabled={isMandatory}
          onCheckedChange={(checked) =>
            onChange({
              ...detector,
              enabled: checked
            })
          }
        />
        <span>{labels.enabled}</span>
      </label>
      <div className="policy-detector-name">
        <span>{labels.detectorType}</span>
        <strong>{detector.type}</strong>
      </div>
      <label className="policy-field">
        <span>{labels.mode}</span>
        <select
          disabled={isMandatory}
          onChange={(event) =>
            onChange({
              ...detector,
              action: event.target.value === "block" ? "block" : "redact"
            })
          }
          value={actionValue}
        >
          <option value="redact">redact</option>
          <option value="block">block</option>
        </select>
      </label>
      <label className="policy-field">
        <span>{labels.placeholder}</span>
        <input
          onChange={(event) =>
            onChange({
              ...detector,
              placeholder: event.target.value
            })
          }
          value={detector.placeholder}
        />
      </label>
    </div>
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

function isMandatorySafetyDetector(detectorType: RuntimePolicyDetector["type"]) {
  return (
    detectorType === "resident_registration_number" ||
    detectorType === "api_key" ||
    detectorType === "authorization_header" ||
    detectorType === "jwt" ||
    detectorType === "private_key"
  );
}

function parseBoundedInteger(value: string, min: number, max: number) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return min;
  }

  return Math.min(Math.max(parsed, min), max);
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

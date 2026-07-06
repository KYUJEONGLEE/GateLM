"use client";

import { Save, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import {
  getRuntimePolicyDraftValues,
  type RuntimePolicyConfig,
  type RuntimePolicyDetector,
  type RuntimePolicyDraftValues,
  type RuntimePolicyHistoryItem,
  type RuntimePolicyModelConfig,
  type RuntimePolicyModel,
  type RuntimePolicyProvider,
  type RuntimePolicySnapshot
} from "@/lib/control-plane/runtime-policy-types";
import { formatDateTime } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type RuntimePolicyEditorProps = {
  breadcrumbItems?: BreadcrumbItem[];
  locale: Locale;
  model: RuntimePolicyModel;
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

type PolicySection =
  | "safety"
  | "routing"
  | "budget"
  | "rateLimit"
  | "cache"
  | "streaming"
  | "providerModel";

type RoutingProviderOption = {
  provider: string;
  providerId: string;
};

type PolicySectionLabelText = {
  budgetTab: string;
  cacheTab: string;
  providerModelTab: string;
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
  "streaming",
  "providerModel"
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
    case "providerModel":
      return text.providerModelTab;
  }
}

const policyText: Record<
  Locale,
  {
    activeConfig: string;
    applicationProviders: string;
    applicationProvidersHint: string;
    applicationProvidersSaved: string;
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
    configuredModels: string;
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
    providerModelTab: string;
    publish: string;
    publishedAt: string;
    history: string;
    rateLimit: string;
    rateLimitTab: string;
    remove: string;
    rollback: string;
    routing: string;
    routingAdvanced: string;
    runtimeSnapshot: string;
    responseCapture: string;
    responseCaptureHint: string;
    responseCaptureMaxChars: string;
    saveDraft: string;
    saveProviders: string;
    savingProviders: string;
    safetyTab: string;
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
    applicationProviders: "Application providers",
    applicationProvidersHint:
      "Select the providers this application can use. Routing only shows models from connected providers.",
    applicationProvidersSaved: "Application provider connections saved.",
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
    configuredModels: "Configured models",
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
    providerModelTab: "Provider/Model",
    publish: "Publish active config",
    publishedAt: "Published",
    history: "Runtime history",
    rateLimit: "Rate limit",
    rateLimitTab: "Rate Limit",
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
    saveProviders: "Save providers",
    savingProviders: "Saving...",
    safetyTab: "Safety",
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
    applicationProviders: "Application providers",
    applicationProvidersHint:
      "이 애플리케이션이 사용할 provider를 선택합니다. Routing은 연결된 provider의 model만 표시합니다.",
    applicationProvidersSaved: "Application provider 연결을 저장했습니다.",
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
    configuredModels: "Configured models",
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
    providerModelTab: "Provider/Model",
    publish: "Active config 게시",
    publishedAt: "게시 시각",
    history: "Runtime history",
    rateLimit: "Rate limit",
    rateLimitTab: "Rate Limit",
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
    saveProviders: "Provider 저장",
    savingProviders: "저장 중...",
    safetyTab: "Safety",
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
  breadcrumbItems,
  locale,
  model
}: RuntimePolicyEditorProps) {
  const router = useRouter();
  const text = policyText[locale];
  const [draftValues, setDraftValues] = useState<RuntimePolicyDraftValues>(() =>
    getRuntimePolicyDraftValues(model.activeConfig)
  );
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const [activePolicySection, setActivePolicySection] = useState<PolicySection>("safety");
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isSavingProviders, setIsSavingProviders] = useState(false);
  const [providerSelectionIds, setProviderSelectionIds] = useState<string[]>(
    model.providerConnections.selectedIds
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  useEffect(() => {
    setDraftValues(getRuntimePolicyDraftValues(model.activeConfig));
    setProviderSelectionIds(model.providerConnections.selectedIds);
  }, [
    model.activeConfig,
    model.applicationId,
    model.providerConnections.selectedIds
  ]);
  const displayConfig =
    submitState.status === "success" && "runtimeConfig" in submitState
      ? submitState.runtimeConfig
      : model.activeConfig;
  const providerOptions = model.activeConfig.providers;
  const selectedProviderIdSet = useMemo(
    () => new Set(providerSelectionIds),
    [providerSelectionIds]
  );
  const hasProviderSelectionChanged = !haveSameStringSet(
    providerSelectionIds,
    model.providerConnections.selectedIds
  );
  const modelOptionsByProvider = useMemo(
    () => groupModelsByProvider(draftValues.models),
    [draftValues.models]
  );
  const routingProviderOptions = useMemo(
    () =>
      getRoutingProviderOptions(model.activeConfig.providers, draftValues.models, [
        draftValues.routingDefaultProvider,
        draftValues.routingLowCostProvider,
        draftValues.routingFallbackProvider
      ]),
    [
      draftValues.models,
      draftValues.routingDefaultProvider,
      draftValues.routingFallbackProvider,
      draftValues.routingLowCostProvider,
      model.activeConfig.providers
    ]
  );
  const hasRoutingCandidates =
    routingProviderOptions.length > 0 &&
    Boolean(draftValues.routingDefaultProvider && draftValues.routingDefaultModel) &&
    Boolean(draftValues.routingLowCostProvider && draftValues.routingLowCostModel) &&
    Boolean(draftValues.routingFallbackProvider && draftValues.routingFallbackModel);

  function toggleProviderSelection(providerConnection: ProviderConnectionRecord) {
    const providerModels = getProviderConnectionModels(providerConnection);

    if (providerModels.length === 0) {
      return;
    }

    setProviderSelectionIds((current) =>
      current.includes(providerConnection.id)
        ? current.filter((providerConnectionId) => providerConnectionId !== providerConnection.id)
        : [...current, providerConnection.id]
    );
  }

  async function saveApplicationProviders() {
    setIsSavingProviders(true);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/application-providers", {
      body: JSON.stringify({
        applicationId: model.applicationId,
        providerConnectionIds: providerSelectionIds
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };

    if (!response.ok) {
      setSubmitState({
        message: payload.error ?? "Application provider update failed.",
        status: "error"
      });
      setIsSavingProviders(false);
      return;
    }

    setSubmitState({
      message: text.applicationProvidersSaved,
      status: "success"
    });
    setIsSavingProviders(false);
    router.refresh();
  }

  function updateRoutingProvider(
    route: "default" | "fallback" | "lowCost",
    provider: string
  ) {
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

  function updateRoutingModel(route: "default" | "fallback" | "lowCost", modelName: string) {
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
    if (!hasRoutingCandidates) {
      setSubmitState({
        message: text.providerConnectionMissing,
        status: "error"
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/runtime-config", {
      body: JSON.stringify({
        action,
        applicationId: model.applicationId,
        values: draftValues
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
            disabled={isSubmitting || !hasRoutingCandidates}
            onClick={() => void submitPolicy("save-draft")}
            type="button"
            variant="outline"
          >
            <Save aria-hidden="true" />
            {text.saveDraft}
          </Button>
          <Button
            disabled={isSubmitting || !hasRoutingCandidates}
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
            <div className="policy-routing-grid">
              <RoutingPairEditor
                label={text.defaultRoute}
                modelOptionsByProvider={modelOptionsByProvider}
                onModelChange={(modelName) => updateRoutingModel("default", modelName)}
                onProviderChange={(provider) => updateRoutingProvider("default", provider)}
                provider={draftValues.routingDefaultProvider}
                providerOptions={routingProviderOptions}
                selectedModel={draftValues.routingDefaultModel}
              />
              <RoutingPairEditor
                label={text.lowCostRoute}
                modelOptionsByProvider={modelOptionsByProvider}
                onModelChange={(modelName) => updateRoutingModel("lowCost", modelName)}
                onProviderChange={(provider) => updateRoutingProvider("lowCost", provider)}
                provider={draftValues.routingLowCostProvider}
                providerOptions={routingProviderOptions}
                selectedModel={draftValues.routingLowCostModel}
              />
              <RoutingPairEditor
                label={text.fallbackRoute}
                modelOptionsByProvider={modelOptionsByProvider}
                onModelChange={(modelName) => updateRoutingModel("fallback", modelName)}
                onProviderChange={(provider) => updateRoutingProvider("fallback", provider)}
                provider={draftValues.routingFallbackProvider}
                providerOptions={routingProviderOptions}
                selectedModel={draftValues.routingFallbackModel}
              />
            </div>
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
              label={text.limit}
              max={100000}
              min={1}
              onChange={(value) =>
                setDraftValues((current) => ({
                  ...current,
                  rateLimitLimit: value
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

        <div
          aria-labelledby={getPolicyTabId("providerModel")}
          className="policy-tab-panel"
          hidden={activePolicySection !== "providerModel"}
          id={getPolicyPanelId("providerModel")}
          role="tabpanel"
          tabIndex={0}
        >
          <article className="console-panel policy-editor-panel wide-panel">
            <div className="panel-heading">
              <h3>{text.applicationProviders}</h3>
              <Button
                disabled={!hasProviderSelectionChanged || isSavingProviders}
                onClick={() => void saveApplicationProviders()}
                type="button"
                variant="outline"
              >
                {isSavingProviders ? text.savingProviders : text.saveProviders}
              </Button>
            </div>
            <p className="project-muted">{text.applicationProvidersHint}</p>
            {model.providerConnections.loadError ? (
              <p className="project-muted">{model.providerConnections.loadError}</p>
            ) : null}
            <div className="policy-provider-list">
              {model.providerConnections.available.length === 0 ? (
                <p className="project-muted">{text.providerConnectionMissing}</p>
              ) : null}
              {model.providerConnections.available.map((providerConnection) => {
                const providerModels = getProviderConnectionModels(providerConnection);
                const isSelectable = providerModels.length > 0;

                return (
                  <label
                    aria-disabled={!isSelectable}
                    className="policy-provider-option"
                    data-disabled={!isSelectable}
                    key={providerConnection.id}
                  >
                    <input
                      checked={selectedProviderIdSet.has(providerConnection.id)}
                      disabled={!isSelectable || isSavingProviders}
                      onChange={() => toggleProviderSelection(providerConnection)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{providerConnection.displayName}</strong>
                      <small>
                        {providerConnection.provider}
                        {" · "}
                        {isSelectable ? providerModels.join(", ") : text.noProviderModels}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </article>

          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.configuredModels}</h3>
            </div>
            {draftValues.models.length > 0 ? (
              <dl className="policy-summary-list">
                {draftValues.models.map((item) => (
                  <div key={`${item.provider}:${item.model}`}>
                    <dt>{item.provider}</dt>
                    <dd>
                      {item.model} / {item.contextWindowTokens} {text.tokens} /{" "}
                      {text.jsonMode} {formatEnabled(item.supportsJsonMode)} /{" "}
                      {text.streaming} {formatEnabled(item.supportsStreaming)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="project-muted">{text.noProviderModels}</p>
            )}
          </article>

          <article className="console-panel policy-editor-panel">
            <div className="panel-heading">
              <h3>{text.activeConfig}</h3>
            </div>
            <dl className="policy-summary-list">
              <div>
                <dt>{text.configVersion}</dt>
                <dd>{displayConfig.configVersion}</dd>
              </div>
              <div>
                <dt>{text.publishedAt}</dt>
                <dd>{formatDateTime(displayConfig.publishedAt)}</dd>
              </div>
            </dl>
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
            {snapshot.policies.rateLimit.scope} / {snapshot.policies.rateLimit.limit} per{" "}
            {snapshot.policies.rateLimit.windowSeconds}s
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

function RoutingPairEditor({
  label,
  modelOptionsByProvider,
  onModelChange,
  onProviderChange,
  provider,
  providerOptions,
  selectedModel
}: {
  label: string;
  modelOptionsByProvider: Map<string, RuntimePolicyModelConfig[]>;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: string) => void;
  provider: string;
  providerOptions: RoutingProviderOption[];
  selectedModel: string;
}) {
  const modelOptions = modelOptionsByProvider.get(provider) ?? [];
  const hasProviderOptions = providerOptions.length > 0;

  return (
    <fieldset className="policy-routing-pair">
      <legend>{label}</legend>
      <label className="policy-field">
        <span>Provider</span>
        <select
          aria-label={`${label} Provider`}
          disabled={!hasProviderOptions}
          onChange={(event) => onProviderChange(event.target.value)}
          value={hasProviderOptions ? provider : ""}
        >
          {!hasProviderOptions ? <option value="">No providers</option> : null}
          {providerOptions.map((option) => (
            <option key={option.providerId} value={option.provider}>
              {option.provider}
            </option>
          ))}
        </select>
      </label>
      <label className="policy-field">
        <span>Model</span>
        <select
          aria-label={`${label} Model`}
          disabled={modelOptions.length === 0}
          onChange={(event) => onModelChange(event.target.value)}
          value={modelOptions.length === 0 ? "" : selectedModel}
        >
          {modelOptions.length === 0 ? <option value="">No models</option> : null}
          {modelOptions.map((option) => (
            <option key={`${option.provider}:${option.model}`} value={option.model}>
              {option.model}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

function PolicyNumberField({
  label,
  max,
  min,
  onChange,
  value
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="policy-field">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(parseBoundedInteger(event.target.value, min, max))}
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

function getRoutingProviderOptions(
  providers: RuntimePolicyProvider[],
  models: RuntimePolicyModelConfig[],
  selectedProviders: string[]
): RoutingProviderOption[] {
  const providerOptions = new Map<string, RoutingProviderOption>();

  for (const provider of providers) {
    const providerName = provider.provider.trim();

    if (providerName) {
      providerOptions.set(providerName, {
        provider: providerName,
        providerId: provider.providerId || `provider-${providerName}`
      });
    }
  }

  for (const model of models) {
    const providerName = model.provider.trim();

    if (providerName && !providerOptions.has(providerName)) {
      providerOptions.set(providerName, {
        provider: providerName,
        providerId: `model-provider-${providerName}`
      });
    }
  }

  for (const provider of selectedProviders) {
    const providerName = provider.trim();

    if (providerName && !providerOptions.has(providerName)) {
      providerOptions.set(providerName, {
        provider: providerName,
        providerId: `selected-provider-${providerName}`
      });
    }
  }

  return Array.from(providerOptions.values());
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

function haveSameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightValues = new Set(right);

  return left.every((value) => rightValues.has(value));
}

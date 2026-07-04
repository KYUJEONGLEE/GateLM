"use client";

import { Save, UploadCloud } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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

type PolicySection = "general" | "cache";

const hiddenPolicySectionStyle = { display: "none" } as const;

const policyText: Record<
  Locale,
  {
    activeConfig: string;
    budget: string;
    budgetEnforcement: string;
    budgetWarning: string;
    cache: string;
    cacheEnabled: string;
    cacheSection: string;
    cacheTtl: string;
    catalogVersion: string;
    configVersion: string;
    completionPrice: string;
    defaultRoute: string;
    detectors: string;
    detectorType: string;
    close: string;
    details: string;
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
    placeholder: string;
    policyDetails: string;
    pricing: string;
    pricingVersion: string;
    promptCapture: string;
    promptCaptureEnabled: string;
    promptCaptureMaxChars: string;
    promptPrice: string;
    provider: string;
    providerCount: string;
    providerCatalog: string;
    publish: string;
    publishedAt: string;
    history: string;
    rateLimit: string;
    remove: string;
    rollback: string;
    routing: string;
    routingAdvanced: string;
    runtimeSnapshot: string;
    saveDraft: string;
    shortPrompt: string;
    snapshotState: string;
    snapshotVersion: string;
    semanticCache: string;
    semanticCacheDisabled: string;
    semanticCacheEvidenceOnly: string;
    semanticCacheNote: string;
    streaming: string;
    title: string;
    tokens: string;
  }
> = {
  en: {
    activeConfig: "Active config",
    budget: "Budget policy",
    budgetEnforcement: "Enforcement",
    budgetWarning: "Warning threshold",
    cache: "Exact cache",
    cacheEnabled: "Cache enabled",
    cacheSection: "Cache",
    cacheTtl: "TTL seconds",
    catalogVersion: "Catalog version",
    configVersion: "Config version",
    completionPrice: "Completion micro USD",
    defaultRoute: "Default route",
    detectors: "Safety detectors",
    detectorType: "Detector",
    close: "Close",
    details: "Details",
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
    placeholder: "Placeholder",
    policyDetails: "Policy details",
    pricing: "Pricing rules",
    pricingVersion: "Pricing version",
    promptCapture: "Prompt capture",
    promptCaptureEnabled: "Log-safe capture",
    promptCaptureMaxChars: "Max characters",
    promptPrice: "Prompt micro USD",
    provider: "Provider",
    providerCount: "Providers",
    providerCatalog: "Provider catalog",
    publish: "Publish active config",
    publishedAt: "Published",
    history: "Runtime history",
    rateLimit: "Rate limit",
    remove: "Remove",
    rollback: "Rollback",
    routing: "Routing",
    routingAdvanced: "Routing advanced",
    runtimeSnapshot: "RuntimeSnapshot",
    saveDraft: "Save draft",
    shortPrompt: "Short prompt threshold",
    snapshotState: "Snapshot state",
    snapshotVersion: "Snapshot version",
    semanticCache: "Semantic cache",
    semanticCacheDisabled: "disabled",
    semanticCacheEvidenceOnly: "evidence only",
    semanticCacheNote:
      "Current Control Plane derives semantic cache evidence mode from the cache policy. It is not a live response path.",
    streaming: "Streaming",
    title: "Policies",
    tokens: "Context tokens"
  },
  ko: {
    activeConfig: "Active config",
    budget: "Budget policy",
    budgetEnforcement: "Enforcement",
    budgetWarning: "Warning threshold",
    cache: "Exact cache",
    cacheEnabled: "캐시 사용",
    cacheSection: "캐시",
    cacheTtl: "TTL 초",
    catalogVersion: "Catalog version",
    configVersion: "Config version",
    completionPrice: "Completion micro USD",
    defaultRoute: "Default route",
    detectors: "Safety detector",
    detectorType: "Detector",
    close: "닫기",
    details: "상세보기",
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
    placeholder: "Placeholder",
    policyDetails: "정책 상세",
    pricing: "Pricing rules",
    pricingVersion: "Pricing version",
    promptCapture: "프롬프트 캡처",
    promptCaptureEnabled: "로그 안전 캡처",
    promptCaptureMaxChars: "최대 글자 수",
    promptPrice: "Prompt micro USD",
    provider: "Provider",
    providerCount: "Providers",
    providerCatalog: "Provider catalog",
    publish: "Active config 게시",
    publishedAt: "게시 시각",
    history: "Runtime history",
    rateLimit: "Rate limit",
    remove: "삭제",
    rollback: "Rollback",
    routing: "Routing",
    routingAdvanced: "Routing advanced",
    runtimeSnapshot: "RuntimeSnapshot",
    saveDraft: "Draft 저장",
    shortPrompt: "Short prompt 기준",
    snapshotState: "Snapshot state",
    snapshotVersion: "Snapshot version",
    semanticCache: "Semantic cache",
    semanticCacheDisabled: "disabled",
    semanticCacheEvidenceOnly: "evidence only",
    semanticCacheNote:
      "현재 Control Plane은 cache policy에서 semantic cache evidence mode를 파생합니다. 실시간 응답 경로는 아닙니다.",
    streaming: "Streaming",
    title: "정책",
    tokens: "Context tokens"
  }
};

export function RuntimePolicyEditor({ locale, model }: RuntimePolicyEditorProps) {
  const text = policyText[locale];
  const [draftValues, setDraftValues] = useState<RuntimePolicyDraftValues>(() =>
    getRuntimePolicyDraftValues(model.activeConfig)
  );
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const [activePolicySection, setActivePolicySection] = useState<PolicySection>("general");
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  const displayConfig =
    submitState.status === "success" && "runtimeConfig" in submitState
      ? submitState.runtimeConfig
      : model.activeConfig;
  const generalSectionStyle =
    activePolicySection === "general" ? undefined : hiddenPolicySectionStyle;
  const cacheSectionStyle =
    activePolicySection === "cache" ? undefined : hiddenPolicySectionStyle;
  const providerOptions = model.activeConfig.providers;
  const modelOptionsByProvider = useMemo(
    () => groupModelsByProvider(draftValues.models),
    [draftValues.models]
  );

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
    setIsSubmitting(true);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/runtime-config", {
      body: JSON.stringify({
        action,
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
          <p className="console-kicker">management</p>
          <h2>{text.title}</h2>
        </div>
        <div className="policy-actions">
          <Button onClick={() => setIsDetailOpen(true)} type="button" variant="outline">
            {text.details}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => void submitPolicy("save-draft")}
            type="button"
            variant="outline"
          >
            <Save aria-hidden="true" />
            {text.saveDraft}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => void submitPolicy("publish")}
            type="button"
          >
            <UploadCloud aria-hidden="true" />
            {text.publish}
          </Button>
        </div>
      </section>

      {model.source === "fixture" ? (
        <p className="policy-alert" data-status="warning">
          {text.fixtureFallback} {model.loadError}
        </p>
      ) : null}
      {submitState.message ? (
        <p className="policy-alert" data-status={submitState.status}>
          {submitState.message}
        </p>
      ) : null}

      <div className="policy-section-tabs" aria-label="Policy sections" role="tablist">
        {(["general", "cache"] as const).map((section) => (
          <button
            aria-selected={activePolicySection === section}
            data-active={activePolicySection === section}
            key={section}
            onClick={() => setActivePolicySection(section)}
            role="tab"
            type="button"
          >
            {section === "general" ? text.general : text.cacheSection}
          </button>
        ))}
      </div>

      <section className="policy-layout policy-settings-list">
        <article
          className="console-panel policy-editor-panel"
          style={generalSectionStyle}
        >
          <div className="panel-heading">
            <h3>{text.budget}</h3>
          </div>
          <label className="policy-toggle-row">
            <input
              checked={draftValues.budgetEnabled}
              onChange={(event) =>
                setDraftValues((current) => ({
                  ...current,
                  budgetEnabled: event.target.checked,
                  budgetEnforcementMode: event.target.checked
                    ? current.budgetEnforcementMode === "disabled"
                      ? "warn"
                      : current.budgetEnforcementMode
                    : "disabled"
                }))
              }
              type="checkbox"
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

        <article
          className="console-panel policy-editor-panel"
          style={generalSectionStyle}
        >
          <div className="panel-heading">
            <h3>{text.rateLimit}</h3>
          </div>
          <label className="policy-toggle-row">
            <input
              checked={draftValues.rateLimitEnabled}
              onChange={(event) =>
                setDraftValues((current) => ({
                  ...current,
                  rateLimitEnabled: event.target.checked
                }))
              }
              type="checkbox"
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

        <article
          className="console-panel policy-editor-panel wide-panel"
          style={generalSectionStyle}
        >
          <div className="panel-heading">
            <h3>{text.detectors}</h3>
          </div>
          <p className="project-muted">
            <strong>{text.mandatoryProtection}</strong> {text.mandatoryProtectionHint}
          </p>
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

        <article
          className="console-panel policy-editor-panel"
          style={generalSectionStyle}
        >
          <div className="panel-heading">
            <h3>{text.promptCapture}</h3>
          </div>
          <label className="policy-toggle-row">
            <input
              checked={draftValues.promptCaptureEnabled}
              onChange={(event) =>
                setDraftValues((current) => ({
                  ...current,
                  promptCaptureEnabled: event.target.checked
                }))
              }
              type="checkbox"
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

        <article
          className="console-panel policy-editor-panel"
          style={generalSectionStyle}
        >
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
              providerOptions={providerOptions}
              selectedModel={draftValues.routingDefaultModel}
            />
            <RoutingPairEditor
              label={text.lowCostRoute}
              modelOptionsByProvider={modelOptionsByProvider}
              onModelChange={(modelName) => updateRoutingModel("lowCost", modelName)}
              onProviderChange={(provider) => updateRoutingProvider("lowCost", provider)}
              provider={draftValues.routingLowCostProvider}
              providerOptions={providerOptions}
              selectedModel={draftValues.routingLowCostModel}
            />
            <RoutingPairEditor
              label={text.fallbackRoute}
              modelOptionsByProvider={modelOptionsByProvider}
              onModelChange={(modelName) => updateRoutingModel("fallback", modelName)}
              onProviderChange={(provider) => updateRoutingProvider("fallback", provider)}
              provider={draftValues.routingFallbackProvider}
              providerOptions={providerOptions}
              selectedModel={draftValues.routingFallbackModel}
            />
          </div>
        </article>

        <article
          className="console-panel policy-editor-panel"
          style={generalSectionStyle}
        >
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

        <article
          className="console-panel policy-editor-panel"
          style={cacheSectionStyle}
        >
          <div className="panel-heading">
            <h3>{text.cache}</h3>
          </div>
          <label className="policy-toggle-row">
            <input
              checked={draftValues.cacheEnabled}
              onChange={(event) =>
                setDraftValues((current) => ({
                  ...current,
                  cacheEnabled: event.target.checked
                }))
              }
              type="checkbox"
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

        <article
          className="console-panel policy-editor-panel"
          style={cacheSectionStyle}
        >
          <div className="panel-heading">
            <h3>{text.semanticCache}</h3>
          </div>
          <label aria-disabled="true" className="policy-toggle-row">
            <input checked={draftValues.cacheEnabled} disabled readOnly type="checkbox" />
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

        <article
          className="console-panel policy-editor-panel"
          style={generalSectionStyle}
        >
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
                  <p className="policy-alert" data-status="warning">
                    {model.runtimeSnapshot.loadError}
                  </p>
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
                  <p className="policy-alert" data-status="warning">
                    {model.providerCatalog.loadError}
                  </p>
                ) : null}
                {model.providerCatalog.canonicalLoadError ? (
                  <p className="policy-alert" data-status="warning">
                    {model.providerCatalog.canonicalLoadError}
                  </p>
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
                  <p className="policy-alert" data-status="warning">
                    {model.history.loadError}
                  </p>
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
            {formatEnabled(snapshot.policies.streaming.enabled)} / thin slice{" "}
            {formatEnabled(snapshot.policies.streaming.thinSliceOnly)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function formatEnabled(value: boolean) {
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
  providerOptions: RuntimePolicyProvider[];
  selectedModel: string;
}) {
  const modelOptions = modelOptionsByProvider.get(provider) ?? [];

  return (
    <fieldset className="policy-routing-pair">
      <legend>{label}</legend>
      <label className="policy-field">
        <span>Provider</span>
        <select onChange={(event) => onProviderChange(event.target.value)} value={provider}>
          {providerOptions.map((option) => (
            <option key={option.providerId} value={option.provider}>
              {option.provider}
            </option>
          ))}
        </select>
      </label>
      <label className="policy-field">
        <span>Model</span>
        <select onChange={(event) => onModelChange(event.target.value)} value={selectedModel}>
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
    <div className="policy-detector-row">
      <label className="policy-toggle-row">
        <input
          checked={isMandatory || detector.enabled}
          disabled={isMandatory}
          onChange={(event) =>
            onChange({
              ...detector,
              enabled: event.target.checked
            })
          }
          type="checkbox"
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

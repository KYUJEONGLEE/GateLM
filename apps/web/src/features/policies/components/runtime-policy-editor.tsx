"use client";

import { Plus, Save, Trash2, UploadCloud } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getRuntimePolicyDraftValues,
  type RuntimePolicyConfig,
  type RuntimePolicyDetector,
  type RuntimePolicyDraftValues,
  type RuntimePolicyModelConfig,
  type RuntimePolicyModel,
  type RuntimePolicyProvider
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

const policyText: Record<
  Locale,
  {
    activeConfig: string;
    application: string;
    budget: string;
    budgetEnforcement: string;
    budgetWarning: string;
    cache: string;
    cacheEnabled: string;
    cacheTtl: string;
    configHash: string;
    configVersion: string;
    completionPrice: string;
    controlPlane: string;
    defaultRoute: string;
    detectors: string;
    detectorType: string;
    enabled: string;
    fallbackRoute: string;
    fixtureFallback: string;
    jsonMode: string;
    limit: string;
    lowCostRoute: string;
    mode: string;
    model: string;
    models: string;
    placeholder: string;
    pricing: string;
    pricingVersion: string;
    promptPrice: string;
    provider: string;
    providerCatalog: string;
    publish: string;
    publishedAt: string;
    rateLimit: string;
    remove: string;
    routing: string;
    saveDraft: string;
    securityPolicyHash: string;
    shortPrompt: string;
    streaming: string;
    title: string;
    tokens: string;
  }
> = {
  en: {
    activeConfig: "Active config",
    application: "Application",
    budget: "Budget policy",
    budgetEnforcement: "Enforcement",
    budgetWarning: "Warning threshold",
    cache: "Exact cache",
    cacheEnabled: "Cache enabled",
    cacheTtl: "TTL seconds",
    configHash: "Config hash",
    configVersion: "Config version",
    completionPrice: "Completion micro USD",
    controlPlane: "Control Plane",
    defaultRoute: "Default route",
    detectors: "Safety detectors",
    detectorType: "Detector",
    enabled: "Enabled",
    fallbackRoute: "Fallback route",
    fixtureFallback: "Control Plane unavailable. Showing fixture values.",
    jsonMode: "JSON",
    limit: "Limit",
    lowCostRoute: "Low-cost route",
    mode: "Mode",
    model: "Model",
    models: "Models",
    placeholder: "Placeholder",
    pricing: "Pricing rules",
    pricingVersion: "Pricing version",
    promptPrice: "Prompt micro USD",
    provider: "Provider",
    providerCatalog: "Provider catalog",
    publish: "Publish active config",
    publishedAt: "Published",
    rateLimit: "Rate limit",
    remove: "Remove",
    routing: "Routing",
    saveDraft: "Save draft",
    securityPolicyHash: "Security policy hash",
    shortPrompt: "Short prompt threshold",
    streaming: "Streaming",
    title: "Policies",
    tokens: "Context tokens"
  },
  ko: {
    activeConfig: "Active config",
    application: "애플리케이션",
    budget: "Budget policy",
    budgetEnforcement: "Enforcement",
    budgetWarning: "Warning threshold",
    cache: "Exact cache",
    cacheEnabled: "캐시 사용",
    cacheTtl: "TTL 초",
    configHash: "Config hash",
    configVersion: "Config version",
    completionPrice: "Completion micro USD",
    controlPlane: "Control Plane",
    defaultRoute: "Default route",
    detectors: "Safety detector",
    detectorType: "Detector",
    enabled: "사용",
    fallbackRoute: "Fallback route",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 값을 표시 중입니다.",
    jsonMode: "JSON",
    limit: "한도",
    lowCostRoute: "Low-cost route",
    mode: "모드",
    model: "Model",
    models: "Models",
    placeholder: "Placeholder",
    pricing: "Pricing rules",
    pricingVersion: "Pricing version",
    promptPrice: "Prompt micro USD",
    provider: "Provider",
    providerCatalog: "Provider catalog",
    publish: "Active config 게시",
    publishedAt: "게시 시각",
    rateLimit: "Rate limit",
    remove: "삭제",
    routing: "Routing",
    saveDraft: "Draft 저장",
    securityPolicyHash: "Security policy hash",
    shortPrompt: "Short prompt 기준",
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const displayConfig =
    submitState.status === "success" && "runtimeConfig" in submitState
      ? submitState.runtimeConfig
      : model.activeConfig;
  const sourceLabel = model.source === "control-plane" ? text.controlPlane : "fixture";
  const detectorSummary = useMemo(
    () => draftValues.detectors.filter((detector) => detector.enabled).length,
    [draftValues.detectors]
  );
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

  function updateModel(index: number, nextModel: RuntimePolicyModelConfig) {
    setDraftValues((current) => {
      const previousModel = current.models[index];

      return {
        ...current,
        models: current.models.map((model, modelIndex) =>
          modelIndex === index ? nextModel : model
        ),
        pricingRules: current.pricingRules.map((rule) =>
          previousModel &&
          rule.provider === previousModel.provider &&
          rule.model === previousModel.model
            ? {
                ...rule,
                model: nextModel.model,
                provider: nextModel.provider
              }
            : rule
        )
      };
    });
  }

  function addModel() {
    const provider = providerOptions[0]?.provider ?? "mock";
    const modelName = `${provider}-model-${draftValues.models.length + 1}`;

    setDraftValues((current) => ({
      ...current,
      models: [
        ...current.models,
        {
          contextWindowTokens: 8192,
          displayName: modelName,
          model: modelName,
          provider,
          status: "active",
          supportsJsonMode: false,
          supportsStreaming: false
        }
      ],
      pricingRules: [
        ...current.pricingRules,
        {
          completionTokenMicroUsd: 0,
          model: modelName,
          pricingVersion: `${provider}.draft`,
          promptTokenMicroUsd: 0,
          provider
        }
      ]
    }));
  }

  function removeModel(index: number) {
    setDraftValues((current) => {
      if (current.models.length <= 1) {
        return current;
      }

      const removedModel = current.models[index];

      return {
        ...current,
        models: current.models.filter((_, modelIndex) => modelIndex !== index),
        pricingRules: removedModel
          ? current.pricingRules.filter(
              (rule) =>
                rule.provider !== removedModel.provider || rule.model !== removedModel.model
            )
          : current.pricingRules
      };
    });
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

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">management</p>
          <h2>{text.title}</h2>
        </div>
        <div className="policy-actions">
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

      <section className="policy-status-grid" aria-label="Runtime policy status">
        <PolicyStat label={text.activeConfig} value={displayConfig.publishState} />
        <PolicyStat label={text.application} value={model.applicationId} />
        <PolicyStat label={text.controlPlane} value={sourceLabel} />
        <PolicyStat label={text.detectors} value={String(detectorSummary)} />
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

      <section className="policy-layout">
        <article className="console-panel policy-editor-panel">
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

        <article className="console-panel policy-editor-panel">
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

        <article className="console-panel policy-editor-panel">
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

        <article className="console-panel policy-editor-panel">
          <div className="panel-heading">
            <h3>{text.providerCatalog}</h3>
          </div>
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
            <div>
              <dt>{text.configHash}</dt>
              <dd>{displayConfig.configHash}</dd>
            </div>
            <div>
              <dt>{text.securityPolicyHash}</dt>
              <dd>{displayConfig.safetyPolicy.securityPolicyHash}</dd>
            </div>
          </dl>
        </article>

        <article className="console-panel policy-editor-panel wide-panel">
          <div className="panel-heading">
            <h3>{text.models}</h3>
            <Button onClick={addModel} type="button" variant="outline">
              <Plus aria-hidden="true" />
              {text.model}
            </Button>
          </div>
          <div className="table-wrap">
            <table className="data-table policy-config-table">
              <thead>
                <tr>
                  <th>{text.provider}</th>
                  <th>{text.model}</th>
                  <th>{text.mode}</th>
                  <th>{text.tokens}</th>
                  <th>{text.streaming}</th>
                  <th>{text.jsonMode}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draftValues.models.map((runtimeModel, index) => (
                  <tr key={`${runtimeModel.provider}:${runtimeModel.model}:${index}`}>
                    <td>
                      <label className="policy-field">
                        <span>{text.provider}</span>
                        <select
                          onChange={(event) =>
                            updateModel(index, {
                              ...runtimeModel,
                              provider: event.target.value
                            })
                          }
                          value={runtimeModel.provider}
                        >
                          {providerOptions.map((provider) => (
                            <option key={provider.providerId} value={provider.provider}>
                              {provider.provider}
                            </option>
                          ))}
                        </select>
                      </label>
                    </td>
                    <td>
                      <div className="policy-model-name-fields">
                        <label className="policy-field">
                          <span>{text.model}</span>
                          <input
                            maxLength={120}
                            onChange={(event) =>
                              updateModel(index, {
                                ...runtimeModel,
                                model: event.target.value
                              })
                            }
                            value={runtimeModel.model}
                          />
                        </label>
                        <label className="policy-field">
                          <span>{text.title}</span>
                          <input
                            maxLength={120}
                            onChange={(event) =>
                              updateModel(index, {
                                ...runtimeModel,
                                displayName: event.target.value
                              })
                            }
                            value={runtimeModel.displayName}
                          />
                        </label>
                      </div>
                    </td>
                    <td>
                      <label className="policy-field">
                        <span>{text.mode}</span>
                        <select
                          onChange={(event) =>
                            updateModel(index, {
                              ...runtimeModel,
                              status: event.target.value === "disabled" ? "disabled" : "active"
                            })
                          }
                          value={runtimeModel.status}
                        >
                          <option value="active">active</option>
                          <option value="disabled">disabled</option>
                        </select>
                      </label>
                    </td>
                    <td>
                      <PolicyNumberField
                        label={text.tokens}
                        max={1000000}
                        min={1}
                        onChange={(value) =>
                          updateModel(index, {
                            ...runtimeModel,
                            contextWindowTokens: value
                          })
                        }
                        value={runtimeModel.contextWindowTokens}
                      />
                    </td>
                    <td>
                      <label className="policy-toggle-row policy-table-toggle">
                        <input
                          checked={runtimeModel.supportsStreaming}
                          onChange={(event) =>
                            updateModel(index, {
                              ...runtimeModel,
                              supportsStreaming: event.target.checked
                            })
                          }
                          type="checkbox"
                        />
                        <span>{text.streaming}</span>
                      </label>
                    </td>
                    <td>
                      <label className="policy-toggle-row policy-table-toggle">
                        <input
                          checked={runtimeModel.supportsJsonMode}
                          onChange={(event) =>
                            updateModel(index, {
                              ...runtimeModel,
                              supportsJsonMode: event.target.checked
                            })
                          }
                          type="checkbox"
                        />
                        <span>{text.jsonMode}</span>
                      </label>
                    </td>
                    <td>
                      <Button
                        disabled={draftValues.models.length <= 1}
                        onClick={() => removeModel(index)}
                        type="button"
                        variant="destructive"
                      >
                        <Trash2 aria-hidden="true" />
                        {text.remove}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="console-panel policy-editor-panel wide-panel">
          <div className="panel-heading">
            <h3>{text.pricing}</h3>
          </div>
          <div className="table-wrap">
            <table className="data-table policy-config-table">
              <thead>
                <tr>
                  <th>{text.provider}</th>
                  <th>{text.model}</th>
                  <th>{text.pricingVersion}</th>
                  <th>{text.promptPrice}</th>
                  <th>{text.completionPrice}</th>
                </tr>
              </thead>
              <tbody>
                {draftValues.pricingRules.map((rule, index) => (
                  <tr key={`${rule.provider}:${rule.model}:${index}`}>
                    <td>
                      <code className="project-code">{rule.provider}</code>
                    </td>
                    <td>
                      <code className="project-code">{rule.model}</code>
                    </td>
                    <td>
                      <label className="policy-field">
                        <span>{text.pricingVersion}</span>
                        <input
                          maxLength={120}
                          onChange={(event) =>
                            setDraftValues((current) => ({
                              ...current,
                              pricingRules: current.pricingRules.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      pricingVersion: event.target.value
                                    }
                                  : item
                              )
                            }))
                          }
                          value={rule.pricingVersion}
                        />
                      </label>
                    </td>
                    <td>
                      <PolicyNumberField
                        label={text.promptPrice}
                        max={1000000000}
                        min={0}
                        onChange={(value) =>
                          setDraftValues((current) => ({
                            ...current,
                            pricingRules: current.pricingRules.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    promptTokenMicroUsd: value
                                  }
                                : item
                            )
                          }))
                        }
                        value={rule.promptTokenMicroUsd}
                      />
                    </td>
                    <td>
                      <PolicyNumberField
                        label={text.completionPrice}
                        max={1000000000}
                        min={0}
                        onChange={(value) =>
                          setDraftValues((current) => ({
                            ...current,
                            pricingRules: current.pricingRules.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    completionTokenMicroUsd: value
                                  }
                                : item
                            )
                          }))
                        }
                        value={rule.completionTokenMicroUsd}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="console-panel policy-editor-panel wide-panel">
          <div className="panel-heading">
            <h3>{text.detectors}</h3>
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
      </section>
    </main>
  );
}

function PolicyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card policy-stat">
      <span>{label}</span>
      <strong>{value}</strong>
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
  return (
    <div className="policy-detector-row">
      <label className="policy-toggle-row">
        <input
          checked={detector.enabled}
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
          onChange={(event) =>
            onChange({
              ...detector,
              action: event.target.value === "block" ? "block" : "redact"
            })
          }
          value={detector.action}
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

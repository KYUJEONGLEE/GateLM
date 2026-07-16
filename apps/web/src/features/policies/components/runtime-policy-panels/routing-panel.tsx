"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import {
  createRuntimePolicyRoleRoutes,
  countRuntimePolicyModelRoleConversionChanges,
  getRuntimePolicyModelRoleConversion,
  getRuntimePolicyModelRoles,
  runtimeRoutingCategories,
  runtimeRoutingDifficulties,
  type RuntimePolicyDraftValues,
  type RuntimePolicyModelRoles
} from "@/lib/control-plane/runtime-policy-types";

import type {
  RuntimePolicyDraftValuesSetter,
  RuntimePolicyEditorText
} from "../runtime-policy-editor-types";
import {
  getRoutingModelOptions,
  groupRoutingModelOptionsByProvider,
  type RoutingModelOption
} from "../runtime-policy-editor-utils";

export type RoutingPolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: RuntimePolicyDraftValuesSetter;
  providerConnections: ProviderConnectionRecord[];
  text: RuntimePolicyEditorText;
};

export function RoutingPolicyPanel({
  draftValues,
  onDraftValuesChange,
  providerConnections,
  text
}: RoutingPolicyPanelProps) {
  const modelOptions = useMemo(
    () => createModelRefOptions(providerConnections),
    [providerConnections]
  );
  const [manualSetupRoles, setManualSetupRoles] = useState<RuntimePolicyModelRoles>({
    complexModelRef: "",
    fallbackModelRef: null,
    simpleModelRef: ""
  });
  const roles = getRuntimePolicyModelRoles(draftValues.routingPolicy.routes);
  const conversionRoles = getRuntimePolicyModelRoleConversion(
    draftValues.routingPolicy.routes
  );
  const conversionChangeCount = conversionRoles
    ? countRuntimePolicyModelRoleConversionChanges(
        draftValues.routingPolicy.routes,
        conversionRoles
      )
    : 0;
  const hasMockRoute = hasMockModelInRoutes(
    draftValues.routingPolicy.routes,
    modelOptions
  );
  const canApplyManualSetup = Boolean(
    manualSetupRoles.simpleModelRef.trim() && manualSetupRoles.complexModelRef.trim()
  );

  function updateRoutingPolicy(
    update: (policy: RuntimePolicyDraftValues["routingPolicy"]) => void
  ) {
    onDraftValuesChange((current) => {
      const routingPolicy = structuredClone(current.routingPolicy);
      update(routingPolicy);
      routingPolicy.bootstrapState = hasMockModelInRoutes(
        routingPolicy.routes,
        modelOptions
      )
        ? "mock_bootstrap"
        : "configured";

      return { ...current, routingPolicy };
    });
  }

  function setMode(mode: "auto" | "manual") {
    updateRoutingPolicy((policy) => {
      policy.mode = mode;
    });
  }

  function setRoles(nextRoles: RuntimePolicyModelRoles) {
    updateRoutingPolicy((policy) => {
      policy.routes = createRuntimePolicyRoleRoutes(nextRoles);
    });
  }

  return (
    <>
      <section
        aria-labelledby="policy-auto-routing-title"
        className="tenant-routing-model-card policy-auto-routing-card"
        data-routing-mode={draftValues.routingPolicy.mode}
      >
        <header className="tenant-routing-model-heading">
          <div className="tenant-routing-model-heading-copy">
            <h3 id="policy-auto-routing-title">Auto routing</h3>
            <p>{text.routingRoleHint}</p>
          </div>
          <div className="tenant-routing-heading-mode">
            <span>Auto routing</span>
            <div className="tenant-routing-switch-control">
              <Switch
                aria-label="Auto routing"
                checked={draftValues.routingPolicy.mode === "auto"}
                className="tenant-routing-switch"
                onCheckedChange={(checked) => setMode(checked ? "auto" : "manual")}
              />
              <span
                className="tenant-routing-mode-label"
                data-active="true"
              >
                {draftValues.routingPolicy.mode === "auto" ? "ON" : "OFF"}
              </span>
            </div>
          </div>
        </header>
      </section>

      {hasMockRoute ? (
        <Alert variant="warning">
          <AlertDescription>{text.routingMockWarning}</AlertDescription>
        </Alert>
      ) : null}

      {!roles ? (
        <Alert className="routing-migration-alert" variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>{text.routingConversionTitle}</AlertTitle>
          <AlertDescription>
            <p>{text.routingConversionDescription}</p>
            {conversionRoles ? (
              <>
                <dl className="routing-migration-preview">
                  <div>
                    <dt>{text.routingSimpleModel}</dt>
                    <dd>{getModelRefLabel(conversionRoles.simpleModelRef, modelOptions)}</dd>
                  </div>
                  <div>
                    <dt>{text.routingComplexModel}</dt>
                    <dd>{getModelRefLabel(conversionRoles.complexModelRef, modelOptions)}</dd>
                  </div>
                  <div>
                    <dt>{text.routingFallbackModel}</dt>
                    <dd>
                      {conversionRoles.fallbackModelRef
                        ? getModelRefLabel(conversionRoles.fallbackModelRef, modelOptions)
                        : text.routingFallbackNone}
                    </dd>
                  </div>
                </dl>
                <div className="routing-migration-meta">
                  <span>
                    {text.routingConversionImpact.replace(
                      "{count}",
                      String(conversionChangeCount)
                    )}
                  </span>
                  <span>{text.routingConversionDraftNote}</span>
                </div>
                <Button
                  className="routing-migration-action"
                  onClick={() => setRoles(conversionRoles)}
                  type="button"
                >
                  {text.routingConvert}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </>
            ) : (
              <div className="routing-migration-manual-setup">
                <p>{text.routingConversionUnavailable}</p>
                <div
                  aria-label={text.routingManualSetup}
                  className="routing-migration-manual-grid"
                  role="group"
                >
                  <RoleModelSelect
                    allowEmpty
                    label={text.routingSimpleModel}
                    modelLabel={text.model}
                    modelOptions={modelOptions}
                    noneLabel={text.routingSelectModel}
                    onChange={(simpleModelRef) =>
                      setManualSetupRoles((current) => ({
                        ...current,
                        fallbackModelRef:
                          current.fallbackModelRef === simpleModelRef
                            ? null
                            : current.fallbackModelRef,
                        simpleModelRef
                      }))
                    }
                    providerLabel={text.provider}
                    value={manualSetupRoles.simpleModelRef}
                  />
                  <RoleModelSelect
                    allowEmpty
                    label={text.routingComplexModel}
                    modelLabel={text.model}
                    modelOptions={modelOptions}
                    noneLabel={text.routingSelectModel}
                    onChange={(complexModelRef) =>
                      setManualSetupRoles((current) => ({
                        ...current,
                        complexModelRef,
                        fallbackModelRef:
                          current.fallbackModelRef === complexModelRef
                            ? null
                            : current.fallbackModelRef
                      }))
                    }
                    providerLabel={text.provider}
                    value={manualSetupRoles.complexModelRef}
                  />
                  <RoleModelSelect
                    allowEmpty
                    excludedModelRefs={[
                      manualSetupRoles.simpleModelRef,
                      manualSetupRoles.complexModelRef
                    ]}
                    label={text.routingFallbackModel}
                    modelLabel={text.model}
                    modelOptions={modelOptions}
                    noneLabel={text.routingFallbackNone}
                    onChange={(fallbackModelRef) =>
                      setManualSetupRoles((current) => ({
                        ...current,
                        fallbackModelRef: fallbackModelRef || null
                      }))
                    }
                    providerLabel={text.provider}
                    value={manualSetupRoles.fallbackModelRef ?? ""}
                  />
                </div>
                <div className="routing-migration-meta">
                  <span>{text.routingConversionDraftNote}</span>
                </div>
                <Button
                  className="routing-migration-action"
                  disabled={!canApplyManualSetup}
                  onClick={() => setRoles(manualSetupRoles)}
                  type="button"
                >
                  {text.routingManualSetup}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </div>
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <section
          aria-labelledby="policy-routing-role-model-title"
          className="tenant-routing-model-card policy-category-model-card"
        >
          <header className="tenant-routing-model-heading">
            <div className="tenant-routing-model-heading-copy">
              <h3 id="policy-routing-role-model-title">{text.routingRoleModels}</h3>
              <p>{text.routingRoleDescription}</p>
            </div>
          </header>

          <div
            aria-label={text.routingRoleModels}
            className="tenant-routing-table policy-routing-role-list"
            role="group"
          >
            <RoleModelSelect
              appearance="card"
              label={text.routingSimpleModel}
              modelLabel={text.model}
              modelOptions={modelOptions}
              noneLabel={text.routingSelectModel}
              onChange={(simpleModelRef) => setRoles({ ...roles, simpleModelRef })}
              providerLabel={text.provider}
              value={roles.simpleModelRef}
            />
            <RoleModelSelect
              appearance="card"
              label={text.routingComplexModel}
              modelLabel={text.model}
              modelOptions={modelOptions}
              noneLabel={text.routingSelectModel}
              onChange={(complexModelRef) => setRoles({ ...roles, complexModelRef })}
              providerLabel={text.provider}
              value={roles.complexModelRef}
            />
            <RoleModelSelect
              allowEmpty
              appearance="card"
              excludedModelRefs={[roles.simpleModelRef, roles.complexModelRef]}
              label={text.routingFallbackModel}
              modelLabel={text.model}
              modelOptions={modelOptions}
              noneLabel={text.routingFallbackNone}
              onChange={(fallbackModelRef) =>
                setRoles({
                  ...roles,
                  fallbackModelRef: fallbackModelRef || null
                })
              }
              providerLabel={text.provider}
              value={roles.fallbackModelRef ?? ""}
            />
          </div>
        </section>
      )}

    </>
  );
}

function RoleModelSelect({
  allowEmpty = false,
  appearance = "default",
  excludedModelRefs = [],
  label,
  modelLabel,
  modelOptions,
  noneLabel = "None",
  onChange,
  providerLabel,
  value
}: {
  allowEmpty?: boolean;
  appearance?: "card" | "default";
  excludedModelRefs?: string[];
  label: string;
  modelLabel: string;
  modelOptions: RoutingModelOption[];
  noneLabel?: string;
  onChange: (modelRef: string) => void;
  providerLabel: string;
  value: string;
}) {
  const availableOptions = modelOptions.filter(
    (option) =>
      !excludedModelRefs.includes(option.modelRef) || option.modelRef === value
  );
  const selectedOption = modelOptions.find((option) => option.modelRef === value);
  const options =
    value && !selectedOption
      ? [
          {
            family: "mock",
            label: `${value} (unavailable)`,
            modelName: `${value} (unavailable)`,
            modelRef: value,
            providerConnectionId: "__unavailable",
            providerDisplayName: "unavailable",
            providerName: "unavailable"
          },
          ...availableOptions
        ]
      : availableOptions;
  const providers = groupRoutingModelOptionsByProvider(options);
  const selectedProvider = providers.find((provider) =>
    provider.models.some((model) => model.modelRef === value)
  );
  const providerValue = selectedProvider?.providerConnectionId ?? "";
  const selectedProviderUnavailable = providerValue === "__unavailable";

  return (
    <div
      className={
        appearance === "card"
          ? "tenant-routing-route policy-routing-role-row"
          : "tenant-routing-route"
      }
    >
      <span className={appearance === "card" ? "policy-routing-role-label" : undefined}>
        {label}
      </span>
      <div
        aria-label={label}
        className="tenant-routing-model-selectors policy-routing-model-selectors"
        role="group"
      >
        <label>
          <span className="sr-only">{providerLabel}</span>
          <span className="tenant-routing-provider-control">
            <ProviderFamilyIcon
              className="tenant-routing-provider-icon"
              family={selectedProvider?.family ?? "unknown"}
              size={22}
            />
            <select
              aria-label={`${label} ${providerLabel}`}
              onChange={(event) => {
                if (event.target.value === "") {
                  onChange("");
                  return;
                }

                const nextProvider = providers.find(
                  (provider) =>
                    provider.providerConnectionId === event.target.value
                );
                onChange(nextProvider?.models[0]?.modelRef ?? "");
              }}
              value={providerValue}
            >
              {allowEmpty ? <option value="">{noneLabel}</option> : null}
              {!allowEmpty && !selectedProvider ? (
                <option disabled value="">
                  {noneLabel}
                </option>
              ) : null}
              {providers.map((provider) => (
                <option
                  disabled={provider.providerConnectionId === "__unavailable"}
                  key={provider.providerConnectionId}
                  value={provider.providerConnectionId}
                >
                  {provider.displayName}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label>
          <span className="sr-only">{modelLabel}</span>
          <span className="tenant-routing-model-control">
            <select
              aria-label={`${label} ${modelLabel}`}
              disabled={!selectedProvider || selectedProviderUnavailable}
              onChange={(event) => onChange(event.target.value)}
              value={selectedProvider ? value : ""}
            >
              {selectedProvider ? (
                selectedProvider.models.map((option) => (
                  <option key={option.modelRef} value={option.modelRef}>
                    {option.modelName}
                  </option>
                ))
              ) : (
                <option value="">{noneLabel}</option>
              )}
            </select>
          </span>
        </label>
      </div>
    </div>
  );
}

function createModelRefOptions(
  providerConnections: ProviderConnectionRecord[]
): RoutingModelOption[] {
  const options = getRoutingModelOptions(providerConnections);

  if (!options.some((option) => option.modelRef === "mock-balanced")) {
    options.unshift({
      family: "mock",
      label: "Mock Provider / mock-balanced",
      modelName: "mock-balanced",
      modelRef: "mock-balanced",
      providerConnectionId: "mock",
      providerDisplayName: "Mock Provider",
      providerName: "mock"
    });
  }

  return options;
}

function getModelRefLabel(modelRef: string, modelOptions: RoutingModelOption[]) {
  return (
    modelOptions.find((option) => option.modelRef === modelRef)?.label ?? modelRef
  );
}

function hasMockModelInRoutes(
  routes: RuntimePolicyDraftValues["routingPolicy"]["routes"],
  modelOptions: RoutingModelOption[]
) {
  return runtimeRoutingCategories.some((category) =>
    runtimeRoutingDifficulties.some((difficulty) =>
      routes[category][difficulty].modelRefs.some((modelRef) =>
        isMockModelRef(modelRef, modelOptions)
      )
    )
  );
}

function isMockModelRef(modelRef: string, modelOptions: RoutingModelOption[]) {
  return (
    modelRef === "mock-balanced" ||
    modelOptions.find((option) => option.modelRef === modelRef)?.providerName === "mock"
  );
}

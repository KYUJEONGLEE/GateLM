"use client";

import { ArrowRight, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import {
  createRuntimePolicyRoleRoutes,
  countRuntimePolicyModelRoleConversionChanges,
  getRuntimePolicyModelRoleConversion,
  getRuntimePolicyModelRoles,
  runtimeRoutingCategories,
  runtimeRoutingDifficulties,
  type RuntimePolicyDraftValues,
  type RuntimePolicyModel,
  type RuntimePolicyModelRoles,
  type RuntimePolicyProvider
} from "@/lib/control-plane/runtime-policy-types";

import type {
  RuntimePolicyDraftValuesSetter,
  RuntimePolicyEditorText
} from "../runtime-policy-editor-types";

type ModelRefOption = {
  family: string;
  label: string;
  modelRef: string;
  providerName: string;
};

export type RoutingPolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: RuntimePolicyDraftValuesSetter;
  providerCatalog: RuntimePolicyModel["providerCatalog"];
  providerManagementHref?: string;
  providers: RuntimePolicyProvider[];
  text: RuntimePolicyEditorText;
};

export function RoutingPolicyPanel({
  draftValues,
  onDraftValuesChange,
  providerCatalog,
  providerManagementHref,
  providers,
  text
}: RoutingPolicyPanelProps) {
  const modelOptions = useMemo(() => createModelRefOptions(providers), [providers]);
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
      <section className="tenant-routing-enable-card" aria-labelledby="policy-auto-routing-title">
        <div>
          <h3 id="policy-auto-routing-title">Auto routing</h3>
          <p>{text.routingRoleHint}</p>
        </div>
        <div className="tenant-routing-switch-control">
          <Switch
            aria-label="Auto routing"
            checked={draftValues.routingPolicy.mode === "auto"}
            className="tenant-routing-switch"
            onCheckedChange={(checked) => setMode(checked ? "auto" : "manual")}
          />
          <span>{draftValues.routingPolicy.mode === "auto" ? "ON" : "OFF"}</span>
        </div>
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
                    value={manualSetupRoles.simpleModelRef}
                  />
                  <RoleModelSelect
                    allowEmpty
                    label={text.routingComplexModel}
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
                    value={manualSetupRoles.complexModelRef}
                  />
                  <RoleModelSelect
                    allowEmpty
                    excludedModelRefs={[
                      manualSetupRoles.simpleModelRef,
                      manualSetupRoles.complexModelRef
                    ]}
                    label={text.routingFallbackModel}
                    modelOptions={modelOptions}
                    noneLabel={text.routingFallbackNone}
                    onChange={(fallbackModelRef) =>
                      setManualSetupRoles((current) => ({
                        ...current,
                        fallbackModelRef: fallbackModelRef || null
                      }))
                    }
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

          <div className="tenant-routing-table" role="group" aria-label={text.routingRoleModels}>
            <RoleModelSelect
              label={text.routingSimpleModel}
              modelOptions={modelOptions}
              onChange={(simpleModelRef) => setRoles({ ...roles, simpleModelRef })}
              value={roles.simpleModelRef}
            />
            <RoleModelSelect
              label={text.routingComplexModel}
              modelOptions={modelOptions}
              onChange={(complexModelRef) => setRoles({ ...roles, complexModelRef })}
              value={roles.complexModelRef}
            />
            <RoleModelSelect
              allowEmpty
              excludedModelRefs={[roles.simpleModelRef, roles.complexModelRef]}
              label={text.routingFallbackModel}
              modelOptions={modelOptions}
              noneLabel={text.routingFallbackNone}
              onChange={(fallbackModelRef) =>
                setRoles({
                  ...roles,
                  fallbackModelRef: fallbackModelRef || null
                })
              }
              value={roles.fallbackModelRef ?? ""}
            />
          </div>
        </section>
      )}

      <article className="console-panel policy-editor-panel">
        <div className="panel-heading">
          <h3>{text.providerCatalog}</h3>
          {providerManagementHref ? (
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={providerManagementHref}
            >
              <Plus aria-hidden="true" />
              {text.providerAdd}
            </Link>
          ) : null}
        </div>
        {providerCatalog.loadError ? (
          <Alert variant="warning">
            <AlertDescription>{providerCatalog.loadError}</AlertDescription>
          </Alert>
        ) : null}
        {providerCatalog.canonicalLoadError ? (
          <Alert variant="warning">
            <AlertDescription>{providerCatalog.canonicalLoadError}</AlertDescription>
          </Alert>
        ) : null}
        {providerCatalog.summary ? (
          <dl className="policy-summary-list">
            <div>
              <dt>{text.catalogVersion}</dt>
              <dd>{providerCatalog.summary.catalogVersion}</dd>
            </div>
            <div>
              <dt>{text.providerCount}</dt>
              <dd>
                {providerCatalog.summary.providerCount} / {text.models}:{" "}
                {providerCatalog.summary.modelCount}
              </dd>
            </div>
          </dl>
        ) : null}
      </article>
    </>
  );
}

function RoleModelSelect({
  allowEmpty = false,
  excludedModelRefs = [],
  label,
  modelOptions,
  noneLabel = "None",
  onChange,
  value
}: {
  allowEmpty?: boolean;
  excludedModelRefs?: string[];
  label: string;
  modelOptions: ModelRefOption[];
  noneLabel?: string;
  onChange: (modelRef: string) => void;
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
            modelRef: value,
            providerName: "unavailable"
          },
          ...availableOptions
        ]
      : availableOptions;

  return (
    <label className="tenant-routing-route">
      <span>{label}</span>
      <span className="routing-model-ref-item" data-has-icon={value ? "true" : "false"}>
        {value ? (
          <ProviderFamilyIcon
            className="tenant-routing-provider-icon"
            family={selectedOption?.family ?? "mock"}
            size={20}
          />
        ) : null}
        <select aria-label={label} onChange={(event) => onChange(event.target.value)} value={value}>
          {allowEmpty ? <option value="">{noneLabel}</option> : null}
          {options.map((option) => (
            <option key={option.modelRef} value={option.modelRef}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

function createModelRefOptions(providers: RuntimePolicyProvider[]): ModelRefOption[] {
  const options = providers
    .filter((provider) => provider.status !== "disabled")
    .flatMap((provider) =>
      provider.models.map((modelId) => ({
        family: getProviderFamily(provider),
        label: `${provider.displayName} / ${modelId}`,
        modelRef:
          provider.provider === "mock" && modelId === "mock-balanced"
            ? "mock-balanced"
            : `${provider.providerId}:${modelId}`,
        providerName: provider.provider
      }))
    );

  if (!options.some((option) => option.modelRef === "mock-balanced")) {
    options.unshift({
      family: "mock",
      label: "Mock Provider / mock-balanced",
      modelRef: "mock-balanced",
      providerName: "mock"
    });
  }

  return options;
}

function getModelRefLabel(modelRef: string, modelOptions: ModelRefOption[]) {
  return (
    modelOptions.find((option) => option.modelRef === modelRef)?.label ?? modelRef
  );
}

function getProviderFamily(provider: RuntimePolicyProvider) {
  const key = `${provider.provider} ${provider.displayName} ${provider.baseUrl}`.toLowerCase();
  if (key.includes("anthropic") || key.includes("claude")) return "claude";
  if (key.includes("gemini") || key.includes("google")) return "gemini";
  if (key.includes("mock")) return "mock";
  return "openai";
}

function hasMockModelInRoutes(
  routes: RuntimePolicyDraftValues["routingPolicy"]["routes"],
  modelOptions: ModelRefOption[]
) {
  return runtimeRoutingCategories.some((category) =>
    runtimeRoutingDifficulties.some((difficulty) =>
      routes[category][difficulty].modelRefs.some((modelRef) =>
        isMockModelRef(modelRef, modelOptions)
      )
    )
  );
}

function isMockModelRef(modelRef: string, modelOptions: ModelRefOption[]) {
  return (
    modelRef === "mock-balanced" ||
    modelOptions.find((option) => option.modelRef === modelRef)?.providerName === "mock"
  );
}

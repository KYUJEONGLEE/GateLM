"use client";

import { useState, type FormEvent } from "react";
import type {
  AdminOnboardingModel,
  AdminProviderModel,
  CredentialIssueResponse,
  CredentialListItem
} from "@/lib/fixtures/v1-admin-fixtures";
import { CredentialOneTimeSecret } from "@/features/onboarding/components/credential-one-time-secret";
import {
  formatDisplayIdentifier,
  formatTenantDisplayName
} from "@/lib/formatting/display-identifiers";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type AdminOnboardingFlowProps = {
  activeStepId: OnboardingStepId;
  locale: Locale;
  model: AdminOnboardingModel;
};

export type OnboardingStepId =
  | "project"
  | "application"
  | "provider"
  | "api-key"
  | "app-token"
  | "runtime-config";

type OnboardingStep = {
  id: OnboardingStepId;
  labels: Record<
    Locale,
    {
      label: string;
    }
  >;
};

const onboardingSteps: OnboardingStep[] = [
  {
    id: "project",
    labels: {
      en: {
        label: "Project"
      },
      ko: {
        label: "프로젝트"
      }
    }
  },
  {
    id: "application",
    labels: {
      en: {
        label: "Application"
      },
      ko: {
        label: "애플리케이션"
      }
    }
  },
  {
    id: "provider",
    labels: {
      en: {
        label: "Provider"
      },
      ko: {
        label: "Provider"
      }
    }
  },
  {
    id: "api-key",
    labels: {
      en: {
        label: "API Key"
      },
      ko: {
        label: "API Key"
      }
    }
  },
  {
    id: "app-token",
    labels: {
      en: {
        label: "App Token"
      },
      ko: {
        label: "App Token"
      }
    }
  },
  {
    id: "runtime-config",
    labels: {
      en: {
        label: "Runtime Config"
      },
      ko: {
        label: "Runtime Config"
      }
    }
  }
];

const onboardingText: Record<
  Locale,
  {
    complete: string;
    next: string;
    previous: string;
    saved: string;
    saveNext: string;
    step: string;
    title: string;
  }
> = {
  en: {
    complete: "Save setup",
    next: "Next",
    previous: "Previous",
    saved: "Saved",
    saveNext: "Save and continue",
    step: "Step",
    title: "Onboarding"
  },
  ko: {
    complete: "설정 저장",
    next: "다음",
    previous: "이전",
    saved: "저장됨",
    saveNext: "저장 후 다음",
    step: "단계",
    title: "온보딩"
  }
};

type OnboardingDraft = {
  apiKeyDisplayName: string;
  apiKeyScopes: string;
  appTokenDisplayName: string;
  appTokenScopes: string;
  applicationId: string;
  applicationName: string;
  applicationStatus: string;
  cacheEnabled: string;
  cacheType: string;
  providerCredentialReference: string;
  providerDisplayName: string;
  providerId: string;
  providerName: string;
  providerResolver: string;
  providerStatus: string;
  projectId: string;
  projectName: string;
  projectStatus: string;
  rateLimitLimit: string;
  rateLimitScope: string;
  rateLimitWindowSeconds: string;
  runtimeConfigVersion: string;
  runtimePublishState: string;
  safetyMode: string;
};

export function AdminOnboardingFlow({ activeStepId, locale, model }: AdminOnboardingFlowProps) {
  const initialActiveIndex = Math.max(
    onboardingSteps.findIndex((step) => step.id === activeStepId),
    0
  );
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex);
  const [draft, setDraft] = useState<OnboardingDraft>(() => buildInitialDraft(model));
  const [savedStepIds, setSavedStepIds] = useState<Set<OnboardingStepId>>(() => new Set());
  const activeStep = onboardingSteps[activeIndex] ?? onboardingSteps[0];
  const previousStep = onboardingSteps[activeIndex - 1];
  const nextStep = onboardingSteps[activeIndex + 1];
  const text = onboardingText[locale];
  const activeStepLabel = activeStep.labels[locale].label;
  const isSaved = savedStepIds.has(activeStep.id);

  function updateDraft(field: keyof OnboardingDraft, value: string) {
    setDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  function saveCurrentStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavedStepIds((current) => new Set(current).add(activeStep.id));

    if (nextStep) {
      setActiveIndex(activeIndex + 1);
    }
  }

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">management</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      <section className="onboarding-layout" aria-label="Admin onboarding flow">
        <ol className="onboarding-rail" aria-label="Onboarding steps">
          {onboardingSteps.map((step, index) => (
            <li
              aria-current={step.id === activeStep.id ? "step" : undefined}
              className="onboarding-step"
              data-active={step.id === activeStep.id}
              data-position={index < activeIndex ? "previous" : "current-or-next"}
              data-saved={savedStepIds.has(step.id)}
              data-state={getStepState(index, activeIndex)}
              key={step.id}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step.labels[locale].label}</strong>
              {savedStepIds.has(step.id) ? <small>{text.saved}</small> : null}
            </li>
          ))}
        </ol>

        <div className="onboarding-main">
          <div className="onboarding-step-title">
            <p>
              {text.step} {activeIndex + 1}
            </p>
            <h3>{activeStepLabel}</h3>
          </div>

          <form className="onboarding-form" onSubmit={saveCurrentStep}>
            <article className="onboarding-panel">
              {renderStepContent({
                activeStepId: activeStep.id,
                draft,
                isSaved,
                locale,
                model,
                updateDraft
              })}
            </article>

            <div className="onboarding-actions">
              <button
                className="secondary-button"
                disabled={!previousStep}
                onClick={() => setActiveIndex((current) => Math.max(current - 1, 0))}
                type="button"
              >
                {text.previous}
              </button>
              <button className="primary-button" type="submit">
                {nextStep ? text.saveNext : text.complete}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

function renderStepContent({
  activeStepId,
  draft,
  isSaved,
  locale,
  model,
  updateDraft
}: {
  activeStepId: OnboardingStepId;
  draft: OnboardingDraft;
  isSaved: boolean;
  locale: Locale;
  model: AdminOnboardingModel;
  updateDraft: (field: keyof OnboardingDraft, value: string) => void;
}) {
  if (activeStepId === "project") {
    return (
      <div className="onboarding-stack">
        <ReadonlySummary
          rows={[
            ["Tenant", formatTenantDisplayName(model.tenantId)]
          ]}
        />
        <OnboardingField
          field="projectName"
          label="Project name"
          onChange={updateDraft}
          value={draft.projectName}
        />
        <OnboardingField
          field="projectId"
          label="Project ID"
          onChange={updateDraft}
          value={draft.projectId}
        />
        <OnboardingSelect
          field="projectStatus"
          label="Status"
          onChange={updateDraft}
          options={["ACTIVE", "DISABLED"]}
          value={draft.projectStatus}
        />
      </div>
    );
  }

  if (activeStepId === "application") {
    return (
      <div className="onboarding-stack">
        <OnboardingField
          field="applicationName"
          label="Application name"
          onChange={updateDraft}
          value={draft.applicationName}
        />
        <OnboardingField
          field="applicationId"
          label="Application ID"
          onChange={updateDraft}
          value={draft.applicationId}
        />
        <OnboardingSelect
          field="applicationStatus"
          label="Status"
          onChange={updateDraft}
          options={["ACTIVE", "DISABLED"]}
          value={draft.applicationStatus}
        />
        <OnboardingField
          field="rateLimitScope"
          label="Rate limit scope"
          onChange={updateDraft}
          value={draft.rateLimitScope}
        />
        <div className="onboarding-form-row">
          <OnboardingField
            field="rateLimitLimit"
            inputMode="numeric"
            label="Window limit"
            onChange={updateDraft}
            value={draft.rateLimitLimit}
          />
          <OnboardingField
            field="rateLimitWindowSeconds"
            inputMode="numeric"
            label="Window seconds"
            onChange={updateDraft}
            value={draft.rateLimitWindowSeconds}
          />
        </div>
      </div>
    );
  }

  if (activeStepId === "provider") {
    return (
      <div className="onboarding-stack">
        <OnboardingField
          field="providerDisplayName"
          label="Display name"
          onChange={updateDraft}
          value={draft.providerDisplayName}
        />
        <div className="onboarding-form-row">
          <OnboardingField
            field="providerId"
            label="Provider ID"
            onChange={updateDraft}
            value={draft.providerId}
          />
          <OnboardingField
            field="providerName"
            label="Provider"
            onChange={updateDraft}
            value={draft.providerName}
          />
        </div>
        <OnboardingSelect
          field="providerStatus"
          label="Status"
          onChange={updateDraft}
          options={["ACTIVE", "DISABLED", "missing"]}
          value={draft.providerStatus}
        />
        <OnboardingField
          field="providerResolver"
          label="Resolver"
          onChange={updateDraft}
          value={draft.providerResolver}
        />
        <OnboardingField
          field="providerCredentialReference"
          label="Credential reference"
          onChange={updateDraft}
          value={draft.providerCredentialReference}
        />
        <ReadonlySummary
          rows={[
            ["Models", String(model.provider.modelCount)]
          ]}
        />
        <ProviderModelList models={model.provider.models} />
      </div>
    );
  }

  if (activeStepId === "api-key") {
    return (
      <div className="onboarding-stack">
        <OnboardingField
          field="apiKeyDisplayName"
          label="Display name"
          onChange={updateDraft}
          value={draft.apiKeyDisplayName}
        />
        <OnboardingField
          field="apiKeyScopes"
          label="Scopes"
          onChange={updateDraft}
          value={draft.apiKeyScopes}
        />
        <CredentialStep
          credentialName="API Key"
          isSaved={isSaved}
          issueResponse={model.apiKey.issueResponse}
          locale={locale}
          listItem={model.apiKey.listItem}
        />
      </div>
    );
  }

  if (activeStepId === "app-token") {
    return (
      <div className="onboarding-stack">
        <OnboardingField
          field="appTokenDisplayName"
          label="Display name"
          onChange={updateDraft}
          value={draft.appTokenDisplayName}
        />
        <OnboardingField
          field="appTokenScopes"
          label="Scopes"
          onChange={updateDraft}
          value={draft.appTokenScopes}
        />
        <CredentialStep
          credentialName="App Token"
          isSaved={isSaved}
          issueResponse={model.appToken.issueResponse}
          locale={locale}
          listItem={model.appToken.listItem}
        />
      </div>
    );
  }

  return (
    <div className="onboarding-stack">
      <div className="onboarding-form-row">
        <OnboardingField
          field="runtimeConfigVersion"
          label="Config version"
          onChange={updateDraft}
          value={draft.runtimeConfigVersion}
        />
        <OnboardingSelect
          field="runtimePublishState"
          label="Publish state"
          onChange={updateDraft}
          options={["published", "draft", "validation_failed"]}
          value={draft.runtimePublishState}
        />
      </div>
      <OnboardingSelect
        field="cacheEnabled"
        label="Cache"
        onChange={updateDraft}
        options={["enabled", "disabled"]}
        value={draft.cacheEnabled}
      />
      <OnboardingField
        field="cacheType"
        label="Cache type"
        onChange={updateDraft}
        value={draft.cacheType}
      />
      <OnboardingField
        field="safetyMode"
        label="Safety mode"
        onChange={updateDraft}
        value={draft.safetyMode}
      />
      <ReadonlySummary
        rows={[
          ["Config hash", model.runtimeConfig.configHash],
          ["Security policy hash", model.runtimeConfig.securityPolicyHash],
          ["Routing policy hash", model.runtimeConfig.routingPolicyHash],
          ["Detectors", String(model.runtimeConfig.detectorCount)]
        ]}
      />
      <div className="guardrail-list">
        <h4>Forbidden admin response fields</h4>
        <ul>
          {(model.forbiddenAdminResponseFields ?? []).map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CredentialStep({
  credentialName,
  isSaved,
  issueResponse,
  locale,
  listItem
}: {
  credentialName: string;
  isSaved: boolean;
  issueResponse: CredentialIssueResponse;
  locale: Locale;
  listItem: CredentialListItem;
}) {
  const listTitle = locale === "ko" ? "이후 조회 상태" : "Subsequent list state";
  const pendingText =
    locale === "ko"
      ? "저장하면 원문이 한 번만 표시됩니다."
      : "The plaintext value appears once after saving.";

  return (
    <div className="credential-flow">
      {isSaved ? (
        <CredentialOneTimeSecret
          credentialName={credentialName}
          issueResponse={issueResponse}
          locale={locale}
        />
      ) : (
        <section className="credential-list-state" aria-label={`${credentialName} pending issue`}>
          <p className="empty-note">{pendingText}</p>
        </section>
      )}

      <section className="credential-list-state" aria-label={`${credentialName} list state`}>
        <div className="panel-heading">
          <h4>{listTitle}</h4>
        </div>
        <ReadonlySummary
          rows={[
            ["Credential ID", listItem.credentialId],
            ["Display name", listItem.displayName],
            ["Status", listItem.status],
            ["Prefix", listItem.prefix],
            ["Last 4", listItem.last4],
            ["Scopes", (listItem.scopes ?? []).join(", ")],
            ["Created", formatDateTime(listItem.createdAt)],
            ["Last used", formatDateTime(listItem.lastUsedAt)]
          ]}
        />
      </section>
    </div>
  );
}

function OnboardingField({
  field,
  inputMode,
  label,
  onChange,
  value
}: {
  field: keyof OnboardingDraft;
  inputMode?: "numeric";
  label: string;
  onChange: (field: keyof OnboardingDraft, value: string) => void;
  value: string;
}) {
  return (
    <label className="onboarding-field">
      <span>{label}</span>
      <input
        inputMode={inputMode}
        onChange={(event) => onChange(field, event.target.value)}
        required
        value={value}
      />
    </label>
  );
}

function OnboardingSelect({
  field,
  label,
  onChange,
  options,
  value
}: {
  field: keyof OnboardingDraft;
  label: string;
  onChange: (field: keyof OnboardingDraft, value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="onboarding-field">
      <span>{label}</span>
      <select onChange={(event) => onChange(field, event.target.value)} required value={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReadonlySummary({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="onboarding-detail-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{formatDisplayIdentifier(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProviderModelList({ models }: { models: AdminProviderModel[] }) {
  if (models.length === 0) {
    return <p className="empty-state">No provider models configured.</p>;
  }

  return (
    <section className="onboarding-model-list" aria-label="Provider models">
      <div className="panel-heading">
        <h4>Provider models</h4>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Context</th>
              <th>Modes</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={`${model.provider}:${model.model}`}>
                <td>
                  <strong className="provider-name">{model.displayName}</strong>
                  <span className="project-muted">{model.model}</span>
                </td>
                <td>{model.provider}</td>
                <td>{model.status}</td>
                <td>{model.contextWindowTokens.toLocaleString()} tokens</td>
                <td>
                  <span className="project-muted">
                    streaming: {model.supportsStreaming ? "yes" : "no"}
                  </span>
                  <span className="project-muted">
                    json: {model.supportsJsonMode ? "yes" : "no"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function normalizeOnboardingStepId(value: string | string[] | undefined): OnboardingStepId {
  const stepId = Array.isArray(value) ? value[0] : value;
  return onboardingSteps.some((step) => step.id === stepId)
    ? (stepId as OnboardingStepId)
    : "project";
}

function getStepState(index: number, activeIndex: number) {
  if (index < activeIndex) {
    return "completed";
  }

  if (index === activeIndex) {
    return "current";
  }

  return "upcoming";
}

function buildInitialDraft(model: AdminOnboardingModel): OnboardingDraft {
  return {
    apiKeyDisplayName: model.apiKey.listItem.displayName,
    apiKeyScopes: model.apiKey.listItem.scopes.join(", "),
    appTokenDisplayName: model.appToken.listItem.displayName,
    appTokenScopes: model.appToken.listItem.scopes.join(", "),
    applicationId: model.application.id,
    applicationName: formatDisplayIdentifier(model.application.id),
    applicationStatus: model.application.status,
    cacheEnabled: model.runtimeConfig.cacheEnabled ? "enabled" : "disabled",
    cacheType: model.runtimeConfig.cacheType,
    providerCredentialReference: nullableText(model.provider.credentialPreview, "not-set"),
    providerDisplayName: model.provider.displayName,
    providerId: model.provider.providerId,
    providerName: model.provider.provider,
    providerResolver: model.provider.resolver,
    providerStatus: model.provider.status,
    projectId: model.project.id,
    projectName: formatDisplayIdentifier(model.project.id),
    projectStatus: model.project.status,
    rateLimitLimit: String(model.application.rateLimitLimit),
    rateLimitScope: model.application.rateLimitScope,
    rateLimitWindowSeconds: String(model.application.rateLimitWindowSeconds),
    runtimeConfigVersion: model.runtimeConfig.configVersion,
    runtimePublishState: model.runtimeConfig.publishState,
    safetyMode: model.runtimeConfig.safetyMode
  };
}

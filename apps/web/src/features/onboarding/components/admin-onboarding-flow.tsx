"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type {
  AdminOnboardingModel,
  AdminProviderModel
} from "@/lib/fixtures/v1-admin-fixtures";
import { CredentialOneTimeSecret } from "@/features/onboarding/components/credential-one-time-secret";
import {
  formatDisplayIdentifier,
  formatTenantDisplayName
} from "@/lib/formatting/display-identifiers";
import type { OneTimeApiKeyResponse } from "@/lib/control-plane/api-keys-types";
import type { ProjectRecord, ProjectStatus } from "@/lib/control-plane/projects-types";
import type { Locale } from "@/lib/i18n/locale";

type AdminOnboardingFlowProps = {
  activeStepId: OnboardingStepId;
  locale: Locale;
  model: AdminOnboardingModel;
};

export type OnboardingStepId =
  | "project"
  | "model-selection"
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
    id: "model-selection",
    labels: {
      en: {
        label: "Model Selection"
      },
      ko: {
        label: "모델 선택"
      }
    }
  },
  {
    id: "runtime-config",
    labels: {
      en: {
        label: "Review"
      },
      ko: {
        label: "검토"
      }
    }
  }
];

const onboardingText: Record<
  Locale,
  {
    complete: string;
    createApiKey: string;
    createProjectError: string;
    issueApiKeyError: string;
    issueApiKeyPending: string;
    next: string;
    previous: string;
    saved: string;
    saveNext: string;
    saveToProjects: string;
    savingProject: string;
    step: string;
    title: string;
  }
> = {
  en: {
    complete: "Complete setup",
    createApiKey: "Create API Key",
    createProjectError: "Project creation failed.",
    issueApiKeyError: "API Key issue failed.",
    issueApiKeyPending: "Create the project to issue a live API Key. The plaintext appears once.",
    next: "Next",
    previous: "Previous",
    saved: "Saved",
    saveNext: "Save and continue",
    saveToProjects: "Save and go to Projects",
    savingProject: "Creating project...",
    step: "Step",
    title: "Create Project"
  },
  ko: {
    complete: "설정 완료",
    createApiKey: "Create API Key",
    createProjectError: "Project 생성에 실패했습니다.",
    issueApiKeyError: "API Key 발급에 실패했습니다.",
    issueApiKeyPending: "프로젝트를 생성하면 실제 API Key를 발급하고 원문을 한 번만 표시합니다.",
    next: "다음",
    previous: "이전",
    saved: "저장됨",
    saveNext: "저장 후 다음",
    saveToProjects: "저장 후 Projects로 이동",
    savingProject: "프로젝트 생성 중...",
    step: "단계",
    title: "Create Project"
  }
};

type OnboardingDraft = {
  apiKeyDisplayName: string;
  cacheEnabled: string;
  cacheType: string;
  defaultModel: string;
  fallbackModel: string;
  lowCostModel: string;
  projectName: string;
  projectStatus: string;
  runtimePublishState: string;
  safetyMode: string;
};

type ProjectSetupState = {
  apiKey: OneTimeApiKeyResponse | null;
  error: string;
  project: ProjectRecord | null;
  status: "error" | "idle" | "issued" | "saving";
};

type ApiKeyIssuePayload = {
  apiKey?: OneTimeApiKeyResponse;
  error?: string;
};

type ProjectResponsePayload = {
  error?: string;
  project?: ProjectRecord;
};

export function AdminOnboardingFlow({
  activeStepId,
  locale,
  model
}: AdminOnboardingFlowProps) {
  const router = useRouter();
  const initialActiveIndex = Math.max(
    onboardingSteps.findIndex((step) => step.id === activeStepId),
    0
  );
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex);
  const [draft, setDraft] = useState<OnboardingDraft>(() => buildInitialDraft(model));
  const [savedStepIds, setSavedStepIds] = useState<Set<OnboardingStepId>>(() => new Set());
  const [projectSetupState, setProjectSetupState] = useState<ProjectSetupState>({
    apiKey: null,
    error: "",
    project: null,
    status: "idle"
  });
  const activeStep = onboardingSteps[activeIndex] ?? onboardingSteps[0];
  const previousStep = onboardingSteps[activeIndex - 1];
  const nextStep = onboardingSteps[activeIndex + 1];
  const text = onboardingText[locale];
  const activeStepLabel = activeStep.labels[locale].label;
  const isCreatingCredential = projectSetupState.status === "saving";
  const isProjectStepIncomplete =
    activeStep.id === "project" && draft.projectName.trim().length === 0;
  const isReviewIncomplete =
    activeStep.id === "runtime-config" && projectSetupState.status !== "issued";
  const isPrimaryActionDisabled =
    isCreatingCredential || isProjectStepIncomplete || isReviewIncomplete;
  const isPreviousActionDisabled =
    !previousStep || isCreatingCredential || projectSetupState.status === "issued";
  const isCreateApiKeyDisabled =
    isCreatingCredential ||
    projectSetupState.status === "issued" ||
    draft.projectName.trim().length === 0 ||
    draft.apiKeyDisplayName.trim().length === 0;

  function updateDraft(field: keyof OnboardingDraft, value: string) {
    setDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function saveCurrentStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (activeStep.id === "runtime-config") {
      if (projectSetupState.status === "issued") {
        router.push(`/tenants/${model.tenantId}/projects`);
        router.refresh();
      }
      return;
    }

    if (isProjectStepIncomplete) {
      return;
    }

    setSavedStepIds((current) => new Set(current).add(activeStep.id));

    if (nextStep) {
      setActiveIndex(activeIndex + 1);
    }
  }

  async function createProjectAndIssueApiKey() {
    if (isCreateApiKeyDisabled) {
      return;
    }

    setProjectSetupState((current) => ({
      ...current,
      error: "",
      status: "saving"
    }));

    let project = projectSetupState.project;

    if (!project) {
      const projectResponse = await fetch("/api/control-plane/projects", {
        body: JSON.stringify({
          action: "create",
          values: {
            description: "",
            name: draft.projectName
          }
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const projectPayload = (await projectResponse
        .json()
        .catch(() => ({}))) as ProjectResponsePayload;

      if (!projectResponse.ok || !projectPayload.project) {
        setProjectSetupState({
          apiKey: null,
          error: projectPayload.error ?? text.createProjectError,
          project: null,
          status: "error"
        });
        return;
      }

      project = projectPayload.project;
    }

    const selectedProjectStatus = normalizeDraftProjectStatus(draft.projectStatus);

    if (project.status !== selectedProjectStatus) {
      const updateResponse = await fetch("/api/control-plane/projects", {
        body: JSON.stringify({
          action: "update",
          values: {
            description: project.description ?? "",
            name: project.name,
            projectId: project.id,
            status: selectedProjectStatus
          }
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const updatePayload = (await updateResponse
        .json()
        .catch(() => ({}))) as ProjectResponsePayload;

      if (!updateResponse.ok || !updatePayload.project) {
        setProjectSetupState({
          apiKey: null,
          error: updatePayload.error ?? text.createProjectError,
          project,
          status: "error"
        });
        return;
      }

      project = updatePayload.project;
    }

    const response = await fetch("/api/control-plane/api-keys", {
      body: JSON.stringify({
        action: "issue",
        values: {
          displayName: draft.apiKeyDisplayName,
          expiresAt: "",
          projectId: project.id,
          scopes: "gateway:invoke"
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ApiKeyIssuePayload;

    if (!response.ok || !payload.apiKey) {
      setProjectSetupState({
        apiKey: null,
        error: payload.error ?? text.issueApiKeyError,
        project,
        status: "error"
      });
      return;
    }

    setProjectSetupState({
      apiKey: payload.apiKey,
      error: "",
      project,
      status: "issued"
    });
    setSavedStepIds((current) => new Set(current).add(activeStep.id));
  }

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">management</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      <section className="onboarding-layout" aria-label="Create project flow">
        <ol className="onboarding-rail" aria-label="Create project steps">
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
                isCreateApiKeyDisabled,
                locale,
                model,
                onCreateApiKey: createProjectAndIssueApiKey,
                projectSetupState,
                text,
                updateDraft
              })}
            </article>

            <div className="onboarding-actions">
              <button
                className="secondary-button"
                disabled={isPreviousActionDisabled}
                onClick={() => setActiveIndex((current) => Math.max(current - 1, 0))}
                type="button"
              >
                {text.previous}
              </button>
              <button
                className="primary-button"
                disabled={isPrimaryActionDisabled}
                type="submit"
              >
                {isCreatingCredential
                  ? text.savingProject
                  : projectSetupState.status === "issued"
                    ? text.saveToProjects
                  : nextStep
                    ? text.saveNext
                    : text.complete}
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
  isCreateApiKeyDisabled,
  locale,
  model,
  onCreateApiKey,
  projectSetupState,
  text,
  updateDraft
}: {
  activeStepId: OnboardingStepId;
  draft: OnboardingDraft;
  isCreateApiKeyDisabled: boolean;
  locale: Locale;
  model: AdminOnboardingModel;
  onCreateApiKey: () => void;
  projectSetupState: ProjectSetupState;
  text: (typeof onboardingText)[Locale];
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

  if (activeStepId === "model-selection") {
    return (
      <div className="onboarding-stack">
        <ModelSelectionFields draft={draft} models={model.provider.models} onChange={updateDraft} />
      </div>
    );
  }

  return (
    <div className="onboarding-stack">
      <OnboardingField
        field="apiKeyDisplayName"
        label="API Key name"
        onChange={updateDraft}
        value={draft.apiKeyDisplayName}
      />
      <ApiKeyIssueReview
        isCreateApiKeyDisabled={isCreateApiKeyDisabled}
        issueState={projectSetupState}
        locale={locale}
        onCreateApiKey={onCreateApiKey}
        text={text}
      />
      <OnboardingSelect
        field="runtimePublishState"
        label="Publish state"
        onChange={updateDraft}
        options={["published", "draft", "validation_failed"]}
        value={draft.runtimePublishState}
      />
      <OnboardingSelect
        field="cacheEnabled"
        label="Cache"
        onChange={updateDraft}
        options={["enabled", "disabled"]}
        value={draft.cacheEnabled}
      />
      <OnboardingSelect
        field="cacheType"
        label="Cache type"
        onChange={updateDraft}
        options={["exact"]}
        value={draft.cacheType}
      />
      <OnboardingSelect
        field="safetyMode"
        label="Safety mode"
        onChange={updateDraft}
        options={["rule_based"]}
        value={draft.safetyMode}
      />
    </div>
  );
}

function ApiKeyIssueReview({
  isCreateApiKeyDisabled,
  issueState,
  locale,
  onCreateApiKey,
  text
}: {
  isCreateApiKeyDisabled: boolean;
  issueState: ProjectSetupState;
  locale: Locale;
  onCreateApiKey: () => void;
  text: (typeof onboardingText)[Locale];
}) {
  if (issueState.apiKey) {
    return (
      <CredentialOneTimeSecret
        credentialName="API Key"
        issueResponse={issueState.apiKey}
        key={issueState.apiKey.credentialId}
        locale={locale}
      />
    );
  }

  return (
    <section className="credential-list-state" aria-label="API Key issue state">
      {issueState.error ? (
        <p className="policy-alert" data-status="error">
          {issueState.error}
        </p>
      ) : null}
      <div className="secret-placeholder secret-placeholder-action">
        <span>{issueState.status === "saving" ? text.savingProject : text.issueApiKeyPending}</span>
        <button
          className="primary-button"
          disabled={isCreateApiKeyDisabled}
          onClick={onCreateApiKey}
          type="button"
        >
          {issueState.status === "saving" ? text.savingProject : text.createApiKey}
        </button>
      </div>
    </section>
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

function ModelSelectionFields({
  draft,
  models,
  onChange
}: {
  draft: OnboardingDraft;
  models: AdminProviderModel[];
  onChange: (field: keyof OnboardingDraft, value: string) => void;
}) {
  if (models.length === 0) {
    return <p className="empty-state">No registered models are available.</p>;
  }

  const options = models.map((model) => ({
    label: `${model.displayName} (${model.provider}:${model.model})`,
    value: getModelOptionValue(model.provider, model.model)
  }));

  return (
    <section className="onboarding-model-list" aria-label="Registered model selection">
      <div className="onboarding-form-row">
        <ModelSelect
          field="defaultModel"
          label="Default model"
          onChange={onChange}
          options={options}
          value={draft.defaultModel}
        />
        <ModelSelect
          field="lowCostModel"
          label="Low-cost model"
          onChange={onChange}
          options={options}
          value={draft.lowCostModel}
        />
      </div>
      <ModelSelect
        field="fallbackModel"
        label="Fallback model"
        onChange={onChange}
        options={options}
        value={draft.fallbackModel}
      />
      <RegisteredModelTable models={models} />
    </section>
  );
}

function ModelSelect({
  field,
  label,
  onChange,
  options,
  value
}: {
  field: "defaultModel" | "fallbackModel" | "lowCostModel";
  label: string;
  onChange: (field: keyof OnboardingDraft, value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="onboarding-field">
      <span>{label}</span>
      <select onChange={(event) => onChange(field, event.target.value)} required value={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RegisteredModelTable({ models }: { models: AdminProviderModel[] }) {
  return (
    <div>
      <div className="panel-heading">
        <h4>Registered models</h4>
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
    </div>
  );
}

function getModelOptionValue(provider: string, model: string) {
  return `${provider}:${model}`;
}

function normalizeDraftProjectStatus(value: string): ProjectStatus {
  if (value === "DISABLED" || value === "disabled") {
    return "DISABLED";
  }

  if (value === "ARCHIVED" || value === "archived") {
    return "ARCHIVED";
  }

  return "ACTIVE";
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
    cacheEnabled: model.runtimeConfig.cacheEnabled ? "enabled" : "disabled",
    cacheType: model.runtimeConfig.cacheType,
    defaultModel: getModelOptionValue(
      model.modelSelection.defaultProvider,
      model.modelSelection.defaultModel
    ),
    fallbackModel: getModelOptionValue(
      model.modelSelection.fallbackProvider,
      model.modelSelection.fallbackModel
    ),
    lowCostModel: getModelOptionValue(
      model.modelSelection.lowCostProvider,
      model.modelSelection.lowCostModel
    ),
    projectName: "",
    projectStatus: normalizeDraftProjectStatus(model.project.status),
    runtimePublishState: model.runtimeConfig.publishState,
    safetyMode: model.runtimeConfig.safetyMode
  };
}

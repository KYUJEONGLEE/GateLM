"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { AdminOnboardingModel } from "@/lib/fixtures/v1-admin-fixtures";
import { CredentialOneTimeSecret } from "@/features/onboarding/components/credential-one-time-secret";
import type { OneTimeApiKeyResponse } from "@/lib/control-plane/api-keys-types";
import type { ProjectRecord, ProjectStatus } from "@/lib/control-plane/projects-types";
import type { Locale } from "@/lib/i18n/locale";

const createdTenantDisplayNameStorageKeyPrefix = "gatelmCreatedTenantDisplayName:";

type AdminOnboardingFlowProps = {
  activeStepId: OnboardingStepId;
  locale: Locale;
  model: AdminOnboardingModel;
};

export type OnboardingStepId =
  | "project"
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
  projectName: string;
  projectTotalBudgetUsd: string;
  projectStatus: string;
  runtimePublishState: string;
  safetyMode: string;
  tenantName: string;
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
  const [isTenantNameLocked, setIsTenantNameLocked] = useState(false);
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
    activeStep.id === "project" &&
    (draft.tenantName.trim().length === 0 ||
      draft.projectName.trim().length === 0 ||
      !isValidBudgetInput(draft.projectTotalBudgetUsd));
  const isReviewIncomplete =
    activeStep.id === "runtime-config" && projectSetupState.status !== "issued";
  const isPrimaryActionDisabled =
    isCreatingCredential || isProjectStepIncomplete || isReviewIncomplete;
  const isPreviousActionDisabled =
    !previousStep || isCreatingCredential || projectSetupState.status === "issued";
  const isCreateApiKeyDisabled =
    isCreatingCredential ||
    projectSetupState.status === "issued" ||
    draft.tenantName.trim().length === 0 ||
    draft.projectName.trim().length === 0 ||
    !isValidBudgetInput(draft.projectTotalBudgetUsd) ||
    draft.apiKeyDisplayName.trim().length === 0;

  useEffect(() => {
    let storedTenantName = "";

    try {
      storedTenantName =
        window.sessionStorage
          .getItem(`${createdTenantDisplayNameStorageKeyPrefix}${model.tenantId}`)
          ?.trim() ?? "";
    } catch {
      storedTenantName = "";
    }

    if (!storedTenantName) {
      setIsTenantNameLocked(false);
      return;
    }

    setDraft((current) => ({
      ...current,
      tenantName: storedTenantName
    }));
    setIsTenantNameLocked(true);
  }, [model.tenantId]);

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

    try {
      if (!project) {
        const projectResponse = await fetch("/api/control-plane/projects", {
          body: JSON.stringify({
            action: "create",
            values: {
              description: "",
              name: draft.projectName,
              totalBudgetUsd: Number(draft.projectTotalBudgetUsd)
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
              status: selectedProjectStatus,
              totalBudgetUsd: Number(draft.projectTotalBudgetUsd)
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
    } catch {
      setProjectSetupState({
        apiKey: null,
        error: text.createProjectError,
        project,
        status: "error"
      });
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
                isTenantNameLocked,
                locale,
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
  isTenantNameLocked,
  locale,
  onCreateApiKey,
  projectSetupState,
  text,
  updateDraft
}: {
  activeStepId: OnboardingStepId;
  draft: OnboardingDraft;
  isCreateApiKeyDisabled: boolean;
  isTenantNameLocked: boolean;
  locale: Locale;
  onCreateApiKey: () => void;
  projectSetupState: ProjectSetupState;
  text: (typeof onboardingText)[Locale];
  updateDraft: (field: keyof OnboardingDraft, value: string) => void;
}) {
  if (activeStepId === "project") {
    return (
      <div className="onboarding-stack">
        <OnboardingField
          disabled={isTenantNameLocked}
          field="tenantName"
          label="Tenant"
          onChange={updateDraft}
          value={draft.tenantName}
        />
        <OnboardingField
          field="projectName"
          label="Project name"
          onChange={updateDraft}
          value={draft.projectName}
        />
        <OnboardingField
          field="projectTotalBudgetUsd"
          inputMode="decimal"
          label="Project budget"
          onChange={updateDraft}
          value={draft.projectTotalBudgetUsd}
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
        <Alert variant="destructive">
          <AlertDescription>{issueState.error}</AlertDescription>
        </Alert>
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
  disabled = false,
  field,
  inputMode,
  label,
  onChange,
  value
}: {
  disabled?: boolean;
  field: keyof OnboardingDraft;
  inputMode?: "decimal" | "numeric";
  label: string;
  onChange: (field: keyof OnboardingDraft, value: string) => void;
  value: string;
}) {
  return (
    <label className="onboarding-field">
      <span>{label}</span>
      <input
        disabled={disabled}
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

function normalizeDraftProjectStatus(value: string): ProjectStatus {
  if (value === "DISABLED" || value === "disabled") {
    return "DISABLED";
  }

  if (value === "ARCHIVED" || value === "archived") {
    return "ARCHIVED";
  }

  return "ACTIVE";
}

function isValidBudgetInput(value: string) {
  const parsed = Number(value);

  return value.trim().length > 0 && Number.isFinite(parsed) && parsed >= 0;
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
    projectName: "",
    projectTotalBudgetUsd: "100",
    projectStatus: normalizeDraftProjectStatus(model.project.status),
    runtimePublishState: model.runtimeConfig.publishState,
    safetyMode: model.runtimeConfig.safetyMode,
    tenantName: ""
  };
}

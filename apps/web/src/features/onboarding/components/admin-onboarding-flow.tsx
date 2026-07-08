"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CredentialOneTimeSecret } from "@/features/onboarding/components/credential-one-time-secret";
import { OnboardingIntegrationGuide } from "@/features/onboarding/components/onboarding-integration-guide";
import { OnboardingProviderRegistration } from "@/features/onboarding/components/onboarding-provider-registration";
import { emptyTeamForm, TeamCreateModal } from "@/features/teams/components/team-management";
import type { OneTimeApiKeyResponse } from "@/lib/control-plane/api-keys-types";
import type {
  ProviderConnectionRecord,
  ProviderConnectionsModel
} from "@/lib/control-plane/provider-connections-types";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { TeamFormValues, TeamRecord, TeamsModel } from "@/lib/control-plane/teams-types";
import type { AdminOnboardingModel, AdminProviderModel } from "@/lib/fixtures/v1-admin-fixtures";
import type { Locale } from "@/lib/i18n/locale";

type AdminOnboardingFlowProps = {
  activeStepId: OnboardingStepId;
  gatewayBaseUrl: string;
  locale: Locale;
  model: AdminOnboardingModel;
  providerConnectionsModel: ProviderConnectionsModel;
  teamsModel: TeamsModel;
};

export type OnboardingStepId =
  | "project"
  | "provider"
  | "integration-guide";

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
        label: "Project 설정"
      },
      ko: {
        label: "Project 설정"
      }
    }
  },
  {
    id: "provider",
    labels: {
      en: {
        label: "Provider 연결"
      },
      ko: {
        label: "Provider 연결"
      }
    }
  },
  {
    id: "integration-guide",
    labels: {
      en: {
        label: "연동 가이드"
      },
      ko: {
        label: "연동 가이드"
      }
    }
  }
];

const onboardingFlowStepIds: OnboardingStepId[] = ["project", "provider", "integration-guide"];
const defaultProjectApiKeyDisplayName = "Project Gateway API Key";

const onboardingText: Record<
  Locale,
  {
    attachTeamError: string;
    complete: string;
    createApiKey: string;
    createProjectError: string;
    createTeam: string;
    createTeamError: string;
    issueApiKeyError: string;
    issueApiKeyPending: string;
    next: string;
    noTeams: string;
    previous: string;
    saveNext: string;
    saveToProjects: string;
    savingProject: string;
    step: string;
    team: string;
    title: string;
  }
> = {
  en: {
    attachTeamError: "Team assignment failed.",
    complete: "Complete setup",
    createApiKey: "Create API Key",
    createProjectError: "Project creation failed.",
    createTeam: "Create team",
    createTeamError: "Team creation failed.",
    issueApiKeyError: "API Key issue failed.",
    issueApiKeyPending: "Issue a live API Key. The plaintext appears once.",
    next: "Next",
    noTeams: "No active teams available.",
    previous: "Previous",
    saveNext: "Save and continue",
    saveToProjects: "Save and go to Projects",
    savingProject: "Creating project...",
    step: "Step",
    team: "Team",
    title: "Create Project"
  },
  ko: {
    attachTeamError: "Team assignment failed.",
    complete: "설정 완료",
    createApiKey: "Create API Key",
    createProjectError: "Project 생성에 실패했습니다.",
    createTeam: "Create team",
    createTeamError: "Team creation failed.",
    issueApiKeyError: "API Key 발급에 실패했습니다.",
    issueApiKeyPending: "실제 API Key를 발급하고 원문을 한 번만 표시합니다.",
    next: "다음",
    noTeams: "No active teams available.",
    previous: "이전",
    saveNext: "저장 후 다음",
    saveToProjects: "저장 후 Projects로 이동",
    savingProject: "API key 발급 중",
    step: "단계",
    team: "Team",
    title: "Create Project"
  }
};

type OnboardingDraft = {
  projectDescription: string;
  projectName: string;
  projectTotalBudgetUsd: string;
  selectedModelKey: string;
  warningThresholdPercent: string;
};

type ProjectSetupState = {
  apiKey: OneTimeApiKeyResponse | null;
  error: string;
  project: ProjectRecord | null;
  status: "error" | "idle" | "issued" | "saving";
};

type ProjectCompletionState = {
  error: string;
  status: "complete" | "error" | "idle" | "saving";
};

type ApiKeyIssuePayload = {
  apiKey?: OneTimeApiKeyResponse;
  error?: string;
};

type ProjectResponsePayload = {
  error?: string;
  policyError?: string;
  project?: ProjectRecord;
};

type TeamResponsePayload = {
  error?: string;
  team?: TeamRecord;
};

type ProjectTeamResponsePayload = {
  error?: string;
  projectTeam?: unknown;
};

type TeamCreateState = {
  error: string;
  status: "error" | "idle" | "saving";
};

type RuntimeModelOption = {
  label: string;
  providerConnectionId: string | null;
  providerTenantId: string | null;
  value: string;
};

export function AdminOnboardingFlow({
  activeStepId,
  gatewayBaseUrl,
  locale,
  model,
  providerConnectionsModel,
  teamsModel
}: AdminOnboardingFlowProps) {
  const router = useRouter();
  const initialActiveIndex = Math.max(
    onboardingFlowStepIds.findIndex((stepId) => stepId === activeStepId),
    0
  );
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex);
  const [providerConnections, setProviderConnections] = useState<ProviderConnectionRecord[]>(
    () => providerConnectionsModel.providers
  );
  const selectableModels = getSelectableModelOptions(
    providerConnections,
    providerConnectionsModel.controlPlaneTenantId,
    model.provider.models
  );
  const [draft, setDraft] = useState<OnboardingDraft>(() => buildInitialDraft(selectableModels));
  const [teams, setTeams] = useState<TeamRecord[]>(() => teamsModel.teams);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(() => new Set());
  const [isTeamCreateModalOpen, setIsTeamCreateModalOpen] = useState(false);
  const [teamCreateValues, setTeamCreateValues] = useState<TeamFormValues>(emptyTeamForm);
  const [teamCreateState, setTeamCreateState] = useState<TeamCreateState>({
    error: "",
    status: "idle"
  });
  const [projectSetupState, setProjectSetupState] = useState<ProjectSetupState>({
    apiKey: null,
    error: "",
    project: null,
    status: "idle"
  });
  const [projectCompletionState, setProjectCompletionState] = useState<ProjectCompletionState>({
    error: "",
    status: "idle"
  });
  const activeFlowStepId = onboardingFlowStepIds[activeIndex] ?? "project";
  const visualActiveIndex = activeIndex;
  const text = onboardingText[locale];
  const activeTeams = teams.filter((team) => team.status === "ACTIVE");
  const isCreatingCredential = projectSetupState.status === "saving";
  const isCompletingProject = projectCompletionState.status === "saving";
  const isCreatingTeam = teamCreateState.status === "saving";
  const isProjectStepIncomplete =
    activeFlowStepId === "project" && draft.projectName.trim().length === 0;
  const isIntegrationStepIncomplete =
    activeFlowStepId === "integration-guide" && projectSetupState.status !== "issued";
  const isPrimaryActionDisabled =
    isCreatingCredential ||
    isCompletingProject ||
    isProjectStepIncomplete ||
    isIntegrationStepIncomplete;
  const isPreviousActionDisabled =
    isCreatingCredential ||
    isCompletingProject ||
    activeFlowStepId === "project";
  const shouldShowPreviousAction = !(
    activeFlowStepId === "integration-guide" || activeFlowStepId === "project"
  );
  const isCreateApiKeyDisabled =
    isCreatingCredential ||
    projectSetupState.status === "issued" ||
    !projectSetupState.project;

  function toggleTeamSelection(teamId: string) {
    setSelectedTeamIds((current) => {
      const next = new Set(current);

      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }

      return next;
    });
  }

  async function submitCreateTeam() {
    if (!teamCreateValues.name.trim()) {
      setTeamCreateState({
        error: "Team name is required.",
        status: "error"
      });
      return;
    }

    setTeamCreateState({ error: "", status: "saving" });

    const response = await fetch("/api/control-plane/teams", {
      body: JSON.stringify({
        action: "create",
        values: {
          ...teamCreateValues,
          tenantId: teamsModel.controlPlaneTenantId
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as TeamResponsePayload;

    if (!response.ok || !payload.team) {
      setTeamCreateState({
        error: payload.error ?? text.createTeamError,
        status: "error"
      });
      return;
    }

    const createdTeam = payload.team;

    setTeams((current) => [...current, createdTeam]);
    setSelectedTeamIds((current) => new Set(current).add(createdTeam.id));
    setTeamCreateValues(emptyTeamForm);
    setTeamCreateState({ error: "", status: "idle" });
    setIsTeamCreateModalOpen(false);
  }

  function updateDraft(field: keyof OnboardingDraft, value: string) {
    setDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  function redactOneTimeApiKey() {
    setProjectSetupState((current) => {
      if (!current.apiKey?.plaintext) {
        return current;
      }

      return {
        ...current,
        apiKey: {
          ...current.apiKey,
          plaintext: ""
        }
      };
    });
  }

  async function saveCurrentStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (activeFlowStepId === "integration-guide") {
      if (projectSetupState.status === "issued") {
        if (projectCompletionState.status === "complete") {
          router.push(`/tenants/${model.tenantId}/projects`);
          router.refresh();
          return;
        }

        const completed = await completeProjectSetup();

        if (completed) {
          router.push(`/tenants/${model.tenantId}/projects`);
          router.refresh();
        }
      }
      return;
    }

    if (activeFlowStepId === "provider") {
      setActiveIndex(2);
      return;
    }

    if (isProjectStepIncomplete) {
      return;
    }

    if (activeFlowStepId === "project") {
      const created = await createProjectDraft();

      if (!created) {
        return;
      }

      setActiveIndex(1);
    }
  }

  async function createProjectDraft() {
    if (isProjectStepIncomplete) {
      return false;
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
            tenantId: model.tenantId,
            values: {
              description: draft.projectDescription,
              name: draft.projectName,
              status: "DRAFT",
              totalBudgetUsd: Number(draft.projectTotalBudgetUsd),
              warningThresholdPercent: Number(draft.warningThresholdPercent)
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
          return false;
        }

        project = projectPayload.project;
      }

      if (!project) {
        setProjectSetupState({
          apiKey: null,
          error: text.createProjectError,
          project: null,
          status: "error"
        });
        return false;
      }

      const activeProject = project;
      const attachableTeamIds = new Set(
        activeTeams
          .filter((team) => team.tenantId === activeProject.tenantId && isUuid(team.id))
          .map((team) => team.id)
      );

      for (const teamId of selectedTeamIds) {
        if (!attachableTeamIds.has(teamId)) {
          continue;
        }

        const attachResponse = await fetch("/api/control-plane/teams", {
          body: JSON.stringify({
            action: "attach",
            values: {
              projectId: activeProject.id,
              teamId
            }
          }),
          headers: {
            "Content-Type": "application/json"
          },
          method: "POST"
        });
        const attachPayload = (await attachResponse
          .json()
          .catch(() => ({}))) as ProjectTeamResponsePayload;

        if (!attachResponse.ok || !attachPayload.projectTeam) {
          setProjectSetupState({
            apiKey: null,
            error: attachPayload.error ?? text.attachTeamError,
            project: activeProject,
            status: "error"
          });
          return false;
        }
      }

      setProjectSetupState({
        apiKey: null,
        error: "",
        project: activeProject,
        status: "idle"
      });
      return true;
    } catch {
      setProjectSetupState({
        apiKey: null,
        error: text.createProjectError,
        project,
        status: "error"
      });
      return false;
    }
  }

  async function issueProjectApiKey() {
    if (isCreateApiKeyDisabled || !projectSetupState.project) {
      return false;
    }

    setProjectSetupState((current) => ({
      ...current,
      error: "",
      status: "saving"
    }));

    const activeProject = projectSetupState.project;

    try {
      const response = await fetch("/api/control-plane/api-keys", {
        body: JSON.stringify({
          action: "issue",
          values: {
            displayName: defaultProjectApiKeyDisplayName,
            expiresAt: "",
            projectId: activeProject.id,
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
          project: activeProject,
          status: "error"
        });
        return false;
      }

      setProjectSetupState({
        apiKey: payload.apiKey,
        error: "",
        project: activeProject,
        status: "issued"
      });
      return true;
    } catch {
      setProjectSetupState({
        apiKey: null,
        error: text.issueApiKeyError,
        project: activeProject,
        status: "error"
      });
      return false;
    }
  }

  async function completeProjectSetup() {
    if (!projectSetupState.project) {
      setProjectCompletionState({
        error: text.createProjectError,
        status: "error"
      });
      return false;
    }

    setProjectCompletionState({ error: "", status: "saving" });

    const selectedModel = draft.selectedModelKey.trim()
      ? getSelectedModelOption(
          selectableModels,
          draft.selectedModelKey,
          projectSetupState.project?.tenantId ?? ""
        )
      : null;

    if (draft.selectedModelKey.trim() && !selectedModel) {
      setProjectCompletionState({
        error:
          locale === "ko"
            ? "현재 Project tenant에서 사용할 수 있는 Provider 모델을 다시 선택하세요."
            : "Select a provider model available for the current project tenant.",
        status: "error"
      });
      return false;
    }

    try {
      const response = await fetch("/api/control-plane/projects", {
        body: JSON.stringify({
          action: "update",
          tenantId: model.tenantId,
          values: {
            description: draft.projectDescription,
            name: draft.projectName,
            projectId: projectSetupState.project.id,
            providerConnectionIds: selectedModel?.providerConnectionId
              ? [selectedModel.providerConnectionId]
              : [],
            selectedModelKey: draft.selectedModelKey,
            status: "ACTIVE",
            totalBudgetUsd: Number(draft.projectTotalBudgetUsd),
            warningThresholdPercent: Number(draft.warningThresholdPercent)
          }
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json().catch(() => ({}))) as ProjectResponsePayload;

      if (!response.ok || !payload.project || payload.policyError) {
        setProjectCompletionState({
          error: payload.policyError ?? payload.error ?? text.createProjectError,
          status: "error"
        });
        return false;
      }

      setProjectSetupState((current) => ({
        ...current,
        error: "",
        project: payload.project ?? current.project
      }));
      setProjectCompletionState({ error: "", status: "complete" });
      return true;
    } catch {
      setProjectCompletionState({
        error: text.createProjectError,
        status: "error"
      });
      return false;
    }
  }

  function completeProviderSetup(result: {
    provider: ProviderConnectionRecord;
    selectedModelKey: string;
  }) {
    setProviderConnections((current) => [
      ...current.filter((provider) => provider.provider !== result.provider.provider),
      result.provider
    ]);
    updateDraft("selectedModelKey", result.selectedModelKey);
  }

  function getPrimaryActionLabel() {
    if (isCreatingCredential || isCompletingProject) {
      return text.savingProject;
    }

    if (activeFlowStepId === "project") {
      return text.saveNext;
    }

    if (activeFlowStepId === "provider") {
      return text.saveNext;
    }

    return text.saveToProjects;
  }

  function goToPreviousStep() {
    redactOneTimeApiKey();

    if (activeFlowStepId === "provider") {
      setActiveIndex(0);
      return;
    }

    setActiveIndex((current) => Math.max(current - 1, 0));
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
        <ol
          aria-label="Create project steps"
          className="onboarding-rail"
          data-active-index={visualActiveIndex}
        >
          {onboardingSteps.map((step, index) => (
            <li
              aria-current={index === visualActiveIndex ? "step" : undefined}
              className="onboarding-step"
              data-active={index === visualActiveIndex}
              data-position={index < visualActiveIndex ? "previous" : "current-or-next"}
              data-state={getStepState(index, visualActiveIndex)}
              key={step.id}
            >
              <span>{index + 1}</span>
              <strong>{step.labels[locale].label}</strong>
            </li>
          ))}
        </ol>

        <div className="onboarding-main">
          <form className="onboarding-form" onSubmit={saveCurrentStep}>
            <article className={`onboarding-panel onboarding-panel-${activeFlowStepId}`}>
              {renderStepContent({
                activeStepId: activeFlowStepId,
                activeTeams,
                draft,
                gatewayBaseUrl,
                isCreateApiKeyDisabled,
                locale,
                onCreateApiKey: issueProjectApiKey,
                onOpenTeamCreate: () => setIsTeamCreateModalOpen(true),
                onProviderSaved: completeProviderSetup,
                onToggleTeam: toggleTeamSelection,
                projectCompletionState,
                projectSetupState,
                providerConnectionsModel: {
                  ...providerConnectionsModel,
                  providers: providerConnections
                },
                selectedTeamIds,
                teamCreateError: teamCreateState.error,
                text,
                updateDraft
              })}
            </article>

            <div className="onboarding-actions">
              {shouldShowPreviousAction ? (
                <button
                  className="secondary-button"
                  disabled={isPreviousActionDisabled}
                  onClick={goToPreviousStep}
                  type="button"
                >
                  {text.previous}
                </button>
              ) : null}
              <button
                className="primary-button"
                disabled={isPrimaryActionDisabled}
                type="submit"
              >
                {getPrimaryActionLabel()}
              </button>
            </div>
          </form>
        </div>
      </section>

      {isTeamCreateModalOpen ? (
        <TeamCreateModal
          createValues={teamCreateValues}
          locale={locale}
          onChange={(values) =>
            setTeamCreateValues((current) => ({
              ...current,
              ...values
            }))
          }
          onClose={() => {
            if (!isCreatingTeam) {
              setIsTeamCreateModalOpen(false);
              setTeamCreateState({ error: "", status: "idle" });
            }
          }}
          onSubmit={submitCreateTeam}
          pendingAction={isCreatingTeam ? "create" : null}
        />
      ) : null}
    </main>
  );
}

function renderStepContent({
  activeStepId,
  activeTeams,
  draft,
  gatewayBaseUrl,
  isCreateApiKeyDisabled,
  locale,
  onCreateApiKey,
  onOpenTeamCreate,
  onProviderSaved,
  onToggleTeam,
  projectCompletionState,
  projectSetupState,
  providerConnectionsModel,
  selectedTeamIds,
  teamCreateError,
  text,
  updateDraft
}: {
  activeStepId: OnboardingStepId;
  activeTeams: TeamRecord[];
  draft: OnboardingDraft;
  gatewayBaseUrl: string;
  isCreateApiKeyDisabled: boolean;
  locale: Locale;
  onCreateApiKey: () => void;
  onOpenTeamCreate: () => void;
  onProviderSaved: (result: { provider: ProviderConnectionRecord; selectedModelKey: string }) => void;
  onToggleTeam: (teamId: string) => void;
  projectCompletionState: ProjectCompletionState;
  projectSetupState: ProjectSetupState;
  providerConnectionsModel: ProviderConnectionsModel;
  selectedTeamIds: Set<string>;
  teamCreateError: string;
  text: (typeof onboardingText)[Locale];
  updateDraft: (field: keyof OnboardingDraft, value: string) => void;
}) {
  if (activeStepId === "project") {
    return (
      <div className="onboarding-stack">
        <OnboardingField
          field="projectName"
          label="Project name"
          onChange={updateDraft}
          value={draft.projectName}
        />
        <OnboardingTeamPicker
          onCreateTeam={onOpenTeamCreate}
          onToggleTeam={onToggleTeam}
          selectedTeamIds={selectedTeamIds}
          teamCreateError={teamCreateError}
          teams={activeTeams}
          text={text}
        />
        <OnboardingField
          field="projectDescription"
          label="Description"
          maxLength={500}
          multiline
          onChange={updateDraft}
          required={false}
          rows={3}
          value={draft.projectDescription}
        />
        {projectSetupState.error ? (
          <Alert variant="destructive">
            <AlertDescription>{projectSetupState.error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    );
  }

  if (activeStepId === "provider") {
    return (
      <div className="onboarding-stack">
        <OnboardingProviderRegistration
          locale={locale}
          model={providerConnectionsModel}
          onProviderSaved={onProviderSaved}
        />
        {projectCompletionState.error ? (
          <Alert variant="destructive">
            <AlertDescription>{projectCompletionState.error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    );
  }

  return (
    <div className="onboarding-stack">
      {projectCompletionState.error ? (
        <Alert variant="destructive">
          <AlertDescription>{projectCompletionState.error}</AlertDescription>
        </Alert>
      ) : null}
      <OnboardingIntegrationGuide
        apiKeyStepContent={
          <ApiKeyIssueReview
            isCreateApiKeyDisabled={isCreateApiKeyDisabled}
            issueState={projectSetupState}
            locale={locale}
            onCreateApiKey={onCreateApiKey}
            text={text}
          />
        }
        gatewayBaseUrl={gatewayBaseUrl}
        locale={locale}
        project={projectSetupState.project}
        selectedModelKey={draft.selectedModelKey}
        tenantId={projectSetupState.project?.tenantId ?? ""}
      />
    </div>
  );
}

function OnboardingTeamPicker({
  onCreateTeam,
  onToggleTeam,
  selectedTeamIds,
  teamCreateError,
  teams,
  text
}: {
  onCreateTeam: () => void;
  onToggleTeam: (teamId: string) => void;
  selectedTeamIds: Set<string>;
  teamCreateError: string;
  teams: TeamRecord[];
  text: (typeof onboardingText)[Locale];
}) {
  const [isTeamDropdownOpen, setIsTeamDropdownOpen] = useState(false);
  const selectedTeams = teams.filter((team) => selectedTeamIds.has(team.id));
  const availableTeams = teams.filter((team) => !selectedTeamIds.has(team.id));

  function selectTeam(teamId: string) {
    onToggleTeam(teamId);
    setIsTeamDropdownOpen(false);
  }

  return (
    <fieldset className="onboarding-team-field">
      <legend>
        {text.team}
        <span aria-hidden="true" className="required-field-marker">*</span>
      </legend>
      {teamCreateError ? (
        <Alert variant="destructive">
          <AlertDescription>{teamCreateError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="onboarding-team-selector">
        {selectedTeams.length > 0 ? (
          <div className="onboarding-team-tags" aria-label="Selected teams">
            {selectedTeams.map((team) => (
              <button
                aria-label={`Remove ${team.name}`}
                className="onboarding-team-tag"
                key={team.id}
                onClick={() => onToggleTeam(team.id)}
                type="button"
              >
                <span>{team.name}</span>
                <span aria-hidden="true">X</span>
              </button>
            ))}
          </div>
        ) : null}
        <button
          aria-expanded={isTeamDropdownOpen}
          aria-required="true"
          className="onboarding-team-toggle"
          onClick={() => setIsTeamDropdownOpen((current) => !current)}
          type="button"
        >
          <span>Select teams</span>
          <span aria-hidden="true">{isTeamDropdownOpen ? "^" : "v"}</span>
        </button>
        {isTeamDropdownOpen ? (
          <div aria-label="Team options" className="onboarding-team-options" role="listbox">
            {availableTeams.length > 0 ? (
              availableTeams.map((team) => (
                <button
                  aria-selected="false"
                  className="onboarding-team-option"
                  data-team-id={team.id}
                  key={team.id}
                  onClick={() => selectTeam(team.id)}
                  role="option"
                  type="button"
                >
                  <span>
                    <strong>{team.name}</strong>
                    {team.description ? <small>{team.description}</small> : null}
                  </span>
                </button>
              ))
            ) : (
              <p className="project-empty">{text.noTeams}</p>
            )}
          </div>
        ) : null}
      </div>
      <button
        className="secondary-button onboarding-team-create-button"
        onClick={onCreateTeam}
        type="button"
      >
        <Plus aria-hidden="true" />
        {text.createTeam}
      </button>
    </fieldset>
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
          className="primary-button onboarding-create-api-key-button"
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
  maxLength,
  multiline = false,
  onChange,
  required = true,
  rows,
  unit,
  value
}: {
  disabled?: boolean;
  field: keyof OnboardingDraft;
  inputMode?: "decimal" | "numeric";
  label: string;
  maxLength?: number;
  multiline?: boolean;
  onChange: (field: keyof OnboardingDraft, value: string) => void;
  required?: boolean;
  rows?: number;
  unit?: string;
  value: string;
}) {
  const inputProps = {
    disabled,
    maxLength,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(field, event.target.value),
    required,
    value
  };

  return (
    <label className="onboarding-field">
      <span>
        {label}
        {required ? <span aria-hidden="true" className="required-field-marker">*</span> : null}
      </span>
      {unit ? (
        <span className="onboarding-input-with-unit">
          <input
            {...inputProps}
            inputMode={inputMode}
          />
          <span aria-hidden="true" className="onboarding-field-unit">
            {unit}
          </span>
        </span>
      ) : multiline ? (
        <textarea {...inputProps} rows={rows} />
      ) : (
        <input
          {...inputProps}
          inputMode={inputMode}
        />
      )}
    </label>
  );
}

export function normalizeOnboardingStepId(value: string | string[] | undefined): OnboardingStepId {
  const stepId = Array.isArray(value) ? value[0] : value;
  return onboardingFlowStepIds.some((flowStepId) => flowStepId === stepId)
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

function buildInitialDraft(
  selectableModels: RuntimeModelOption[]
): OnboardingDraft {
  return {
    projectDescription: "",
    projectName: "",
    projectTotalBudgetUsd: "100",
    selectedModelKey: selectableModels[0]?.value ?? "",
    warningThresholdPercent: "80"
  };
}

function getSelectedModelOption(
  options: RuntimeModelOption[],
  value: string,
  projectTenantId: string
) {
  return (
    options.find(
      (option) =>
        option.value === value &&
        (!option.providerTenantId || option.providerTenantId === projectTenantId)
    ) ?? null
  );
}

function getSelectableModelOptions(
  providerConnections: ProviderConnectionRecord[],
  controlPlaneTenantId: string,
  fallbackModels: AdminProviderModel[] = []
): RuntimeModelOption[] {
  const providerConnectionOptions = providerConnections
    .filter((providerConnection) =>
      isTenantLevelProviderConnection(providerConnection, controlPlaneTenantId)
    )
    .flatMap((providerConnection) =>
      getProviderConfigModels(providerConnection.providerConfig).map((model) => ({
        label: `${model} (${providerConnection.provider})`,
        providerConnectionId: providerConnection.id,
        providerTenantId: providerConnection.tenantId,
        value: `${providerConnection.provider}::${model}`
      }))
    );

  if (providerConnectionOptions.length > 0) {
    return providerConnectionOptions;
  }

  return fallbackModels
    .filter((model) => model.status === "active" || model.status === "ACTIVE")
    .map((model) => ({
      label: `${model.displayName || model.model} (${model.provider})`,
      providerConnectionId: null,
      providerTenantId: null,
      value: `${model.provider}::${model.model}`
    }));
}

function isTenantLevelProviderConnection(
  providerConnection: ProviderConnectionRecord,
  controlPlaneTenantId: string
) {
  return providerConnection.projectId === null && providerConnection.tenantId === controlPlaneTenantId;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getProviderConfigModels(providerConfig: Record<string, unknown> | null) {
  const models = providerConfig?.models;

  return Array.isArray(models)
    ? Array.from(
        new Set(
          models
            .map((model) => (typeof model === "string" ? model.trim() : ""))
            .filter(Boolean)
        )
      )
    : [];
}

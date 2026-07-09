import type {
  OnboardingDraftProjectApiKeyIssueResponse,
  OnboardingDraftProjectApiKeyIssueValues,
  OneTimeApiKeyResponse
} from "@/lib/control-plane/api-keys-types";
import type {
  ProjectFormValues,
  ProjectRecord,
  ProjectUpdateValues
} from "@/lib/control-plane/projects-types";
import type {
  ProjectTeamMutationValues,
  ProjectTeamRecord
} from "@/lib/control-plane/teams-types";

type MutationResult<T> =
  | {
      data: T;
      ok: true;
      policyError?: string;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type OnboardingDraftProjectApiKeyIssueResult = MutationResult<
  OnboardingDraftProjectApiKeyIssueResponse
>;

type OnboardingDraftProjectApiKeyIssueDependencies = {
  attachProjectTeam: (
    values: ProjectTeamMutationValues
  ) => Promise<MutationResult<ProjectTeamRecord>>;
  createProject: (
    values: ProjectFormValues,
    routeTenantId?: string
  ) => Promise<MutationResult<ProjectRecord>>;
  issueApiKey: (
    values: {
      displayName: string;
      expiresAt: string;
      projectId: string;
      scopes: string;
    }
  ) => Promise<MutationResult<OneTimeApiKeyResponse>>;
  updateProject: (
    values: ProjectUpdateValues,
    routeTenantId?: string
  ) => Promise<MutationResult<ProjectRecord>>;
};

export async function issueApiKeyForOnboardingDraftProject(
  values: OnboardingDraftProjectApiKeyIssueValues,
  routeTenantId: string,
  dependencies: OnboardingDraftProjectApiKeyIssueDependencies
): Promise<OnboardingDraftProjectApiKeyIssueResult> {
  const projectResult = await dependencies.createProject(
    {
      description: values.project.description,
      name: values.project.name,
      status: "DRAFT",
      totalBudgetUsd: values.project.totalBudgetUsd,
      warningThresholdPercent: values.project.warningThresholdPercent
    },
    routeTenantId
  );

  if (!projectResult.ok) {
    return projectResult;
  }

  const project = projectResult.data;

  for (const teamId of uniqueStringValues(values.teamIds ?? [])) {
    const attachResult = await dependencies.attachProjectTeam({
      projectId: project.id,
      teamId
    });

    if (!attachResult.ok) {
      await archiveCreatedDraftProject(project, routeTenantId, dependencies.updateProject);
      return attachResult;
    }
  }

  const apiKeyResult = await dependencies.issueApiKey({
    displayName: values.displayName,
    expiresAt: values.expiresAt,
    projectId: project.id,
    scopes: values.scopes
  });

  if (!apiKeyResult.ok) {
    await archiveCreatedDraftProject(project, routeTenantId, dependencies.updateProject);
    return apiKeyResult;
  }

  return {
    data: {
      apiKey: apiKeyResult.data,
      project
    },
    ok: true,
    status: apiKeyResult.status
  };
}

async function archiveCreatedDraftProject(
  project: ProjectRecord,
  routeTenantId: string,
  updateProject: OnboardingDraftProjectApiKeyIssueDependencies["updateProject"]
) {
  await updateProject(
    {
      description: project.description ?? "",
      name: project.name,
      projectId: project.id,
      status: "ARCHIVED",
      totalBudgetUsd: project.totalBudgetUsd
    },
    routeTenantId
  ).catch(() => undefined);
}

function uniqueStringValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

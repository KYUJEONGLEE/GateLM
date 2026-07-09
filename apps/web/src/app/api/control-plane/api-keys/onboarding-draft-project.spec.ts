import { expect, test } from "@playwright/test";
import type { OneTimeApiKeyResponse } from "@/lib/control-plane/api-keys-types";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { ProjectTeamRecord } from "@/lib/control-plane/teams-types";
import { issueApiKeyForOnboardingDraftProject } from "./onboarding-draft-project";

test("creates a DRAFT project and issues the API key against that project", async () => {
  const calls: string[] = [];
  const createdProject = buildProject({ status: "DRAFT" });
  const issuedApiKey = buildApiKey();
  const createProjectValues: unknown[] = [];
  const attachedTeamIds: string[] = [];
  const issueApiKeyValues: unknown[] = [];

  const result = await issueApiKeyForOnboardingDraftProject(
    {
      displayName: "Project Gateway API Key",
      expiresAt: "",
      project: {
        description: "Draft only",
        name: "Onboarding project",
        selectedModelKey: "openai::gpt-4o-mini",
        status: "ACTIVE",
        totalBudgetUsd: 120,
        warningThresholdPercent: 75
      },
      scopes: "gateway:invoke",
      teamIds: ["team_a", "team_a", "team_b"],
      tenantId: "tenant_demo_acme"
    },
    "tenant_demo_acme",
    {
      attachProjectTeam: async (values) => {
        calls.push("attachProjectTeam");
        attachedTeamIds.push(values.teamId);
        return {
          data: buildProjectTeam(values.teamId),
          ok: true,
          status: 201
        };
      },
      createProject: async (values) => {
        calls.push("createProject");
        createProjectValues.push(values);
        return {
          data: createdProject,
          ok: true,
          status: 201
        };
      },
      issueApiKey: async (values) => {
        calls.push("issueApiKey");
        issueApiKeyValues.push(values);
        return {
          data: issuedApiKey,
          ok: true,
          status: 201
        };
      },
      updateProject: async () => {
        throw new Error("updateProject should not run on success");
      }
    }
  );

  expect(result).toEqual({
    data: {
      apiKey: issuedApiKey,
      project: createdProject
    },
    ok: true,
    status: 201
  });
  expect(calls).toEqual([
    "createProject",
    "attachProjectTeam",
    "attachProjectTeam",
    "issueApiKey"
  ]);
  expect(createProjectValues).toEqual([
    {
      description: "Draft only",
      name: "Onboarding project",
      status: "DRAFT",
      totalBudgetUsd: 120,
      warningThresholdPercent: 75
    }
  ]);
  expect(attachedTeamIds).toEqual(["team_a", "team_b"]);
  expect(issueApiKeyValues).toEqual([
    {
      displayName: "Project Gateway API Key",
      expiresAt: "",
      projectId: createdProject.id,
      scopes: "gateway:invoke"
    }
  ]);
});

test("archives the created DRAFT project when API key issuance fails", async () => {
  const createdProject = buildProject({ status: "DRAFT" });
  const archivedProjectValues: unknown[] = [];

  const result = await issueApiKeyForOnboardingDraftProject(
    {
      displayName: "Project Gateway API Key",
      expiresAt: "",
      project: {
        description: "",
        name: "Onboarding project",
        status: "DRAFT",
        totalBudgetUsd: 100,
        warningThresholdPercent: 80
      },
      scopes: "gateway:invoke",
      tenantId: "tenant_demo_acme"
    },
    "tenant_demo_acme",
    {
      attachProjectTeam: async () => {
        throw new Error("attachProjectTeam should not run without teams");
      },
      createProject: async () => ({
        data: createdProject,
        ok: true,
        status: 201
      }),
      issueApiKey: async () => ({
        error: "API Key issue failed.",
        ok: false,
        status: 502
      }),
      updateProject: async (values) => {
        archivedProjectValues.push(values);
        return {
          data: buildProject({ status: "ARCHIVED" }),
          ok: true,
          status: 200
        };
      }
    }
  );

  expect(result).toEqual({
    error: "API Key issue failed.",
    ok: false,
    status: 502
  });
  expect(archivedProjectValues).toEqual([
    {
      description: "",
      name: createdProject.name,
      projectId: createdProject.id,
      status: "ARCHIVED",
      totalBudgetUsd: createdProject.totalBudgetUsd
    }
  ]);
});

function buildProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    createdAt: "2026-07-09T00:00:00.000Z",
    description: "",
    id: "project_onboarding_draft",
    name: "Onboarding project",
    runtimeApplicationId: "app_onboarding_draft",
    status: "DRAFT",
    tenantId: "tenant_demo_acme",
    totalBudgetUsd: 100,
    updatedAt: "2026-07-09T00:00:00.000Z",
    warningThresholdPercent: 80,
    ...overrides
  };
}

function buildApiKey(): OneTimeApiKeyResponse {
  return {
    createdAt: "2026-07-09T00:00:00.000Z",
    credentialId: "cred_onboarding_draft",
    credentialType: "api_key",
    expiresAt: null,
    last4: "raft",
    plaintext: "redacted-one-time-placeholder",
    plaintextShownOnce: true,
    prefix: "gsk_live_",
    scopes: ["gateway:invoke"],
    status: "active",
    warning: "Store this value now."
  };
}

function buildProjectTeam(teamId: string): ProjectTeamRecord {
  return {
    assignedAt: "2026-07-09T00:00:00.000Z",
    id: `project_team_${teamId}`,
    projectId: "project_onboarding_draft",
    teamDescription: null,
    teamId,
    teamName: teamId,
    teamStatus: "ACTIVE",
    tenantId: "tenant_demo_acme"
  };
}

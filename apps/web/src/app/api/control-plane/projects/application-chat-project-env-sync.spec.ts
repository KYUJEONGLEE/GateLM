import { expect, test } from "@playwright/test";
import { syncApplicationChatEnvAfterProjectMutation } from "./application-chat-project-env-sync";

test("archived project update removes the stale Application Chat API key when project list refresh fails", async () => {
  const removedProjectIds: string[] = [];
  const syncedProjectLists: unknown[][] = [];

  await syncApplicationChatEnvAfterProjectMutation({
    controlPlaneTenantId: "00000000-0000-4000-8000-000000000100",
    listProjectsFresh: async () => ({
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    }),
    removeProjectEnv: async (projectId) => {
      removedProjectIds.push(projectId);
    },
    syncProjectsEnv: async (projects) => {
      syncedProjectLists.push(projects);
    },
    updatedProject: {
      createdAt: "2026-07-09T00:00:00.000Z",
      description: null,
      id: "00000000-0000-4000-8000-000000000201",
      name: "Archived Project",
      rateLimit: null,
      runtimeApplicationId: "00000000-0000-4000-8000-000000000301",
      status: "ARCHIVED",
      tenantId: "00000000-0000-4000-8000-000000000100",
      totalBudgetUsd: 100,
      updatedAt: "2026-07-09T00:01:00.000Z",
      warningThresholdPercent: 80
    }
  });

  expect(removedProjectIds).toEqual(["00000000-0000-4000-8000-000000000201"]);
  expect(syncedProjectLists).toEqual([]);
});

test("non-active project update removes the stale Application Chat API key when project list refresh fails", async () => {
  const removedProjectIds: string[] = [];

  await syncApplicationChatEnvAfterProjectMutation({
    controlPlaneTenantId: "00000000-0000-4000-8000-000000000100",
    listProjectsFresh: async () => ({
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    }),
    removeProjectEnv: async (projectId) => {
      removedProjectIds.push(projectId);
    },
    syncProjectsEnv: async () => {
      throw new Error("syncProjectsEnv should not run.");
    },
    updatedProject: {
      createdAt: "2026-07-09T00:00:00.000Z",
      description: null,
      id: "00000000-0000-4000-8000-000000000202",
      name: "Draft Project",
      rateLimit: null,
      runtimeApplicationId: "00000000-0000-4000-8000-000000000302",
      status: "DRAFT",
      tenantId: "00000000-0000-4000-8000-000000000100",
      totalBudgetUsd: 100,
      updatedAt: "2026-07-09T00:01:00.000Z",
      warningThresholdPercent: 80
    }
  });

  expect(removedProjectIds).toEqual(["00000000-0000-4000-8000-000000000202"]);
});

test("active project without a runtime application removes the stale Application Chat API key when project list refresh fails", async () => {
  const removedProjectIds: string[] = [];

  await syncApplicationChatEnvAfterProjectMutation({
    controlPlaneTenantId: "00000000-0000-4000-8000-000000000100",
    listProjectsFresh: async () => ({
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    }),
    removeProjectEnv: async (projectId) => {
      removedProjectIds.push(projectId);
    },
    syncProjectsEnv: async () => {
      throw new Error("syncProjectsEnv should not run.");
    },
    updatedProject: {
      createdAt: "2026-07-09T00:00:00.000Z",
      description: null,
      id: "00000000-0000-4000-8000-000000000203",
      name: "Unbound Project",
      rateLimit: null,
      runtimeApplicationId: null,
      status: "ACTIVE",
      tenantId: "00000000-0000-4000-8000-000000000100",
      totalBudgetUsd: 100,
      updatedAt: "2026-07-09T00:01:00.000Z",
      warningThresholdPercent: 80
    }
  });

  expect(removedProjectIds).toEqual(["00000000-0000-4000-8000-000000000203"]);
});

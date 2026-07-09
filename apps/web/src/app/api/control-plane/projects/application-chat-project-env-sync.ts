import type { ProjectRecord } from "@/lib/control-plane/projects-types";

type ProjectListResult =
  | {
      data: ProjectRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type SyncApplicationChatEnvInput = {
  controlPlaneTenantId: string;
  listProjectsFresh: (tenantId: string) => Promise<ProjectListResult>;
  removeProjectEnv: (projectId: string) => Promise<void>;
  syncProjectsEnv: (projects: ProjectRecord[]) => Promise<void>;
  updatedProject: ProjectRecord;
};

export async function syncApplicationChatEnvAfterProjectMutation({
  controlPlaneTenantId,
  listProjectsFresh,
  removeProjectEnv,
  syncProjectsEnv,
  updatedProject
}: SyncApplicationChatEnvInput) {
  const syncProjectList = await listProjectsFresh(controlPlaneTenantId);

  if (syncProjectList.ok) {
    await syncProjectsEnv(syncProjectList.data);
    return;
  }

  if (updatedProject.status !== "ACTIVE" || !updatedProject.runtimeApplicationId) {
    await removeProjectEnv(updatedProject.id);
    return;
  }

  console.warn("Application Chat env sync skipped.", syncProjectList.error);
}

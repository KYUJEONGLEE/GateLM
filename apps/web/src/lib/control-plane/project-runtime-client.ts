import "server-only";

import { getApplicationsModel } from "@/lib/control-plane/applications-client";
import type { ApplicationRecord } from "@/lib/control-plane/applications-types";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import { getRuntimePolicyModelForApplication } from "@/lib/control-plane/runtime-policy-client";
import type { RuntimePolicyModel } from "@/lib/control-plane/runtime-policy-types";

export type ProjectRuntimePolicyModel = {
  project: ProjectRecord;
  runtimeApplicationId: string;
  policyModel: RuntimePolicyModel;
};

export async function getProjectRuntimePolicyModel(
  routeTenantId: string,
  projectId: string
): Promise<ProjectRuntimePolicyModel | null> {
  const projectsModel = await getProjectsModel(routeTenantId);
  const project = projectsModel.projects.find((item) => item.id === projectId);

  if (!project) {
    return null;
  }

  if (project.status !== "ACTIVE") {
    return null;
  }

  const applicationsModel = await getApplicationsModel(routeTenantId, project.id);
  const runtimeApplicationId = resolveProjectRuntimeApplicationId(
    project,
    applicationsModel.applications
  );

  if (!runtimeApplicationId) {
    return null;
  }

  return {
    policyModel: await getRuntimePolicyModelForApplication(
      routeTenantId,
      runtimeApplicationId,
      project.id
    ),
    project,
    runtimeApplicationId
  };
}

export function resolveProjectRuntimeApplicationId(
  project: Pick<ProjectRecord, "runtimeApplicationId">,
  applications: Array<Pick<ApplicationRecord, "id" | "status">>
) {
  const activeApplications = applications.filter((application) => application.status === "ACTIVE");
  const activeRuntimeApplication = activeApplications.find(
    (application) => application.id === project.runtimeApplicationId
  );

  return (
    activeRuntimeApplication?.id ??
    activeApplications[0]?.id ??
    project.runtimeApplicationId ??
    null
  );
}

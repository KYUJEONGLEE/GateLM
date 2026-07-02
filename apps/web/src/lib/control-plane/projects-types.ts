export type ProjectStatus = "ACTIVE" | "ARCHIVED" | "DISABLED";

export type ProjectRecord = {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  status: ProjectStatus;
  tenantId: string;
  updatedAt: string;
};

export type ProjectFormValues = {
  description: string;
  name: string;
};

export type ProjectUpdateValues = ProjectFormValues & {
  projectId: string;
  status: ProjectStatus;
};

export type ProjectsModel = {
  controlPlaneBaseUrl: string;
  controlPlaneTenantId: string;
  loadError: string | null;
  projects: ProjectRecord[];
  routeTenantId: string;
  source: "control-plane" | "fixture";
};

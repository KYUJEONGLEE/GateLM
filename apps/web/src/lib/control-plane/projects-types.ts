export type ProjectStatus = "ACTIVE" | "ARCHIVED" | "DISABLED";

export type ProjectRecord = {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  status: ProjectStatus;
  tenantId: string;
  totalBudgetUsd: number;
  updatedAt: string;
};

export type ProjectBaseValues = {
  description: string;
  name: string;
  totalBudgetUsd: number;
};

export type ProjectFormValues = ProjectBaseValues & {
  providerConnectionIds?: string[];
  selectedModelKey?: string;
  warningThresholdPercent: number;
};

export type ProjectUpdateValues = ProjectBaseValues & {
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

export type ProjectStatus = "ACTIVE" | "ARCHIVED" | "DISABLED" | "DRAFT";

export type ProjectRecord = {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  runtimeApplicationId: string | null;
  status: ProjectStatus;
  tenantId: string;
  totalBudgetUsd: number;
  updatedAt: string;
  warningThresholdPercent: number;
};

export type ProjectBudgetThresholdRecord = {
  projectId: string;
  warningThresholdPercent: number;
};

export type ProjectBaseValues = {
  description: string;
  name: string;
  totalBudgetUsd: number;
};

export type ProjectFormValues = ProjectBaseValues & {
  providerConnectionIds?: string[];
  selectedModelKey?: string;
  status?: ProjectStatus;
  warningThresholdPercent: number;
};

export type ProjectUpdateValues = ProjectBaseValues & {
  projectId: string;
  providerConnectionIds?: string[];
  selectedModelKey?: string;
  status: ProjectStatus;
  warningThresholdPercent?: number;
};

export type ProjectsModel = {
  controlPlaneBaseUrl: string;
  controlPlaneTenantId: string;
  loadError: string | null;
  projects: ProjectRecord[];
  routeTenantId: string;
  source: "control-plane" | "fixture";
};

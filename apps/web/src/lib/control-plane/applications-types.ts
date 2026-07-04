export type ApplicationStatus = "ACTIVE" | "ARCHIVED" | "DISABLED";
export type ApplicationBudgetLimitMode = "FIXED" | "PERCENT";

export type ApplicationRecord = {
  budgetLimitMode: ApplicationBudgetLimitMode;
  budgetLimitPercent: number | null;
  budgetLimitUsd: number | null;
  createdAt: string;
  description: string | null;
  effectiveBudgetLimitUsd: number;
  id: string;
  name: string;
  projectId: string;
  status: ApplicationStatus;
  tenantId: string;
  updatedAt: string;
};

export type ApplicationFormValues = {
  budgetLimitMode: ApplicationBudgetLimitMode;
  budgetLimitPercent: number;
  budgetLimitUsd: number;
  description: string;
  name: string;
  projectId?: string;
  providerConnectionIds?: string[];
  selectedModelKey?: string;
};

export type ApplicationUpdateValues = ApplicationFormValues & {
  applicationId: string;
  status: ApplicationStatus;
};

export type ApplicationsModel = {
  applications: ApplicationRecord[];
  controlPlaneBaseUrl: string;
  controlPlaneProjectId: string;
  loadError: string | null;
  routeTenantId: string;
  source: "control-plane" | "fixture";
};

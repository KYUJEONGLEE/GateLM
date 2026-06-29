export type ApplicationStatus = "ACTIVE" | "ARCHIVED" | "DISABLED";

export type ApplicationRecord = {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  projectId: string;
  status: ApplicationStatus;
  tenantId: string;
  updatedAt: string;
};

export type ApplicationFormValues = {
  description: string;
  name: string;
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

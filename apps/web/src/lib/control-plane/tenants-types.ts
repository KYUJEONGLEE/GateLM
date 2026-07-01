export type TenantStatus = "ACTIVE" | "ARCHIVED" | "DISABLED";

export type TenantRecord = {
  createdAt: string;
  id: string;
  name: string;
  status: TenantStatus;
  updatedAt: string;
};

export type TenantCreateValues = {
  name: string;
};

export type TenantsModel = {
  controlPlaneBaseUrl: string;
  controlPlaneTenantId: string;
  loadError: string | null;
  routeTenantId: string;
  source: "control-plane" | "fixture";
  tenants: TenantRecord[];
};

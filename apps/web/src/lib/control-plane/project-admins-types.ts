export type ProjectAdminStatus = "active" | "pending";

export type ProjectAdminRecord = {
  connectedAt: string;
  email: string;
  id: string;
  invitationId: string | null;
  name: string;
  projectAdminId: string | null;
  projectId: string;
  role: "project_admin";
  status: ProjectAdminStatus;
  tenantId: string;
  userId: string | null;
};

export type ProjectAdminInvitationRecord = {
  email: string;
  expiresAt: string;
  invitationId: string;
  name: string;
  projectId: string;
  projectName: string;
  signupUrl: string;
  status: string;
  tenantId: string;
  tenantName: string;
};

export type ProjectAdminInviteValues = {
  email: string;
  name: string;
  projectId: string;
};

export type ProjectAdminRemoveValues = {
  projectId: string;
  userId: string;
};

export type ProjectAdminInvitationRevokeValues = {
  invitationId: string;
};

export type ProjectAdminsModel = {
  loadError: string | null;
  projectAdmins: ProjectAdminRecord[];
  projectId: string;
  routeTenantId: string;
  source: "control-plane" | "fixture";
};

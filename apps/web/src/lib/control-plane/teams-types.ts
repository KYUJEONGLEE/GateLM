export type TeamStatus = "ACTIVE" | "ARCHIVED" | "DISABLED";

export type TeamRecord = {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  projectCount: number;
  status: TeamStatus;
  tenantId: string;
  updatedAt: string;
};

export type ProjectTeamRecord = {
  assignedAt: string;
  id: string;
  projectId: string;
  teamDescription: string | null;
  teamId: string;
  teamName: string;
  teamStatus: TeamStatus;
  tenantId: string;
};

export type TeamFormValues = {
  description: string;
  name: string;
  tenantId?: string;
};

export type TeamUpdateValues = TeamFormValues & {
  status: TeamStatus;
  teamId: string;
};

export type ProjectTeamMutationValues = {
  projectId: string;
  teamId: string;
};

export type TeamsModel = {
  controlPlaneBaseUrl: string;
  controlPlaneTenantId: string;
  loadError: string | null;
  routeTenantId: string;
  source: "control-plane" | "fixture";
  teams: TeamRecord[];
};

export type ProjectTeamsModel = {
  attachedTeams: ProjectTeamRecord[];
  availableTeams: TeamRecord[];
  loadError: string | null;
  projectId: string;
  routeTenantId: string;
  source: "control-plane" | "fixture";
};

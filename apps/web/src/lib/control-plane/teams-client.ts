import "server-only";

import {
  getControlPlaneBaseUrl,
  getControlPlaneTenantId,
  resolveControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import type {
  ProjectTeamMutationValues,
  ProjectTeamRecord,
  ProjectTeamsModel,
  TeamFormValues,
  TeamRecord,
  TeamsModel,
  TeamUpdateValues
} from "@/lib/control-plane/teams-types";

type TeamRequestResult =
  | {
      data: TeamRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type TeamListResult =
  | {
      data: TeamRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProjectTeamRequestResult =
  | {
      data: ProjectTeamRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProjectTeamListResult =
  | {
      data: ProjectTeamRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

export async function getTeamsModel(routeTenantId: string): Promise<TeamsModel> {
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const controlPlaneTenantId = resolveControlPlaneTenantId(routeTenantId);
  const listResult = await listTeams(controlPlaneTenantId);

  if (listResult.ok) {
    return {
      controlPlaneBaseUrl,
      controlPlaneTenantId,
      loadError: null,
      routeTenantId,
      source: "control-plane",
      teams: listResult.data
    };
  }

  return {
    controlPlaneBaseUrl,
    controlPlaneTenantId,
    loadError: listResult.error,
    routeTenantId,
    source: "fixture",
    teams: getFixtureTeams(controlPlaneTenantId)
  };
}

export async function getProjectTeamsModel(
  routeTenantId: string,
  projectId: string
): Promise<ProjectTeamsModel> {
  const controlPlaneTenantId = resolveControlPlaneTenantId(routeTenantId);
  const teamsResult = await listTeams(controlPlaneTenantId);
  const projectTeamsResult = await listProjectTeams(projectId);

  if (teamsResult.ok && projectTeamsResult.ok) {
    return {
      attachedTeams: projectTeamsResult.data,
      availableTeams: teamsResult.data,
      loadError: null,
      projectId,
      routeTenantId,
      source: "control-plane"
    };
  }

  const fixtureTeams = getFixtureTeams(controlPlaneTenantId);
  const loadError = !teamsResult.ok
    ? teamsResult.error
    : !projectTeamsResult.ok
      ? projectTeamsResult.error
      : "Control Plane unavailable.";

  return {
    attachedTeams: [],
    availableTeams: fixtureTeams,
    loadError,
    projectId,
    routeTenantId,
    source: "fixture"
  };
}

export async function createTeam(values: TeamFormValues): Promise<TeamRequestResult> {
  const tenantId = values.tenantId?.trim() || getControlPlaneTenantId();

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/teams`,
      {
        body: JSON.stringify(toTeamPayload(values)),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    return readTeamResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function updateTeam(values: TeamUpdateValues): Promise<TeamRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/teams/${encodeURIComponent(values.teamId)}`,
      {
        body: JSON.stringify({
          description: values.description.trim(),
          name: values.name.trim(),
          status: values.status
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH"
      }
    );

    return readTeamResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function archiveTeam(teamId: string): Promise<TeamRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/teams/${encodeURIComponent(teamId)}`,
      {
        cache: "no-store",
        method: "DELETE"
      }
    );

    return readTeamResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function attachProjectTeam(
  values: ProjectTeamMutationValues
): Promise<ProjectTeamRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(values.projectId)}/teams`,
      {
        body: JSON.stringify({
          teamId: values.teamId
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    return readProjectTeamResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function detachProjectTeam(
  values: ProjectTeamMutationValues
): Promise<ProjectTeamRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(values.projectId)}/teams/${encodeURIComponent(values.teamId)}`,
      {
        cache: "no-store",
        method: "DELETE"
      }
    );

    return readProjectTeamResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function listTeams(tenantId: string): Promise<TeamListResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/teams?limit=100`,
      {
        cache: "no-store"
      }
    );

    return readTeamListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function listProjectTeams(projectId: string): Promise<ProjectTeamListResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/teams`,
      {
        cache: "no-store"
      }
    );

    return readProjectTeamListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function toTeamPayload(values: TeamFormValues) {
  return {
    description: values.description.trim() || undefined,
    name: values.name.trim()
  };
}

async function readTeamResponse(response: Response): Promise<TeamRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const team = getTeamFromPayload(payload);

  if (!team) {
    return {
      error: "Control Plane response did not include team data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: team,
    ok: true,
    status: response.status
  };
}

async function readTeamListResponse(response: Response): Promise<TeamListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const teams = getTeamsFromPayload(payload);

  if (!teams) {
    return {
      error: "Control Plane response did not include team list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: teams,
    ok: true,
    status: response.status
  };
}

async function readProjectTeamResponse(
  response: Response
): Promise<ProjectTeamRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const projectTeam = getProjectTeamFromPayload(payload);

  if (!projectTeam) {
    return {
      error: "Control Plane response did not include project team data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: projectTeam,
    ok: true,
    status: response.status
  };
}

async function readProjectTeamListResponse(
  response: Response
): Promise<ProjectTeamListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const projectTeams = getProjectTeamsFromPayload(payload);

  if (!projectTeams) {
    return {
      error: "Control Plane response did not include project team list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: projectTeams,
    ok: true,
    status: response.status
  };
}

function getTeamFromPayload(payload: unknown): TeamRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const team = record.data ?? record;

  return toTeamRecord(team);
}

function getTeamsFromPayload(payload: unknown): TeamRecord[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const teams = record.data.map(toTeamRecord);

  if (teams.some((team) => team === null)) {
    return null;
  }

  return teams as TeamRecord[];
}

function getProjectTeamFromPayload(payload: unknown): ProjectTeamRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const projectTeam = record.data ?? record;

  return toProjectTeamRecord(projectTeam);
}

function getProjectTeamsFromPayload(payload: unknown): ProjectTeamRecord[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const projectTeams = record.data.map(toProjectTeamRecord);

  if (projectTeams.some((projectTeam) => projectTeam === null)) {
    return null;
  }

  return projectTeams as ProjectTeamRecord[];
}

function toTeamRecord(value: unknown): TeamRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeTeamStatus(record.status);

  if (
    typeof record.id !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.name !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.projectCount !== "number" ||
    !status
  ) {
    return null;
  }

  return {
    createdAt: record.createdAt,
    description: typeof record.description === "string" ? record.description : null,
    id: record.id,
    name: record.name,
    projectCount: record.projectCount,
    status,
    tenantId: record.tenantId,
    updatedAt: record.updatedAt
  };
}

function toProjectTeamRecord(value: unknown): ProjectTeamRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const teamStatus = normalizeTeamStatus(record.teamStatus);

  if (
    typeof record.id !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.projectId !== "string" ||
    typeof record.teamId !== "string" ||
    typeof record.teamName !== "string" ||
    typeof record.assignedAt !== "string" ||
    !teamStatus
  ) {
    return null;
  }

  return {
    assignedAt: record.assignedAt,
    id: record.id,
    projectId: record.projectId,
    teamDescription: typeof record.teamDescription === "string" ? record.teamDescription : null,
    teamId: record.teamId,
    teamName: record.teamName,
    teamStatus,
    tenantId: record.tenantId
  };
}

function normalizeTeamStatus(value: unknown): TeamRecord["status"] | null {
  if (value === "ACTIVE" || value === "active") {
    return "ACTIVE";
  }

  if (value === "ARCHIVED" || value === "archived") {
    return "ARCHIVED";
  }

  if (value === "DISABLED" || value === "disabled") {
    return "DISABLED";
  }

  return null;
}

function getErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.message ?? record.error;

    if (typeof message === "string") {
      return message;
    }

    if (message && typeof message === "object") {
      const nestedMessage = (message as Record<string, unknown>).message;

      if (typeof nestedMessage === "string" && nestedMessage.trim()) {
        return nestedMessage;
      }
    }
  }

  return `Control Plane request failed with HTTP ${status}.`;
}

function getFixtureTeams(tenantId: string): TeamRecord[] {
  const timestamp = "2026-06-27T00:00:00.000Z";

  return [
    {
      createdAt: timestamp,
      description: "Handles customer-facing support AI operations.",
      id: "team_fixture_support",
      name: "Support Team",
      projectCount: 0,
      status: "ACTIVE",
      tenantId,
      updatedAt: timestamp
    },
    {
      createdAt: timestamp,
      description: "Owns platform operation and internal tooling.",
      id: "team_fixture_platform",
      name: "Platform Team",
      projectCount: 0,
      status: "ACTIVE",
      tenantId,
      updatedAt: timestamp
    }
  ];
}

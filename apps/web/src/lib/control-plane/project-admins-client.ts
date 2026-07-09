import "server-only";

import { cookies } from "next/headers";
import { getControlPlaneBaseUrl, getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import type {
  ProjectAdminInvitationRecord,
  ProjectAdminInvitationRevokeValues,
  ProjectAdminInviteValues,
  ProjectAdminRecord,
  ProjectAdminRemoveValues,
  ProjectAdminsModel
} from "@/lib/control-plane/project-admins-types";

type ControlPlaneRequestOptions = {
  cookieHeader?: string | null;
};

type ProjectAdminListResult =
  | {
      data: ProjectAdminRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProjectAdminRequestResult =
  | {
      data: ProjectAdminRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProjectAdminInviteRequestResult =
  | {
      data: ProjectAdminInvitationRecord | ProjectAdminRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };
export async function getProjectAdminsModel(
  routeTenantId: string,
  projectId: string
): Promise<ProjectAdminsModel> {
  const listResult = await listProjectAdmins(projectId);

  if (listResult.ok) {
    return {
      loadError: null,
      projectAdmins: listResult.data,
      projectId,
      routeTenantId,
      source: "control-plane"
    };
  }

  return {
    loadError: listResult.error,
    projectAdmins: getFixtureProjectAdmins(getControlPlaneTenantId(), projectId),
    projectId,
    routeTenantId,
    source: "fixture"
  };
}

export async function inviteProjectAdmin(
  values: ProjectAdminInviteValues,
  options?: ControlPlaneRequestOptions
): Promise<ProjectAdminInviteRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(values.projectId)}/project-admin-invitations`,
      {
        body: JSON.stringify({ email: values.email.trim(), name: values.name.trim() }),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options, {
          "Content-Type": "application/json"
        }),
        method: "POST"
      }
    );

    return readProjectAdminInviteResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function removeProjectAdmin(
  values: ProjectAdminRemoveValues,
  options?: ControlPlaneRequestOptions
): Promise<ProjectAdminRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(values.projectId)}/project-admins/${encodeURIComponent(values.userId)}`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options),
        method: "DELETE"
      }
    );

    return readProjectAdminResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function revokeProjectAdminInvitation(
  values: ProjectAdminInvitationRevokeValues,
  options?: ControlPlaneRequestOptions
): Promise<ProjectAdminRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/project-admin-invitations/${encodeURIComponent(values.invitationId)}/revoke`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options),
        method: "POST"
      }
    );

    return readProjectAdminResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function listProjectAdmins(
  projectId: string,
  options?: ControlPlaneRequestOptions
): Promise<ProjectAdminListResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/project-admins`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options)
      }
    );

    return readProjectAdminListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function readProjectAdminListResponse(response: Response): Promise<ProjectAdminListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const projectAdmins = getProjectAdminsFromPayload(payload);

  if (!projectAdmins) {
    return {
      error: "Control Plane response did not include project admin list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: projectAdmins,
    ok: true,
    status: response.status
  };
}

async function readProjectAdminResponse(response: Response): Promise<ProjectAdminRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const projectAdmin = getProjectAdminFromPayload(payload);

  if (!projectAdmin) {
    return {
      error: "Control Plane response did not include project admin data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: projectAdmin,
    ok: true,
    status: response.status
  };
}

async function readProjectAdminInviteResponse(
  response: Response
): Promise<ProjectAdminInviteRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const projectAdmin = getProjectAdminFromPayload(payload);
  if (projectAdmin) {
    return {
      data: projectAdmin,
      ok: true,
      status: response.status
    };
  }

  const invitation = getProjectAdminInvitationFromPayload(payload);
  if (invitation) {
    return {
      data: invitation,
      ok: true,
      status: response.status
    };
  }

  return {
    error: "Control Plane response did not include project admin invite data.",
    ok: false,
    status: response.status
  };
}
async function buildControlPlaneHeaders(
  options?: ControlPlaneRequestOptions,
  init?: Record<string, string>
): Promise<Record<string, string> | undefined> {
  const headers = { ...(init ?? {}) };
  const cookieHeader = options?.cookieHeader ?? await getServerCookieHeader();

  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

async function getServerCookieHeader() {
  let cookieStore: Awaited<ReturnType<typeof cookies>>;

  try {
    cookieStore = await cookies();
  } catch {
    return null;
  }

  const pairs = ["gatelm_session", "gatelm_onboarding"]
    .map((name) => {
      const value = cookieStore.get(name)?.value;
      return value ? `${name}=${encodeURIComponent(value)}` : null;
    })
    .filter((pair): pair is string => Boolean(pair));

  return pairs.length > 0 ? pairs.join("; ") : null;
}

function getProjectAdminsFromPayload(payload: unknown): ProjectAdminRecord[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const projectAdmins = record.data.map(toProjectAdminRecord);

  if (projectAdmins.some((projectAdmin) => projectAdmin === null)) {
    return null;
  }

  return projectAdmins as ProjectAdminRecord[];
}

function getProjectAdminFromPayload(payload: unknown): ProjectAdminRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const projectAdmin = record.data ?? record;

  return toProjectAdminRecord(projectAdmin);
}

function getProjectAdminInvitationFromPayload(payload: unknown): ProjectAdminInvitationRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const invitation = record.data ?? record;

  return toProjectAdminInvitationRecord(invitation);
}

function toProjectAdminRecord(value: unknown): ProjectAdminRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.connectedAt !== "string" ||
    typeof record.email !== "string" ||
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.projectId !== "string" ||
    record.role !== "project_admin" ||
    !isProjectAdminStatus(record.status) ||
    typeof record.tenantId !== "string"
  ) {
    return null;
  }

  return {
    connectedAt: record.connectedAt,
    email: record.email,
    id: record.id,
    invitationId: typeof record.invitationId === "string" ? record.invitationId : null,
    name: record.name,
    projectAdminId: typeof record.projectAdminId === "string" ? record.projectAdminId : null,
    projectId: record.projectId,
    role: "project_admin",
    status: record.status,
    tenantId: record.tenantId,
    userId: typeof record.userId === "string" ? record.userId : null
  };
}

function toProjectAdminInvitationRecord(value: unknown): ProjectAdminInvitationRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.email !== "string" ||
    typeof record.expiresAt !== "string" ||
    typeof record.invitationId !== "string" ||
    typeof record.name !== "string" ||
    typeof record.projectId !== "string" ||
    typeof record.projectName !== "string" ||
    typeof record.signupUrl !== "string" ||
    typeof record.status !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.tenantName !== "string"
  ) {
    return null;
  }

  return {
    email: record.email,
    expiresAt: record.expiresAt,
    invitationId: record.invitationId,
    name: record.name,
    projectId: record.projectId,
    projectName: record.projectName,
    signupUrl: record.signupUrl,
    status: record.status,
    tenantId: record.tenantId,
    tenantName: record.tenantName
  };
}

function isProjectAdminStatus(value: unknown): value is ProjectAdminRecord["status"] {
  return value === "active" || value === "pending";
}

function getErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.message ?? record.error;

    if (typeof message === "string") {
      return message;
    }
  }

  return `Control Plane request failed with HTTP ${status}.`;
}

function getFixtureProjectAdmins(tenantId: string, projectId: string): ProjectAdminRecord[] {
  return [
    {
      connectedAt: "2026-07-07T10:15:00.000Z",
      email: "hong@example.com",
      id: "fixture-project-admin-hong",
      invitationId: null,
      name: "홍길동",
      projectAdminId: "fixture-project-admin-hong",
      projectId,
      role: "project_admin",
      status: "active",
      tenantId,
      userId: "fixture-user-hong"
    },
    {
      connectedAt: "2026-06-18T09:42:00.000Z",
      email: "kim@example.com",
      id: "fixture-project-admin-kim-invite",
      invitationId: "fixture-project-admin-kim-invite",
      name: "김민지",
      projectAdminId: null,
      projectId,
      role: "project_admin",
      status: "pending",
      tenantId,
      userId: null
    }
  ];
}

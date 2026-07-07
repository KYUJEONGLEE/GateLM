import { NextResponse } from "next/server";
import { getCurrentConsoleAuth, type CurrentConsoleAuth } from "@/lib/auth/current-console-auth";
import { getControlPlaneBaseUrl } from "@/lib/control-plane/control-plane-config";
import {
  inviteProjectAdmin,
  listProjectAdmins,
  removeProjectAdmin,
  revokeProjectAdminInvitation
} from "@/lib/control-plane/project-admins-client";
import type {
  ProjectAdminInvitationRevokeValues,
  ProjectAdminInviteValues,
  ProjectAdminRemoveValues
} from "@/lib/control-plane/project-admins-types";

type RequestPayload = {
  action?: unknown;
  values?: unknown;
};

type ProjectAdminAction = "invite" | "remove" | "revokeInvitation";
type ProjectAdminActionValues =
  | ProjectAdminInvitationRevokeValues
  | ProjectAdminInviteValues
  | ProjectAdminRemoveValues;

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (!isProjectAdminAction(payload.action)) {
    return NextResponse.json({ error: "Unknown project admin action." }, { status: 400 });
  }

  const values = getProjectAdminActionValues(payload.action, payload.values);

  if (!values) {
    return NextResponse.json({ error: "Invalid project admin payload." }, { status: 400 });
  }

  const cookieHeader = request.headers.get("cookie");
  const auth = await getCurrentConsoleAuth(cookieHeader);
  const authFailure = await authorizeTenantAdminForProject(auth, values.projectId, cookieHeader);

  if (authFailure) {
    return authFailure;
  }

  if (payload.action === "revokeInvitation") {
    const invitationCheck = await assertInvitationBelongsToProject(
      values.projectId,
      (values as ProjectAdminInvitationRevokeValues).invitationId,
      cookieHeader
    );

    if (invitationCheck) {
      return invitationCheck;
    }
  }

  const result = await runProjectAdminAction(payload.action, values, cookieHeader);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        status: result.status
      },
      { status: result.status > 0 ? result.status : 502 }
    );
  }

  if (payload.action === "invite") {
    return isProjectAdminRecord(result.data)
      ? NextResponse.json({
          projectAdmin: result.data,
          status: result.status
        })
      : NextResponse.json({
          invitation: result.data,
          status: result.status
        });
  }

  return NextResponse.json({
    projectAdmin: result.data,
    status: result.status
  });
}

function runProjectAdminAction(
  action: ProjectAdminAction,
  values: ProjectAdminActionValues,
  cookieHeader?: string | null
) {
  if (action === "invite") {
    return inviteProjectAdmin(values as ProjectAdminInviteValues, { cookieHeader });
  }

  if (action === "remove") {
    return removeProjectAdmin(values as ProjectAdminRemoveValues, { cookieHeader });
  }

  return revokeProjectAdminInvitation(values as ProjectAdminInvitationRevokeValues, { cookieHeader });
}

async function authorizeTenantAdminForProject(
  auth: CurrentConsoleAuth,
  projectId: string,
  cookieHeader?: string | null
) {
  if (!auth.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const tenantIds = auth.memberships
    .filter((membership) =>
      membership.status === "active" && membership.role === "tenant_admin" && membership.tenantId
    )
    .map((membership) => membership.tenantId);

  if (tenantIds.length === 0) {
    return NextResponse.json({ error: "Only tenant admins can manage project admins." }, { status: 403 });
  }

  for (const tenantId of tenantIds) {
    const projectLookup = await tenantHasProject(tenantId, projectId, cookieHeader);

    if (!projectLookup.ok) {
      return NextResponse.json(
        { error: projectLookup.error, status: projectLookup.status },
        { status: projectLookup.status > 0 ? projectLookup.status : 502 }
      );
    }

    if (projectLookup.hasProject) {
      return null;
    }
  }

  return NextResponse.json({ error: "Project is outside the tenant admin scope." }, { status: 403 });
}

async function tenantHasProject(tenantId: string, projectId: string, cookieHeader?: string | null) {
  let cursor: string | null = null;

  try {
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (cursor) {
        query.set("cursor", cursor);
      }

      const response = await fetch(
        `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/projects?${query.toString()}`,
        {
          cache: "no-store",
          headers: cookieHeader ? { cookie: cookieHeader } : undefined
        }
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          error: getErrorMessage(payload, response.status),
          hasProject: false,
          ok: false as const,
          status: response.status
        };
      }

      if (payloadHasProject(payload, projectId)) {
        return {
          hasProject: true,
          ok: true as const,
          status: response.status
        };
      }

      cursor = getNextCursor(payload);
    } while (cursor);

    return {
      hasProject: false,
      ok: true as const,
      status: 200
    };
  } catch {
    return {
      error: "Control Plane unavailable.",
      hasProject: false,
      ok: false as const,
      status: 0
    };
  }
}

async function assertInvitationBelongsToProject(
  projectId: string,
  invitationId: string,
  cookieHeader?: string | null
) {
  const projectAdmins = await listProjectAdmins(projectId, { cookieHeader });

  if (!projectAdmins.ok) {
    return NextResponse.json(
      { error: projectAdmins.error, status: projectAdmins.status },
      { status: projectAdmins.status > 0 ? projectAdmins.status : 502 }
    );
  }

  const invitationBelongsToProject = projectAdmins.data.some((projectAdmin) =>
    projectAdmin.invitationId === invitationId && projectAdmin.projectId === projectId
  );

  if (!invitationBelongsToProject) {
    return NextResponse.json(
      { error: "Project admin invitation is outside the project scope." },
      { status: 403 }
    );
  }

  return null;
}

function isProjectAdminRecord(value: unknown): value is import("@/lib/control-plane/project-admins-types").ProjectAdminRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.connectedAt === "string" &&
    typeof record.email === "string" &&
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.projectId === "string" &&
    record.role === "project_admin" &&
    record.status === "active" &&
    typeof record.tenantId === "string"
  );
}
function getProjectAdminActionValues(
  action: ProjectAdminAction,
  value: unknown
): ProjectAdminActionValues | null {
  if (action === "invite") {
    return isProjectAdminInviteValues(value) ? value : null;
  }

  if (action === "remove") {
    return isProjectAdminRemoveValues(value) ? value : null;
  }

  return isProjectAdminInvitationRevokeValues(value) ? value : null;
}

function isProjectAdminAction(value: unknown): value is ProjectAdminAction {
  return value === "invite" || value === "remove" || value === "revokeInvitation";
}

function isProjectAdminInviteValues(value: unknown): value is ProjectAdminInviteValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProjectAdminInviteValues>;

  return (
    typeof record.projectId === "string" &&
    typeof record.email === "string" &&
    typeof record.name === "string"
  );
}

function isProjectAdminRemoveValues(value: unknown): value is ProjectAdminRemoveValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProjectAdminRemoveValues>;

  return typeof record.projectId === "string" && typeof record.userId === "string";
}

function isProjectAdminInvitationRevokeValues(
  value: unknown
): value is ProjectAdminInvitationRevokeValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProjectAdminInvitationRevokeValues>;

  return typeof record.invitationId === "string" && typeof record.projectId === "string";
}

function payloadHasProject(payload: unknown, projectId: string) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return false;
  }

  return record.data.some((project) => {
    return Boolean(project && typeof project === "object" && (project as Record<string, unknown>).id === projectId);
  });
}

function getNextCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const pagination = (payload as Record<string, unknown>).pagination;
  if (!pagination || typeof pagination !== "object") {
    return null;
  }

  const nextCursor = (pagination as Record<string, unknown>).nextCursor;
  return typeof nextCursor === "string" && nextCursor.length > 0 ? nextCursor : null;
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

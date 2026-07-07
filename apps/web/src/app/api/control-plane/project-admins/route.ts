import { NextResponse } from "next/server";
import {
  inviteProjectAdmin,
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

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (!isProjectAdminAction(payload.action)) {
    return NextResponse.json({ error: "Unknown project admin action." }, { status: 400 });
  }

  const result = await runProjectAdminAction(payload.action, payload.values);

  if (!result) {
    return NextResponse.json({ error: "Invalid project admin payload." }, { status: 400 });
  }

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
    return NextResponse.json({
      invitation: result.data,
      status: result.status
    });
  }

  return NextResponse.json({
    projectAdmin: result.data,
    status: result.status
  });
}

function runProjectAdminAction(action: ProjectAdminAction, values: unknown) {
  if (action === "invite") {
    return isProjectAdminInviteValues(values) ? inviteProjectAdmin(values) : null;
  }

  if (action === "remove") {
    return isProjectAdminRemoveValues(values) ? removeProjectAdmin(values) : null;
  }

  return isProjectAdminInvitationRevokeValues(values) ? revokeProjectAdminInvitation(values) : null;
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

  return typeof (value as Partial<ProjectAdminInvitationRevokeValues>).invitationId === "string";
}


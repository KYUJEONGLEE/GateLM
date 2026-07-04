import { NextResponse } from "next/server";
import {
  archiveTeam,
  attachProjectTeam,
  createTeam,
  detachProjectTeam,
  updateTeam
} from "@/lib/control-plane/teams-client";
import type {
  ProjectTeamMutationValues,
  TeamFormValues,
  TeamStatus,
  TeamUpdateValues
} from "@/lib/control-plane/teams-types";

type RequestPayload = {
  action?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (!isTeamAction(payload.action)) {
    return NextResponse.json({ error: "Unknown team action." }, { status: 400 });
  }

  const result = await runTeamAction(payload.action, payload.values);

  if (!result) {
    return NextResponse.json({ error: "Invalid team payload." }, { status: 400 });
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

  if (payload.action === "attach" || payload.action === "detach") {
    return NextResponse.json({
      projectTeam: result.data,
      status: result.status
    });
  }

  return NextResponse.json({
    status: result.status,
    team: result.data
  });
}

async function runTeamAction(action: TeamAction, values: unknown) {
  if (action === "create") {
    return isTeamFormValues(values) ? createTeam(values) : null;
  }

  if (action === "update") {
    return isTeamUpdateValues(values) ? updateTeam(values) : null;
  }

  if (action === "archive") {
    return isArchiveValues(values) ? archiveTeam(values.teamId) : null;
  }

  if (action === "attach") {
    return isProjectTeamMutationValues(values) ? attachProjectTeam(values) : null;
  }

  return isProjectTeamMutationValues(values) ? detachProjectTeam(values) : null;
}

type TeamAction = "archive" | "attach" | "create" | "detach" | "update";

function isTeamAction(value: unknown): value is TeamAction {
  return (
    value === "archive" ||
    value === "attach" ||
    value === "create" ||
    value === "detach" ||
    value === "update"
  );
}

function isTeamFormValues(value: unknown): value is TeamFormValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<TeamFormValues>;

  return typeof record.name === "string" && typeof record.description === "string";
}

function isTeamUpdateValues(value: unknown): value is TeamUpdateValues {
  if (!isTeamFormValues(value)) {
    return false;
  }

  const record = value as Partial<TeamUpdateValues>;

  return typeof record.teamId === "string" && isTeamStatus(record.status);
}

function isArchiveValues(value: unknown): value is { teamId: string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as { teamId?: unknown }).teamId === "string";
}

function isProjectTeamMutationValues(value: unknown): value is ProjectTeamMutationValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProjectTeamMutationValues>;

  return typeof record.projectId === "string" && typeof record.teamId === "string";
}

function isTeamStatus(value: unknown): value is TeamStatus {
  return value === "ACTIVE" || value === "ARCHIVED" || value === "DISABLED";
}

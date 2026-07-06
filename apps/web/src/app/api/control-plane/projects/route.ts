import { NextResponse } from "next/server";
import { createProject, updateProject } from "@/lib/control-plane/projects-client";
import type {
  ProjectFormValues,
  ProjectStatus,
  ProjectUpdateValues
} from "@/lib/control-plane/projects-types";

type RequestPayload = {
  action?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (payload.action !== "create" && payload.action !== "update") {
    return NextResponse.json({ error: "Unknown project action." }, { status: 400 });
  }

  const result =
    payload.action === "create"
      ? isProjectFormValues(payload.values)
        ? await createProject(payload.values)
        : null
      : isProjectUpdateValues(payload.values)
        ? await updateProject(payload.values)
        : null;

  if (!result) {
    return NextResponse.json({ error: "Invalid project payload." }, { status: 400 });
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

  return NextResponse.json({
    project: result.data,
    status: result.status
  });
}

function isProjectFormValues(value: unknown): value is ProjectFormValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProjectFormValues>;

  return (
    typeof record.name === "string" &&
    typeof record.description === "string" &&
    typeof record.totalBudgetUsd === "number" &&
    Number.isFinite(record.totalBudgetUsd) &&
    record.totalBudgetUsd >= 0
  );
}

function isProjectUpdateValues(value: unknown): value is ProjectUpdateValues {
  if (!isProjectFormValues(value)) {
    return false;
  }

  const record = value as Partial<ProjectUpdateValues>;

  return typeof record.projectId === "string" && isProjectStatus(record.status);
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return value === "ACTIVE" || value === "ARCHIVED" || value === "DISABLED";
}

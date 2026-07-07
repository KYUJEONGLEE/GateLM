import { NextResponse } from "next/server";
import { getCurrentConsoleAuth, isTenantAdminForTenant } from "@/lib/auth/current-console-auth";
import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
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

  if (payload.action === "create") {
    const auth = await getCurrentConsoleAuth(request.headers.get("cookie"));
    if (!isTenantAdminForTenant(auth, getControlPlaneTenantId())) {
      return NextResponse.json({ error: "Only tenant admins can create projects." }, { status: 403 });
    }
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
    policyError: "policyError" in result ? result.policyError : undefined,
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
    record.totalBudgetUsd >= 0 &&
    typeof record.warningThresholdPercent === "number" &&
    Number.isInteger(record.warningThresholdPercent) &&
    record.warningThresholdPercent >= 0 &&
    record.warningThresholdPercent <= 100 &&
    (
      record.providerConnectionIds === undefined ||
      (
        Array.isArray(record.providerConnectionIds) &&
        record.providerConnectionIds.every((providerConnectionId) =>
          typeof providerConnectionId === "string"
        )
      )
    ) &&
    (record.status === undefined || isProjectStatus(record.status)) &&
    (record.selectedModelKey === undefined || typeof record.selectedModelKey === "string")
  );
}

function isProjectUpdateValues(value: unknown): value is ProjectUpdateValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProjectUpdateValues>;

  return (
    typeof record.name === "string" &&
    typeof record.description === "string" &&
    typeof record.totalBudgetUsd === "number" &&
    Number.isFinite(record.totalBudgetUsd) &&
    record.totalBudgetUsd >= 0 &&
    typeof record.projectId === "string" &&
    isProjectStatus(record.status) &&
    (
      record.providerConnectionIds === undefined ||
      (
        Array.isArray(record.providerConnectionIds) &&
        record.providerConnectionIds.every((providerConnectionId) =>
          typeof providerConnectionId === "string"
        )
      )
    ) &&
    (record.selectedModelKey === undefined || typeof record.selectedModelKey === "string") &&
    (
      record.warningThresholdPercent === undefined ||
      (
        typeof record.warningThresholdPercent === "number" &&
        Number.isInteger(record.warningThresholdPercent) &&
        record.warningThresholdPercent >= 0 &&
        record.warningThresholdPercent <= 100
      )
    )
  );
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return value === "ACTIVE" || value === "ARCHIVED" || value === "DISABLED" || value === "DRAFT";
}

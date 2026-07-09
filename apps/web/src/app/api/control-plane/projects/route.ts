import { NextResponse } from "next/server";
import { getCurrentConsoleAuthForCookieHeader, isTenantAdminForTenant } from "@/lib/auth/current-console-auth";
import {
  getControlPlaneTenantId,
  resolveControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import {
  controlPlaneReadCacheTags,
  controlPlaneTenantReadCacheTag,
  revalidateControlPlaneRead
} from "@/lib/control-plane/read-cache";
import {
  createProject,
  listControlPlaneProjectsFresh,
  updateProject
} from "@/lib/control-plane/projects-client";
import type {
  ProjectFormValues,
  ProjectStatus,
  ProjectUpdateValues
} from "@/lib/control-plane/projects-types";
import {
  removeApplicationChatEnvProject,
  syncApplicationChatEnvForProjects
} from "@/lib/gateway/application-chat-env-file";
import { syncApplicationChatEnvAfterProjectMutation } from "./application-chat-project-env-sync";

type RequestPayload = {
  action?: unknown;
  tenantId?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;
  const requestOptions = { cookieHeader: request.headers.get("cookie") };

  if (payload.action !== "create" && payload.action !== "update") {
    return NextResponse.json({ error: "Unknown project action." }, { status: 400 });
  }

  const routeTenantId = typeof payload.tenantId === "string"
    ? payload.tenantId
    : getControlPlaneTenantId();

  const auth = await getCurrentConsoleAuthForCookieHeader(request.headers.get("cookie"));
  if (!auth.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isTenantAdminForTenant(auth, routeTenantId)) {
    return NextResponse.json(
      {
        error: payload.action === "create"
          ? "Only tenant admins can create projects."
          : "Only tenant admins can update projects."
      },
      { status: 403 }
    );
  }

  const result =
    payload.action === "create"
      ? isProjectFormValues(payload.values)
        ? await createProject(payload.values, routeTenantId, requestOptions)
        : null
      : isProjectUpdateValues(payload.values)
        ? await updateProject(payload.values, routeTenantId, requestOptions)
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

  const controlPlaneTenantId = resolveControlPlaneTenantId(routeTenantId);
  revalidateControlPlaneRead([
    controlPlaneReadCacheTags.projects,
    controlPlaneTenantReadCacheTag("projects", controlPlaneTenantId),
    controlPlaneReadCacheTags.runtimePolicy
  ]);

  await syncApplicationChatEnvAfterProjectMutation({
    controlPlaneTenantId,
    listProjectsFresh: listControlPlaneProjectsFresh,
    removeProjectEnv: removeApplicationChatEnvProject,
    syncProjectsEnv: syncApplicationChatEnvForProjects,
    updatedProject: result.data
  }).catch((error) => {
      console.warn(
        "Application Chat env sync failed.",
        error instanceof Error ? error.message : "unknown error"
      );
  });

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

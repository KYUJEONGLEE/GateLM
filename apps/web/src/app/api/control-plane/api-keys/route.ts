import { NextResponse } from "next/server";
import { getCurrentConsoleAuthForCookieHeader, isTenantAdminForTenant } from "@/lib/auth/current-console-auth";
import {
  issueApiKey,
  revokeApiKey,
  rotateApiKey
} from "@/lib/control-plane/api-keys-client";
import type {
  ApiKeyIssueValues,
  OnboardingDraftProjectApiKeyIssueValues
} from "@/lib/control-plane/api-keys-types";
import {
  getControlPlaneTenantId,
  resolveControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import {
  controlPlaneReadCacheTags,
  controlPlaneTenantReadCacheTag,
  revalidateControlPlaneRead
} from "@/lib/control-plane/read-cache";
import { createProject, updateProject } from "@/lib/control-plane/projects-client";
import type { ProjectFormValues, ProjectStatus } from "@/lib/control-plane/projects-types";
import { attachProjectTeam } from "@/lib/control-plane/teams-client";
import { issueApiKeyForOnboardingDraftProject } from "./onboarding-draft-project";

type RequestPayload = {
  action?: unknown;
  apiKeyId?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (
    payload.action !== "issue" &&
    payload.action !== "issueForOnboardingDraftProject" &&
    payload.action !== "rotate" &&
    payload.action !== "revoke"
  ) {
    return NextResponse.json({ error: "Unknown API Key action." }, { status: 400 });
  }

  if (payload.action === "issueForOnboardingDraftProject") {
    if (!isOnboardingDraftProjectApiKeyIssueValues(payload.values)) {
      return NextResponse.json({ error: "Invalid API Key payload." }, { status: 400 });
    }

    const routeTenantId = payload.values.tenantId?.trim() || getControlPlaneTenantId();
    const auth = await getCurrentConsoleAuthForCookieHeader(request.headers.get("cookie"));

    if (!auth.isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isTenantAdminForTenant(auth, routeTenantId)) {
      return NextResponse.json(
        { error: "Only tenant admins can create project API Keys." },
        { status: 403 }
      );
    }

    const result = await issueApiKeyForOnboardingDraftProject(
      payload.values,
      routeTenantId,
      {
        attachProjectTeam,
        createProject,
        issueApiKey,
        updateProject
      }
    );

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
      controlPlaneTenantReadCacheTag("projects", controlPlaneTenantId)
    ]);

    return NextResponse.json({
      apiKey: result.data.apiKey,
      project: result.data.project,
      status: result.status
    });
  }

  const result =
    payload.action === "issue"
      ? isApiKeyIssueValues(payload.values)
        ? await issueApiKey(payload.values)
        : null
      : typeof payload.apiKeyId === "string"
        ? payload.action === "rotate"
          ? await rotateApiKey(payload.apiKeyId)
          : await revokeApiKey(payload.apiKeyId)
        : null;

  if (!result) {
    return NextResponse.json({ error: "Invalid API Key payload." }, { status: 400 });
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

  if (payload.action === "revoke") {
    return NextResponse.json({
      revoked: result.data,
      status: result.status
    });
  }

  return NextResponse.json({
    apiKey: result.data,
    status: result.status
  });
}

function isApiKeyIssueValues(value: unknown): value is ApiKeyIssueValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ApiKeyIssueValues>;

  return (
    typeof record.displayName === "string" &&
    typeof record.expiresAt === "string" &&
    (record.projectId === undefined || typeof record.projectId === "string") &&
    typeof record.scopes === "string"
  );
}

function isOnboardingDraftProjectApiKeyIssueValues(
  value: unknown
): value is OnboardingDraftProjectApiKeyIssueValues {
  if (!isApiKeyIssueValues(value)) {
    return false;
  }

  const record = value as Partial<OnboardingDraftProjectApiKeyIssueValues>;

  return (
    (record.tenantId === undefined || typeof record.tenantId === "string") &&
    isProjectFormValues(record.project) &&
    (
      record.teamIds === undefined ||
      (Array.isArray(record.teamIds) && record.teamIds.every((teamId) => typeof teamId === "string"))
    )
  );
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

function isProjectStatus(value: unknown): value is ProjectStatus {
  return value === "ACTIVE" || value === "ARCHIVED" || value === "DISABLED" || value === "DRAFT";
}

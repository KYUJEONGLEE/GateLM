import { NextResponse } from "next/server";
import { getCurrentConsoleAuthForCookieHeader, isTenantAdminForTenant } from "@/lib/auth/current-console-auth";
import {
  issueApiKey,
  listApiKeysForProjectWithAuth,
  revokeApiKey,
  rotateApiKey
} from "@/lib/control-plane/api-keys-client";
import {
  containsApiKey,
  containsProject
} from "@/lib/control-plane/api-keys-management-model";
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
import {
  createProject,
  listControlPlaneProjects,
  updateProject
} from "@/lib/control-plane/projects-client";
import type { ProjectFormValues, ProjectStatus } from "@/lib/control-plane/projects-types";
import { attachProjectTeam } from "@/lib/control-plane/teams-client";
import { issueApiKeyForOnboardingDraftProject } from "./onboarding-draft-project";

type RequestPayload = {
  action?: unknown;
  apiKeyId?: unknown;
  projectId?: unknown;
  routeTenantId?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;
  const requestOptions = { cookieHeader: request.headers.get("cookie") };

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
        attachProjectTeam: (values) => attachProjectTeam(values, requestOptions),
        createProject: (values, tenantId) => createProject(values, tenantId, requestOptions),
        issueApiKey: (values) => issueApiKey(values, requestOptions),
        updateProject: (values, tenantId) => updateProject(values, tenantId, requestOptions)
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

  if (typeof payload.routeTenantId !== "string" || !payload.routeTenantId.trim()) {
    return NextResponse.json({ error: "Tenant context is required." }, { status: 400 });
  }

  const auth = await getCurrentConsoleAuthForCookieHeader(request.headers.get("cookie"));
  if (!auth.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isTenantAdminForTenant(auth, payload.routeTenantId)) {
    return NextResponse.json(
      { error: "API Key is outside tenant admin scope." },
      { status: 403 }
    );
  }

  const projectId = payload.action === "issue"
    ? isApiKeyIssueValues(payload.values)
      ? payload.values.projectId
      : undefined
    : typeof payload.projectId === "string"
      ? payload.projectId
      : undefined;

  if (!projectId) {
    return NextResponse.json({ error: "Project context is required." }, { status: 400 });
  }

  const controlPlaneTenantId = resolveControlPlaneTenantId(payload.routeTenantId);
  const projects = await listControlPlaneProjects(controlPlaneTenantId, requestOptions);

  if (!projects.ok) {
    return NextResponse.json(
      { error: projects.error },
      { status: projects.status > 0 ? projects.status : 502 }
    );
  }

  if (!containsProject(projects.data, projectId)) {
    return NextResponse.json(
      { error: "Project is outside tenant scope." },
      { status: 403 }
    );
  }

  if (payload.action === "rotate" || payload.action === "revoke") {
    if (typeof payload.apiKeyId !== "string") {
      return NextResponse.json({ error: "API Key context is required." }, { status: 400 });
    }

    const apiKeys = await listApiKeysForProjectWithAuth(projectId, requestOptions);
    if (!apiKeys.ok) {
      return NextResponse.json(
        { error: apiKeys.error },
        { status: apiKeys.status > 0 ? apiKeys.status : 502 }
      );
    }
    if (!containsApiKey(apiKeys.data, payload.apiKeyId)) {
      return NextResponse.json(
        { error: "API Key is outside project scope." },
        { status: 403 }
      );
    }
  }

  const result =
    payload.action === "issue"
      ? isApiKeyIssueValues(payload.values)
        ? await issueApiKey(payload.values, requestOptions)
        : null
      : typeof payload.apiKeyId === "string"
        ? payload.action === "rotate"
          ? await rotateApiKey(payload.apiKeyId, requestOptions)
          : await revokeApiKey(payload.apiKeyId, requestOptions)
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

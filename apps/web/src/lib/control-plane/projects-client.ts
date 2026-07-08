import "server-only";

import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import {
  getControlPlaneBaseUrl,
  resolveControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import {
  cachedControlPlaneRead,
  CONTROL_PLANE_READ_CACHE_SECONDS,
  controlPlaneReadCacheTags,
  controlPlaneTenantReadCacheTag
} from "@/lib/control-plane/read-cache";
import {
  publishRuntimePolicyModelSelectionForApplication
} from "@/lib/control-plane/runtime-policy-client";
import { setApplicationProviderConnections } from "@/lib/control-plane/provider-connections-client";
import type {
  ProjectFormValues,
  ProjectRecord,
  ProjectsModel,
  ProjectUpdateValues
} from "@/lib/control-plane/projects-types";

type RuntimeConfigFixture = {
  runtimeConfig: {
    generatedAt: string;
    projectId: string;
    projectStatus: string;
    tenantId: string;
  };
};

type ProjectRequestResult =
  | {
      data: ProjectRecord;
      ok: true;
      policyError?: string;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProjectListResult =
  | {
      data: ProjectRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

const DEFAULT_WARNING_THRESHOLD_PERCENT = 80;

export async function getProjectsModel(routeTenantId: string): Promise<ProjectsModel> {
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const controlPlaneTenantId = resolveControlPlaneTenantId(routeTenantId);
  const listResult = await listControlPlaneProjects(controlPlaneTenantId);

  if (listResult.ok) {
    return {
      controlPlaneBaseUrl,
      controlPlaneTenantId,
      loadError: null,
      projects: listResult.data,
      routeTenantId,
      source: "control-plane"
    };
  }

  return {
    controlPlaneBaseUrl,
    controlPlaneTenantId,
    loadError: listResult.error,
    projects: [getFixtureProject()],
    routeTenantId,
    source: "fixture"
  };
}

export async function listControlPlaneProjects(
  tenantId: string
): Promise<ProjectListResult> {
  return cachedControlPlaneRead(
    ["control-plane-projects", tenantId],
    () => listControlPlaneProjectsFresh(tenantId),
    {
      revalidate: CONTROL_PLANE_READ_CACHE_SECONDS.projects,
      tags: [
        controlPlaneReadCacheTags.projects,
        controlPlaneTenantReadCacheTag("projects", tenantId)
      ]
    }
  );
}

export async function listControlPlaneProjectsFresh(
  tenantId: string
): Promise<ProjectListResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/projects?limit=50`,
      {
        cache: "no-store"
      }
    );

    return readProjectListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function createProject(
  values: ProjectFormValues,
  routeTenantId?: string
): Promise<ProjectRequestResult> {
  const tenantId = resolveControlPlaneTenantId(routeTenantId);

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/projects`,
      {
        body: JSON.stringify(toProjectPayload(values)),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    const result = await readProjectResponse(response);

    if (!result.ok || !values.selectedModelKey?.trim()) {
      return result;
    }

    const runtimeApplicationId = result.data.runtimeApplicationId;

    if (!runtimeApplicationId) {
      return {
        ...result,
        policyError: "Runtime boundary was not created."
      };
    }

    const runtimePolicy = await publishRuntimePolicyModelSelectionForApplication(
      runtimeApplicationId,
      values.selectedModelKey,
      {
        routeTenantId,
        warningThresholdPercent: values.warningThresholdPercent
      }
    );

    return runtimePolicy.ok
      ? result
      : {
          ...result,
          policyError: runtimePolicy.error ?? "Runtime Policy model selection failed."
        };
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function updateProject(
  values: ProjectUpdateValues,
  routeTenantId?: string
): Promise<ProjectRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(values.projectId)}`,
      {
        body: JSON.stringify({
          description: values.description.trim(),
          name: values.name.trim(),
          status: values.status,
          totalBudgetUsd: values.totalBudgetUsd
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH"
      }
    );

    const result = await readProjectResponse(response);

    if (!result.ok || !values.selectedModelKey?.trim()) {
      return result;
    }

    const runtimeApplicationId = result.data.runtimeApplicationId;

    if (!runtimeApplicationId) {
      return {
        ...result,
        policyError: "Runtime boundary was not created."
      };
    }

    if (values.providerConnectionIds) {
      const providerConnections = await setApplicationProviderConnections({
        applicationId: runtimeApplicationId,
        providerConnectionIds: values.providerConnectionIds
      });

      if (!providerConnections.ok) {
        return {
          ...result,
          policyError: providerConnections.error ?? "Application provider assignment failed."
        };
      }
    }

    const runtimePolicy = await publishRuntimePolicyModelSelectionForApplication(
      runtimeApplicationId,
      values.selectedModelKey,
      {
        routeTenantId,
        warningThresholdPercent: values.warningThresholdPercent
      }
    );

    return runtimePolicy.ok
      ? result
      : {
          ...result,
          policyError: runtimePolicy.error ?? "Runtime Policy model selection failed."
        };
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function normalizeWarningThresholdPercent(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : DEFAULT_WARNING_THRESHOLD_PERCENT;
}

function toProjectPayload(values: ProjectFormValues) {
  return {
    description: values.description.trim() || undefined,
    name: values.name.trim(),
    totalBudgetUsd: values.totalBudgetUsd
  };
}

async function readProjectResponse(response: Response): Promise<ProjectRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const project = getProjectFromPayload(payload);

  if (!project) {
    return {
      error: "Control Plane response did not include project data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: project,
    ok: true,
    status: response.status
  };
}

async function readProjectListResponse(response: Response): Promise<ProjectListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const projects = getProjectsFromPayload(payload);

  if (!projects) {
    return {
      error: "Control Plane response did not include project list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: projects,
    ok: true,
    status: response.status
  };
}

function getProjectFromPayload(payload: unknown): ProjectRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const project = record.data ?? record;

  if (!project || typeof project !== "object") {
    return null;
  }

  return toProjectRecord(project);
}

function getProjectsFromPayload(payload: unknown): ProjectRecord[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const projects = record.data.map(toProjectRecord);

  if (projects.some((project) => project === null)) {
    return null;
  }

  return projects as ProjectRecord[];
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

function getFixtureProject(): ProjectRecord {
  const runtimeConfig = (runtimeConfigFixture as RuntimeConfigFixture).runtimeConfig;
  const timestamp = runtimeConfig.generatedAt;

  return {
    createdAt: timestamp,
    description: "Customer support Gateway project from the v1 runtime config fixture.",
    id: runtimeConfig.projectId,
    name: "Customer Support",
    runtimeApplicationId: null,
    status: runtimeConfig.projectStatus === "active" ? "ACTIVE" : "DISABLED",
    tenantId: runtimeConfig.tenantId,
    totalBudgetUsd: 100,
    updatedAt: timestamp,
    warningThresholdPercent: DEFAULT_WARNING_THRESHOLD_PERCENT
  };
}

function toProjectRecord(value: unknown): ProjectRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeProjectStatus(record.status);

  if (
    typeof record.id !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.name !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    !status
  ) {
    return null;
  }

  return {
    createdAt: record.createdAt,
    description: typeof record.description === "string" ? record.description : null,
    id: record.id,
    name: record.name,
    runtimeApplicationId:
      typeof record.runtimeApplicationId === "string" && record.runtimeApplicationId.trim()
        ? record.runtimeApplicationId
        : null,
    status,
    tenantId: record.tenantId,
    totalBudgetUsd: normalizeNumber(record.totalBudgetUsd, 100),
    updatedAt: record.updatedAt,
    warningThresholdPercent: normalizeWarningThresholdPercent(record.warningThresholdPercent)
  };
}

function normalizeNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return fallback;
    }

    const parsed = Number(trimmed);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeProjectStatus(value: unknown): ProjectRecord["status"] | null {
  if (value === "ACTIVE" || value === "active") {
    return "ACTIVE";
  }

  if (value === "ARCHIVED" || value === "archived") {
    return "ARCHIVED";
  }

  if (value === "DISABLED" || value === "disabled") {
    return "DISABLED";
  }

  if (value === "DRAFT" || value === "draft") {
    return "DRAFT";
  }

  return null;
}

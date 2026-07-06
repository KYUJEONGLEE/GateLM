import "server-only";

import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import {
  getControlPlaneBaseUrl,
  getControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import {
  getRuntimePolicyConfigForApplication,
  publishRuntimePolicyModelSelectionForApplication
} from "@/lib/control-plane/runtime-policy-client";
import type {
  ProjectBudgetThresholdRecord,
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
  const controlPlaneTenantId = getControlPlaneTenantId();
  const listResult = await listProjects(controlPlaneTenantId);

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

export async function getProjectBudgetThresholds(
  projects: ProjectRecord[]
): Promise<ProjectBudgetThresholdRecord[]> {
  return Promise.all(projects.map(getProjectBudgetThreshold));
}

export async function createProject(values: ProjectFormValues): Promise<ProjectRequestResult> {
  const tenantId = getControlPlaneTenantId();

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

export async function updateProject(values: ProjectUpdateValues): Promise<ProjectRequestResult> {
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

    return readProjectResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function getProjectBudgetThreshold(
  project: ProjectRecord
): Promise<ProjectBudgetThresholdRecord> {
  if (!project.runtimeApplicationId) {
    return {
      projectId: project.id,
      warningThresholdPercent: DEFAULT_WARNING_THRESHOLD_PERCENT
    };
  }

  const config = await getRuntimePolicyConfigForApplication(project.runtimeApplicationId);
  const warningThresholdPercent = config?.budgetPolicy?.warningThresholdPercent;

  return {
    projectId: project.id,
    warningThresholdPercent: normalizeWarningThresholdPercent(warningThresholdPercent)
  };
}

async function listProjects(tenantId: string): Promise<ProjectListResult> {
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

function normalizeWarningThresholdPercent(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : DEFAULT_WARNING_THRESHOLD_PERCENT;
}

function toProjectPayload(values: ProjectFormValues) {
  return {
    description: values.description.trim() || undefined,
    name: values.name.trim(),
    providerConnectionIds: values.providerConnectionIds ?? [],
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
    updatedAt: timestamp
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
    updatedAt: record.updatedAt
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

  return null;
}

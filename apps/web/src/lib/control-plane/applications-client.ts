import "server-only";

import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import {
  getControlPlaneBaseUrl,
  getControlPlaneProjectId
} from "@/lib/control-plane/control-plane-config";
import type {
  ApplicationFormValues,
  ApplicationRecord,
  ApplicationsModel,
  ApplicationUpdateValues
} from "@/lib/control-plane/applications-types";

type RuntimeConfigFixture = {
  runtimeConfig: {
    applicationId: string;
    applicationStatus: string;
    generatedAt: string;
    projectId: string;
    tenantId: string;
  };
};

type ApplicationRequestResult =
  | {
      data: ApplicationRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ApplicationListResult =
  | {
      data: ApplicationRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

export async function getApplicationsModel(
  routeTenantId: string,
  projectId = getControlPlaneProjectId()
): Promise<ApplicationsModel> {
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const controlPlaneProjectId = projectId;
  const listResult = await listApplications(controlPlaneProjectId);

  if (listResult.ok) {
    return {
      applications: listResult.data,
      controlPlaneBaseUrl,
      controlPlaneProjectId,
      loadError: null,
      routeTenantId,
      source: "control-plane"
    };
  }

  return {
    applications: [getFixtureApplication()],
    controlPlaneBaseUrl,
    controlPlaneProjectId,
    loadError: listResult.error,
    routeTenantId,
    source: "fixture"
  };
}

export async function createApplication(
  values: ApplicationFormValues
): Promise<ApplicationRequestResult> {
  const projectId = values.projectId ?? getControlPlaneProjectId();

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/applications`,
      {
        body: JSON.stringify(toApplicationPayload(values)),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    return readApplicationResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function updateApplication(
  values: ApplicationUpdateValues
): Promise<ApplicationRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(values.applicationId)}`,
      {
        body: JSON.stringify({
          budgetLimitMode: values.budgetLimitMode,
          budgetLimitPercent: values.budgetLimitPercent,
          budgetLimitUsd: values.budgetLimitUsd,
          description: values.description.trim(),
          name: values.name.trim(),
          status: values.status
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH"
      }
    );

    return readApplicationResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function listApplications(projectId: string): Promise<ApplicationListResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/applications?limit=50`,
      {
        cache: "no-store"
      }
    );

    return readApplicationListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function toApplicationPayload(values: ApplicationFormValues) {
  return {
    budgetLimitMode: values.budgetLimitMode,
    budgetLimitPercent: values.budgetLimitPercent,
    budgetLimitUsd: values.budgetLimitUsd,
    description: values.description.trim() || undefined,
    name: values.name.trim()
  };
}

async function readApplicationResponse(response: Response): Promise<ApplicationRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const application = getApplicationFromPayload(payload);

  if (!application) {
    return {
      error: "Control Plane response did not include application data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: application,
    ok: true,
    status: response.status
  };
}

async function readApplicationListResponse(response: Response): Promise<ApplicationListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const applications = getApplicationsFromPayload(payload);

  if (!applications) {
    return {
      error: "Control Plane response did not include application list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: applications,
    ok: true,
    status: response.status
  };
}

function getApplicationFromPayload(payload: unknown): ApplicationRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const application = record.data ?? record;

  if (!application || typeof application !== "object") {
    return null;
  }

  return toApplicationRecord(application);
}

function getApplicationsFromPayload(payload: unknown): ApplicationRecord[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const applications = record.data.map(toApplicationRecord);

  if (applications.some((application) => application === null)) {
    return null;
  }

  return applications as ApplicationRecord[];
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

function getFixtureApplication(): ApplicationRecord {
  const runtimeConfig = (runtimeConfigFixture as RuntimeConfigFixture).runtimeConfig;
  const timestamp = runtimeConfig.generatedAt;

  return {
    budgetLimitMode: "FIXED",
    budgetLimitPercent: null,
    budgetLimitUsd: 0,
    createdAt: timestamp,
    description: "Customer-facing chat application from the v1 runtime config fixture.",
    effectiveBudgetLimitUsd: 0,
    id: runtimeConfig.applicationId,
    name: "Customer Demo App",
    projectId: runtimeConfig.projectId,
    status: runtimeConfig.applicationStatus === "active" ? "ACTIVE" : "DISABLED",
    tenantId: runtimeConfig.tenantId,
    updatedAt: timestamp
  };
}

function toApplicationRecord(value: unknown): ApplicationRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeApplicationStatus(record.status);

  if (
    typeof record.id !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.projectId !== "string" ||
    typeof record.name !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    !status
  ) {
    return null;
  }

  return {
    budgetLimitMode: normalizeBudgetLimitMode(record.budgetLimitMode),
    budgetLimitPercent: normalizeNullableNumber(record.budgetLimitPercent),
    budgetLimitUsd: normalizeNullableNumber(record.budgetLimitUsd),
    createdAt: record.createdAt,
    description: typeof record.description === "string" ? record.description : null,
    effectiveBudgetLimitUsd: normalizeNumber(record.effectiveBudgetLimitUsd, 0),
    id: record.id,
    name: record.name,
    projectId: record.projectId,
    status,
    tenantId: record.tenantId,
    updatedAt: record.updatedAt
  };
}

function normalizeBudgetLimitMode(value: unknown): ApplicationRecord["budgetLimitMode"] {
  return value === "PERCENT" ? "PERCENT" : "FIXED";
}

function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeNumber(value: unknown, fallback: number) {
  return normalizeNullableNumber(value) ?? fallback;
}

function normalizeApplicationStatus(value: unknown): ApplicationRecord["status"] | null {
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

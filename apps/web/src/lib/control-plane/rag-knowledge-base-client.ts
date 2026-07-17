import "server-only";

import {
  getControlPlaneBaseUrl,
  resolveControlPlaneTenantId,
} from "@/lib/control-plane/control-plane-config";
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions,
} from "@/lib/control-plane/control-plane-request";
import type { TenantRagKnowledgeBaseSettings } from "@/lib/control-plane/rag-knowledge-base-types";

export type RagKnowledgeBaseResult =
  | { data: TenantRagKnowledgeBaseSettings; ok: true; status: number }
  | { error: string; ok: false; status: number };

export async function getTenantRagKnowledgeBaseSettings(
  routeTenantId: string,
  options?: ControlPlaneRequestOptions,
): Promise<RagKnowledgeBaseResult> {
  return requestSettings(routeTenantId, options);
}

export async function updateTenantRagKnowledgeBaseSettings(
  routeTenantId: string,
  enabled: boolean,
  options?: ControlPlaneRequestOptions,
): Promise<RagKnowledgeBaseResult> {
  return requestSettings(routeTenantId, options, enabled);
}

async function requestSettings(
  routeTenantId: string,
  options?: ControlPlaneRequestOptions,
  enabled?: boolean,
): Promise<RagKnowledgeBaseResult> {
  const tenantId = resolveControlPlaneTenantId(routeTenantId);
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/rag/knowledge-base`,
      {
        body: enabled === undefined ? undefined : JSON.stringify({ enabled }),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(
          options,
          enabled === undefined ? undefined : { "Content-Type": "application/json" },
        ),
        method: enabled === undefined ? "GET" : "PATCH",
      },
    );
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      return {
        error: readErrorMessage(payload, response.status),
        ok: false,
        status: response.status,
      };
    }
    const settings = readSettingsEnvelope(payload);
    if (!settings) {
      return {
        error: "Control Plane response did not include valid Knowledge Base settings.",
        ok: false,
        status: response.status,
      };
    }
    return { data: settings, ok: true, status: response.status };
  } catch {
    return { error: "Control Plane unavailable.", ok: false, status: 0 };
  }
}

function readSettingsEnvelope(value: unknown): TenantRagKnowledgeBaseSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const settings = data as Record<string, unknown>;
  if (
    typeof settings.tenantEnabled !== "boolean" ||
    typeof settings.globalEnabled !== "boolean" ||
    typeof settings.effectiveEnabled !== "boolean" ||
    settings.effectiveEnabled !==
      (settings.tenantEnabled && settings.globalEnabled)
  ) {
    return null;
  }
  return {
    tenantEnabled: settings.tenantEnabled,
    globalEnabled: settings.globalEnabled,
    effectiveEnabled: settings.effectiveEnabled,
  };
}

function readErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
    if (
      record.error &&
      typeof record.error === "object" &&
      !Array.isArray(record.error)
    ) {
      const message = (record.error as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return `Control Plane request failed (${status}).`;
}

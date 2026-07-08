import { NextResponse } from "next/server";
import {
  getCurrentConsoleAuth,
  isTenantAdminForTenant
} from "@/lib/auth/current-console-auth";
import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import {
  deleteProviderConnection,
  discoverProviderModels,
  removeProviderModel,
  upsertProviderConnection
} from "@/lib/control-plane/provider-connections-client";
import type {
  ProviderConnectionFormValues,
  ProviderConnectionStatus
} from "@/lib/control-plane/provider-connections-types";

const minProviderTimeoutMs = 1000;
const maxProviderTimeoutMs = 120000;

type RequestPayload = {
  action?: unknown;
  tenantId?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;
  const routeTenantId = typeof payload.tenantId === "string" ? payload.tenantId : undefined;
  const tenantId = routeTenantId ?? getControlPlaneTenantId();
  const auth = await getCurrentConsoleAuth(request.headers.get("cookie"));

  if (!auth.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isTenantAdminForTenant(auth, tenantId)) {
    return NextResponse.json(
      { error: "Only tenant admins can manage provider connections." },
      { status: 403 }
    );
  }

  if (payload.action === "discover-models") {
    const provider = getProviderFromPayload(payload.values);

    if (!provider) {
      return NextResponse.json({ error: "Invalid provider discovery payload." }, { status: 400 });
    }

    const result = await discoverProviderModels(provider, routeTenantId);

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
      discovery: result.data,
      status: result.status
    });
  }

  if (payload.action === "delete-provider") {
    const provider = getProviderFromPayload(payload.values);

    if (!provider) {
      return NextResponse.json({ error: "Invalid provider deletion payload." }, { status: 400 });
    }

    const result = await deleteProviderConnection(provider, routeTenantId);

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
      provider: result.data,
      status: result.status
    });
  }

  if (payload.action === "remove-model") {
    const values = getRemoveModelValues(payload.values);

    if (!values) {
      return NextResponse.json({ error: "Invalid model removal payload." }, { status: 400 });
    }

    const result = await removeProviderModel({
      ...values,
      routeTenantId
    });

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
      provider: result.data,
      status: result.status
    });
  }

  if (payload.action !== "upsert") {
    return NextResponse.json({ error: "Unknown provider action." }, { status: 400 });
  }

  if (!isProviderConnectionFormValues(payload.values)) {
    return NextResponse.json({ error: "Invalid provider payload." }, { status: 400 });
  }

  const result = await upsertProviderConnection(payload.values, routeTenantId);

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
    provider: result.data,
    status: result.status
  });
}

function isProviderConnectionFormValues(value: unknown): value is ProviderConnectionFormValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProviderConnectionFormValues>;
  const timeoutMs = record.timeoutMs;

  return (
    typeof record.adapterType === "string" &&
    typeof record.apiVersion === "string" &&
    typeof record.provider === "string" &&
    typeof record.displayName === "string" &&
    typeof record.baseUrl === "string" &&
    typeof record.credentialRequired === "boolean" &&
    typeof record.models === "string" &&
    (record.failureMode === "fail_closed" ||
      record.failureMode === "fail_open_to_fallback") &&
    (record.requestFormat === "openai_chat_completions" ||
      record.requestFormat === "anthropic_messages" ||
      record.requestFormat === "mock_chat_completions") &&
    typeof timeoutMs === "number" &&
    Number.isInteger(timeoutMs) &&
    timeoutMs >= minProviderTimeoutMs &&
    timeoutMs <= maxProviderTimeoutMs &&
    typeof record.resolver === "string" &&
    typeof record.secretRef === "string" &&
    (record.isEdit === undefined || typeof record.isEdit === "boolean") &&
    typeof record.presetProviderKey === "string" &&
    (record.previousProvider === undefined ||
      (typeof record.previousProvider === "string" &&
        /^[a-z][a-z0-9_-]{1,63}$/.test(record.previousProvider))) &&
    typeof record.credentialPrefix === "string" &&
    typeof record.credentialLast4 === "string" &&
    (record.credentialValue === undefined ||
      (typeof record.credentialValue === "string" && record.credentialValue.length <= 8192)) &&
    typeof record.modelsEndpointPath === "string" &&
    isProviderStatus(record.status)
  );
}

function getProviderFromPayload(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const provider = (value as Record<string, unknown>).provider;

  if (typeof provider !== "string" || !/^[a-z][a-z0-9_-]{1,63}$/.test(provider)) {
    return null;
  }

  return provider;
}

function getRemoveModelValues(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const provider = record.provider;
  const modelName = record.modelName;

  if (
    typeof provider !== "string" ||
    !/^[a-z][a-z0-9_-]{1,63}$/.test(provider) ||
    typeof modelName !== "string"
  ) {
    return null;
  }

  const normalizedModelName = modelName.trim();

  if (
    normalizedModelName.length === 0 ||
    normalizedModelName.length > 200 ||
    /[\r\n]/.test(normalizedModelName)
  ) {
    return null;
  }

  return {
    modelName: normalizedModelName,
    provider
  };
}

function isProviderStatus(value: unknown): value is ProviderConnectionStatus {
  return value === "ACTIVE" || value === "DEGRADED" || value === "DISABLED";
}

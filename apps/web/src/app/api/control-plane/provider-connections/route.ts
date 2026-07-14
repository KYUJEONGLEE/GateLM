import { NextResponse } from "next/server";
import {
  getCurrentConsoleAuthForCookieHeader,
  isTenantAdminForTenant
} from "@/lib/auth/current-console-auth";
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
const maxProviderContextWindowTokens = 10_000_000;
const maxProviderOutputTokens = 1_000_000;

type RequestPayload = {
  action?: unknown;
  tenantId?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;
  const routeTenantId = typeof payload.tenantId === "string" ? payload.tenantId : undefined;
  const tenantId = routeTenantId ?? getControlPlaneTenantId();
  const controlPlaneTenantId = resolveControlPlaneTenantId(routeTenantId);
  const auth = await getCurrentConsoleAuthForCookieHeader(request.headers.get("cookie"));
  const requestOptions = { cookieHeader: request.headers.get("cookie") };

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

    const result = await discoverProviderModels(provider, routeTenantId, requestOptions);

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

    const result = await deleteProviderConnection(provider, routeTenantId, requestOptions);

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          status: result.status
        },
        { status: result.status > 0 ? result.status : 502 }
      );
    }

    revalidateProviderReadCache(controlPlaneTenantId);

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
      options: requestOptions,
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

    revalidateProviderReadCache(controlPlaneTenantId);

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

  const result = await upsertProviderConnection(payload.values, routeTenantId, requestOptions);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        status: result.status
      },
      { status: result.status > 0 ? result.status : 502 }
    );
  }

  revalidateProviderReadCache(controlPlaneTenantId);

  return NextResponse.json({
    provider: result.data,
    status: result.status
  });
}

function revalidateProviderReadCache(controlPlaneTenantId: string) {
  revalidateControlPlaneRead([
    controlPlaneReadCacheTags.providerConnections,
    controlPlaneTenantReadCacheTag("providerConnections", controlPlaneTenantId),
    controlPlaneReadCacheTags.runtimePolicy
  ]);
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
    isProviderModelMetadataMap(record.modelMetadata) &&
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

function isProviderModelMetadataMap(value: unknown) {
  if (value === undefined) {
    return true;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);
  if (entries.length > 200) {
    return false;
  }

  return entries.every(([model, metadata]) => {
    if (
      !model.trim() ||
      model.length > 200 ||
      !metadata ||
      typeof metadata !== "object" ||
      Array.isArray(metadata)
    ) {
      return false;
    }

    const record = metadata as Record<string, unknown>;
    const allowedKeys = new Set([
      "contextWindowTokens",
      "displayName",
      "maxOutputTokens",
      "supportsJsonMode",
      "supportsStreaming"
    ]);

    return (
      Object.keys(record).every((key) => allowedKeys.has(key)) &&
      (record.contextWindowTokens === undefined ||
        (typeof record.contextWindowTokens === "number" &&
          Number.isSafeInteger(record.contextWindowTokens) &&
          record.contextWindowTokens > 0 &&
          record.contextWindowTokens <= maxProviderContextWindowTokens)) &&
      (record.maxOutputTokens === undefined ||
        (typeof record.maxOutputTokens === "number" &&
          Number.isSafeInteger(record.maxOutputTokens) &&
          record.maxOutputTokens > 0 &&
          record.maxOutputTokens <= maxProviderOutputTokens)) &&
      (record.displayName === undefined ||
        (typeof record.displayName === "string" && record.displayName.length <= 120)) &&
      (record.supportsJsonMode === undefined ||
        typeof record.supportsJsonMode === "boolean") &&
      (record.supportsStreaming === undefined ||
        typeof record.supportsStreaming === "boolean")
    );
  });
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

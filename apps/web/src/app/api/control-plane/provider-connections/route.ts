import { NextResponse } from "next/server";
import {
  discoverProviderModels,
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
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (payload.action === "discover-models") {
    const provider = getProviderFromPayload(payload.values);

    if (!provider) {
      return NextResponse.json({ error: "Invalid provider discovery payload." }, { status: 400 });
    }

    const result = await discoverProviderModels(provider);

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

  if (payload.action !== "upsert") {
    return NextResponse.json({ error: "Unknown provider action." }, { status: 400 });
  }

  if (!isProviderConnectionFormValues(payload.values)) {
    return NextResponse.json({ error: "Invalid provider payload." }, { status: 400 });
  }

  const result = await upsertProviderConnection(payload.values);

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
      record.requestFormat === "mock_chat_completions") &&
    typeof timeoutMs === "number" &&
    Number.isInteger(timeoutMs) &&
    timeoutMs >= minProviderTimeoutMs &&
    timeoutMs <= maxProviderTimeoutMs &&
    typeof record.resolver === "string" &&
    typeof record.secretRef === "string" &&
    typeof record.credentialPrefix === "string" &&
    typeof record.credentialLast4 === "string" &&
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

function isProviderStatus(value: unknown): value is ProviderConnectionStatus {
  return value === "ACTIVE" || value === "DEGRADED" || value === "DISABLED";
}

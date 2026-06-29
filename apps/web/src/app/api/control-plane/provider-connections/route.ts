import { NextResponse } from "next/server";
import { upsertProviderConnection } from "@/lib/control-plane/provider-connections-client";
import type {
  ProviderConnectionFormValues,
  ProviderConnectionStatus
} from "@/lib/control-plane/provider-connections-types";

type RequestPayload = {
  action?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

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

  return (
    typeof record.provider === "string" &&
    typeof record.displayName === "string" &&
    typeof record.baseUrl === "string" &&
    typeof record.timeoutMs === "number" &&
    typeof record.resolver === "string" &&
    typeof record.secretRef === "string" &&
    typeof record.credentialPrefix === "string" &&
    typeof record.credentialLast4 === "string" &&
    isProviderStatus(record.status)
  );
}

function isProviderStatus(value: unknown): value is ProviderConnectionStatus {
  return value === "ACTIVE" || value === "DEGRADED" || value === "DISABLED";
}

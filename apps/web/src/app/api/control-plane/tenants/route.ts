import { NextResponse } from "next/server";
import { createTenant } from "@/lib/control-plane/tenants-client";
import type { TenantCreateValues } from "@/lib/control-plane/tenants-types";

type RequestPayload = {
  action?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (payload.action !== "create") {
    return NextResponse.json({ error: "Unknown tenant action." }, { status: 400 });
  }

  if (!isTenantCreateValues(payload.values)) {
    return NextResponse.json({ error: "Invalid tenant payload." }, { status: 400 });
  }

  const result = await createTenant(payload.values);

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
    status: result.status,
    tenant: result.data
  });
}

function isTenantCreateValues(value: unknown): value is TenantCreateValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<TenantCreateValues>;

  return typeof record.name === "string";
}

import { NextResponse } from "next/server";
import {
  issueApiKey,
  revokeApiKey,
  rotateApiKey
} from "@/lib/control-plane/api-keys-client";
import type { ApiKeyIssueValues } from "@/lib/control-plane/api-keys-types";

type RequestPayload = {
  action?: unknown;
  apiKeyId?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (
    payload.action !== "issue" &&
    payload.action !== "rotate" &&
    payload.action !== "revoke"
  ) {
    return NextResponse.json({ error: "Unknown API Key action." }, { status: 400 });
  }

  const result =
    payload.action === "issue"
      ? isApiKeyIssueValues(payload.values)
        ? await issueApiKey(payload.values)
        : null
      : typeof payload.apiKeyId === "string"
        ? payload.action === "rotate"
          ? await rotateApiKey(payload.apiKeyId)
          : await revokeApiKey(payload.apiKeyId)
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
    typeof record.scopes === "string"
  );
}

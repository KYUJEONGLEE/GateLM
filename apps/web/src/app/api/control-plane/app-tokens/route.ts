import { NextResponse } from "next/server";
import {
  issueAppToken,
  revokeAppToken,
  rotateAppToken
} from "@/lib/control-plane/app-tokens-client";
import type { AppTokenIssueValues } from "@/lib/control-plane/app-tokens-types";

type RequestPayload = {
  action?: unknown;
  appTokenId?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (
    payload.action !== "issue" &&
    payload.action !== "rotate" &&
    payload.action !== "revoke"
  ) {
    return NextResponse.json({ error: "Unknown App Token action." }, { status: 400 });
  }

  const result =
    payload.action === "issue"
      ? isAppTokenIssueValues(payload.values)
        ? await issueAppToken(payload.values)
        : null
      : typeof payload.appTokenId === "string"
        ? payload.action === "rotate"
          ? await rotateAppToken(payload.appTokenId)
          : await revokeAppToken(payload.appTokenId)
        : null;

  if (!result) {
    return NextResponse.json({ error: "Invalid App Token payload." }, { status: 400 });
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
    appToken: result.data,
    status: result.status
  });
}

function isAppTokenIssueValues(value: unknown): value is AppTokenIssueValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<AppTokenIssueValues>;

  return (
    typeof record.displayName === "string" &&
    typeof record.expiresAt === "string" &&
    typeof record.scopes === "string"
  );
}

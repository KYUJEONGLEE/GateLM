import { NextResponse } from "next/server";
import { setApplicationProviderConnections } from "@/lib/control-plane/provider-connections-client";

type RequestPayload = {
  applicationId?: unknown;
  providerConnectionIds?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (
    typeof payload.applicationId !== "string" ||
    !Array.isArray(payload.providerConnectionIds) ||
    !payload.providerConnectionIds.every((providerConnectionId) =>
      typeof providerConnectionId === "string"
    )
  ) {
    return NextResponse.json(
      { error: "Invalid application provider payload." },
      { status: 400 }
    );
  }

  const result = await setApplicationProviderConnections({
    applicationId: payload.applicationId,
    providerConnectionIds: payload.providerConnectionIds
  }, {
    cookieHeader: request.headers.get("cookie")
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
    providers: result.data,
    status: result.status
  });
}

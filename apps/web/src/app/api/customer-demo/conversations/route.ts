import { NextResponse } from "next/server";
import {
  createChatConversation,
  updateChatConversation
} from "@/lib/control-plane/conversations-client";
import { resolveApplicationChatProfile } from "@/lib/gateway/application-chat-profiles";
import { getCustomerDemoLiveModel } from "@/lib/gateway/customer-demo-live-model";
import { legacyCustomerDemoEnabled } from "@/lib/gateway/legacy-customer-demo";

type ConversationRequestPayload = {
  contextRetentionEnabled?: unknown;
  conversationId?: unknown;
  profileId?: unknown;
  tenantId?: unknown;
  userName?: unknown;
};

const APPLICATION_END_USER_ID = "customer_user_demo_live";

export async function POST(request: Request) {
  if (!legacyCustomerDemoEnabled()) {
    return NextResponse.json({ error: "Legacy customer demo is disabled." }, { status: 404 });
  }
  const payload = await readPayload(request);
  const profileResult = await getRequestProfile(payload.profileId);

  if (!profileResult.ok) {
    return NextResponse.json({ error: profileResult.error }, { status: 400 });
  }

  const model = await getCustomerDemoLiveModel({ profileId: profileResult.profile.id });

  if (payload.tenantId !== model.tenantId) {
    return NextResponse.json({ error: "Unknown tenant for customer demo." }, { status: 404 });
  }

  const result = await createChatConversation({
    applicationId: model.applicationId,
    contextRetentionEnabled: payload.contextRetentionEnabled,
    endUserId: payload.userName ?? APPLICATION_END_USER_ID,
    projectId: model.projectId,
    tenantId: model.tenantId
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 502 });
  }

  return NextResponse.json({
    conversation: result.data
  });
}

export async function PATCH(request: Request) {
  if (!legacyCustomerDemoEnabled()) {
    return NextResponse.json({ error: "Legacy customer demo is disabled." }, { status: 404 });
  }
  const payload = await readPayload(request);
  const profileResult = await getRequestProfile(payload.profileId);

  if (!profileResult.ok) {
    return NextResponse.json({ error: profileResult.error }, { status: 400 });
  }

  const model = await getCustomerDemoLiveModel({ profileId: profileResult.profile.id });

  if (payload.tenantId !== model.tenantId) {
    return NextResponse.json({ error: "Unknown tenant for customer demo." }, { status: 404 });
  }

  if (!payload.conversationId) {
    return NextResponse.json({ error: "Missing conversation id." }, { status: 400 });
  }

  const result = await updateChatConversation({
    applicationId: model.applicationId,
    contextRetentionEnabled: payload.contextRetentionEnabled,
    conversationId: payload.conversationId,
    projectId: model.projectId,
    tenantId: model.tenantId
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 502 });
  }

  return NextResponse.json({
    conversation: result.data
  });
}

async function readPayload(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as ConversationRequestPayload;

  return {
    contextRetentionEnabled:
      typeof payload.contextRetentionEnabled === "boolean"
        ? payload.contextRetentionEnabled
        : undefined,
    conversationId: typeof payload.conversationId === "string" ? payload.conversationId : "",
    profileId: typeof payload.profileId === "string" ? payload.profileId : "",
    tenantId: typeof payload.tenantId === "string" ? payload.tenantId : "",
    userName: normalizeEndUserId(payload.userName)
  };
}

function normalizeEndUserId(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/[\r\n\t]+/g, " ").trim().replace(/\s+/g, " ");

  return normalized.length > 0 ? Array.from(normalized).slice(0, 160).join("") : undefined;
}

async function getRequestProfile(profileId: string) {
  try {
    return {
      ok: true as const,
      profile: await resolveApplicationChatProfile(profileId)
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Application chat profile is invalid.",
      ok: false as const
    };
  }
}

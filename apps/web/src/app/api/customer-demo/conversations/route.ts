import { NextResponse } from "next/server";
import {
  createChatConversation,
  updateChatConversation
} from "@/lib/control-plane/conversations-client";
import { getCustomerDemoLiveModel } from "@/lib/gateway/customer-demo-live-model";

type ConversationRequestPayload = {
  contextRetentionEnabled?: unknown;
  conversationId?: unknown;
  tenantId?: unknown;
};

const APPLICATION_END_USER_ID = "customer_user_demo_live";

export async function POST(request: Request) {
  const payload = await readPayload(request);
  const model = getCustomerDemoLiveModel();

  if (payload.tenantId !== model.tenantId) {
    return NextResponse.json({ error: "Unknown tenant for customer demo." }, { status: 404 });
  }

  const result = await createChatConversation({
    applicationId: model.applicationId,
    contextRetentionEnabled: payload.contextRetentionEnabled,
    endUserId: APPLICATION_END_USER_ID,
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
  const payload = await readPayload(request);
  const model = getCustomerDemoLiveModel();

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
    tenantId: typeof payload.tenantId === "string" ? payload.tenantId : ""
  };
}

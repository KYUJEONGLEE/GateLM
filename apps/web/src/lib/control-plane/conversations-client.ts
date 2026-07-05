import "server-only";

import { getControlPlaneBaseUrl } from "@/lib/control-plane/control-plane-config";
import type {
  ChatMessageRecord,
  ConversationCreateValues,
  ConversationMessageCreateValues,
  ConversationMessageResult,
  ConversationRecord,
  ConversationUpdateValues,
  ControlPlaneResult,
  GatewayContextMessage
} from "@/lib/control-plane/conversations-types";

type JsonRecord = Record<string, unknown>;

export async function createChatConversation(
  values: ConversationCreateValues
): Promise<ControlPlaneResult<ConversationRecord>> {
  try {
    const response = await fetch(`${getControlPlaneBaseUrl()}/api/chat/conversations`, {
      body: JSON.stringify({
        applicationId: values.applicationId,
        contextRetentionEnabled: values.contextRetentionEnabled,
        endUserId: values.endUserId,
        projectId: values.projectId,
        tenantId: values.tenantId,
        title: values.title
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    return readDataResponse(response, toConversationRecord, "Conversation create failed.");
  } catch {
    return unavailableResult();
  }
}

export async function updateChatConversation(
  values: ConversationUpdateValues
): Promise<ControlPlaneResult<ConversationRecord>> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/api/chat/conversations/${encodeURIComponent(values.conversationId)}`,
      {
        body: JSON.stringify({
          applicationId: values.applicationId,
          contextRetentionEnabled: values.contextRetentionEnabled,
          projectId: values.projectId,
          status: values.status,
          tenantId: values.tenantId,
          title: values.title
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH"
      }
    );

    return readDataResponse(response, toConversationRecord, "Conversation update failed.");
  } catch {
    return unavailableResult();
  }
}

export async function createChatConversationMessage(
  values: ConversationMessageCreateValues
): Promise<ControlPlaneResult<ConversationMessageResult>> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/api/chat/conversations/${encodeURIComponent(values.conversationId)}/messages`,
      {
        body: JSON.stringify({
          applicationId: values.applicationId,
          content: values.content,
          parentMessageId: values.parentMessageId,
          projectId: values.projectId,
          requestId: values.requestId,
          role: values.role,
          systemMessage: values.systemMessage,
          tenantId: values.tenantId
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    return readDataResponse(
      response,
      toConversationMessageResult,
      "Conversation message create failed."
    );
  } catch {
    return unavailableResult();
  }
}

async function readDataResponse<T>(
  response: Response,
  parser: (value: unknown) => T | null,
  fallbackError: string
): Promise<ControlPlaneResult<T>> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status, fallbackError),
      ok: false,
      status: response.status
    };
  }

  const data = isJsonRecord(payload) ? parser(payload.data) : null;

  if (!data) {
    return {
      error: "Control Plane response did not match the conversation contract.",
      ok: false,
      status: response.status
    };
  }

  return {
    data,
    ok: true,
    status: response.status
  };
}

function unavailableResult<T>(): ControlPlaneResult<T> {
  return {
    error: "Control Plane unavailable.",
    ok: false,
    status: 0
  };
}

function toConversationRecord(value: unknown): ConversationRecord | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.tenantId !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.applicationId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.contextRetentionEnabled !== "boolean"
  ) {
    return null;
  }

  return {
    applicationId: value.applicationId,
    contextRetentionEnabled: value.contextRetentionEnabled,
    createdAt: value.createdAt,
    deletedAt: typeof value.deletedAt === "string" ? value.deletedAt : null,
    endUserId: typeof value.endUserId === "string" ? value.endUserId : null,
    id: value.id,
    projectId: value.projectId,
    status: normalizeConversationStatus(value.status),
    tenantId: value.tenantId,
    title: typeof value.title === "string" ? value.title : null,
    updatedAt: value.updatedAt
  };
}

function toConversationMessageResult(value: unknown): ConversationMessageResult | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  const message = toChatMessageRecord(value.message);
  const context = isJsonRecord(value.context) ? toConversationContext(value.context) : null;

  return message && context
    ? {
        context,
        message
      }
    : null;
}

function toConversationContext(value: JsonRecord): ConversationMessageResult["context"] | null {
  if (
    value.strategy !== "sliding_window" ||
    typeof value.contextRetentionEnabled !== "boolean" ||
    typeof value.maxPreviousChars !== "number" ||
    typeof value.maxPreviousUserTurns !== "number" ||
    !Array.isArray(value.messages)
  ) {
    return null;
  }

  const messages = value.messages.map(toGatewayContextMessage);

  if (messages.some((message) => message === null)) {
    return null;
  }

  return {
    contextRetentionEnabled: value.contextRetentionEnabled,
    maxPreviousChars: value.maxPreviousChars,
    maxPreviousUserTurns: value.maxPreviousUserTurns,
    messages: messages as GatewayContextMessage[],
    strategy: "sliding_window"
  };
}

function toGatewayContextMessage(value: unknown): GatewayContextMessage | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (
    value.role !== "system" &&
    value.role !== "user" &&
    value.role !== "assistant"
  ) {
    return null;
  }

  return typeof value.content === "string" && value.content.trim()
    ? {
        content: value.content,
        role: value.role
      }
    : null;
}

function toChatMessageRecord(value: unknown): ChatMessageRecord | null {
  if (!isJsonRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.conversationId !== "string" ||
    typeof value.tenantId !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.applicationId !== "string" ||
    typeof value.sequence !== "number" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }

  const role = value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;

  if (!role) {
    return null;
  }

  return {
    applicationId: value.applicationId,
    contentPolicy: value.contentPolicy === "not_retained" ? "not_retained" : "retained",
    conversationId: value.conversationId,
    createdAt: value.createdAt,
    id: value.id,
    parentMessageId: typeof value.parentMessageId === "string" ? value.parentMessageId : null,
    projectId: value.projectId,
    requestId: typeof value.requestId === "string" ? value.requestId : null,
    role,
    safeContent: typeof value.safeContent === "string" ? value.safeContent : null,
    sequence: value.sequence,
    tenantId: value.tenantId
  };
}

function normalizeConversationStatus(value: unknown): ConversationRecord["status"] {
  return value === "archived" || value === "deleted" ? value : "active";
}

function getErrorMessage(payload: unknown, status: number, fallbackError: string) {
  if (isJsonRecord(payload)) {
    const message = payload.message ?? payload.error;

    if (typeof message === "string") {
      return message;
    }
  }

  return status > 0 ? `${fallbackError} HTTP ${status}.` : fallbackError;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

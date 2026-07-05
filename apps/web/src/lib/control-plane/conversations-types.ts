export type ConversationStatus = "active" | "archived" | "deleted";
export type ChatMessageRole = "user" | "assistant";
export type ChatMessageContentPolicy = "retained" | "not_retained";

export type ConversationRecord = {
  applicationId: string;
  contextRetentionEnabled: boolean;
  createdAt: string;
  deletedAt: string | null;
  endUserId: string | null;
  id: string;
  projectId: string;
  status: ConversationStatus;
  tenantId: string;
  title: string | null;
  updatedAt: string;
};

export type ChatMessageRecord = {
  applicationId: string;
  contentPolicy: ChatMessageContentPolicy;
  conversationId: string;
  createdAt: string;
  id: string;
  parentMessageId: string | null;
  projectId: string;
  requestId: string | null;
  role: ChatMessageRole;
  safeContent: string | null;
  sequence: number;
  tenantId: string;
};

export type GatewayContextMessage = {
  content: string;
  role: "system" | ChatMessageRole;
};

export type ConversationContext = {
  contextRetentionEnabled: boolean;
  maxPreviousChars: number;
  maxPreviousUserTurns: number;
  messages: GatewayContextMessage[];
  strategy: "sliding_window";
};

export type ConversationMessageResult = {
  context: ConversationContext;
  message: ChatMessageRecord;
};

export type ConversationCreateValues = {
  applicationId: string;
  contextRetentionEnabled?: boolean;
  endUserId?: string;
  projectId: string;
  tenantId: string;
  title?: string;
};

export type ConversationUpdateValues = {
  applicationId: string;
  contextRetentionEnabled?: boolean;
  conversationId: string;
  projectId: string;
  status?: ConversationStatus;
  tenantId: string;
  title?: string;
};

export type ConversationMessageCreateValues = {
  applicationId: string;
  content: string;
  conversationId: string;
  parentMessageId?: string;
  projectId: string;
  requestId?: string;
  role: ChatMessageRole;
  systemMessage?: string;
  tenantId: string;
};

export type ControlPlaneResult<T> =
  | {
      data: T;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

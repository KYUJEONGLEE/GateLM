export type LiveRequestCacheStatus = "HIT" | "MISS" | "BYPASS" | "NONE";

export type LiveRequestSafetyAction =
  | "MASKED"
  | "BLOCKED"
  | "REDACTED"
  | "UNAVAILABLE"
  | "NONE";

export type LiveRequestStatusFilter = "" | "success" | "failed" | "blocked" | "rate_limited";

export type LiveRequestRow = {
  cacheStatus: LiveRequestCacheStatus;
  category: "general" | "code" | "translation" | "summarization" | "reasoning";
  costUsd: number;
  difficulty: "simple" | "complex";
  executedModel: string | null;
  fallbackUsed?: boolean;
  id: string;
  latencyMs: number;
  ttftMs?: number | null;
  modelRef: string | null;
  projectId: string;
  projectName: string;
  providerFamily: string | null;
  providerId: string | null;
  providerName: string | null;
  requestedModel: string;
  requestId: string;
  routingReason: string | null;
  safetyAction: LiveRequestSafetyAction;
  surface?: "project_application" | "tenant_chat";
  status: string;
  statusCode: number;
  statusLabel: string;
  timestamp: string;
  totalTokens: number;
  userName: string | null;
};

export type LiveRequestsPayload = {
  generatedAt: string;
  requestedModelOptions: string[];
  projectNameSource: "control-plane" | "fixture";
  rows: LiveRequestRow[];
};

export type LiveRequestCacheStatus = "HIT" | "MISS" | "BYPASS" | "NONE";

export type LiveRequestSafetyAction = "MASKED" | "BLOCKED" | "REDACTED" | "NONE";

export type LiveRequestStatusFilter = "" | "success" | "failed" | "blocked" | "rate_limited";

export type LiveRequestRow = {
  cacheStatus: LiveRequestCacheStatus;
  category: "general" | "code" | "translation" | "summarization" | "reasoning";
  costUsd: number;
  difficulty: "simple" | "complex";
  fallbackUsed?: boolean;
  id: string;
  latencyMs: number;
  modelRef: string | null;
  projectId: string;
  projectName: string;
  requestedModel: string;
  requestId: string;
  routingReason: string | null;
  safetyAction: LiveRequestSafetyAction;
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

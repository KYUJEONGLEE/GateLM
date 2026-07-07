export type LiveRequestProvider = "openai" | "anthropic" | "google" | "gemini" | "mock" | "unknown";

export type LiveRequestCacheStatus = "HIT" | "MISS" | "BYPASS" | "NONE";

export type LiveRequestSafetyAction = "MASKED" | "BLOCKED" | "REDACTED" | "NONE";

export type LiveRequestStatusFilter = "" | "success" | "failed" | "blocked" | "rate_limited";

export type LiveRequestRow = {
  cacheStatus: LiveRequestCacheStatus;
  costUsd: number;
  id: string;
  latencyMs: number;
  model: string;
  projectId: string;
  projectName: string;
  provider: LiveRequestProvider;
  providerLabel: string;
  requestId: string;
  safetyAction: LiveRequestSafetyAction;
  status: string;
  statusCode: number;
  statusLabel: string;
  timestamp: string;
  totalTokens: number;
};

export type LiveRequestsPayload = {
  generatedAt: string;
  modelOptions: string[];
  projectNameSource: "control-plane" | "fixture";
  rows: LiveRequestRow[];
};

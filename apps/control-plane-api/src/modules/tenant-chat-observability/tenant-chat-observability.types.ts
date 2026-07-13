export const TENANT_CHAT_EVENT_TYPES = [
  'usage_reserved',
  'usage_topped_up',
  'usage_settled',
  'usage_released',
  'usage_unconfirmed',
  'invocation_terminal',
] as const;

export type TenantChatEventType = (typeof TENANT_CHAT_EVENT_TYPES)[number];

export interface TenantChatAttemptEvent {
  attemptNo: number;
  kind: 'primary' | 'fallback';
  providerId: string;
  modelKey: string;
  outcome: string;
  usageQuality: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

export interface TenantChatProjectionEvent {
  eventId: string;
  schemaVersion: number;
  eventType: TenantChatEventType;
  eventVersion: number;
  occurredAt: string;
  aggregateId: string;
  requestId: string;
  turnId: string;
  executionScope: {
    kind: 'tenant_chat';
    tenantId: string;
    userId: string;
    actorKind: 'tenant_admin' | 'employee';
    employeeId?: string;
  };
  snapshotVersion: number;
  pricingVersion?: number;
  terminalOutcome?: string;
  quotaState?: string;
  budgetState?: string;
  cacheOutcome?: string;
  latencyMs?: number;
  quota?: {
    state: string;
    confirmedInputTokensDelta: number;
    confirmedOutputTokensDelta: number;
    confirmedTotalTokensDelta: number;
    unconfirmedTokensDelta: number;
  };
  budget?: {
    state: string;
    confirmedCostMicroUsdDelta: number;
    unconfirmedExposureMicroUsdDelta: number;
  };
  attempts?: TenantChatAttemptEvent[];
}

export interface TenantChatInvocationResponse {
  requestId: string;
  surface: 'tenant_chat';
  executionScopeKind: 'tenant_chat';
  tenantId: string;
  userId: string;
  employeeId: string | null;
  actorKind: string;
  turnId: string;
  terminalOutcome: string;
  providerId: string | null;
  modelKey: string | null;
  attemptCount: number;
  confirmedInputTokens: number;
  confirmedOutputTokens: number;
  confirmedTotalTokens: number;
  confirmedCostMicroUsd: number;
  quotaState: string;
  budgetState: string;
  cacheOutcome: string;
  latencyMs: number;
  snapshotVersion: number;
  pricingVersion: number;
  startedAt: string;
  completedAt: string;
  projectionVersion: number;
}

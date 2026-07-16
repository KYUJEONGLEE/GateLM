export type ExecutionPhase = 'admission' | 'sanitization' | 'completion' | 'cancel';

export type ExecutionScope = Readonly<{
  kind: 'tenant_chat';
  tenantId: string;
  actor: Readonly<{
    userId: string;
    actorKind: 'tenant_admin' | 'employee';
    employeeId?: string;
  }>;
  quotaScope: Readonly<{ type: 'user'; id: string }>;
  budgetScope: Readonly<{ type: 'tenant'; id: string }>;
}>;

export type SnapshotReference = Readonly<{
  version: number;
  digest: string;
  policyVersion: number;
  employeeNoticeVersion: number;
  pricingVersion: number;
}>;

export const MAX_EPHEMERAL_MESSAGE_CHARACTERS = 20_000;

export type ClientUsageIntent = Readonly<{
  maxOutputTokens: number;
  requestedTier: 'auto' | 'high_quality' | 'standard' | 'economy';
  cacheStrategy: 'off' | 'exact';
}>;

export type UsageIntent = Readonly<ClientUsageIntent & {
  estimatedInputTokens: number;
}>;

export type ExecutionContext = Readonly<{
  surface: 'tenant_chat';
  phase: ExecutionPhase;
  requestId: string;
  turnId: string;
  idempotencyKey: string;
  admissionId?: string;
  executionScope: ExecutionScope;
  snapshot: SnapshotReference;
  bindingDigest: string;
  usageIntent?: UsageIntent;
}>;

export type AdmissionSeed = Readonly<{
  requestId: string;
  turnId: string;
  idempotencyKey: string;
  executionScope: ExecutionScope;
  snapshot: SnapshotReference;
  actorAuthzVersion: number;
  tenantAuthzVersion: number;
  sessionVersion: number;
}>;

export type AdmissionIdentity = Readonly<{
  requestId: string;
  turnId: string;
  idempotencyKey: string;
}>;

export type AdmissionHandle = Readonly<AdmissionSeed & {
  admissionId: string;
  expiresAt: string;
}>;

export type EphemeralMessage = Readonly<{
  role: 'system' | 'user' | 'assistant';
  content: string;
  safety?: SafetyProvenance;
}>;

export type SafetyProvenance =
  | Readonly<{ status: 'sanitized'; policyDigest: string }>
  | Readonly<{ status: 'provider_generated' }>;

export type SanitizationInput = Readonly<{
  messages: readonly Readonly<{ role: 'user'; content: string }>[];
  placeholderCounters?: Readonly<Record<string, number>>;
}>;

export type SanitizationResult = Readonly<{
  messages: readonly Readonly<{ itemIndex: number; content: string }>[];
  policyDigest: string;
}>;

export type CompletionInput = Readonly<{
  messages: readonly EphemeralMessage[];
  stream: true;
}>;

export type CompletionUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageQuality: 'confirmed' | 'pending_unconfirmed' | 'not_available';
}>;

export type CompletionFinalEvent = Readonly<{
  type: 'tenant_chat.final';
  schemaVersion: 1;
  requestId: string;
  turnId: string;
  sequence: number;
  terminalOutcome: 'succeeded' | 'failed' | 'cancelled' | 'cache_hit' | 'quota_blocked' | 'budget_blocked';
  effectiveModelKey: string | null;
  usage: CompletionUsage;
  quotaState: 'normal' | 'warning' | 'economy' | 'blocked';
  budgetState: 'normal' | 'warning' | 'economy' | 'blocked';
  cacheOutcome: 'off' | 'hit' | 'miss';
  replayed: boolean;
  error?: Readonly<{ code: string; message: string; retryAfterSeconds?: number }>;
}>;

export type CompletionResult = Readonly<{
  assistantContent: string;
  final: CompletionFinalEvent;
}>;

export type CompleteOptions = Readonly<{
  signal?: AbortSignal;
  onDelta?: (delta: string, sequence: number) => void | Promise<void>;
}>;

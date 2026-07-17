export type PolicyState = 'normal' | 'warning' | 'economy' | 'blocked';
export type SafeChatError = Readonly<{ code: string; message: string; retryAfterSeconds?: number }>;
export const MAX_TENANT_CHAT_OUTPUT_TOKENS: 8192;
export type TurnEvent = Readonly<Record<string, unknown> & {
  type: 'chat.turn.accepted' | 'chat.turn.delta' | 'chat.turn.sources' | 'chat.turn.citations' | 'chat.turn.final' | 'chat.turn.error' | 'chat.turn.cancelled';
  conversationId: string;
  turnId: string;
  sequence: number;
  delta?: string;
  error?: SafeChatError;
  quotaState?: PolicyState;
  budgetState?: PolicyState;
  messageId?: string;
  userMessageId?: string;
  userContent?: string;
  effectiveModelKey?: string;
  cacheOutcome?: 'off' | 'hit' | 'miss';
  citations?: readonly Citation[];
}>;
export type Citation = Readonly<{ sourceId: string; documentId: string; displayName: string; pageStart: number | null; pageEnd: number | null; lineStart: number | null; lineEnd: number | null; ordinal: number; availability?: 'available' | 'unavailable' }>;

export class ConversationContractError extends Error { code: string; status: number }
export function conversationId(value: unknown): string;
export function turnId(value: unknown): string;
export function parsePageQuery(url: string, maximum: number, fallback: number): Readonly<{ cursor?: string; limit: number }>;
export function assertNoQuery(url: string): void;
export function assertExactOrigin(request: Request, expectedOrigin: string): void;
export function assertDoubleSubmitCsrf(request: Request, cookieValue: string | undefined): void;
export function parseIfMatch(value: unknown): number;
export function createConversationBody(value: unknown): Readonly<{ idempotencyKey: string; title: string; knowledgeMode: 'off' | 'tenant' }>;
export function updateConversationBody(value: unknown): Readonly<{ expectedVersion: number; title?: string; knowledgeMode?: 'off' | 'tenant' }>;
export function createTurnBody(value: unknown): Readonly<{
  content: string;
  contextMode: 'conversation' | 'single_turn';
  idempotencyKey: string;
  usageIntent: Readonly<{ cacheStrategy: 'off' | 'exact'; maxOutputTokens: number; requestedTier: 'auto' | 'high_quality' | 'standard' | 'economy' }>;
}>;
export type Conversation = Readonly<{ id: string; title: string; knowledgeMode: 'off' | 'tenant'; version: number; historyRetentionDays: 0 | 7 | 30 | 90; createdAt: string; updatedAt: string }>;
export type Message = Readonly<{ id: string; turnId: string; role: 'user' | 'assistant'; content: string; effectiveModelKey?: string; citations?: readonly Citation[]; sequence: number; createdAt: string }>;
export function conversationView(value: unknown): Conversation;
export function conversationPage(value: unknown): Readonly<{ items: readonly Conversation[]; nextCursor: string | null }>;
export function messagePage(value: unknown): Readonly<{ items: readonly Message[]; nextCursor: string | null }>;
export function cancelResult(value: unknown): Readonly<{ cancelled: boolean }>;
export function strongestPolicyState(quotaState?: PolicyState, budgetState?: PolicyState): PolicyState;
export function isBlockedCode(code: string): boolean;
export function safeChatError(value: unknown): SafeChatError;
export function consumeTurnSse(
  stream: ReadableStream<Uint8Array> | null,
  options: Readonly<{
    conversationId: string;
    onAccepted?: (event: TurnEvent) => void;
    onDelta?: (delta: string, event: TurnEvent) => void;
    onSources?: (citations: readonly Citation[], event: TurnEvent) => void;
    onCitations?: (citations: readonly Citation[], event: TurnEvent) => void;
    onTerminal?: (event: TurnEvent) => void;
  }>,
): Promise<TurnEvent>;

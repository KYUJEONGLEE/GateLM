import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { SessionService } from '@/auth/session.service';
import type { AuthorizedExecution } from '@/auth/auth.types';
import { ExecutionBridgeService } from '@/execution/execution-bridge.service';
import type {
  AdmissionHandle,
  ClientUsageIntent,
  CompletionFinalEvent,
  EphemeralMessage,
  TenantChatContextMode,
  UsageIntent,
} from '@/execution/execution.types';
import { PrivateGatewayError } from '@/execution/private-gateway.client';
import { TerminalReplayContentUnavailable } from '@/execution/sse-parser';
import {
  RagRetrievalDisabledError,
  RagRetrievalError,
} from '@/rag/rag-retrieval.errors';
import { RagContextBuilder } from '@/rag/rag-context.builder';
import { validateRagCitations, type RagCitation } from '@/rag/rag-citations';
import { RagRetrievalService } from '@/rag/rag-retrieval.service';

import { ActiveTurnRegistry, TurnAttachmentLimitReached } from './active-turn-registry';
import {
  ConversationNotFound,
  ConversationVersionConflict,
  IdempotencyConflict,
  TurnStateConflict,
} from './chat-store.errors';
import { ContentIntegrityError, ContentKeyUnavailable } from './content.errors';
import {
  EncryptedChatStore,
  type ChatActor,
  type CompletionHistoryMessage,
  type MessageView,
  type ReservedTurn,
} from './encrypted-chat-store';
import { InvalidCursor } from './cursor-codec';

export type PreparedTurn =
  | Readonly<{
      kind: 'replay';
      actor: ChatActor;
      reserved: ReservedTurn;
      message: MessageView;
      userMessage: MessageView;
    }>
  | Readonly<{
      kind: 'local';
      actor: ChatActor;
      reserved: ReservedTurn;
      message: MessageView;
      userMessage: MessageView;
    }>
  | Readonly<{
      kind: 'execute';
      actor: ChatActor;
      reserved: ReservedTurn;
      handle: AdmissionHandle;
      messages: readonly EphemeralMessage[];
      userMessage: MessageView;
      usageIntent: UsageIntent;
      signal: AbortSignal;
      citationSources: readonly RagCitation[];
    }>;

export type SafeStreamError = Readonly<{
  code: string;
  message: string;
  cancelled: boolean;
}>;

export type CompletedTurn = Readonly<{
  message: MessageView;
  replayed: boolean;
  quotaState?: CompletionFinalEvent['quotaState'];
  budgetState?: CompletionFinalEvent['budgetState'];
  cacheOutcome?: CompletionFinalEvent['cacheOutcome'];
}>;

@Injectable()
export class ConversationService {
  private readonly historyRetentionDays: 0 | 7 | 30 | 90;
  private readonly assistantMaxBytes: number;
  private readonly maximumAttachmentsPerTurn: number;
  private readonly inFlight = new Map<string, TurnFlight>();

  constructor(
    config: ConfigService,
    private readonly sessions: SessionService,
    private readonly store: EncryptedChatStore,
    private readonly bridge: ExecutionBridgeService,
    private readonly activeTurns: ActiveTurnRegistry,
    private readonly retrieval: RagRetrievalService,
    private readonly ragContext: RagContextBuilder,
  ) {
    this.historyRetentionDays = config.getOrThrow<0 | 7 | 30 | 90>('TENANT_CHAT_HISTORY_RETENTION_DAYS');
    this.assistantMaxBytes = config.getOrThrow<number>('TENANT_CHAT_ASSISTANT_MAX_BYTES');
    this.maximumAttachmentsPerTurn = config.getOrThrow<number>('TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN');
  }

  create(
    accessToken: string,
    idempotencyKey: string,
    title: string,
    requestedKnowledgeMode?: 'off' | 'tenant',
  ) {
    return this.guard(async () => {
      const authorized = await this.sessions.authorizeExecution(accessToken);
      const actor = actorOf(authorized);
      const knowledgeMode = requestedKnowledgeMode ?? 'off';
      if (knowledgeMode === 'tenant') await this.retrieval.assertTenantEnabled(authorized.tenantId);
      return this.store.createConversation(actor, {
        idempotencyKey,
        title,
        historyRetentionDays: this.historyRetentionDays,
        knowledgeMode,
      });
    });
  }

  list(accessToken: string, cursor: string | undefined, limit: number) {
    return this.guard(async () => this.store.listConversations(await this.actor(accessToken), { cursor, limit }));
  }

  get(accessToken: string, conversationId: string) {
    return this.guard(async () => this.store.getConversation(await this.actor(accessToken), conversationId));
  }

  update(
    accessToken: string,
    conversationId: string,
    input: Readonly<{ expectedVersion: number; title?: string; knowledgeMode?: 'off' | 'tenant' }>,
  ) {
    return this.guard(async () => {
      if (input.title === undefined && input.knowledgeMode === undefined) {
        throw new HttpException({
          code: 'CHAT_INVALID_REQUEST',
          message: 'At least one conversation field must be provided.',
        }, HttpStatus.BAD_REQUEST);
      }
      const authorized = await this.sessions.authorizeExecution(accessToken);
      if (input.knowledgeMode === 'tenant') await this.retrieval.assertTenantEnabled(authorized.tenantId);
      return this.store.updateConversation(actorOf(authorized), conversationId, input);
    });
  }

  history(accessToken: string, conversationId: string, cursor: string | undefined, limit: number) {
    return this.guard(async () => this.store.listMessages(
      await this.actor(accessToken),
      conversationId,
      { cursor, limit },
    ));
  }

  async delete(accessToken: string, conversationId: string, expectedVersion: number): Promise<void> {
    await this.guard(async () => {
      const actor = await this.actor(accessToken);
      const result = await this.store.deleteConversation(actor, conversationId, expectedVersion);
      for (const turnId of result.cancelledTurnIds) await this.abortGateway(turnId);
    });
  }

  async prepareTurn(
    accessToken: string,
    conversationId: string,
    input: Readonly<{
      idempotencyKey: string;
      content: string;
      contextMode?: TenantChatContextMode;
      usageIntent: ClientUsageIntent;
    }>,
  ): Promise<PreparedTurn> {
    return this.guard(async () => {
      const authorized = await this.sessions.authorizeExecution(accessToken);
      const actor = actorOf(authorized);
      const contextMode = input.contextMode ?? 'conversation';
      const turnInput = Object.freeze({ ...input, contextMode });
      const reserved = await this.store.reserveTurn(actor, conversationId, turnInput);
      if (reserved.state === 'completed') {
        const [message, userMessage] = await Promise.all([
          this.store.readCompletedReplay(actor, reserved),
          this.store.readSanitizedUser(actor, reserved),
        ]);
        if (!message || !userMessage) throw new TerminalReplayContentUnavailable();
        return Object.freeze({ kind: 'replay' as const, actor, reserved, message, userMessage });
      }
      if (['failed', 'cancelled', 'deleted'].includes(reserved.state)) {
        throw new TurnStateConflict();
      }
      let ragMessage: EphemeralMessage | undefined;
      let citationSources: readonly RagCitation[] = Object.freeze([]);
      const attachment = this.activeTurns.reserve(
        reserved.turnId,
        this.maximumAttachmentsPerTurn,
      );
      let handle: AdmissionHandle | undefined;
      try {
        handle = await this.bridge.admitAuthorized(authorized, {
          requestId: reserved.requestId,
          turnId: reserved.turnId,
          idempotencyKey: reserved.idempotencyKey,
        });
        if (reserved.knowledgeMode === 'tenant') {
          const querySanitization = await this.bridge.sanitize(handle, {
            messages: Object.freeze([
              Object.freeze({ role: 'user' as const, content: input.content }),
            ]),
          });
          const safeQuery = sanitizedContentAt(querySanitization, 0);
          const retrieved = await this.retrieval.retrieve(
            authorized,
            latestRagQuery(safeQuery.content),
          );
          const context = this.ragContext.build(retrieved);
          if (context.sources.length === 0) {
            const local = await this.store.persistRagNoEvidence(
              actor,
              reserved,
              safeQuery.content,
              safeQuery.policyDigest,
              RAG_NO_EVIDENCE_RESPONSE,
            );
            this.activeTurns.releaseReservation(reserved.turnId, attachment);
            await this.bridge.cancel(handle).catch(() => undefined);
            return Object.freeze({
              kind: 'local' as const,
              actor,
              reserved,
              message: local.message,
              userMessage: local.userMessage,
            });
          }
          ragMessage = context.message;
          citationSources = context.citationSources;
        }
        const existingCurrent = reserved.state === 'pending_admission'
          ? null
          : await this.store.readCurrentUserSafety(actor, reserved);
        if (reserved.state !== 'pending_admission' && !existingCurrent) {
          throw new ContentIntegrityError();
        }
        const history = contextMode === 'single_turn'
          ? Object.freeze({
              messages: Object.freeze([]),
              placeholderCounters: Object.freeze({}),
            })
          : await this.store.completionHistory(
              actor,
              conversationId,
              Buffer.byteLength(existingCurrent?.content ?? input.content, 'utf8'),
            );
        const legacyUsers = history.messages.filter((message) =>
          message.role === 'user' && message.safetyStatus === 'legacy_unverified');
        const currentNeedsSanitization = existingCurrent?.safetyStatus !== 'sanitized';
        const sanitizationMessages = Object.freeze([
          ...legacyUsers.map((message) => Object.freeze({ role: 'user' as const, content: message.content })),
          ...(currentNeedsSanitization
            ? [Object.freeze({
                role: 'user' as const,
                content: existingCurrent?.content ?? input.content,
              })]
            : []),
        ]);
        const sanitization = sanitizationMessages.length > 0
          ? await this.bridge.sanitize(handle, {
              messages: sanitizationMessages,
              ...(Object.keys(history.placeholderCounters).length > 0
                ? { placeholderCounters: history.placeholderCounters }
                : {}),
            })
          : undefined;
        const sanitizedLegacy = new Map<string, SanitizedContent>();
        for (let index = 0; index < legacyUsers.length; index += 1) {
          const content = sanitization?.messages[index]?.content;
          if (!content || !sanitization) throw new ContentIntegrityError();
          sanitizedLegacy.set(legacyUsers[index]!.id, Object.freeze({
            content,
            policyDigest: sanitization.policyDigest,
          }));
        }
        const sanitizedCurrent = currentNeedsSanitization
          ? sanitizedContentAt(sanitization, legacyUsers.length)
          : trustedCurrent(existingCurrent);
        const persisted = await this.store.persistAdmittedUser(
          actor,
          reserved,
          sanitizedCurrent.content,
          sanitizedCurrent.policyDigest,
          handle,
          legacyUsers.map((message) => Object.freeze({
            messageId: message.id,
            content: sanitizedLegacy.get(message.id)!.content,
          })),
          sanitization?.policyDigest ?? sanitizedCurrent.policyDigest,
        );
        const baseMessages = completionMessages(
          history.messages,
          sanitizedLegacy,
          Object.freeze({
            content: persisted.message.content,
            policyDigest: sanitizedCurrent.policyDigest,
          }),
        );
        const messages = ragMessage
          ? Object.freeze([ragMessage, ...baseMessages])
          : baseMessages;        const signal = this.activeTurns.activate(reserved.turnId, attachment, handle);
        if (signal.aborted) throw new TurnStateConflict();
        return Object.freeze({
          kind: 'execute' as const,
          actor,
          reserved,
          handle,
          messages,
          userMessage: persisted.message,
          usageIntent: internalUsageIntent(
            input.usageIntent,
            messages,
            reserved.knowledgeMode === 'tenant',
          ),          signal,
          citationSources,
        });
      } catch (error) {
        const lastAttachment = this.activeTurns.releaseReservation(reserved.turnId, attachment);
        if (handle && lastAttachment) {
          if (isSafetyBlocked(error)) {
            await this.store.markTerminalFailure(
              actor,
              reserved.turnId,
              'CHAT_SAFETY_BLOCKED',
            ).catch(() => undefined);
          } else if (!reserved.replayed) {
            await Promise.allSettled([
              this.bridge.cancel(handle),
              this.store.cancelTurn(actor, conversationId, reserved.turnId),
            ]);
          }
        }
        throw error;
      }
    });
  }

  async executeTurn(
    prepared: Extract<PreparedTurn, { kind: 'execute' }>,
    onDelta: (delta: string) => Promise<void>,
  ): Promise<CompletedTurn> {
    const turnId = prepared.reserved.turnId;
    let flight = this.inFlight.get(turnId);
    const listener: FlightListener = { nextIndex: 0, send: onDelta };
    if (!flight) {
      flight = {
        chunks: [],
        listeners: new Set([listener]),
        promise: undefined as never,
      };
      this.inFlight.set(turnId, flight);
      flight.promise = this.runTurn(prepared, async (delta) => {
        flight!.chunks.push(delta);
        for (const current of flight!.listeners) {
          void pump(flight!, current).catch(() => undefined);
        }
      }).finally(() => {
        if (this.inFlight.get(turnId) === flight) this.inFlight.delete(turnId);
      });
    } else {
      flight.listeners.add(listener);
    }
    try {
      await pump(flight, listener);
      const result = await flight.promise;
      await pump(flight, listener);
      return result;
    } finally {
      flight.listeners.delete(listener);
      this.activeTurns.release(turnId, prepared.handle);
    }
  }

  private async runTurn(
    prepared: Extract<PreparedTurn, { kind: 'execute' }>,
    onDelta: (delta: string) => Promise<void>,
  ): Promise<CompletedTurn> {
    let assistantBytes = 0;
    let assistantTooLarge = false;
    try {
      try {
        await this.store.markStreaming(prepared.actor, prepared.reserved.turnId);
      } catch (error) {
        if (error instanceof TurnStateConflict) {
          const local = await this.store.readCompletedReplay(prepared.actor, prepared.reserved);
          if (local) {
            await onDelta(local.content);
            return Object.freeze({ message: local, replayed: true });
          }
        }
        throw error;
      }
      let result;
      try {
        result = await this.bridge.complete(
          prepared.handle,
          { messages: prepared.messages, stream: true },
          prepared.usageIntent,
          {
            signal: prepared.signal,
            onDelta: async (delta) => {
              assistantBytes += Buffer.byteLength(delta, 'utf8');
              if (assistantBytes > this.assistantMaxBytes) {
                assistantTooLarge = true;
                this.activeTurns.abort(prepared.reserved.turnId);
                throw new AssistantTooLarge();
              }
              await onDelta(delta);
            },
          },
        );
      } catch (error) {
        if (assistantTooLarge) throw new AssistantTooLarge();
        if (error instanceof TerminalReplayContentUnavailable) {
          const local = await this.store.readCompletedReplay(prepared.actor, prepared.reserved);
          if (local) {
            await onDelta(local.content);
            return Object.freeze({ message: local, replayed: true });
          }
        }
        throw error;
      }
      if (prepared.signal.aborted) throw new TurnStateConflict();
      const persisted = await this.persistAssistantWithRetry(
        prepared,
        result.assistantContent,
        result.final.cacheOutcome === 'hit' ? null : result.final.effectiveModelKey,
        prepared.citationSources.length ? validateRagCitations(result.assistantContent, prepared.citationSources) : undefined,
      );
      return Object.freeze({
        message: persisted.message,
        replayed: persisted.replayed,
        quotaState: result.final.quotaState,
        budgetState: result.final.budgetState,
        cacheOutcome: result.final.cacheOutcome,
      });
    } catch (error) {
      if (error instanceof AssistantTooLarge) {
        await this.store.markTerminalFailure(
          prepared.actor,
          prepared.reserved.turnId,
          'CHAT_RESPONSE_TOO_LARGE',
        ).catch(() => undefined);
      } else if (prepared.signal.aborted) {
        await this.store.cancelTurn(
          prepared.actor,
          prepared.reserved.conversationId,
          prepared.reserved.turnId,
        ).catch(() => undefined);
      } else {
        await this.store.markTerminalFailure(
          prepared.actor,
          prepared.reserved.turnId,
          safeStreamError(error, false).code,
        ).catch(() => undefined);
      }
      throw error;
    }
  }

  async cancel(accessToken: string, conversationId: string, turnId: string) {
    return this.guard(async () => {
      const actor = await this.actor(accessToken);
      const result = await this.store.cancelTurn(actor, conversationId, turnId);
      if (result.cancelled) await this.abortGateway(turnId);
      return result;
    });
  }

  async disconnect(prepared: PreparedTurn): Promise<void> {
    if (prepared.kind !== 'execute') return;
    this.activeTurns.abort(prepared.reserved.turnId);
    this.activeTurns.release(prepared.reserved.turnId, prepared.handle);
    await Promise.allSettled([
      this.bridge.cancel(prepared.handle),
      this.store.cancelTurn(prepared.actor, prepared.reserved.conversationId, prepared.reserved.turnId),
    ]);
  }

  streamError(error: unknown, aborted: boolean): SafeStreamError {
    return safeStreamError(error, aborted);
  }

  private actor(accessToken: string): Promise<ChatActor> {
    return this.sessions.authorizeExecution(accessToken).then(actorOf);
  }

  private async abortGateway(turnId: string): Promise<void> {
    const handles = this.activeTurns.abort(turnId);
    await Promise.allSettled(handles.map((handle) => this.bridge.cancel(handle)));
  }

  private async persistAssistantWithRetry(
    prepared: Extract<PreparedTurn, { kind: 'execute' }>,
    content: string,
    effectiveModelKey: string | null,
    citations?: readonly RagCitation[],
  ) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return citations === undefined
          ? await this.store.persistAssistant(prepared.actor, prepared.reserved, content, effectiveModelKey)
          : await this.store.persistAssistant(prepared.actor, prepared.reserved, content, effectiveModelKey, citations);
      } catch (error) {
        if (attempt === 3 || !isRetryableStorageError(error)) throw error;
        await delay(attempt * 25);
      }
    }
    throw new Error('Assistant persistence retry loop exhausted.');
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw httpError(error);
    }
  }
}

function actorOf(authorized: AuthorizedExecution): ChatActor {
  return Object.freeze({ tenantId: authorized.tenantId, userId: authorized.userId });
}

function httpError(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof ConversationNotFound) return failure(404, 'CHAT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
  if (error instanceof ConversationVersionConflict) return failure(409, 'CHAT_CONVERSATION_VERSION_CONFLICT', 'The conversation changed.');
  if (error instanceof IdempotencyConflict) return failure(409, 'CHAT_IDEMPOTENCY_CONFLICT', 'The idempotency key is already bound.');
  if (error instanceof InvalidCursor) return failure(400, 'CHAT_CURSOR_INVALID', 'The cursor is invalid.');
  if (error instanceof TerminalReplayContentUnavailable) return failure(409, 'CHAT_TERMINAL_REPLAY_UNAVAILABLE', 'The completed response cannot be replayed safely.');
  if (error instanceof TurnStateConflict) return failure(409, 'CHAT_TURN_STATE_CONFLICT', 'The turn cannot continue from its current state.');
  if (error instanceof TurnAttachmentLimitReached) return failure(429, 'CHAT_CONCURRENCY_LIMITED', 'Too many clients are attached to this turn.');
  if (error instanceof ContentKeyUnavailable) return failure(503, 'CHAT_CONTENT_KEY_UNAVAILABLE', 'Encrypted content is temporarily unavailable.');
  if (error instanceof ContentIntegrityError) return failure(500, 'CHAT_CONTENT_INTEGRITY_FAILED', 'Encrypted content integrity validation failed.');
  if (error instanceof RagRetrievalDisabledError) return failure(503, 'CHAT_RAG_DISABLED', 'Tenant knowledge chat is not enabled.');
  if (error instanceof RagRetrievalError) return failure(503, 'CHAT_RAG_UNAVAILABLE', 'Tenant knowledge retrieval is unavailable.');
  if (error instanceof PrivateGatewayError) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
    return failure(status, safeCode(error.code), 'Tenant Chat execution could not be completed.');
  }
  if (isStorageError(error)) {
    return failure(503, 'CHAT_STORAGE_UNAVAILABLE', 'Encrypted content storage is temporarily unavailable.');
  }
  return failure(500, 'CHAT_INTERNAL_ERROR', 'The request could not be completed.');
}

function safeStreamError(error: unknown, aborted: boolean): SafeStreamError {
  if (error instanceof AssistantTooLarge) return Object.freeze({ code: 'CHAT_RESPONSE_TOO_LARGE', message: 'The response exceeded the allowed size.', cancelled: false });
  if (aborted) return Object.freeze({ code: 'CHAT_REQUEST_CANCELLED', message: 'The request was cancelled.', cancelled: true });
  if (error instanceof TerminalReplayContentUnavailable) return Object.freeze({ code: 'CHAT_TERMINAL_REPLAY_UNAVAILABLE', message: 'The completed response cannot be replayed safely.', cancelled: false });
  if (error instanceof ContentIntegrityError) return Object.freeze({ code: 'CHAT_CONTENT_INTEGRITY_FAILED', message: 'Encrypted content integrity validation failed.', cancelled: false });
  if (error instanceof RagRetrievalDisabledError) return Object.freeze({ code: 'CHAT_RAG_DISABLED', message: 'Tenant knowledge chat is not enabled.', cancelled: false });
  if (error instanceof RagRetrievalError) return Object.freeze({ code: 'CHAT_RAG_UNAVAILABLE', message: 'Tenant knowledge retrieval is unavailable.', cancelled: false });
  if (error instanceof ContentKeyUnavailable) return Object.freeze({ code: 'CHAT_CONTENT_KEY_UNAVAILABLE', message: 'Encrypted content is temporarily unavailable.', cancelled: false });
  if (isStorageError(error)) return Object.freeze({ code: 'CHAT_STORAGE_UNAVAILABLE', message: 'Encrypted content storage is temporarily unavailable.', cancelled: false });
  if (error instanceof TurnStateConflict) return Object.freeze({ code: 'CHAT_TURN_STATE_CONFLICT', message: 'The turn cannot continue from its current state.', cancelled: false });
  if (error instanceof PrivateGatewayError) return Object.freeze({ code: safeCode(error.code), message: 'Tenant Chat execution could not be completed.', cancelled: error.code === 'CHAT_REQUEST_CANCELLED' });
  return Object.freeze({ code: 'CHAT_INTERNAL_ERROR', message: 'The request could not be completed.', cancelled: false });
}

function failure(status: number, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status as HttpStatus);
}

function safeCode(value: string): string {
  return /^CHAT_[A-Z0-9_]{1,59}$/.test(value) ? value : 'CHAT_PROVIDER_FAILED';
}

class AssistantTooLarge extends Error {}

const RETRYABLE_STORAGE_CODES = new Set(['P1008', 'P1017', 'P2024', 'P2034', 'P2037']);
const RAG_NO_EVIDENCE_RESPONSE = '등록된 문서에서 관련 근거를 찾지 못했습니다.';

function internalUsageIntent(
  input: ClientUsageIntent,
  messages: readonly EphemeralMessage[],
  ragEnabled = false,
): UsageIntent {
  return Object.freeze({
    ...input,
    ...(ragEnabled ? { cacheStrategy: 'off' as const } : {}),
    estimatedInputTokens: Math.max(
      1,
      messages.reduce((total, message) => total + Buffer.byteLength(message.content, 'utf8'), 0),
    ),
  });
}

function completionMessages(
  history: readonly CompletionHistoryMessage[],
  sanitizedLegacy: ReadonlyMap<string, SanitizedContent>,
  current: SanitizedContent,
): readonly EphemeralMessage[] {
  const messages = history.map((message): EphemeralMessage => {
    if (message.role === 'assistant' && message.safetyStatus === 'provider_generated') {
      return Object.freeze({
        role: 'assistant' as const,
        content: message.content,
        safety: Object.freeze({ status: 'provider_generated' as const }),
      });
    }
    if (message.role === 'user' && message.safetyStatus === 'sanitized' && message.safetyPolicyDigest) {
      return Object.freeze({
        role: 'user' as const,
        content: message.content,
        safety: Object.freeze({
          status: 'sanitized' as const,
          policyDigest: message.safetyPolicyDigest,
        }),
      });
    }
    if (message.role === 'user' && message.safetyStatus === 'legacy_unverified') {
      const sanitized = sanitizedLegacy.get(message.id);
      if (!sanitized) throw new ContentIntegrityError();
      return Object.freeze({
        role: 'user' as const,
        content: sanitized.content,
        safety: Object.freeze({
          status: 'sanitized' as const,
          policyDigest: sanitized.policyDigest,
        }),
      });
    }
    throw new ContentIntegrityError();
  });
  messages.push(Object.freeze({
    role: 'user' as const,
    content: current.content,
    safety: Object.freeze({
      status: 'sanitized' as const,
      policyDigest: current.policyDigest,
    }),
  }));
  return Object.freeze(messages);
}

type SanitizedContent = Readonly<{
  content: string;
  policyDigest: string;
}>;

function sanitizedContentAt(
  result: Readonly<{
    messages: readonly Readonly<{ content: string }>[];
    policyDigest: string;
  }> | undefined,
  index: number,
): SanitizedContent {
  const content = result?.messages[index]?.content;
  if (!content || !result) throw new ContentIntegrityError();
  return Object.freeze({ content, policyDigest: result.policyDigest });
}

function trustedCurrent(
  message: CompletionHistoryMessage | null,
): SanitizedContent {
  if (
    !message ||
    message.role !== 'user' ||
    message.safetyStatus !== 'sanitized' ||
    !message.safetyPolicyDigest
  ) {
    throw new ContentIntegrityError();
  }
  return Object.freeze({
    content: message.content,
    policyDigest: message.safetyPolicyDigest,
  });
}

function isSafetyBlocked(error: unknown): boolean {
  return error instanceof PrivateGatewayError && error.code === 'CHAT_SAFETY_BLOCKED';
}

function latestRagQuery(content: string): string {
  const query = content.trim();
  if (query.length === 0) throw new RagRetrievalError('RAG_QUERY_INVALID', 400);
  return query;}

function isStorageError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError;
}

function isRetryableStorageError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_STORAGE_CODES.has(error.code));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type FlightListener = {
  nextIndex: number;
  send: (delta: string) => Promise<void>;
  pumping?: Promise<void>;
  failure?: unknown;
};

type TurnFlight = {
  chunks: string[];
  listeners: Set<FlightListener>;
  promise: Promise<Readonly<{ message: MessageView; replayed: boolean }>>;
};

function pump(flight: TurnFlight, listener: FlightListener): Promise<void> {
  if (listener.failure) return Promise.reject(listener.failure);
  if (listener.pumping) return listener.pumping;
  listener.pumping = (async () => {
    while (listener.nextIndex < flight.chunks.length) {
      const index = listener.nextIndex;
      listener.nextIndex += 1;
      await listener.send(flight.chunks[index]);
    }
  })()
    .catch((error: unknown) => {
      listener.failure = error;
      throw error;
    })
    .finally(() => {
      listener.pumping = undefined;
    });
  return listener.pumping;
}

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
    }>
  | Readonly<{
      kind: 'execute';
      actor: ChatActor;
      reserved: ReservedTurn;
      handle: AdmissionHandle;
      messages: readonly { role: 'system' | 'user' | 'assistant'; content: string }[];
      usageIntent: UsageIntent;
      signal: AbortSignal;
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
  ) {
    this.historyRetentionDays = config.getOrThrow<0 | 7 | 30 | 90>('TENANT_CHAT_HISTORY_RETENTION_DAYS');
    this.assistantMaxBytes = config.getOrThrow<number>('TENANT_CHAT_ASSISTANT_MAX_BYTES');
    this.maximumAttachmentsPerTurn = config.getOrThrow<number>('TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN');
  }

  create(accessToken: string, idempotencyKey: string, title: string) {
    return this.guard(async () => {
      const actor = await this.actor(accessToken);
      return this.store.createConversation(actor, {
        idempotencyKey,
        title,
        historyRetentionDays: this.historyRetentionDays,
      });
    });
  }

  list(accessToken: string, cursor: string | undefined, limit: number) {
    return this.guard(async () => this.store.listConversations(await this.actor(accessToken), { cursor, limit }));
  }

  get(accessToken: string, conversationId: string) {
    return this.guard(async () => this.store.getConversation(await this.actor(accessToken), conversationId));
  }

  rename(accessToken: string, conversationId: string, title: string, expectedVersion: number) {
    return this.guard(async () => this.store.renameConversation(
      await this.actor(accessToken),
      conversationId,
      title,
      expectedVersion,
    ));
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
        const message = await this.store.readCompletedReplay(actor, reserved);
        if (!message) throw new TerminalReplayContentUnavailable();
        return Object.freeze({ kind: 'replay' as const, actor, reserved, message });
      }
      if (['failed', 'cancelled', 'deleted'].includes(reserved.state)) {
        throw new TurnStateConflict();
      }
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
        await this.store.persistAdmittedUser(actor, reserved, input.content, handle);
        const messages = contextMode === 'single_turn'
          ? Object.freeze([Object.freeze({ role: 'user' as const, content: input.content })])
          : await this.store.completionHistory(actor, conversationId, reserved.turnId);
        const signal = this.activeTurns.activate(reserved.turnId, attachment, handle);
        if (signal.aborted) throw new TurnStateConflict();
        return Object.freeze({
          kind: 'execute' as const,
          actor,
          reserved,
          handle,
          messages,
          usageIntent: internalUsageIntent(input.usageIntent, messages),
          signal,
        });
      } catch (error) {
        const lastAttachment = this.activeTurns.releaseReservation(reserved.turnId, attachment);
        if (handle && lastAttachment) {
          await Promise.allSettled([
            this.bridge.cancel(handle),
            this.store.cancelTurn(actor, conversationId, reserved.turnId),
          ]);
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
  ) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.store.persistAssistant(
          prepared.actor,
          prepared.reserved,
          content,
          effectiveModelKey,
        );
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

function internalUsageIntent(
  input: ClientUsageIntent,
  messages: readonly EphemeralMessage[],
): UsageIntent {
  return Object.freeze({
    ...input,
    estimatedInputTokens: Math.max(
      1,
      messages.reduce((total, message) => total + Buffer.byteLength(message.content, 'utf8'), 0),
    ),
  });
}

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

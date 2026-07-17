import type { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import type { AdmissionHandle, CompleteOptions, CompletionResult } from '@/execution/execution.types';
import { PrivateGatewayError } from '@/execution/private-gateway.client';

import { ActiveTurnRegistry } from './active-turn-registry';
import { ConversationService, type PreparedTurn } from './conversation.service';
import type { MessageView } from './encrypted-chat-store';

const OLD_POLICY_DIGEST = `sha256:${'A'.repeat(43)}`;
const CURRENT_POLICY_DIGEST = `sha256:${'B'.repeat(43)}`;

describe('ConversationService turn fan-out', () => {
  it('releases an early-disconnected attachment after cancellation attempts', async () => {
    const registry = new ActiveTurnRegistry();
    const prepared = execution(registry, 'first');
    const store = { cancelTurn: jest.fn().mockResolvedValue({ cancelled: true }) };
    let finishCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      finishCancel = resolve;
    });
    const bridge = { cancel: jest.fn(() => cancelGate) };
    const service = serviceWith({ store, bridge, registry });

    const disconnected = service.disconnect(prepared);

    expect(prepared.signal.aborted).toBe(true);
    expect(registry.abort(prepared.reserved.turnId)).toEqual([]);
    expect(bridge.cancel).toHaveBeenCalledWith(prepared.handle);
    finishCancel();
    await disconnected;
  });

  it('does not let one slow attachment block shared completion and persistence', async () => {
    const registry = new ActiveTurnRegistry();
    const first = execution(registry, 'first');
    const second = execution(registry, 'second');
    const message = assistantMessage();
    const store = {
      markStreaming: jest.fn().mockResolvedValue(undefined),
      persistAssistant: jest.fn().mockResolvedValue({ message, replayed: false }),
      markTerminalFailure: jest.fn().mockResolvedValue(undefined),
      cancelTurn: jest.fn().mockResolvedValue({ cancelled: true }),
    };
    let providerFinished = false;
    const bridge = {
      complete: jest.fn(async (...args: unknown[]): Promise<CompletionResult> => {
        const options = args[3] as CompleteOptions;
        await options.onDelta?.('delta', 1);
        providerFinished = true;
        return completion('delta');
      }),
    };
    const service = serviceWith({ store, bridge, registry });
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let firstSettled = false;

    const firstResult = service.executeTurn(first, () => slowGate).finally(() => {
      firstSettled = true;
    });
    const secondResult = service.executeTurn(second, async () => undefined);

    await expect(secondResult).resolves.toEqual({
      message,
      replayed: false,
      quotaState: 'normal',
      budgetState: 'normal',
      cacheOutcome: 'miss',
    });
    expect(providerFinished).toBe(true);
    expect(firstSettled).toBe(false);
    expect(bridge.complete).toHaveBeenCalledTimes(1);
    expect(store.persistAssistant).toHaveBeenCalledTimes(1);
    expect(store.persistAssistant).toHaveBeenCalledWith(
      first.actor,
      first.reserved,
      'delta',
      'mock',
    );

    releaseSlow();
    await expect(firstResult).resolves.toEqual({
      message,
      replayed: false,
      quotaState: 'normal',
      budgetState: 'normal',
      cacheOutcome: 'miss',
    });
  });

  it('retries a transient final persistence conflict while assistant content is available', async () => {
    const registry = new ActiveTurnRegistry();
    const prepared = execution(registry, 'first');
    const message = assistantMessage();
    const store = {
      markStreaming: jest.fn().mockResolvedValue(undefined),
      persistAssistant: jest.fn()
        .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('retry', {
          code: 'P2034',
          clientVersion: '6.1.0',
        }))
        .mockResolvedValue({ message, replayed: false }),
      markTerminalFailure: jest.fn().mockResolvedValue(undefined),
      cancelTurn: jest.fn().mockResolvedValue({ cancelled: true }),
    };
    const bridge = { complete: jest.fn().mockResolvedValue(completion('delta')) };
    const service = serviceWith({ store, bridge, registry });

    await expect(service.executeTurn(prepared, async () => undefined))
      .resolves.toEqual({
        message,
        replayed: false,
        quotaState: 'normal',
        budgetState: 'normal',
        cacheOutcome: 'miss',
      });
    expect(store.persistAssistant).toHaveBeenCalledTimes(2);
    expect(store.persistAssistant).toHaveBeenLastCalledWith(
      prepared.actor,
      prepared.reserved,
      'delta',
      'mock',
    );
    expect(store.markTerminalFailure).not.toHaveBeenCalled();
  });

  it('omits model history metadata when an exact cache hit supplies the assistant', async () => {
    const registry = new ActiveTurnRegistry();
    const prepared = execution(registry, 'first');
    const message = Object.freeze({
      id: '00000000-0000-4000-8000-000000000400',
      turnId: '00000000-0000-4000-8000-000000000301',
      role: 'assistant' as const,
      content: 'cached delta',
      sequence: 2,
      createdAt: '2026-07-14T00:00:00.000Z',
    });
    const store = {
      markStreaming: jest.fn().mockResolvedValue(undefined),
      persistAssistant: jest.fn().mockResolvedValue({ message, replayed: false }),
      markTerminalFailure: jest.fn().mockResolvedValue(undefined),
      cancelTurn: jest.fn().mockResolvedValue({ cancelled: true }),
    };
    const bridge = {
      complete: jest.fn().mockResolvedValue(completion('cached delta', 'hit')),
    };
    const service = serviceWith({ store, bridge, registry });

    await expect(service.executeTurn(prepared, async () => undefined)).resolves.toEqual({
      message,
      replayed: false,
      quotaState: 'normal',
      budgetState: 'normal',
      cacheOutcome: 'hit',
    });
    expect(store.persistAssistant).toHaveBeenCalledWith(
      prepared.actor,
      prepared.reserved,
      'cached delta',
      null,
    );
    expect(message).not.toHaveProperty('effectiveModelKey');
  });

  it('derives the internal input estimate from the exact bounded completion messages', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = reservedTurn('pending_admission');
    const messages = Object.freeze([
      Object.freeze({
        id: '00000000-0000-4000-8000-000000000410',
        turnId: '00000000-0000-4000-8000-000000000411',
        role: 'assistant' as const,
        content: '한',
        safetyStatus: 'provider_generated' as const,
        safetyPolicyDigest: null,
      }),
    ]);
    const handle = Object.freeze({ admissionId: 'admission' } as AdmissionHandle);
    const persistedUser = userMessage('abc');
    const store = {
      reserveTurn: jest.fn().mockResolvedValue(reserved),
      persistAdmittedUser: jest.fn().mockResolvedValue({ message: persistedUser, replayed: false }),
      completionHistory: jest.fn().mockResolvedValue({ messages, placeholderCounters: {} }),
    };
    const bridge = {
      admitAuthorized: jest.fn().mockResolvedValue(handle),
      sanitize: jest.fn().mockResolvedValue({
        messages: [{ itemIndex: 0, content: 'abc' }],
        policyDigest: CURRENT_POLICY_DIGEST,
      }),
    };
    const service = serviceWith({
      store,
      bridge,
      registry,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    const prepared = await service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: 'abc',
      usageIntent: { maxOutputTokens: 8192, requestedTier: 'standard', cacheStrategy: 'exact' },
    });

    expect(prepared.kind).toBe('execute');
    if (prepared.kind !== 'execute') throw new Error('Expected an executable turn.');
    expect(prepared.usageIntent).toEqual({
      estimatedInputTokens: Buffer.byteLength('한abc', 'utf8'),
      maxOutputTokens: 8192,
      requestedTier: 'standard',
      cacheStrategy: 'exact',
    });
    expect(bridge.sanitize).toHaveBeenCalledWith(handle, {
      messages: [{ role: 'user', content: 'abc' }],
    });
    expect(prepared.userMessage).toEqual(persistedUser);
    registry.release(reserved.turnId, handle);
  });

  it('persists only sanitized current content and migrates selected legacy user history', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = reservedTurn('pending_admission');
    const handle = Object.freeze({ admissionId: 'admission' } as AdmissionHandle);
    const history = Object.freeze([
      Object.freeze({
        id: '00000000-0000-4000-8000-000000000420',
        turnId: '00000000-0000-4000-8000-000000000421',
        role: 'user' as const,
        content: '[EMAIL_3]',
        safetyStatus: 'sanitized' as const,
        safetyPolicyDigest: OLD_POLICY_DIGEST,
      }),
      Object.freeze({
        id: '00000000-0000-4000-8000-000000000422',
        turnId: '00000000-0000-4000-8000-000000000423',
        role: 'user' as const,
        content: '010-1234-5678',
        safetyStatus: 'legacy_unverified' as const,
        safetyPolicyDigest: null,
      }),
      Object.freeze({
        id: '00000000-0000-4000-8000-000000000424',
        turnId: '00000000-0000-4000-8000-000000000425',
        role: 'assistant' as const,
        content: '확인',
        safetyStatus: 'provider_generated' as const,
        safetyPolicyDigest: null,
      }),
    ]);
    const persistedUser = userMessage('[EMAIL_4]');
    const store = {
      reserveTurn: jest.fn().mockResolvedValue(reserved),
      completionHistory: jest.fn().mockResolvedValue({
        messages: history,
        placeholderCounters: { EMAIL: 3 },
      }),
      persistAdmittedUser: jest.fn().mockResolvedValue({ message: persistedUser, replayed: false }),
    };
    const bridge = {
      admitAuthorized: jest.fn().mockResolvedValue(handle),
      sanitize: jest.fn().mockResolvedValue({
        messages: [
          { itemIndex: 0, content: '[PHONE_NUMBER_1]' },
          { itemIndex: 1, content: '[EMAIL_4]' },
        ],
        policyDigest: CURRENT_POLICY_DIGEST,
      }),
    };
    const service = serviceWith({
      store,
      bridge,
      registry,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    const prepared = await service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: 'new@example.com',
      usageIntent: { maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'exact' },
    });

    expect(bridge.sanitize).toHaveBeenCalledWith(handle, {
      messages: [
        { role: 'user', content: '010-1234-5678' },
        { role: 'user', content: 'new@example.com' },
      ],
      placeholderCounters: { EMAIL: 3 },
    });
    expect(store.persistAdmittedUser).toHaveBeenCalledWith(
      { tenantId: authorized().tenantId, userId: authorized().userId },
      reserved,
      '[EMAIL_4]',
      CURRENT_POLICY_DIGEST,
      handle,
      [{ messageId: history[1]!.id, content: '[PHONE_NUMBER_1]' }],
      CURRENT_POLICY_DIGEST,
    );
    expect(prepared).toMatchObject({
      kind: 'execute',
      userMessage: persistedUser,
      messages: [
        { role: 'user', content: '[EMAIL_3]', safety: { status: 'sanitized', policyDigest: OLD_POLICY_DIGEST } },
        { role: 'user', content: '[PHONE_NUMBER_1]', safety: { status: 'sanitized', policyDigest: CURRENT_POLICY_DIGEST } },
        { role: 'assistant', content: '확인', safety: { status: 'provider_generated' } },
        { role: 'user', content: '[EMAIL_4]', safety: { status: 'sanitized', policyDigest: CURRENT_POLICY_DIGEST } },
      ],
    });
    if (prepared.kind !== 'execute') throw new Error('Expected an executable turn.');
    expect(JSON.stringify({ messages: prepared.messages, userMessage: prepared.userMessage }))
      .not.toContain('new@example.com');
    expect(JSON.stringify({ messages: prepared.messages, userMessage: prepared.userMessage }))
      .not.toContain('010-1234-5678');
    registry.release(reserved.turnId, handle);
  });

  it('reuses an already-sanitized current message on an idempotent retry', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = reservedTurn('user_persisted', true);
    const handle = Object.freeze({ admissionId: 'admission' } as AdmissionHandle);
    const persistedUser = userMessage('[EMAIL_1]');
    const existingCurrent = Object.freeze({
      id: persistedUser.id,
      turnId: persistedUser.turnId,
      role: 'user' as const,
      content: persistedUser.content,
      safetyStatus: 'sanitized' as const,
      safetyPolicyDigest: OLD_POLICY_DIGEST,
    });
    const store = {
      reserveTurn: jest.fn().mockResolvedValue(reserved),
      readCurrentUserSafety: jest.fn().mockResolvedValue(existingCurrent),
      completionHistory: jest.fn().mockResolvedValue({ messages: [], placeholderCounters: {} }),
      persistAdmittedUser: jest.fn().mockResolvedValue({ message: persistedUser, replayed: true }),
    };
    const bridge = {
      admitAuthorized: jest.fn().mockResolvedValue(handle),
      sanitize: jest.fn(),
    };
    const service = serviceWith({
      store,
      bridge,
      registry,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    const prepared = await service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: 'retry@example.com',
      usageIntent: { maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'exact' },
    });

    expect(bridge.sanitize).not.toHaveBeenCalled();
    expect(store.completionHistory).toHaveBeenCalledWith(
      { tenantId: authorized().tenantId, userId: authorized().userId },
      reserved.conversationId,
      Buffer.byteLength('[EMAIL_1]'),
    );
    expect(store.persistAdmittedUser).toHaveBeenCalledWith(
      { tenantId: authorized().tenantId, userId: authorized().userId },
      reserved,
      '[EMAIL_1]',
      OLD_POLICY_DIGEST,
      handle,
      [],
      OLD_POLICY_DIGEST,
    );
    expect(prepared).toMatchObject({
      kind: 'execute',
      userMessage: persistedUser,
      messages: [{
        role: 'user',
        content: '[EMAIL_1]',
        safety: { status: 'sanitized', policyDigest: OLD_POLICY_DIGEST },
      }],
    });
    if (prepared.kind !== 'execute') throw new Error('Expected an executable turn.');
    expect(JSON.stringify({ messages: prepared.messages, userMessage: prepared.userMessage }))
      .not.toContain('retry@example.com');
    registry.release(reserved.turnId, handle);
  });

  it('marks a safety-blocked turn failed without cancelling the consumed admission', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = reservedTurn('pending_admission');
    const handle = Object.freeze({ admissionId: 'admission' } as AdmissionHandle);
    const store = {
      reserveTurn: jest.fn().mockResolvedValue(reserved),
      completionHistory: jest.fn().mockResolvedValue({ messages: [], placeholderCounters: {} }),
      persistAdmittedUser: jest.fn(),
      markTerminalFailure: jest.fn().mockResolvedValue(undefined),
      cancelTurn: jest.fn(),
    };
    const bridge = {
      admitAuthorized: jest.fn().mockResolvedValue(handle),
      sanitize: jest.fn().mockRejectedValue(new PrivateGatewayError('CHAT_SAFETY_BLOCKED', 403)),
      cancel: jest.fn(),
    };
    const service = serviceWith({
      store,
      bridge,
      registry,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    await expect(service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: 'blocked@example.com',
      usageIntent: { maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'exact' },
    })).rejects.toMatchObject({ status: 403 });

    expect(store.markTerminalFailure).toHaveBeenCalledWith(
      { tenantId: authorized().tenantId, userId: authorized().userId },
      reserved.turnId,
      'CHAT_SAFETY_BLOCKED',
    );
    expect(store.persistAdmittedUser).not.toHaveBeenCalled();
    expect(store.cancelTurn).not.toHaveBeenCalled();
    expect(bridge.cancel).not.toHaveBeenCalled();
  });

  it('records a terminal safety block even when the reservation is an idempotent replay', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = reservedTurn('pending_admission', true);
    const handle = Object.freeze({ admissionId: 'admission' } as AdmissionHandle);
    const store = {
      reserveTurn: jest.fn().mockResolvedValue(reserved),
      completionHistory: jest.fn().mockResolvedValue({ messages: [], placeholderCounters: {} }),
      markTerminalFailure: jest.fn().mockResolvedValue(undefined),
      cancelTurn: jest.fn(),
    };
    const bridge = {
      admitAuthorized: jest.fn().mockResolvedValue(handle),
      sanitize: jest.fn().mockRejectedValue(
        new PrivateGatewayError('CHAT_SAFETY_BLOCKED', 403),
      ),
      cancel: jest.fn(),
    };
    const service = serviceWith({
      store,
      bridge,
      registry,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    await expect(service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: 'blocked@example.com',
      usageIntent: { maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'exact' },
    })).rejects.toMatchObject({ status: 403 });

    expect(store.markTerminalFailure).toHaveBeenCalledWith(
      { tenantId: authorized().tenantId, userId: authorized().userId },
      reserved.turnId,
      'CHAT_SAFETY_BLOCKED',
    );
    expect(store.cancelTurn).not.toHaveBeenCalled();
    expect(bridge.cancel).not.toHaveBeenCalled();
  });

  it('does not terminally mutate a shared turn when an idempotent contender loses', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = reservedTurn('user_persisted', true);
    const handle = Object.freeze({ admissionId: 'admission' } as AdmissionHandle);
    const store = {
      reserveTurn: jest.fn().mockResolvedValue(reserved),
      readCurrentUserSafety: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000401',
        turnId: reserved.turnId,
        role: 'user',
        content: 'legacy@example.com',
        safetyStatus: 'legacy_unverified',
        safetyPolicyDigest: null,
      }),
      completionHistory: jest.fn().mockResolvedValue({ messages: [], placeholderCounters: {} }),
      persistAdmittedUser: jest.fn(),
      markTerminalFailure: jest.fn(),
      cancelTurn: jest.fn(),
    };
    const bridge = {
      admitAuthorized: jest.fn().mockResolvedValue(handle),
      sanitize: jest.fn().mockRejectedValue(
        new PrivateGatewayError('CHAT_ADMISSION_EXPIRED', 409),
      ),
      cancel: jest.fn(),
    };
    const service = serviceWith({
      store,
      bridge,
      registry,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    await expect(service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: 'legacy@example.com',
      usageIntent: { maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'exact' },
    })).rejects.toMatchObject({ status: 409 });

    expect(bridge.cancel).not.toHaveBeenCalled();
    expect(store.cancelTurn).not.toHaveBeenCalled();
    expect(store.markTerminalFailure).not.toHaveBeenCalled();
  });

  it('uses only the sanitized current user message when conversation context is disabled', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = reservedTurn('pending_admission');
    const handle = Object.freeze({ admissionId: 'admission' } as AdmissionHandle);
    const policyDigest = `sha256:${'S'.repeat(43)}`;
    const store = {
      reserveTurn: jest.fn().mockResolvedValue(reserved),
      readCurrentUserSafety: jest.fn().mockResolvedValue(null),
      persistAdmittedUser: jest.fn().mockResolvedValue({
        replayed: false,
        message: { content: 'current only' },
      }),
      completionHistory: jest.fn(),
    };
    const bridge = {
      admitAuthorized: jest.fn().mockResolvedValue(handle),
      sanitize: jest.fn().mockResolvedValue({
        messages: [{ role: 'user', content: 'current only' }],
        policyDigest,
      }),
    };
    const service = serviceWith({
      store,
      bridge,
      registry,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    const prepared = await service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: 'current only',
      contextMode: 'single_turn',
      usageIntent: { maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'exact' },
    });

    expect(prepared.kind).toBe('execute');
    if (prepared.kind !== 'execute') throw new Error('Expected an executable turn.');
    expect(store.reserveTurn).toHaveBeenCalledWith(
      { tenantId: authorized().tenantId, userId: authorized().userId },
      reserved.conversationId,
      expect.objectContaining({ contextMode: 'single_turn' }),
    );
    expect(store.completionHistory).not.toHaveBeenCalled();
    expect(bridge.sanitize).toHaveBeenCalledWith(handle, {
      messages: [{ role: 'user', content: 'current only' }],
    });
    expect(prepared.messages).toEqual([{
      role: 'user',
      content: 'current only',
      safety: { status: 'sanitized', policyDigest },
    }]);
    expect(prepared.usageIntent.estimatedInputTokens).toBe(Buffer.byteLength('current only', 'utf8'));
    registry.release(reserved.turnId, handle);
  });

  it('adds sanitized user content and the built RAG context to provider messages', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = { ...reservedTurn('pending_admission'), knowledgeMode: 'tenant' as const };
    const handle = Object.freeze({ admissionId: 'admission' } as AdmissionHandle);
    const policyDigest = `sha256:${'A'.repeat(43)}`;
    const userMessage = { ...assistantMessage(), role: 'user' as const, content: 'leave policy?' };
    const ragMessage = Object.freeze({
      role: 'system' as const,
      purpose: 'rag_context' as const,
      content: 'safe RAG context',
    });
    const store = {
      reserveTurn: jest.fn().mockResolvedValue(reserved),
      persistAdmittedUser: jest.fn().mockResolvedValue({ message: userMessage, replayed: false }),
      completionHistory: jest.fn().mockResolvedValue({ messages: [], placeholderCounters: {} }),
    };
    const retrieval = { retrieve: jest.fn().mockResolvedValue([{ chunkId: 'chunk' }]) };
    const ragContext = {
      build: jest.fn().mockReturnValue({
        message: ragMessage,
        sources: [{ id: 'S1' }],
        citationSources: [],
      }),
    };
    const bridge = {
      admitAuthorized: jest.fn().mockResolvedValue(handle),
      sanitize: jest.fn().mockResolvedValue({
        messages: [{ itemIndex: 0, content: 'leave policy?' }],
        policyDigest,
      }),
    };
    const service = serviceWith({
      store, bridge, registry, retrieval, ragContext,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    const prepared = await service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: 'leave policy?',
      usageIntent: { maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'exact' },
    });

    expect(prepared).toMatchObject({
      kind: 'execute',
      messages: [
        ragMessage,
        {
          role: 'user',
          content: 'leave policy?',
          safety: { status: 'sanitized', policyDigest },
        },
      ],
    });
    if (prepared.kind !== 'execute') throw new Error('Expected an executable turn.');
    expect(prepared.usageIntent).toEqual(expect.objectContaining({
      estimatedInputTokens: Buffer.byteLength('safe RAG contextleave policy?', 'utf8'),
      cacheStrategy: 'off',
    }));
    expect(retrieval.retrieve).toHaveBeenCalledWith(authorized(), 'leave policy?');
    expect(bridge.sanitize).toHaveBeenCalledTimes(2);
    registry.release(reserved.turnId, handle);
  });

  it('sanitizes the RAG query before retrieval and stores only the safe no-evidence turn', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = { ...reservedTurn('pending_admission'), knowledgeMode: 'tenant' as const };
    const handle = Object.freeze({ admissionId: 'admission' } as AdmissionHandle);
    const message = assistantMessage();
    const userMessage = { ...message, role: 'user' as const, content: '[PERSON_1]' };
    const policyDigest = `sha256:${'A'.repeat(43)}`;
    const store = {
      reserveTurn: jest.fn().mockResolvedValue(reserved),
      persistRagNoEvidence: jest.fn().mockResolvedValue({ message, userMessage }),
    };
    const bridge = {
      admitAuthorized: jest.fn().mockResolvedValue(handle),
      sanitize: jest.fn().mockResolvedValue({
        messages: [{ itemIndex: 0, content: '[PERSON_1]' }],
        policyDigest,
      }),
      cancel: jest.fn().mockResolvedValue({ state: 'cancelled' }),
      complete: jest.fn(),
    };
    const retrieval = { retrieve: jest.fn().mockResolvedValue([]) };
    const service = serviceWith({
      store, bridge, registry, retrieval,
      ragContext: { build: jest.fn().mockReturnValue({ sources: [], message: {} }) },
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    await expect(service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: '?띻만?숈쓽 臾몄꽌??',
      usageIntent: { maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'exact' },
    })).resolves.toMatchObject({ kind: 'local', message, userMessage });
    expect(retrieval.retrieve).toHaveBeenCalledWith(expect.anything(), '[PERSON_1]');
    expect(store.persistRagNoEvidence).toHaveBeenCalledWith(
      expect.anything(), reserved, '[PERSON_1]', policyDigest,
      '등록된 문서에서 관련 근거를 찾지 못했습니다.',
    );
    expect(bridge.admitAuthorized).toHaveBeenCalled();
    expect(bridge.sanitize).toHaveBeenCalled();
    expect(bridge.cancel).toHaveBeenCalledWith(handle);
    expect(bridge.complete).not.toHaveBeenCalled();
  });

  it('cleans up the last admitted attachment when history preparation fails', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = reservedTurn('pending_admission');
    const handle = Object.freeze({ admissionId: 'admission' } as AdmissionHandle);
    const store = {
      reserveTurn: jest.fn().mockResolvedValue(reserved),
      persistAdmittedUser: jest.fn().mockResolvedValue({ replayed: false }),
      completionHistory: jest.fn().mockRejectedValue(new Error('history failed')),
      cancelTurn: jest.fn().mockResolvedValue({ cancelled: true }),
    };
    const bridge = {
      admitAuthorized: jest.fn().mockResolvedValue(handle),
      cancel: jest.fn().mockResolvedValue({ state: 'cancelled' }),
    };
    const service = serviceWith({
      store,
      bridge,
      registry,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    await expect(service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: 'abc',
      usageIntent: { maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'exact' },
    })).rejects.toMatchObject({ status: 500 });

    expect(bridge.cancel).toHaveBeenCalledWith(handle);
    expect(store.cancelTurn).toHaveBeenCalledWith(
      { tenantId: authorized().tenantId, userId: authorized().userId },
      reserved.conversationId,
      reserved.turnId,
    );
    const replacement = registry.reserve(reserved.turnId, 1);
    expect(registry.releaseReservation(reserved.turnId, replacement)).toBe(true);
  });

  it('rejects an excess attachment before creating another admission', async () => {
    const registry = new ActiveTurnRegistry();
    const reserved = reservedTurn('pending_admission');
    const occupied = registry.reserve(reserved.turnId, 1);
    const store = { reserveTurn: jest.fn().mockResolvedValue(reserved) };
    const bridge = { admitAuthorized: jest.fn() };
    const service = serviceWith({
      store,
      bridge,
      registry,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
      maximumAttachmentsPerTurn: 1,
    });

    await expect(service.prepareTurn('access', reserved.conversationId, {
      idempotencyKey: reserved.idempotencyKey,
      content: 'abc',
      usageIntent: { maxOutputTokens: 64, requestedTier: 'standard', cacheStrategy: 'exact' },
    })).rejects.toMatchObject({ status: 429 });
    expect(bridge.admitAuthorized).not.toHaveBeenCalled();
    registry.releaseReservation(reserved.turnId, occupied);
  });
});

describe('ConversationService knowledge mode updates', () => {
  it('verifies the tenant RAG feature before persisting a tenant-mode update', async () => {
    const registry = new ActiveTurnRegistry();
    const updated = Object.freeze({ id: 'conversation', knowledgeMode: 'tenant' as const });
    const store = { updateConversation: jest.fn().mockResolvedValue(updated) };
    const retrieval = { assertTenantEnabled: jest.fn().mockResolvedValue(undefined) };
    const service = serviceWith({
      store,
      bridge: {},
      registry,
      retrieval,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    await expect(service.update('access', 'conversation', {
      expectedVersion: 3,
      knowledgeMode: 'tenant',
    })).resolves.toBe(updated);

    expect(retrieval.assertTenantEnabled).toHaveBeenCalledWith(authorized().tenantId);
    expect(store.updateConversation).toHaveBeenCalledWith(
      { tenantId: authorized().tenantId, userId: authorized().userId },
      'conversation',
      { expectedVersion: 3, knowledgeMode: 'tenant' },
    );
  });

  it('does not consult RAG availability when returning an owned conversation to normal mode', async () => {
    const registry = new ActiveTurnRegistry();
    const store = { updateConversation: jest.fn().mockResolvedValue({ id: 'conversation', knowledgeMode: 'off' }) };
    const retrieval = { assertTenantEnabled: jest.fn() };
    const service = serviceWith({
      store,
      bridge: {},
      registry,
      retrieval,
      sessions: { authorizeExecution: jest.fn().mockResolvedValue(authorized()) },
    });

    await service.update('access', 'conversation', { expectedVersion: 3, knowledgeMode: 'off' });

    expect(retrieval.assertTenantEnabled).not.toHaveBeenCalled();
  });

  it('rejects an update with no mutable conversation fields', async () => {
    const registry = new ActiveTurnRegistry();
    const store = { updateConversation: jest.fn() };
    const service = serviceWith({
      store,
      bridge: {},
      registry,
      sessions: { authorizeExecution: jest.fn() },
    });

    await expect(service.update('access', 'conversation', { expectedVersion: 3 }))
      .rejects.toMatchObject({ status: 400 });
    expect(store.updateConversation).not.toHaveBeenCalled();
  });
});

function serviceWith(input: {
  store: object;
  bridge: object;
  registry: ActiveTurnRegistry;
  sessions?: object;
  retrieval?: object;
  ragContext?: object;
  maximumAttachmentsPerTurn?: number;
}): ConversationService {
  const values: Record<string, number> = {
    TENANT_CHAT_HISTORY_RETENTION_DAYS: 30,
    TENANT_CHAT_ASSISTANT_MAX_BYTES: 1024 * 1024,
    TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN: input.maximumAttachmentsPerTurn ?? 4,
  };
  const config = {
    getOrThrow: (name: string) => values[name],
  } as ConfigService;
  return new ConversationService(
    config,
    (input.sessions ?? {}) as never,
    input.store as never,
    input.bridge as never,
    input.registry,
    (input.retrieval ?? {}) as never,
    (input.ragContext ?? {}) as never,
  );
}

function execution(
  registry: ActiveTurnRegistry,
  admissionId: string,
): Extract<PreparedTurn, { kind: 'execute' }> {
  const handle = Object.freeze({ admissionId } as AdmissionHandle);
  const turnId = '00000000-0000-4000-8000-000000000301';
  return Object.freeze({
    kind: 'execute' as const,
    actor: Object.freeze({
      tenantId: '00000000-0000-4000-8000-000000000100',
      userId: '00000000-0000-4000-8000-000000000200',
    }),
    reserved: Object.freeze({
      conversationId: '00000000-0000-4000-8000-000000000300',
      turnId,
      requestId: '00000000-0000-4000-8000-000000000302',
      idempotencyKey: 'idempotency-key',
      cacheEpoch: 1n,
      knowledgeMode: 'off' as const,
      state: 'user_persisted',
      replayed: false,
    }),
    handle,
    messages: Object.freeze([]),
    userMessage: userMessage(),
    usageIntent: Object.freeze({
      estimatedInputTokens: 1,
      maxOutputTokens: 1,
      requestedTier: 'standard' as const,
      cacheStrategy: 'exact' as const,
    }),
    signal: registry.register(turnId, handle, 4),
    citationSources: Object.freeze([]),
  });
}

function userMessage(content = '[EMAIL_1]'): MessageView {
  return Object.freeze({
    id: '00000000-0000-4000-8000-000000000401',
    turnId: '00000000-0000-4000-8000-000000000301',
    role: 'user' as const,
    content,
    sequence: 1,
    createdAt: '2026-07-14T00:00:00.000Z',
  });
}

function assistantMessage(): MessageView {
  return Object.freeze({
    id: '00000000-0000-4000-8000-000000000400',
    turnId: '00000000-0000-4000-8000-000000000301',
    role: 'assistant' as const,
    content: 'delta',
    effectiveModelKey: 'mock',
    sequence: 2,
    createdAt: '2026-07-14T00:00:00.000Z',
  });
}

function completion(
  assistantContent: string,
  cacheOutcome: 'hit' | 'miss' = 'miss',
): CompletionResult {
  return Object.freeze({
    assistantContent,
    final: Object.freeze({
      type: 'tenant_chat.final' as const,
      schemaVersion: 1 as const,
      requestId: '00000000-0000-4000-8000-000000000302',
      turnId: '00000000-0000-4000-8000-000000000301',
      sequence: 2,
      terminalOutcome: 'succeeded' as const,
      effectiveModelKey: 'mock',
      usage: Object.freeze({
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        usageQuality: 'confirmed' as const,
      }),
      quotaState: 'normal' as const,
      budgetState: 'normal' as const,
      cacheOutcome,
      replayed: false,
    }),
  });
}

function reservedTurn(state: string, replayed = false) {
  return Object.freeze({
    conversationId: '00000000-0000-4000-8000-000000000300',
    turnId: '00000000-0000-4000-8000-000000000301',
    requestId: '00000000-0000-4000-8000-000000000302',
    idempotencyKey: 'idempotency-key',
    cacheEpoch: 1n,
    knowledgeMode: 'off' as const,
    state,
    replayed,
  });
}

function authorized() {
  return Object.freeze({
    actorAuthzVersion: 1,
    actorKind: 'employee' as const,
    employeeId: '00000000-0000-4000-8000-000000000201',
    sessionId: 'session',
    sessionVersion: 1,
    tenantAuthzVersion: 1,
    tenantId: '00000000-0000-4000-8000-000000000100',
    userId: '00000000-0000-4000-8000-000000000200',
  });
}

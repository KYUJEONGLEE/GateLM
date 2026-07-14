import type { ConfigService } from '@nestjs/config';

import type { AdmissionHandle, CompleteOptions, CompletionResult } from '@/execution/execution.types';

import { ActiveTurnRegistry } from './active-turn-registry';
import { ConversationService, type PreparedTurn } from './conversation.service';
import type { MessageView } from './encrypted-chat-store';

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

    await expect(secondResult).resolves.toEqual({ message, replayed: false });
    expect(providerFinished).toBe(true);
    expect(firstSettled).toBe(false);
    expect(bridge.complete).toHaveBeenCalledTimes(1);
    expect(store.persistAssistant).toHaveBeenCalledTimes(1);

    releaseSlow();
    await expect(firstResult).resolves.toEqual({ message, replayed: false });
  });
});

function serviceWith(input: {
  store: object;
  bridge: object;
  registry: ActiveTurnRegistry;
}): ConversationService {
  const values: Record<string, number> = {
    TENANT_CHAT_HISTORY_RETENTION_DAYS: 30,
    TENANT_CHAT_ASSISTANT_MAX_BYTES: 1024 * 1024,
    TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN: 4,
  };
  const config = {
    getOrThrow: (name: string) => values[name],
  } as ConfigService;
  return new ConversationService(
    config,
    {} as never,
    input.store as never,
    input.bridge as never,
    input.registry,
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
      state: 'user_persisted',
      replayed: false,
    }),
    handle,
    messages: Object.freeze([]),
    usageIntent: Object.freeze({
      estimatedInputTokens: 1,
      maxOutputTokens: 1,
      requestedTier: 'standard' as const,
      cacheStrategy: 'exact' as const,
    }),
    signal: registry.register(turnId, handle, 4),
  });
}

function assistantMessage(): MessageView {
  return Object.freeze({
    id: '00000000-0000-4000-8000-000000000400',
    turnId: '00000000-0000-4000-8000-000000000301',
    role: 'assistant' as const,
    content: 'delta',
    sequence: 2,
    createdAt: '2026-07-14T00:00:00.000Z',
  });
}

function completion(assistantContent: string): CompletionResult {
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
      cacheOutcome: 'miss' as const,
      replayed: false,
    }),
  });
}

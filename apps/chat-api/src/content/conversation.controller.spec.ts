import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';

import { ConversationController } from './conversation.controller';
import type { PreparedTurn } from './conversation.service';

describe('ConversationController SSE cleanup', () => {
  it('removes the losing close listener after response backpressure drains', async () => {
    const prepared = replay();
    const conversations = {
      prepareTurn: jest.fn().mockResolvedValue(prepared),
      disconnect: jest.fn().mockResolvedValue(undefined),
      streamError: jest.fn(),
    };
    const controller = new ConversationController(conversations as never);
    const response = testResponse();
    response.write.mockReturnValueOnce(false).mockReturnValue(true);

    const turning = controller.turn(
      'access',
      { conversationId: prepared.reserved.conversationId },
      {} as never,
      request(),
      response as unknown as Response,
    );
    await waitUntil(() => response.listenerCount('drain') === 1);
    expect(response.listenerCount('close')).toBe(2);

    response.emit('drain');
    await turning;

    expect(response.listenerCount('drain')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
    expect(conversations.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects an admitted turn when SSE setup fails before execution', async () => {
    const prepared = execution();
    const conversations = {
      prepareTurn: jest.fn().mockResolvedValue(prepared),
      executeTurn: jest.fn(),
      disconnect: jest.fn().mockResolvedValue(undefined),
      streamError: jest.fn().mockReturnValue({
        code: 'CHAT_INTERNAL_ERROR',
        message: 'The request could not be completed.',
        cancelled: false,
      }),
    };
    const controller = new ConversationController(conversations as never);
    const response = testResponse();
    response.write.mockImplementation(() => {
      throw new Error('write failed');
    });

    await controller.turn(
      'access',
      { conversationId: prepared.reserved.conversationId },
      {} as never,
      request(),
      response as unknown as Response,
    );

    expect(conversations.executeTurn).not.toHaveBeenCalled();
    expect(conversations.disconnect).toHaveBeenCalledTimes(1);
    expect(conversations.disconnect).toHaveBeenCalledWith(prepared);
  });
});

function testResponse(): EventEmitter & {
  destroyed: boolean;
  writableEnded: boolean;
  status: jest.Mock;
  setHeader: jest.Mock;
  flushHeaders: jest.Mock;
  write: jest.Mock;
  end: jest.Mock;
} {
  const response = new EventEmitter() as EventEmitter & {
    destroyed: boolean;
    writableEnded: boolean;
    status: jest.Mock;
    setHeader: jest.Mock;
    flushHeaders: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
  };
  response.destroyed = false;
  response.writableEnded = false;
  response.status = jest.fn().mockReturnValue(response);
  response.setHeader = jest.fn().mockReturnValue(response);
  response.flushHeaders = jest.fn();
  response.write = jest.fn().mockReturnValue(true);
  response.end = jest.fn(() => {
    response.writableEnded = true;
    return response;
  });
  return response;
}

function request(): Request {
  return { socket: { setNoDelay: jest.fn() } } as unknown as Request;
}

function replay(): Extract<PreparedTurn, { kind: 'replay' }> {
  return Object.freeze({
    kind: 'replay' as const,
    actor: actor(),
    reserved: reserved('completed'),
    message: Object.freeze({
      id: '00000000-0000-4000-8000-000000000400',
      turnId: '00000000-0000-4000-8000-000000000301',
      role: 'assistant' as const,
      content: '',
      sequence: 2,
      createdAt: '2026-07-14T00:00:00.000Z',
    }),
  });
}

function execution(): Extract<PreparedTurn, { kind: 'execute' }> {
  return Object.freeze({
    kind: 'execute' as const,
    actor: actor(),
    reserved: reserved('user_persisted'),
    handle: Object.freeze({ admissionId: '00000000-0000-4000-8000-000000000500' }) as never,
    messages: Object.freeze([]),
    usageIntent: Object.freeze({
      estimatedInputTokens: 1,
      maxOutputTokens: 1,
      requestedTier: 'standard' as const,
      cacheStrategy: 'exact' as const,
    }),
    signal: new AbortController().signal,
  });
}

function actor() {
  return Object.freeze({
    tenantId: '00000000-0000-4000-8000-000000000100',
    userId: '00000000-0000-4000-8000-000000000200',
  });
}

function reserved(state: string) {
  return Object.freeze({
    conversationId: '00000000-0000-4000-8000-000000000300',
    turnId: '00000000-0000-4000-8000-000000000301',
    requestId: '00000000-0000-4000-8000-000000000302',
    idempotencyKey: 'idempotency-key',
    cacheEpoch: 1n,
    state,
    replayed: false,
  });
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for listener registration.');
}

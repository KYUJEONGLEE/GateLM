import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeTurnSse,
  conversationPage,
  createConversationBody,
  createTurnBody,
  messagePage,
  parseIfMatch,
  parsePageQuery,
  strongestPolicyState,
} from './src/lib/conversation-contract.mjs';

const conversationId = '00000000-0000-4000-8000-000000000300';
const turnId = '00000000-0000-4000-8000-000000000301';
const messageId = '00000000-0000-4000-8000-000000000400';

test('conversation inputs reject browser-provided scope and unknown keys', () => {
  assert.throws(() => createConversationBody({
    idempotencyKey: '1234567890abcdef', title: '새 대화', tenantId: conversationId,
  }));
  assert.throws(() => createTurnBody({
    content: '질문',
    idempotencyKey: '1234567890abcdef',
    usageIntent: { cacheStrategy: 'exact', maxOutputTokens: 1024, requestedTier: 'auto', userId: turnId },
  }));
  assert.throws(() => parsePageQuery('https://chat.test/api?limit=20&limit=30', 50, 20));
  assert.throws(() => parseIfMatch('1'));
  assert.throws(() => createTurnBody({
    content: 'x'.repeat(20_001),
    idempotencyKey: '1234567890abcdef',
    usageIntent: { cacheStrategy: 'exact', maxOutputTokens: 1024, requestedTier: 'auto' },
  }));
});

test('success response shaping rejects tenant or user scope fields', () => {
  assert.throws(() => conversationPage({
    items: [{
      id: conversationId,
      title: '새 대화',
      version: 1,
      historyRetentionDays: 30,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      tenantId: conversationId,
    }],
    nextCursor: null,
  }));
});

test('policy reducer uses the most severe bounded state', () => {
  assert.equal(strongestPolicyState('warning', 'normal'), 'warning');
  assert.equal(strongestPolicyState('economy', 'warning'), 'economy');
  assert.equal(strongestPolicyState('normal', 'blocked'), 'blocked');
});

test('history accepts bounded assistant model metadata and rejects it on user messages', () => {
  const assistant = messagePage({
    items: [{
      id: messageId,
      turnId,
      role: 'assistant',
      content: 'answer',
      effectiveModelKey: 'gpt-5.4-mini',
      sequence: 2,
      createdAt: '2026-07-15T00:00:00.000Z',
    }],
    nextCursor: null,
  });
  assert.equal(assistant.items[0].effectiveModelKey, 'gpt-5.4-mini');
  assert.throws(() => messagePage({
    items: [{ ...assistant.items[0], role: 'user' }],
    nextCursor: null,
  }));
});

test('SSE parser enforces accepted, contiguous deltas, and one terminal event', async () => {
  const deltas = [];
  const terminal = await consumeTurnSse(stream([
    frame('chat.turn.accepted', 1, { replayed: false }),
    frame('chat.turn.delta', 2, { delta: '안녕' }),
    frame('chat.turn.final', 3, {
      messageId,
      terminalOutcome: 'succeeded',
      effectiveModelKey: 'gpt-5.4-mini',
      quotaState: 'economy',
      budgetState: 'warning',
      replayed: false,
    }),
  ]), { conversationId, onDelta: (delta) => deltas.push(delta) });
  assert.deepEqual(deltas, ['안녕']);
  assert.equal(terminal.type, 'chat.turn.final');
  assert.equal(terminal.quotaState, 'economy');
  assert.equal(terminal.effectiveModelKey, 'gpt-5.4-mini');
});

test('SSE parser rejects invalid effective model metadata', async () => {
  await assert.rejects(() => consumeTurnSse(stream([
    frame('chat.turn.accepted', 1, { replayed: false }),
    frame('chat.turn.final', 2, {
      messageId,
      terminalOutcome: 'succeeded',
      effectiveModelKey: '<provider raw>',
      replayed: false,
    }),
  ]), { conversationId }));
});

test('SSE parser rejects gaps, mismatched ids, and oversized frames', async () => {
  await assert.rejects(() => consumeTurnSse(stream([
    frame('chat.turn.accepted', 1, { replayed: false }),
    frame('chat.turn.delta', 3, { delta: 'gap' }),
  ]), { conversationId }));
  await assert.rejects(() => consumeTurnSse(stream([
    frame('chat.turn.accepted', 1, { replayed: false }).replace(`${turnId}:1`, `${turnId}:2`),
  ]), { conversationId }));
  await assert.rejects(() => consumeTurnSse(stream([`event: chat.turn.delta\ndata: ${'x'.repeat(70_000)}\n\n`]), { conversationId }));
  await assert.rejects(() => consumeTurnSse(stream([
    `: ${'한'.repeat(30_000)}\n\n`,
  ]), { conversationId }), { message: 'SSE frame limit exceeded.' });
});

test('SSE parser cancels the upstream reader after a malformed sequence', async () => {
  const encoder = new TextEncoder();
  let cancelled = false;
  const malformedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode([
        frame('chat.turn.accepted', 1, { replayed: false }),
        frame('chat.turn.delta', 3, { delta: 'gap' }),
      ].join('')));
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(() => consumeTurnSse(malformedStream, { conversationId }));
  assert.equal(cancelled, true);
});

function frame(type, sequence, extra) {
  const event = { type, schemaVersion: 1, conversationId, turnId, sequence, ...extra };
  return `id: ${turnId}:${sequence}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function stream(parts) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

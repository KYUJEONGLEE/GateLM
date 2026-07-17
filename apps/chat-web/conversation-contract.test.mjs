import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  consumeTurnSse,
  conversationPage,
  createConversationBody,
  createTurnBody,
  isBlockedCode,
  MAX_TENANT_CHAT_OUTPUT_TOKENS,
  messagePage,
  parseIfMatch,
  parsePageQuery,
  safeChatError,
  strongestPolicyState,
} from './src/lib/conversation-contract.mjs';

const conversationId = '00000000-0000-4000-8000-000000000300';
const turnId = '00000000-0000-4000-8000-000000000301';
const messageId = '00000000-0000-4000-8000-000000000400';
const userMessageId = '00000000-0000-4000-8000-000000000401';

function accepted(extra = {}) {
  return frame('chat.turn.accepted', 1, {
    replayed: false,
    userContent: '연락처는 [EMAIL_1]입니다.',
    userMessageId,
    ...extra,
  });
}

test('conversation inputs reject browser-provided scope and unknown keys', () => {
  assert.throws(() => createConversationBody({
    idempotencyKey: '1234567890abcdef', title: '새 대화', tenantId: conversationId,
  }));
  assert.throws(() => createConversationBody({
    idempotencyKey: '1234567890abcdef', knowledgeBaseId: conversationId, title: '새 대화',
  }));
  assert.throws(() => createConversationBody({
    idempotencyKey: '1234567890abcdef', knowledgeMode: 'global', title: '새 대화',
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
  assert.throws(() => createTurnBody({
    content: '질문',
    contextMode: 'all_history',
    idempotencyKey: '1234567890abcdef',
    usageIntent: { cacheStrategy: 'exact', maxOutputTokens: 1024, requestedTier: 'auto' },
  }));
});

test('conversation knowledge mode defaults off and accepts only an explicit tenant mode', () => {
  const base = { idempotencyKey: '1234567890abcdef', title: '새 대화' };
  assert.equal(createConversationBody(base).knowledgeMode, 'off');
  assert.equal(createConversationBody({ ...base, knowledgeMode: 'tenant' }).knowledgeMode, 'tenant');
});

test('turn context mode defaults to conversation and accepts single-turn isolation', () => {
  const base = {
    content: '질문',
    idempotencyKey: '1234567890abcdef',
    usageIntent: { cacheStrategy: 'exact', maxOutputTokens: 1024, requestedTier: 'auto' },
  };
  assert.equal(createTurnBody(base).contextMode, 'conversation');
  assert.equal(createTurnBody({ ...base, contextMode: 'single_turn' }).contextMode, 'single_turn');
});

test('turn output token limit matches the public Tenant Chat API limit', () => {
  const base = {
    content: '질문',
    idempotencyKey: '1234567890abcdef',
    usageIntent: { cacheStrategy: 'exact', maxOutputTokens: MAX_TENANT_CHAT_OUTPUT_TOKENS, requestedTier: 'auto' },
  };
  assert.equal(createTurnBody(base).usageIntent.maxOutputTokens, MAX_TENANT_CHAT_OUTPUT_TOKENS);
  assert.throws(() => createTurnBody({
    ...base,
    usageIntent: { ...base.usageIntent, maxOutputTokens: MAX_TENANT_CHAT_OUTPUT_TOKENS + 1 },
  }));
  assert.throws(() => createTurnBody({
    ...base,
    usageIntent: { ...base.usageIntent, maxOutputTokens: 0 },
  }));
});

test('success response shaping rejects tenant or user scope fields', () => {
  const conversation = {
    id: conversationId,
    title: '새 대화',
    knowledgeMode: 'off',
    version: 1,
    historyRetentionDays: 30,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
  assert.throws(() => conversationPage({
    items: [{ ...conversation, tenantId: conversationId }],
    nextCursor: null,
  }));
  assert.throws(() => conversationPage({ items: [{ ...conversation, knowledgeMode: 'global' }], nextCursor: null }));
  const withoutKnowledgeMode = Object.fromEntries(Object.entries(conversation).filter(([key]) => key !== 'knowledgeMode'));
  assert.throws(() => conversationPage({ items: [withoutKnowledgeMode], nextCursor: null }));
});

test('conversation response accepts required knowledge mode and no-retention policy', () => {
  const page = conversationPage({
    items: [{
      id: conversationId,
      title: '새 대화',
      knowledgeMode: 'tenant',
      version: 1,
      historyRetentionDays: 0,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    }],
    nextCursor: null,
  });
  assert.equal(page.items[0].knowledgeMode, 'tenant');
  assert.equal(page.items[0].historyRetentionDays, 0);
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
  const acceptedEvents = [];
  const terminal = await consumeTurnSse(stream([
    accepted(),
    frame('chat.turn.delta', 2, { delta: '안녕' }),
    frame('chat.turn.final', 3, {
      messageId,
      terminalOutcome: 'succeeded',
      effectiveModelKey: 'gpt-5.4-mini',
      cacheOutcome: 'miss',
      quotaState: 'economy',
      budgetState: 'warning',
      replayed: false,
    }),
  ]), {
    conversationId,
    onAccepted: (event) => acceptedEvents.push(event),
    onDelta: (delta) => deltas.push(delta),
  });
  assert.deepEqual(deltas, ['안녕']);
  assert.equal(acceptedEvents[0].userContent, '연락처는 [EMAIL_1]입니다.');
  assert.equal(acceptedEvents[0].userMessageId, userMessageId);
  assert.equal(terminal.type, 'chat.turn.final');
  assert.equal(terminal.quotaState, 'economy');
  assert.equal(terminal.effectiveModelKey, 'gpt-5.4-mini');
  assert.equal(terminal.cacheOutcome, 'miss');
});

test('SSE parser accepts an exact cache hit', async () => {
  const terminal = await consumeTurnSse(stream([
    accepted(),
    frame('chat.turn.final', 2, {
      messageId,
      terminalOutcome: 'succeeded',
      cacheOutcome: 'hit',
      replayed: false,
    }),
  ]), { conversationId });
  assert.equal(terminal.cacheOutcome, 'hit');
  assert.equal(terminal.effectiveModelKey, undefined);
});

test('SSE parser accepts only safe citation metadata and keeps event order', async () => {
  const citation = { sourceId: 'S1', documentId: '00000000-0000-4000-8000-000000000101', displayName: 'Policy.pdf', pageStart: 2, pageEnd: 2, lineStart: null, lineEnd: null, ordinal: 1 };
  let current = [];
  let applyCount = 0;
  const applyCitations = (citations) => {
    current = citations;
    applyCount += 1;
  };
  await consumeTurnSse(stream([
    accepted(),
    frame('chat.turn.sources', 2, { citations: [citation] }),
    frame('chat.turn.delta', 3, { delta: 'Answer [S1] [S999]' }),
    frame('chat.turn.citations', 4, { citations: [citation] }),
    frame('chat.turn.final', 5, { messageId, terminalOutcome: 'succeeded', replayed: false }),
  ]), { conversationId, onSources: applyCitations, onCitations: applyCitations });
  assert.equal(applyCount, 2);
  assert.deepEqual(current, [citation]);

  current = [];
  await consumeTurnSse(stream([
    accepted({ replayed: true }),
    frame('chat.turn.sources', 2, { citations: [citation] }),
    frame('chat.turn.delta', 3, { delta: 'Replay [S1]' }),
    frame('chat.turn.final', 4, { messageId, terminalOutcome: 'succeeded', replayed: true }),
  ]), { conversationId, onSources: applyCitations, onCitations: applyCitations });
  assert.deepEqual(current, [citation]);
  await assert.rejects(() => consumeTurnSse(stream([
    accepted(),
    frame('chat.turn.sources', 2, { citations: [{ ...citation, ciphertext: 'not-safe' }] }),
  ]), { conversationId }));
});

test('ChatShell applies replay sources and final citations through one replace handler', () => {
  const source = readFileSync(new URL('./src/components/chat-shell.tsx', import.meta.url), 'utf8');
  assert.match(source, /onSources:\s*applyCitations/);
  assert.match(source, /onCitations:\s*applyCitations/);
  assert.match(source, /replaceCitations\(message, citations\)/);
});

test('ChatShell defaults new conversations to normal and forwards an explicit knowledge mode', () => {
  const source = readFileSync(new URL('./src/components/chat-shell.tsx', import.meta.url), 'utf8');
  assert.match(source, /useState<KnowledgeMode>\('off'\)/);
  assert.match(source, /knowledgeMode:\s*requestedKnowledgeMode/);
  assert.match(source, /setNewConversationKnowledgeMode\('off'\)/);
});

test('RAG failures use bounded user-safe Korean copy', () => {
  assert.equal(safeChatError({ code: 'CHAT_RAG_DISABLED' }).message, '이 조직에서는 사내 지식 채팅을 사용할 수 없습니다.');
  assert.equal(safeChatError({ code: 'CHAT_RAG_UNAVAILABLE', detail: 'provider secret' }).message, '사내 지식 검색을 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
});

test('employee weekly quota uses the same blocked state with its weekly guidance', () => {
  const error = safeChatError({ code: 'CHAT_EMPLOYEE_WEEKLY_TOKEN_QUOTA_HARD_LIMIT' });

  assert.equal(isBlockedCode(error.code), true);
  assert.equal(error.message, '이번 주 사용 한도에 도달했습니다. 조직 관리자에게 문의해 주세요.');
});

test('blocked quota state keeps the composer available for exact cache hits', () => {
  const shell = readFileSync(new URL('./src/components/chat-shell.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(shell, /creatingConversation \|\| policyState === 'blocked' \|\| !composer\.trim\(\)/);
  assert.doesNotMatch(shell, /disabled=\{policyState === 'blocked'\}/);
  assert.match(shell, /캐시된 동일 질문은 답변을 다시 볼 수 있습니다/);
});

test('SSE parser rejects invalid effective model metadata', async () => {
  await assert.rejects(() => consumeTurnSse(stream([
    accepted(),
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
    accepted(),
    frame('chat.turn.delta', 3, { delta: 'gap' }),
  ]), { conversationId }));
  await assert.rejects(() => consumeTurnSse(stream([
    accepted().replace(`${turnId}:1`, `${turnId}:2`),
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
        accepted(),
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

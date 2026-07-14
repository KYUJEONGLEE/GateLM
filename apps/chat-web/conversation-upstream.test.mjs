import assert from 'node:assert/strict';
import test from 'node:test';

import { assertDoubleSubmitCsrf, assertExactOrigin } from './src/lib/conversation-contract.mjs';
import { ConversationBffError, conversationJson, conversationSse } from './src/lib/conversation-upstream.mjs';
import { fetchWithSessionRefresh } from './src/lib/session-retry.mjs';

const input = Object.freeze({
  accessToken: 'access-secret',
  baseUrl: 'https://chat-api.test',
  method: 'GET',
  path: '/internal/v1/tenant-chat/conversations?limit=20',
  serviceToken: 'service-secret-service-secret-service-secret',
});

test('exact Origin and double-submit CSRF reject missing or mismatched values', () => {
  const valid = new Request('https://chat.test/api', { headers: { origin: 'https://chat.test', 'x-gatelm-csrf': 'same' } });
  assert.doesNotThrow(() => assertExactOrigin(valid, 'https://chat.test'));
  assert.doesNotThrow(() => assertDoubleSubmitCsrf(valid, 'same'));
  assert.throws(() => assertExactOrigin(new Request(valid, { headers: { origin: 'https://chat.test.evil' } }), 'https://chat.test'));
  assert.throws(() => assertDoubleSubmitCsrf(valid, 'different'));
});

test('BFF injects only fixed credentials and does not forward browser scope headers', async () => {
  let captured;
  await conversationJson({
    ...input,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), headers: new Headers(init.headers) };
      return Response.json({ items: [], nextCursor: null });
    },
  });
  assert.equal(captured.url, 'https://chat-api.test/internal/v1/tenant-chat/conversations?limit=20');
  assert.equal(captured.headers.get('x-gatelm-chat-access'), input.accessToken);
  assert.equal(captured.headers.get('x-gatelm-chat-web-service-token'), input.serviceToken);
  assert.equal(captured.headers.get('authorization'), null);
  assert.equal(captured.headers.get('x-tenant-id'), null);
  assert.equal(captured.headers.get('x-user-id'), null);
});

test('missing access, redirects, and provider raw errors fail closed with safe payloads', async () => {
  await assert.rejects(() => conversationJson({ ...input, accessToken: '', fetchImpl: async () => Response.json({}) }), (error) => {
    assert.equal(error.status, 401);
    assert.equal(error.payload.code, 'CHAT_AUTH_REQUIRED');
    return true;
  });
  await assert.rejects(() => conversationJson({ ...input, fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }) }), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.payload.code, 'CHAT_UPSTREAM_INVALID');
    return true;
  });
  await assert.rejects(() => conversationJson({
    ...input,
    fetchImpl: async () => Response.json({ code: 'CHAT_PROVIDER_FAILED', message: 'upstream-sensitive-sentinel' }, { status: 503 }),
  }), (error) => {
    assert.equal(error.payload.code, 'CHAT_PROVIDER_FAILED');
    assert.doesNotMatch(error.payload.message, /upstream-sensitive-sentinel/i);
    return true;
  });
});

test('SSE proxy rejects declared overflow and aborts upstream when browser cancels', async () => {
  await assert.rejects(() => conversationSse({
    ...input,
    body: {},
    fetchImpl: async () => new Response('event: x\n\n', {
      headers: { 'content-length': String(6 * 1024 * 1024), 'content-type': 'text/event-stream' },
    }),
  }), ConversationBffError);

  let upstreamSignal;
  const response = await conversationSse({
    ...input,
    body: {},
    fetchImpl: async (_url, init) => {
      upstreamSignal = init.signal;
      return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([1])); } }), {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(upstreamSignal.aborted, true);
});

test('expired access refreshes once and retries the identical idempotent request body', async () => {
  const requestBody = JSON.stringify({ idempotencyKey: '1234567890abcdef', title: '새 대화' });
  const calls = [];
  const responses = [
    Response.json({ code: 'CHAT_AUTH_REQUIRED' }, { status: 401 }),
    Response.json({ state: 'authenticated' }),
    Response.json({ id: 'created' }),
  ];
  const response = await fetchWithSessionRefresh('/api/tenant-chat/conversations', { body: requestBody, method: 'POST' }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, body: init.body, method: init.method });
      return responses.shift();
    },
    prepare: (value) => value,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/tenant-chat/conversations',
    '/api/tenant-chat/auth/session',
    '/api/tenant-chat/conversations',
  ]);
  assert.equal(calls[0].body, requestBody);
  assert.equal(calls[2].body, requestBody);
});

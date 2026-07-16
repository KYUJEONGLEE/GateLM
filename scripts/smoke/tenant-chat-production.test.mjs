import assert from 'node:assert/strict';
import test from 'node:test';

import { runProductionTenantChatSmoke } from './tenant-chat-production.mjs';

const conversationId = '00000000-0000-4000-8000-000000000300';
const turnId = '00000000-0000-4000-8000-000000000301';
const messageId = '00000000-0000-4000-8000-000000000302';
const session = Object.freeze({
  selectedTenant: {
    actorKind: 'employee',
    employeeId: '00000000-0000-4000-8000-000000000303',
    id: '00000000-0000-4000-8000-000000000304',
    name: 'Smoke tenant',
  },
  state: 'authenticated',
  user: { email: 'smoke@example.com' },
});

test('runs an authenticated turn and removes the smoke conversation', async () => {
  const fake = fakeTenantChat();

  const result = await runProductionTenantChatSmoke({
    email: 'smoke@example.com',
    fetchImpl: fake.fetch,
    origin: 'https://chat.example.com',
    password: 'test-only-password',
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(fake.calls.map((call) => `${call.method} ${call.path}`), [
    'GET /login',
    'POST /api/tenant-chat/auth/login',
    'GET /api/tenant-chat/auth/session',
    'POST /api/tenant-chat/conversations',
    `POST /api/tenant-chat/conversations/${conversationId}/turns`,
    `GET /api/tenant-chat/conversations/${conversationId}`,
    `DELETE /api/tenant-chat/conversations/${conversationId}`,
    'POST /api/tenant-chat/auth/logout',
  ]);
  assert.equal(fake.calls[6].headers.get('if-match'), '"2"');
});

test('fails on a runtime terminal error but still cleans up', async () => {
  const fake = fakeTenantChat('CHAT_RUNTIME_UNAVAILABLE');

  await assert.rejects(
    runProductionTenantChatSmoke({
      email: 'smoke@example.com',
      fetchImpl: fake.fetch,
      origin: 'https://chat.example.com',
      password: 'test-only-password',
    }),
    /CHAT_RUNTIME_UNAVAILABLE/,
  );

  assert.equal(fake.calls.some((call) => call.method === 'DELETE'), true);
  assert.equal(fake.calls.at(-1).path, '/api/tenant-chat/auth/logout');
});

test('rejects a non-HTTPS production origin before making a request', async () => {
  let called = false;
  await assert.rejects(
    runProductionTenantChatSmoke({
      email: 'smoke@example.com',
      fetchImpl: async () => { called = true; },
      origin: 'http://chat.example.com',
      password: 'test-only-password',
    }),
    /HTTPS origin/,
  );
  assert.equal(called, false);
});

function fakeTenantChat(terminalErrorCode) {
  const calls = [];
  return {
    calls,
    fetch: async (input, init = {}) => {
      const url = new URL(input);
      const method = init.method ?? 'GET';
      const headers = new Headers(init.headers);
      calls.push({ headers, method, path: url.pathname });

      if (method === 'GET' && url.pathname === '/login') {
        return json({}, 200, 'gatelm_chat_csrf=csrf-token; Path=/; SameSite=Strict');
      }
      if (method === 'POST' && url.pathname === '/api/tenant-chat/auth/login') {
        assert.deepEqual(JSON.parse(init.body), { email: 'smoke@example.com', password: 'test-only-password' });
        return json(session, 200, [
          'gatelm_chat_access=access-token; Path=/; HttpOnly',
          'gatelm_chat_refresh=refresh-token; Path=/; HttpOnly',
          'gatelm_chat_csrf=csrf-token; Path=/; SameSite=Strict',
        ].join(', '));
      }
      if (method === 'GET' && url.pathname === '/api/tenant-chat/auth/session') return json(session);
      if (method === 'POST' && url.pathname === '/api/tenant-chat/conversations') {
        return json({ id: conversationId, version: 1 }, 201);
      }
      if (method === 'POST' && url.pathname.endsWith('/turns')) {
        return sse(terminalErrorCode);
      }
      if (method === 'GET' && url.pathname === `/api/tenant-chat/conversations/${conversationId}`) {
        return json({ id: conversationId, version: 2 });
      }
      if (method === 'DELETE' && url.pathname === `/api/tenant-chat/conversations/${conversationId}`) {
        return new Response(null, { status: 204 });
      }
      if (method === 'POST' && url.pathname === '/api/tenant-chat/auth/logout') return json({ ok: true });
      return json({ code: 'CHAT_NOT_FOUND' }, 404);
    },
  };
}

function json(value, status = 200, setCookie) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (setCookie) headers.set('set-cookie', setCookie);
  return new Response(JSON.stringify(value), { headers, status });
}

function sse(errorCode) {
  const accepted = {
    conversationId,
    replayed: false,
    schemaVersion: 1,
    sequence: 1,
    turnId,
    type: 'chat.turn.accepted',
  };
  const terminal = errorCode ? {
    conversationId,
    error: { code: errorCode, message: 'Safe error.' },
    schemaVersion: 1,
    sequence: 2,
    turnId,
    type: 'chat.turn.error',
  } : {
    conversationId,
    messageId,
    replayed: false,
    schemaVersion: 1,
    sequence: 2,
    terminalOutcome: 'succeeded',
    turnId,
    type: 'chat.turn.final',
  };
  const body = [accepted, terminal]
    .map((event) => `id: ${turnId}:${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

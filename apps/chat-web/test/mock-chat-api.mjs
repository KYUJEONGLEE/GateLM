import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.CHAT_MOCK_PORT ?? '3003');
const serviceToken = process.env.TENANT_CHAT_WEB_SERVICE_TOKEN;
if (!serviceToken) throw new Error('TENANT_CHAT_WEB_SERVICE_TOKEN is required.');

const accessToken = randomUUID();
const refreshToken = randomUUID();
const userId = randomUUID();
const employeeId = randomUUID();
const tenantId = randomUUID();
const sessionId = randomUUID();
const conversations = [];
const createKeys = new Map();
const messages = new Map();
const activeTurns = new Map();

const session = Object.freeze({
  accessExpiresAt: new Date(Date.now() + 300_000).toISOString(),
  csrfRequired: true,
  refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  selectedTenant: { actorKind: 'employee', employeeId, id: tenantId, name: 'GateLM QA 조직' },
  sessionId,
  sessionVersion: 1,
  state: 'authenticated',
  tenants: [{ actorKind: 'employee', employeeId, id: tenantId, name: 'GateLM QA 조직' }],
  user: { email: 'employee@example.test', id: userId, name: 'QA 직원' },
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (request.headers['x-gatelm-chat-web-service-token'] !== serviceToken) return json(response, 401, { code: 'CHAT_AUTH_REQUIRED' });
    if (url.pathname === '/internal/v1/tenant-chat/auth/password' && request.method === 'POST') {
      await body(request);
      return json(response, 200, issued());
    }
    if (url.pathname === '/internal/v1/tenant-chat/auth/refresh' && request.method === 'POST') {
      if (request.headers['x-gatelm-chat-refresh'] !== refreshToken) return json(response, 401, { code: 'CHAT_AUTH_REQUIRED' });
      return json(response, 200, issued());
    }
    if (url.pathname === '/internal/v1/tenant-chat/auth/session' && request.method === 'GET') {
      if (!authorized(request)) return json(response, 401, { code: 'CHAT_AUTH_REQUIRED' });
      return json(response, 200, session);
    }
    if (!authorized(request)) return json(response, 401, { code: 'CHAT_AUTH_REQUIRED' });

    if (url.pathname === '/internal/v1/tenant-chat/conversations' && request.method === 'GET') {
      return json(response, 200, { items: conversations, nextCursor: null });
    }
    if (url.pathname === '/internal/v1/tenant-chat/conversations' && request.method === 'POST') {
      const input = await body(request);
      const replay = createKeys.get(input.idempotencyKey);
      if (replay) return json(response, 200, replay);
      const now = new Date().toISOString();
      const conversation = { id: randomUUID(), title: input.title, version: 1, historyRetentionDays: 30, createdAt: now, updatedAt: now };
      conversations.unshift(conversation);
      messages.set(conversation.id, []);
      createKeys.set(input.idempotencyKey, conversation);
      return json(response, 201, conversation);
    }

    const match = url.pathname.match(/^\/internal\/v1\/tenant-chat\/conversations\/([0-9a-f-]+)(?:\/(.*))?$/);
    if (!match) return json(response, 404, { code: 'CHAT_CONVERSATION_NOT_FOUND' });
    const conversation = conversations.find(({ id }) => id === match[1]);
    if (!conversation) return json(response, 404, { code: 'CHAT_CONVERSATION_NOT_FOUND' });
    const suffix = match[2] ?? '';

    if (!suffix && request.method === 'GET') return json(response, 200, conversation);
    if (!suffix && request.method === 'PATCH') {
      const input = await body(request);
      if (input.expectedVersion !== conversation.version) return json(response, 409, { code: 'CHAT_CONVERSATION_VERSION_CONFLICT' });
      conversation.title = input.title;
      conversation.version += 1;
      conversation.updatedAt = new Date().toISOString();
      return json(response, 200, conversation);
    }
    if (!suffix && request.method === 'DELETE') {
      if (request.headers['if-match'] !== `"${conversation.version}"`) return json(response, 409, { code: 'CHAT_CONVERSATION_VERSION_CONFLICT' });
      conversations.splice(conversations.indexOf(conversation), 1);
      messages.delete(conversation.id);
      response.writeHead(204, { 'cache-control': 'no-store' });
      return response.end();
    }
    if (suffix === 'messages' && request.method === 'GET') {
      return json(response, 200, { items: messages.get(conversation.id) ?? [], nextCursor: null });
    }
    if (suffix === 'turns' && request.method === 'POST') {
      const input = await body(request);
      if (/blocked/i.test(input.content)) return json(response, 429, { code: 'CHAT_QUOTA_HARD_LIMIT' });
      return streamTurn(response, conversation, input);
    }
    const cancel = suffix.match(/^turns\/([0-9a-f-]+)\/cancel$/);
    if (cancel && request.method === 'POST') {
      const turn = activeTurns.get(cancel[1]);
      if (turn) turn.cancelled = true;
      return json(response, 200, { cancelled: Boolean(turn) });
    }
    return json(response, 404, { code: 'CHAT_CONVERSATION_NOT_FOUND' });
  } catch {
    if (!response.headersSent) return json(response, 400, { code: 'CHAT_INVALID_REQUEST' });
    response.end();
  }
});

server.listen(port, '127.0.0.1', () => process.stdout.write(`Tenant Chat QA mock listening on ${port}.\n`));

function issued() {
  return { accessExpiresAt: session.accessExpiresAt, accessToken, refreshExpiresAt: session.refreshExpiresAt, refreshToken, session };
}

function authorized(request) {
  return request.headers['x-gatelm-chat-access'] === accessToken;
}

async function streamTurn(response, conversation, input) {
  const turnId = randomUUID();
  const userMessage = {
    id: randomUUID(), turnId, role: 'user', content: input.content,
    sequence: (messages.get(conversation.id)?.at(-1)?.sequence ?? 0) + 1,
    createdAt: new Date().toISOString(),
  };
  const assistantMessage = {
    id: randomUUID(), turnId, role: 'assistant', content: '요청을 안전하게 처리한 테스트 답변입니다.',
    sequence: userMessage.sequence + 1,
    createdAt: new Date().toISOString(),
  };
  const turn = { cancelled: false };
  activeTurns.set(turnId, turn);
  response.writeHead(200, {
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
  });
  let sequence = 1;
  writeSse(response, turnId, { type: 'chat.turn.accepted', schemaVersion: 1, conversationId: conversation.id, turnId, sequence, replayed: false });
  const deltas = input.content.toLowerCase().includes('slow')
    ? ['요청을 ', '안전하게 ', '처리한 ', '테스트 ', '답변입니다.']
    : ['요청을 안전하게 처리한 ', '테스트 답변입니다.'];
  for (const delta of deltas) {
    await delay(input.content.toLowerCase().includes('slow') ? 2_000 : 45);
    sequence += 1;
    if (turn.cancelled) {
      writeSse(response, turnId, {
        type: 'chat.turn.cancelled', schemaVersion: 1, conversationId: conversation.id, turnId, sequence,
        error: { code: 'CHAT_REQUEST_CANCELLED', message: 'cancelled' },
      });
      activeTurns.delete(turnId);
      return response.end();
    }
    writeSse(response, turnId, { type: 'chat.turn.delta', schemaVersion: 1, conversationId: conversation.id, turnId, sequence, delta });
  }
  if (/safety/i.test(input.content)) {
    sequence += 1;
    writeSse(response, turnId, {
      type: 'chat.turn.error', schemaVersion: 1, conversationId: conversation.id, turnId, sequence,
      error: { code: 'CHAT_SAFETY_BLOCKED', message: 'Request blocked.' },
    });
  } else {
    messages.get(conversation.id).push(userMessage, assistantMessage);
    conversation.updatedAt = new Date().toISOString();
    sequence += 1;
    writeSse(response, turnId, {
      type: 'chat.turn.final', schemaVersion: 1, conversationId: conversation.id, turnId, sequence,
      messageId: assistantMessage.id, terminalOutcome: 'succeeded',
      quotaState: input.content.toLowerCase().includes('economy') ? 'economy' : 'normal',
      budgetState: 'normal', replayed: false,
    });
  }
  activeTurns.delete(turnId);
  response.end();
}

function writeSse(response, turnId, event) {
  response.write(`id: ${turnId}:${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

async function body(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > 300_000) throw new Error('too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function json(response, status, payload) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

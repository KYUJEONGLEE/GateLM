import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { consumeTurnSse } from '../../apps/chat-web/src/lib/conversation-contract.mjs';

const SAFE_ERROR_CODE = /^CHAT_[A-Z0-9_]{1,59}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REQUEST_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 120_000;

export async function runProductionTenantChatSmoke({
  email,
  fetchImpl = fetch,
  origin,
  password,
} = {}) {
  const baseUrl = productionOrigin(origin);
  const accountEmail = requiredValue('TENANT_CHAT_SMOKE_EMAIL', email);
  const accountPassword = requiredValue('TENANT_CHAT_SMOKE_PASSWORD', password);
  const jar = new Map();
  let conversationId;
  let failure;

  try {
    const bootstrap = await request(fetchImpl, `${baseUrl}/login`, {
      redirect: 'manual',
    }, REQUEST_TIMEOUT_MS, 'login bootstrap');
    absorbCookies(jar, bootstrap);
    await expectOk(bootstrap, 'login bootstrap');
    requireCookie(jar, 'gatelm_chat_csrf');

    const login = await request(fetchImpl, `${baseUrl}/api/tenant-chat/auth/login`, {
      body: JSON.stringify({ email: accountEmail, password: accountPassword }),
      headers: mutationHeaders(baseUrl, jar),
      method: 'POST',
      redirect: 'manual',
    }, REQUEST_TIMEOUT_MS, 'login');
    absorbCookies(jar, login);
    await expectOk(login, 'login');
    requireCookie(jar, 'gatelm_chat_access');
    requireCookie(jar, 'gatelm_chat_refresh');
    assertAuthenticatedSession(await responseJson(login, 'login'), accountEmail);

    const session = await request(fetchImpl, `${baseUrl}/api/tenant-chat/auth/session`, {
      headers: { cookie: cookieHeader(jar) },
      redirect: 'manual',
    }, REQUEST_TIMEOUT_MS, 'session');
    absorbCookies(jar, session);
    await expectOk(session, 'session');
    assertAuthenticatedSession(await responseJson(session, 'session'), accountEmail);

    const create = await request(fetchImpl, `${baseUrl}/api/tenant-chat/conversations`, {
      body: JSON.stringify({
        idempotencyKey: smokeKey('conversation'),
        title: 'Production deployment smoke',
      }),
      headers: mutationHeaders(baseUrl, jar),
      method: 'POST',
      redirect: 'manual',
    }, REQUEST_TIMEOUT_MS, 'conversation create');
    absorbCookies(jar, create);
    await expectOk(create, 'conversation create');
    const created = await responseJson(create, 'conversation create');
    conversationId = conversationIdentifier(created);

    const turn = await request(fetchImpl, `${baseUrl}/api/tenant-chat/conversations/${conversationId}/turns`, {
      body: JSON.stringify({
        content: 'Reply with OK.',
        contextMode: 'single_turn',
        idempotencyKey: smokeKey('turn'),
        usageIntent: {
          cacheStrategy: 'off',
          maxOutputTokens: 8,
          requestedTier: 'auto',
        },
      }),
      headers: mutationHeaders(baseUrl, jar),
      method: 'POST',
      redirect: 'manual',
    }, TURN_TIMEOUT_MS, 'conversation turn');
    absorbCookies(jar, turn);
    await expectOk(turn, 'conversation turn');
    if (!turn.headers.get('content-type')?.startsWith('text/event-stream')) {
      throw new Error('conversation turn returned an invalid content type');
    }
    const terminal = await consumeTurnSse(turn.body, { conversationId });
    if (terminal.type !== 'chat.turn.final' || terminal.terminalOutcome !== 'succeeded') {
      throw new Error(`conversation turn failed (${safeCode(terminal.error?.code)})`);
    }
  } catch (error) {
    failure = safeError(error);
  }

  if (conversationId) {
    try {
      await deleteConversation(fetchImpl, baseUrl, jar, conversationId);
    } catch (error) {
      failure = combineFailure(failure, safeError(error), 'conversation cleanup failed');
    }
  }

  try {
    await logout(fetchImpl, baseUrl, jar);
  } catch (error) {
    failure = combineFailure(failure, safeError(error), 'logout cleanup failed');
  }

  if (failure) throw failure;
  return Object.freeze({ ok: true });
}

async function deleteConversation(fetchImpl, baseUrl, jar, conversationId) {
  const read = await request(fetchImpl, `${baseUrl}/api/tenant-chat/conversations/${conversationId}`, {
    headers: { cookie: cookieHeader(jar) },
    redirect: 'manual',
  }, REQUEST_TIMEOUT_MS, 'conversation cleanup read');
  absorbCookies(jar, read);
  await expectOk(read, 'conversation cleanup read');
  const conversation = await responseJson(read, 'conversation cleanup read');
  if (!Number.isSafeInteger(conversation.version) || conversation.version < 1) {
    throw new Error('conversation cleanup read returned an invalid version');
  }

  const remove = await request(fetchImpl, `${baseUrl}/api/tenant-chat/conversations/${conversationId}`, {
    headers: {
      ...mutationHeaders(baseUrl, jar, false),
      'if-match': `"${conversation.version}"`,
    },
    method: 'DELETE',
    redirect: 'manual',
  }, REQUEST_TIMEOUT_MS, 'conversation cleanup delete');
  absorbCookies(jar, remove);
  await expectOk(remove, 'conversation cleanup delete');
}

async function logout(fetchImpl, baseUrl, jar) {
  if (!jar.has('gatelm_chat_csrf')) return;
  const response = await request(fetchImpl, `${baseUrl}/api/tenant-chat/auth/logout`, {
    body: '{}',
    headers: mutationHeaders(baseUrl, jar),
    method: 'POST',
    redirect: 'manual',
  }, REQUEST_TIMEOUT_MS, 'logout');
  absorbCookies(jar, response);
  await expectOk(response, 'logout');
}

function mutationHeaders(origin, jar, json = true) {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    cookie: cookieHeader(jar),
    origin,
    'x-gatelm-csrf': requireCookie(jar, 'gatelm_chat_csrf'),
  };
}

async function request(fetchImpl, url, init, timeoutMs, label) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error(`${label} request failed`);
  }
}

async function expectOk(response, label) {
  if (response.ok) return;
  throw new Error(`${label} failed (${response.status}, ${await responseErrorCode(response)})`);
}

async function responseErrorCode(response) {
  try {
    const value = await response.json();
    return safeCode(value?.code);
  } catch {
    return 'CHAT_UNKNOWN_ERROR';
  }
}

async function responseJson(response, label) {
  try {
    const value = await response.json();
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function assertAuthenticatedSession(value, expectedEmail) {
  if (
    value.state !== 'authenticated' ||
    !value.selectedTenant ||
    value.selectedTenant.actorKind !== 'employee' ||
    typeof value.user?.email !== 'string' ||
    value.user.email.toLowerCase() !== expectedEmail.toLowerCase()
  ) {
    throw new Error('authenticated employee session was not established');
  }
}

function conversationIdentifier(value) {
  if (typeof value.id !== 'string' || !UUID_V4.test(value.id)) {
    throw new Error('conversation create returned an invalid identifier');
  }
  return value.id;
}

function productionOrigin(value) {
  const raw = requiredValue('TENANT_CHAT_SMOKE_ORIGIN', value);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('TENANT_CHAT_SMOKE_ORIGIN must be a valid URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('TENANT_CHAT_SMOKE_ORIGIN must be an HTTPS origin without a path');
  }
  return parsed.origin;
}

function requiredValue(name, value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`Missing ${name}`);
  return normalized;
}

function requireCookie(jar, name) {
  const value = jar.get(name);
  if (!value) throw new Error(`required ${name} cookie was not issued`);
  return value;
}

function absorbCookies(jar, response) {
  const headerValues = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : splitCombinedSetCookie(response.headers.get('set-cookie'));
  const values = headerValues.flatMap(splitCombinedSetCookie);
  for (const value of values) {
    const [pair, ...attributes] = value.split(';');
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const cookieValue = pair.slice(separator + 1).trim();
    const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
    if (expired || cookieValue === '') jar.delete(name);
    else jar.set(name, cookieValue);
  }
}

function splitCombinedSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/);
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function smokeKey(kind) {
  return `${kind}_${randomUUID().replaceAll('-', '')}`;
}

function safeCode(value) {
  return typeof value === 'string' && SAFE_ERROR_CODE.test(value) ? value : 'CHAT_UNKNOWN_ERROR';
}

function safeError(error) {
  return error instanceof Error ? error : new Error('Tenant Chat production smoke failed');
}

function combineFailure(primary, cleanup, fallbackMessage) {
  if (!primary) return cleanup;
  return new Error(`${primary.message}; ${fallbackMessage}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await runProductionTenantChatSmoke({
      email: process.env.TENANT_CHAT_SMOKE_EMAIL,
      origin: process.env.TENANT_CHAT_SMOKE_ORIGIN,
      password: process.env.TENANT_CHAT_SMOKE_PASSWORD,
    });
    console.log('Tenant Chat production smoke passed.');
  } catch (error) {
    console.error(safeError(error).message);
    process.exitCode = 1;
  }
}

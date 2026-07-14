import { safeChatError } from './conversation-contract.mjs';

const JSON_LIMIT = 8 * 1024 * 1024;
const SSE_LIMIT = 5 * 1024 * 1024;

export class ConversationBffError extends Error {
  constructor(status, payload) {
    super('Conversation BFF request failed.');
    this.status = status;
    this.payload = safeChatError(payload);
  }
}

export async function conversationJson(input) {
  requireAccess(input.accessToken);
  const controller = linkedController(input.signal);
  const timeout = setTimeout(() => controller.abort('timeout'), input.timeoutMs ?? 5_000);
  try {
    const response = await input.fetchImpl(buildUrl(input.baseUrl, input.path), {
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      cache: 'no-store',
      headers: upstreamHeaders(input, 'application/json'),
      method: input.method,
      redirect: 'manual',
      signal: controller.signal,
    });
    rejectRedirect(response);
    const payload = response.status === 204 ? null : await boundedJson(response, JSON_LIMIT);
    if (!response.ok) throw new ConversationBffError(response.status, withRetry(payload, response));
    return Object.freeze({ payload, status: response.status });
  } catch (error) {
    if (error instanceof ConversationBffError) throw error;
    throw new ConversationBffError(503, { code: 'CHAT_UPSTREAM_UNAVAILABLE' });
  } finally {
    clearTimeout(timeout);
    controller.cleanup();
  }
}

export async function conversationSse(input) {
  requireAccess(input.accessToken);
  const controller = linkedController(input.signal);
  const timeout = setTimeout(() => controller.abort('timeout'), input.timeoutMs ?? 135_000);
  try {
    const response = await input.fetchImpl(buildUrl(input.baseUrl, input.path), {
      body: JSON.stringify(input.body),
      cache: 'no-store',
      headers: upstreamHeaders(input, 'text/event-stream'),
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
    });
    rejectRedirect(response);
    if (!response.ok) {
      const payload = await boundedJson(response, 64 * 1024);
      throw new ConversationBffError(response.status, withRetry(payload, response));
    }
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
    if (contentType !== 'text/event-stream' || !response.body) {
      throw new ConversationBffError(502, { code: 'CHAT_UPSTREAM_INVALID' });
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > SSE_LIMIT) {
      throw new ConversationBffError(502, { code: 'CHAT_RESPONSE_TOO_LARGE' });
    }
    const stream = boundedStream(response.body, SSE_LIMIT, controller, timeout);
    return new Response(stream, {
      headers: {
        'cache-control': 'no-store',
        'content-encoding': 'identity',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      },
      status: 200,
    });
  } catch (error) {
    clearTimeout(timeout);
    controller.cleanup();
    if (error instanceof ConversationBffError) throw error;
    throw new ConversationBffError(503, { code: 'CHAT_UPSTREAM_UNAVAILABLE' });
  }
}

function upstreamHeaders(input, accept) {
  const headers = new Headers({
    accept,
    'x-gatelm-chat-access': input.accessToken,
    'x-gatelm-chat-web-service-token': input.serviceToken,
  });
  if (input.body !== undefined) headers.set('content-type', 'application/json');
  if (input.ifMatch) headers.set('if-match', input.ifMatch);
  return headers;
}

function buildUrl(baseUrl, path) {
  if (typeof path !== 'string' || !path.startsWith('/internal/v1/tenant-chat/conversations')) {
    throw new ConversationBffError(500, { code: 'CHAT_INTERNAL_ERROR' });
  }
  const base = new URL(baseUrl);
  const target = new URL(path, `${base.origin}/`);
  if (target.origin !== base.origin || target.username || target.password) {
    throw new ConversationBffError(500, { code: 'CHAT_INTERNAL_ERROR' });
  }
  return target;
}

function requireAccess(value) {
  if (typeof value !== 'string' || !value) throw new ConversationBffError(401, { code: 'CHAT_AUTH_REQUIRED' });
}

function rejectRedirect(response) {
  if (response.status >= 300 && response.status < 400) {
    throw new ConversationBffError(502, { code: 'CHAT_UPSTREAM_INVALID' });
  }
}

async function boundedJson(response, limit) {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (contentType !== 'application/json') {
    await response.body?.cancel().catch(() => undefined);
    throw new ConversationBffError(502, { code: 'CHAT_UPSTREAM_INVALID' });
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new ConversationBffError(502, { code: 'CHAT_RESPONSE_TOO_LARGE' });
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ConversationBffError(502, { code: 'CHAT_UPSTREAM_INVALID' });
  const chunks = [];
  let total = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      total += value.byteLength;
      if (total > limit) throw new ConversationBffError(502, { code: 'CHAT_RESPONSE_TOO_LARGE' });
      chunks.push(value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
    return parsed;
  } catch {
    throw new ConversationBffError(502, { code: 'CHAT_UPSTREAM_INVALID' });
  }
}

function boundedStream(source, limit, controller, timeout) {
  const reader = source.getReader();
  let total = 0;
  let closed = false;
  const cleanup = async (cancelReader = false) => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    controller.cleanup();
    if (cancelReader) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  };
  return new ReadableStream({
    async pull(destination) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await cleanup();
          destination.close();
          return;
        }
        total += value.byteLength;
        if (total > limit) throw new Error('SSE byte limit exceeded.');
        destination.enqueue(value);
      } catch (error) {
        controller.abort('stream');
        await cleanup(true);
        destination.error(error);
      }
    },
    async cancel() {
      controller.abort('browser-disconnect');
      await cleanup(true);
    },
  });
}

function linkedController(signal) {
  const controller = new AbortController();
  const abort = () => controller.abort('browser-disconnect');
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  controller.cleanup = () => signal?.removeEventListener('abort', abort);
  return controller;
}

function withRetry(payload, response) {
  const retry = Number(response.headers.get('retry-after') ?? '0');
  if (Number.isSafeInteger(retry) && retry >= 1 && retry <= 60 && payload && typeof payload === 'object') {
    return { ...payload, retryAfterSeconds: retry };
  }
  return payload;
}

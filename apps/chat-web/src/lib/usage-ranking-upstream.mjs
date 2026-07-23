import { safeChatError } from './conversation-contract.mjs';

const RESPONSE_LIMIT = 64 * 1024;

export class UsageRankingBffError extends Error {
  constructor(status, payload) {
    super('Usage ranking BFF request failed.');
    this.status = status;
    this.payload = safeChatError(payload);
  }
}

export async function usageRankingJson(input) {
  if (typeof input.accessToken !== 'string' || !input.accessToken) {
    throw new UsageRankingBffError(401, { code: 'CHAT_AUTH_REQUIRED' });
  }
  const controller = linkedController(input.signal);
  const timeout = setTimeout(() => controller.abort('timeout'), input.timeoutMs ?? 5_000);
  try {
    const response = await input.fetchImpl(buildUrl(input.baseUrl, input.path), {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'x-gatelm-chat-access': input.accessToken,
        'x-gatelm-chat-web-service-token': input.serviceToken,
      },
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new UsageRankingBffError(503, { code: 'CHAT_USAGE_UNAVAILABLE' });
    }
    const payload = await boundedJson(response);
    if (!response.ok) throw new UsageRankingBffError(response.status, payload);
    return Object.freeze({ payload, status: response.status });
  } catch (error) {
    if (error instanceof UsageRankingBffError) throw error;
    throw new UsageRankingBffError(503, { code: 'CHAT_USAGE_UNAVAILABLE' });
  } finally {
    clearTimeout(timeout);
    controller.cleanup();
  }
}

function buildUrl(baseUrl, path) {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/internal/v1/tenant-chat/usage-ranking?')
  ) throw new UsageRankingBffError(500, { code: 'CHAT_INTERNAL_ERROR' });
  const base = new URL(baseUrl);
  const target = new URL(path, `${base.origin}/`);
  if (
    target.origin !== base.origin ||
    target.username ||
    target.password ||
    target.pathname !== '/internal/v1/tenant-chat/usage-ranking'
  ) throw new UsageRankingBffError(500, { code: 'CHAT_INTERNAL_ERROR' });
  return target;
}

async function boundedJson(response) {
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (contentType !== 'application/json') {
    await response.body?.cancel().catch(() => undefined);
    throw new UsageRankingBffError(503, { code: 'CHAT_USAGE_UNAVAILABLE' });
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > RESPONSE_LIMIT) {
    await response.body?.cancel().catch(() => undefined);
    throw new UsageRankingBffError(503, { code: 'CHAT_USAGE_UNAVAILABLE' });
  }
  const reader = response.body?.getReader();
  if (!reader) throw new UsageRankingBffError(503, { code: 'CHAT_USAGE_UNAVAILABLE' });
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
      if (total > RESPONSE_LIMIT) {
        throw new UsageRankingBffError(503, { code: 'CHAT_USAGE_UNAVAILABLE' });
      }
      chunks.push(value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new UsageRankingBffError(503, { code: 'CHAT_USAGE_UNAVAILABLE' });
  }
}

function linkedController(signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  controller.cleanup = () => signal?.removeEventListener('abort', abort);
  return controller;
}

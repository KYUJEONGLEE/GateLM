import { safeChatError, type SafeChatError } from './conversation-contract.mjs';
import { fetchWithSessionRefresh } from './session-retry.mjs';

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: SafeChatError,
  ) {
    super(detail.message);
  }
}

export function csrfToken(): string {
  const cookie = document.cookie.split('; ').find((item) => item.startsWith('gatelm_chat_csrf='));
  return cookie ? decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)) : '';
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithSessionRefresh(url, init, { fetchImpl: fetch, prepare: requestInit });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw apiError(response.status, payload);
  return payload as T;
}

export async function streamApi(url: string, init: RequestInit): Promise<Response> {
  const response = await fetchWithSessionRefresh(url, init, { fetchImpl: fetch, prepare: requestInit });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as unknown;
    throw apiError(response.status, payload);
  }
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (contentType !== 'text/event-stream') throw apiError(502, { code: 'CHAT_UPSTREAM_INVALID' });
  return response;
}

export async function startGoogle(): Promise<void> {
  const result = await api<{ continueUrl: string }>('/api/tenant-chat/auth/google/start', {
    body: '{}', method: 'POST',
  });
  window.location.assign(result.continueUrl);
}

function requestInit(init: RequestInit | undefined): RequestInit {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (init?.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) headers.set('x-gatelm-csrf', csrfToken());
  return { ...init, cache: 'no-store', credentials: 'same-origin', headers };
}

function apiError(status: number, value: unknown): ChatApiError {
  return new ChatApiError(status, safeChatError(value));
}

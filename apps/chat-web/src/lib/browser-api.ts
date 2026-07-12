export function csrfToken(): string {
  const cookie = document.cookie.split('; ').find((item) => item.startsWith('gatelm_chat_csrf='));
  return cookie ? decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)) : '';
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.method && init.method !== 'GET' ? { 'x-gatelm-csrf': csrfToken() } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.message === 'string' ? payload.message : '요청을 처리하지 못했습니다.');
  }
  return payload as T;
}

export async function startGoogle(): Promise<void> {
  const result = await api<{ continueUrl: string }>('/api/tenant-chat/auth/google/start', {
    body: '{}', method: 'POST',
  });
  window.location.assign(result.continueUrl);
}

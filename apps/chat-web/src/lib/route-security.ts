import { readJsonBody, UpstreamResponseError } from '@gatelm/web-bff';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import { COOKIE } from './auth-server';
import { assertDoubleSubmitCsrf, assertExactOrigin } from './conversation-contract.mjs';
import { serverEnv } from './server-env';

export async function secureJson(request: Request, cookies: ReadonlyRequestCookies, maxBytes?: number) {
  secureMutation(request, cookies);
  return readJsonBody(request, maxBytes);
}

export function secureMutation(request: Request, cookies: ReadonlyRequestCookies): void {
  assertExactOrigin(request, serverEnv().chatWebOrigin);
  assertDoubleSubmitCsrf(request, cookies.get(COOKIE.csrf)?.value);
}

export async function secureEmptyMutation(request: Request, cookies: ReadonlyRequestCookies): Promise<void> {
  secureMutation(request, cookies);
  if (!request.body) return;
  const reader = request.body.getReader();
  try {
    const first = await reader.read();
    if (!first.done && first.value.byteLength > 0) {
      await reader.cancel();
      throw new UpstreamResponseError(400, { code: 'CHAT_INVALID_REQUEST' });
    }
  } finally {
    reader.releaseLock();
  }
}

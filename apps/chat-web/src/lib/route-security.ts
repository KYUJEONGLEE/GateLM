import { assertCsrf, assertSameOrigin, readJsonBody } from '@gatelm/web-bff';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import { COOKIE } from './auth-server';
import { serverEnv } from './server-env';

export async function secureJson(request: Request, cookies: ReadonlyRequestCookies) {
  assertSameOrigin(request, serverEnv().chatWebOrigin);
  assertCsrf(request, cookies.get(COOKIE.csrf)?.value);
  return readJsonBody(request);
}

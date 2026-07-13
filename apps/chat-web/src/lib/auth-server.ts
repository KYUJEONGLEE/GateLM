import { callJson } from '@gatelm/web-bff';
import type { NextResponse } from 'next/server';

import type { IssuedSession } from './auth-types';
import { serverEnv } from './server-env';

export const COOKIE = {
  access: 'gatelm_chat_access',
  csrf: 'gatelm_chat_csrf',
  device: 'gatelm_chat_device',
  invitation: 'gatelm_chat_invitation_intent',
  oauthPending: 'gatelm_chat_oauth_pending',
  oauthState: 'gatelm_chat_oauth_state',
  refresh: 'gatelm_chat_refresh',
} as const;

export function chatCall<T>(path: string, input: {
  body?: unknown;
  headers?: Record<string, string | undefined>;
  method: 'GET' | 'POST';
}) {
  const env = serverEnv();
  return callJson<T>({
    ...input,
    serviceHeaderName: 'x-gatelm-chat-web-service-token',
    serviceToken: env.serviceToken,
    timeoutMs: 2_000,
    url: `${env.chatApiBaseUrl}${path}`,
  });
}

export function setIssuedCookies(response: NextResponse, issued: IssuedSession): void {
  const secure = serverEnv().production;
  response.cookies.set(COOKIE.access, issued.accessToken, {
    httpOnly: true, maxAge: 5 * 60, path: '/', sameSite: 'lax', secure,
  });
  if (issued.refreshToken) {
    response.cookies.set(COOKIE.refresh, issued.refreshToken, {
      httpOnly: true, maxAge: 30 * 24 * 60 * 60, path: '/api/tenant-chat/auth', sameSite: 'strict', secure,
    });
  }
}

export function clearAuthCookies(response: NextResponse): void {
  const secure = serverEnv().production;
  response.cookies.set(COOKIE.access, '', { httpOnly: true, maxAge: 0, path: '/', sameSite: 'lax', secure });
  response.cookies.set(COOKIE.refresh, '', { httpOnly: true, maxAge: 0, path: '/api/tenant-chat/auth', sameSite: 'strict', secure });
}

export function clearShortCookie(response: NextResponse, name: string, path = '/'): void {
  response.cookies.set(name, '', { httpOnly: true, maxAge: 0, path, sameSite: 'lax', secure: serverEnv().production });
}

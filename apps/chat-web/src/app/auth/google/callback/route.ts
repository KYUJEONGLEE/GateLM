import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall, clearShortCookie, COOKIE, setIssuedCookies } from '@/lib/auth-server';
import type { IssuedSession } from '@/lib/auth-types';

export async function GET(request: Request) {
  const jar = await cookies();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = jar.get(COOKIE.oauthState)?.value;
  if (!code || !state || !expectedState) return fail(request);
  try {
    const deviceId = jar.get(COOKIE.device)?.value ?? randomUUID();
    const issued = await chatCall<IssuedSession>('/internal/v1/tenant-chat/auth/google/complete', {
      body: { code, deviceId, expectedState, state },
      headers: { 'x-gatelm-chat-invitation-intent': jar.get(COOKIE.invitation)?.value }, method: 'POST',
    });
    const destination = issued.session.state === 'authenticated' ? '/' : '/tenants';
    const response = NextResponse.redirect(new URL(destination, request.url), 303);
    setIssuedCookies(response, issued);
    response.cookies.set(COOKIE.device, deviceId, { httpOnly: true, maxAge: 365 * 24 * 60 * 60, path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    clearShortCookie(response, COOKIE.oauthState, '/auth/google');
    clearShortCookie(response, COOKIE.invitation);
    return response;
  } catch { return fail(request); }
}

function fail(request: Request) {
  const response = NextResponse.redirect(new URL('/login?error=oauth', request.url), 303);
  clearShortCookie(response, COOKIE.oauthState, '/auth/google');
  clearShortCookie(response, COOKIE.oauthPending, '/api/auth/google');
  clearShortCookie(response, COOKIE.invitation);
  return response;
}

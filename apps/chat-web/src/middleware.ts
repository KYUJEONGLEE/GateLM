import { NextRequest, NextResponse } from 'next/server';

import { createContentSecurityPolicy } from '../content-security-policy.mjs';

const CSRF_COOKIE = 'gatelm_chat_csrf';
const INVITATION_COOKIE = 'gatelm_chat_invitation_intent';

export async function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const contentSecurityPolicy = createContentSecurityPolicy(process.env.NODE_ENV, nonce);

  if (request.nextUrl.pathname === '/invitations/accept' && request.nextUrl.searchParams.has('token')) {
    const token = request.nextUrl.searchParams.get('token') ?? '';
    const cleanUrl = new URL('/invitations/accept', request.url);
    try {
      const response = await fetch(`${required('TENANT_CHAT_API_BASE_URL')}/internal/v1/tenant-chat/auth/invitation-intents`, {
        body: JSON.stringify({ token }),
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          'x-gatelm-chat-web-service-token': required('TENANT_CHAT_WEB_SERVICE_TOKEN'),
        },
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(2_000),
      });
      const payload = await response.json() as { intent?: unknown };
      if (!response.ok || typeof payload.intent !== 'string') {
        return secureResponse(
          invitationErrorRedirect(request, cleanUrl, response.status >= 500 ? 'unavailable' : 'invalid'),
          contentSecurityPolicy,
        );
      }
      const redirect = NextResponse.redirect(cleanUrl, 303);
      redirect.cookies.set(INVITATION_COOKIE, payload.intent, shortCookie(15 * 60));
      ensureCsrf(request, redirect);
      return secureResponse(redirect, contentSecurityPolicy);
    } catch {
      return secureResponse(
        invitationErrorRedirect(request, cleanUrl, 'unavailable'),
        contentSecurityPolicy,
      );
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);
  requestHeaders.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  ensureCsrf(request, response);
  return secureResponse(response, contentSecurityPolicy);
}

function invitationErrorRedirect(request: NextRequest, cleanUrl: URL, error: 'invalid' | 'unavailable') {
  cleanUrl.searchParams.set('error', error);
  const redirect = NextResponse.redirect(cleanUrl, 303);
  ensureCsrf(request, redirect);
  return redirect;
}

function ensureCsrf(request: NextRequest, response: NextResponse) {
  if (!request.cookies.has(CSRF_COOKIE)) {
    response.cookies.set(CSRF_COOKIE, crypto.randomUUID(), {
      httpOnly: false, maxAge: 24 * 60 * 60, path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
    });
  }
}

function secureResponse(response: NextResponse, contentSecurityPolicy: string) {
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  return response;
}

function shortCookie(maxAge: number) {
  return { httpOnly: true, maxAge, path: '/', sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' };
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  if (name !== 'TENANT_CHAT_API_BASE_URL') return value;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`Invalid ${name}`);
  return url.origin;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };

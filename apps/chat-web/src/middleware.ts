import { NextRequest, NextResponse } from 'next/server';

const CSRF_COOKIE = 'gatelm_chat_csrf';
const INVITATION_COOKIE = 'gatelm_chat_invitation_intent';

export async function middleware(request: NextRequest) {
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
      });
      const payload = await response.json() as { intent?: unknown };
      if (!response.ok || typeof payload.intent !== 'string') throw new Error('invalid');
      const redirect = NextResponse.redirect(cleanUrl, 303);
      redirect.cookies.set(INVITATION_COOKIE, payload.intent, shortCookie(15 * 60));
      ensureCsrf(request, redirect);
      return redirect;
    } catch {
      cleanUrl.searchParams.set('error', 'invalid');
      const redirect = NextResponse.redirect(cleanUrl, 303);
      ensureCsrf(request, redirect);
      return redirect;
    }
  }

  const response = NextResponse.next();
  ensureCsrf(request, response);
  return response;
}

function ensureCsrf(request: NextRequest, response: NextResponse) {
  if (!request.cookies.has(CSRF_COOKIE)) {
    response.cookies.set(CSRF_COOKIE, crypto.randomUUID(), {
      httpOnly: false, maxAge: 24 * 60 * 60, path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
    });
  }
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

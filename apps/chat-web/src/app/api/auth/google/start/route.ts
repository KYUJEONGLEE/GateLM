import { jsonError } from '@gatelm/web-bff';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall, COOKIE } from '@/lib/auth-server';
import { secureJson } from '@/lib/route-security';

export async function POST(request: Request) {
  const jar = await cookies();
  try {
    await secureJson(request, jar);
    const result = await chatCall<{ authorizationUrl: string; state: string }>('/internal/v1/tenant-chat/auth/google/start', { method: 'POST' });
    const target = new URL(result.authorizationUrl);
    if (target.protocol !== 'https:' || target.hostname !== 'accounts.google.com') throw new Error('Unexpected OAuth authority');
    const response = NextResponse.json({ continueUrl: '/api/auth/google/continue' }, { headers: { 'cache-control': 'no-store' } });
    const options = { httpOnly: true, maxAge: 10 * 60, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' };
    response.cookies.set(COOKIE.oauthState, result.state, { ...options, path: '/auth/google' });
    response.cookies.set(COOKIE.oauthPending, result.authorizationUrl, { ...options, path: '/api/auth/google' });
    return response;
  } catch (error) { return jsonError(error); }
}

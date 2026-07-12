import { jsonError, UpstreamResponseError } from '@gatelm/web-bff';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall, clearShortCookie, COOKIE, setIssuedCookies } from '@/lib/auth-server';
import type { IssuedSession } from '@/lib/auth-types';
import { secureJson } from '@/lib/route-security';

export async function POST(request: Request) {
  const jar = await cookies();
  try {
    await secureJson(request, jar);
    const intent = jar.get(COOKIE.invitation)?.value;
    const access = jar.get(COOKIE.access)?.value;
    if (!intent || !access) throw new UpstreamResponseError(401, { code: 'CHAT_AUTH_REQUIRED', message: '기존 계정으로 먼저 로그인해 주세요.' });
    const issued = await chatCall<IssuedSession>('/internal/v1/tenant-chat/auth/invitations/bind-existing', {
      body: { intent }, headers: { 'x-gatelm-chat-access': access }, method: 'POST',
    });
    const response = NextResponse.json(issued.session, { headers: { 'cache-control': 'no-store' } });
    setIssuedCookies(response, issued);
    clearShortCookie(response, COOKIE.invitation);
    return response;
  } catch (error) { return jsonError(error); }
}

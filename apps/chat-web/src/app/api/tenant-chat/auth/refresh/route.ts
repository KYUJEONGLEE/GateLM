import { jsonError, UpstreamResponseError } from '@gatelm/web-bff';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall, COOKIE, setIssuedCookies } from '@/lib/auth-server';
import type { IssuedSession } from '@/lib/auth-types';
import { secureJson } from '@/lib/route-security';

export async function POST(request: Request) {
  const jar = await cookies();
  try {
    await secureJson(request, jar);
    const refresh = jar.get(COOKIE.refresh)?.value;
    if (!refresh) throw new UpstreamResponseError(401, { code: 'CHAT_AUTH_REQUIRED', message: '로그인이 필요합니다.' });
    const issued = await chatCall<IssuedSession>('/internal/v1/tenant-chat/auth/refresh', {
      headers: { 'x-gatelm-chat-refresh': refresh }, method: 'POST',
    });
    const response = NextResponse.json(issued.session, { headers: { 'cache-control': 'no-store' } });
    setIssuedCookies(response, issued);
    return response;
  } catch (error) { return jsonError(error); }
}

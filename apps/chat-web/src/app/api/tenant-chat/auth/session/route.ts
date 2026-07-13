import { UpstreamResponseError } from '@gatelm/web-bff';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall, clearAuthCookies, COOKIE, setIssuedCookies } from '@/lib/auth-server';
import type { ChatSession, IssuedSession } from '@/lib/auth-types';

export async function GET() {
  const jar = await cookies();
  const access = jar.get(COOKIE.access)?.value;
  try {
    if (access) {
      try {
        const session = await chatCall<ChatSession>('/internal/v1/tenant-chat/auth/session', {
          headers: { 'x-gatelm-chat-access': access }, method: 'GET',
        });
        return NextResponse.json(session, { headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        if (!(error instanceof UpstreamResponseError) || error.status !== 401) throw error;
      }
    }
    const refresh = jar.get(COOKIE.refresh)?.value;
    if (!refresh) throw new UpstreamResponseError(401, { code: 'CHAT_AUTH_REQUIRED', message: '로그인이 필요합니다.' });
    const issued = await chatCall<IssuedSession>('/internal/v1/tenant-chat/auth/refresh', {
      headers: { 'x-gatelm-chat-refresh': refresh }, method: 'POST',
    });
    const response = NextResponse.json(issued.session, { headers: { 'cache-control': 'no-store' } });
    setIssuedCookies(response, issued);
    return response;
  } catch (error) {
    const known = error instanceof UpstreamResponseError;
    const response = NextResponse.json(
      known ? error.payload : { code: 'CHAT_INTERNAL_ERROR', message: '요청을 처리하지 못했습니다.' },
      { headers: { 'cache-control': 'no-store' }, status: known ? error.status : 500 },
    );
    if (known && (error.status === 401 || error.status === 403)) clearAuthCookies(response);
    return response;
  }
}

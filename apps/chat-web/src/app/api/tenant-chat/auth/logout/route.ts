import { jsonError } from '@gatelm/web-bff';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall, clearAuthCookies, COOKIE } from '@/lib/auth-server';
import { secureJson } from '@/lib/route-security';

export async function POST(request: Request) {
  const jar = await cookies();
  try {
    await secureJson(request, jar);
    try {
      await chatCall('/internal/v1/tenant-chat/auth/logout', {
        headers: {
          'x-gatelm-chat-access': jar.get(COOKIE.access)?.value,
          'x-gatelm-chat-refresh': jar.get(COOKIE.refresh)?.value,
        }, method: 'POST',
      });
    } catch {
      // Browser logout still succeeds locally if upstream revocation is temporarily unavailable.
    }
    const response = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    clearAuthCookies(response);
    return response;
  } catch (error) { return jsonError(error); }
}

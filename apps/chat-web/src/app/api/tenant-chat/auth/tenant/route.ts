import { jsonError } from '@gatelm/web-bff';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall, COOKIE, setIssuedCookies } from '@/lib/auth-server';
import type { IssuedSession } from '@/lib/auth-types';
import { secureJson } from '@/lib/route-security';

export async function POST(request: Request) {
  const jar = await cookies();
  try {
    const body = await secureJson(request, jar);
    const issued = await chatCall<IssuedSession>('/internal/v1/tenant-chat/auth/tenant', {
      body: { tenantId: body.tenantId },
      headers: { 'x-gatelm-chat-access': jar.get(COOKIE.access)?.value }, method: 'POST',
    });
    const response = NextResponse.json(issued.session, { headers: { 'cache-control': 'no-store' } });
    setIssuedCookies(response, issued);
    return response;
  } catch (error) { return jsonError(error); }
}

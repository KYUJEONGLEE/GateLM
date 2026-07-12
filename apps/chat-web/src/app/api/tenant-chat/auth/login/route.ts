import { jsonError } from '@gatelm/web-bff';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall, COOKIE, setIssuedCookies } from '@/lib/auth-server';
import type { IssuedSession } from '@/lib/auth-types';
import { secureJson } from '@/lib/route-security';

export async function POST(request: Request) {
  const jar = await cookies();
  try {
    const body = await secureJson(request, jar);
    const deviceId = jar.get(COOKIE.device)?.value ?? randomUUID();
    const issued = await chatCall<IssuedSession>('/internal/v1/tenant-chat/auth/password', {
      body: { deviceId, email: body.email, password: body.password }, method: 'POST',
    });
    const response = NextResponse.json(issued.session, { headers: { 'cache-control': 'no-store' } });
    setIssuedCookies(response, issued);
    response.cookies.set(COOKIE.device, deviceId, { httpOnly: true, maxAge: 365 * 24 * 60 * 60, path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    return response;
  } catch (error) { return jsonError(error); }
}

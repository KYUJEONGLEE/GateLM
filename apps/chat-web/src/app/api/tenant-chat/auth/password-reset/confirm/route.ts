import { jsonError } from '@gatelm/web-bff';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall, clearAuthCookies } from '@/lib/auth-server';
import { secureJson } from '@/lib/route-security';

export async function POST(request: Request) {
  const jar = await cookies();
  try {
    const body = await secureJson(request, jar);
    const result = await chatCall<{ passwordReset: true }>(
      '/internal/v1/tenant-chat/auth/password-reset/confirm',
      {
        body: { newPassword: body.newPassword, token: body.token },
        method: 'POST',
      },
    );
    const response = NextResponse.json(result, {
      headers: { 'cache-control': 'no-store' },
    });
    clearAuthCookies(response);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}

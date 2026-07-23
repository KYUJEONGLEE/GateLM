import { jsonError } from '@gatelm/web-bff';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall } from '@/lib/auth-server';
import { secureJson } from '@/lib/route-security';

export async function POST(request: Request) {
  const jar = await cookies();
  try {
    const body = await secureJson(request, jar);
    const result = await chatCall<{ accepted: true }>(
      '/internal/v1/tenant-chat/auth/password-reset/request',
      {
        body: { email: body.email },
        method: 'POST',
      },
    );
    return NextResponse.json(result, {
      headers: { 'cache-control': 'no-store' },
      status: 202,
    });
  } catch (error) {
    return jsonError(error);
  }
}

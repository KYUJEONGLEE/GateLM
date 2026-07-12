import { jsonError, UpstreamResponseError } from '@gatelm/web-bff';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { chatCall, COOKIE } from '@/lib/auth-server';
import type { InvitationSummary } from '@/lib/auth-types';

export async function GET() {
  const jar = await cookies();
  try {
    const intent = jar.get(COOKIE.invitation)?.value;
    if (!intent) throw new UpstreamResponseError(409, { code: 'CHAT_INVITATION_INVALID', message: '초대 링크가 없거나 만료되었습니다.' });
    const result = await chatCall<InvitationSummary>('/internal/v1/tenant-chat/auth/invitations/resolve', {
      body: { intent }, method: 'POST',
    });
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return jsonError(error); }
}

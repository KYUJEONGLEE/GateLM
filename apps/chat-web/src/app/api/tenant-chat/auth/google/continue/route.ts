import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { clearShortCookie, COOKIE } from '@/lib/auth-server';

export async function GET(request: Request) {
  const jar = await cookies();
  const pending = jar.get(COOKIE.oauthPending)?.value;
  if (!pending) return NextResponse.redirect(new URL('/login?error=oauth', request.url), 303);
  try {
    const target = new URL(pending);
    if (target.protocol !== 'https:' || target.hostname !== 'accounts.google.com') throw new Error('invalid');
    const response = NextResponse.redirect(target, 303);
    clearShortCookie(response, COOKIE.oauthPending, '/api/tenant-chat/auth/google');
    return response;
  } catch {
    return NextResponse.redirect(new URL('/login?error=oauth', request.url), 303);
  }
}

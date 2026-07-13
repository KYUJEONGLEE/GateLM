import { proxyHttp } from '@gatelm/web-bff';
import { NextRequest } from 'next/server';

import { getControlPlaneBaseUrl } from '@/lib/control-plane/control-plane-config';

type AuthProxyContext = { params: Promise<{ path?: string[] }> };

export function GET(request: NextRequest, context: AuthProxyContext) {
  return proxyAuthRequest(request, context);
}

export function POST(request: NextRequest, context: AuthProxyContext) {
  return proxyAuthRequest(request, context);
}

async function proxyAuthRequest(request: NextRequest, context: AuthProxyContext) {
  const { path = [] } = await context.params;
  const targetUrl = new URL(`/api/auth/${path.map(encodeURIComponent).join('/')}`, getControlPlaneBaseUrl());
  targetUrl.search = request.nextUrl.search;
  const forwarded = new Request(request.url, {
    body: request.method === 'GET' ? undefined : request.body,
    duplex: request.method === 'GET' ? undefined : 'half',
    headers: request.headers,
    method: request.method,
  } as RequestInit);
  const host = request.headers.get('host');
  if (host) forwarded.headers.set('x-forwarded-host', host);
  return proxyHttp({
    allowedMethods: ['GET', 'POST'],
    forwardHeaders: ['accept', 'content-type', 'cookie', 'x-forwarded-host'],
    maxRequestBytes: 32 * 1024,
    maxResponseBytes: 64 * 1024,
    request: forwarded,
    responseHeaders: ['content-type', 'location'],
    targetUrl,
  });
}

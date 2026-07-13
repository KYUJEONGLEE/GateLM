const DEFAULT_MAX_BYTES = 64 * 1024;

export class UpstreamResponseError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super('Upstream request failed.');
  }
}

export function assertSameOrigin(request: Request, expectedOrigin: string): void {
  const origin = request.headers.get('origin');
  if (!origin || origin !== expectedOrigin) {
    throw new UpstreamResponseError(403, {
      code: 'CHAT_ORIGIN_REJECTED',
      message: '요청 출처를 확인할 수 없습니다.',
    });
  }
}

export function assertCsrf(request: Request, cookieValue: string | undefined): void {
  const header = request.headers.get('x-gatelm-csrf');
  if (!cookieValue || !header || !constantTimeTextEqual(cookieValue, header)) {
    throw new UpstreamResponseError(403, {
      code: 'CHAT_CSRF_REJECTED',
      message: '보안 확인이 만료되었습니다. 페이지를 새로고침해 주세요.',
    });
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes = 32 * 1024,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim();
  if (contentType !== 'application/json') {
    throw new UpstreamResponseError(415, {
      code: 'CHAT_UNSUPPORTED_MEDIA_TYPE',
      message: 'JSON 요청만 허용됩니다.',
    });
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return tooLarge();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('invalid');
    return parsed as Record<string, unknown>;
  } catch {
    throw new UpstreamResponseError(400, {
      code: 'CHAT_INVALID_REQUEST',
      message: '요청 형식이 올바르지 않습니다.',
    });
  }
}

export async function callJson<T>(input: {
  body?: unknown;
  headers?: Record<string, string | undefined>;
  maxResponseBytes?: number;
  method: 'GET' | 'POST';
  serviceHeaderName: string;
  serviceToken: string;
  timeoutMs?: number;
  url: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 2_000);
  try {
    const headers = new Headers({
      accept: 'application/json',
      [input.serviceHeaderName]: input.serviceToken,
    });
    for (const [name, value] of Object.entries(input.headers ?? {})) {
      if (value) headers.set(name, value);
    }
    if (input.body !== undefined) headers.set('content-type', 'application/json');
    const response = await fetch(input.url, {
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      cache: 'no-store',
      headers,
      method: input.method,
      redirect: 'manual',
      signal: controller.signal,
    });
    const payload = await readBoundedResponse(response, input.maxResponseBytes ?? DEFAULT_MAX_BYTES);
    if (!response.ok) throw new UpstreamResponseError(response.status, safeError(payload));
    return payload as T;
  } catch (error) {
    if (error instanceof UpstreamResponseError) throw error;
    throw new UpstreamResponseError(503, {
      code: 'CHAT_UPSTREAM_UNAVAILABLE',
      message: '인증 서비스를 잠시 사용할 수 없습니다.',
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function jsonError(error: unknown): Response {
  const known = error instanceof UpstreamResponseError;
  return Response.json(
    known ? error.payload : { code: 'CHAT_INTERNAL_ERROR', message: '요청을 처리하지 못했습니다.' },
    {
      headers: { 'cache-control': 'no-store' },
      status: known ? error.status : 500,
    },
  );
}

export async function proxyHttp(input: {
  allowedMethods: readonly string[];
  forwardHeaders: readonly string[];
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  request: Request;
  responseHeaders?: readonly string[];
  targetUrl: URL;
}): Promise<Response> {
  if (!input.allowedMethods.includes(input.request.method)) {
    return new Response(null, { headers: { allow: input.allowedMethods.join(', '), 'cache-control': 'no-store' }, status: 405 });
  }
  const requestHeaders = new Headers();
  for (const name of input.forwardHeaders) {
    const value = input.request.headers.get(name);
    if (value) requestHeaders.set(name, value);
  }
  const body = input.request.method === 'GET' || input.request.method === 'HEAD'
    ? undefined
    : await readBoundedBytes(input.request.body, input.maxRequestBytes ?? 32 * 1024);
  let upstream: Response;
  try {
    upstream = await fetch(input.targetUrl, {
      body, headers: requestHeaders, method: input.request.method, redirect: 'manual',
    });
  } catch {
    return Response.json(
      { code: 'BFF_UPSTREAM_UNAVAILABLE', message: 'Authentication service is unavailable.' },
      { headers: { 'cache-control': 'no-store' }, status: 503 },
    );
  }
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of input.responseHeaders ?? ['content-type', 'location']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const cookie of getSetCookies(upstream.headers)) headers.append('set-cookie', cookie);
  try {
    const responseBody = await readBoundedBytes(upstream.body, input.maxResponseBytes ?? 64 * 1024);
    return new Response(responseBody, { headers, status: upstream.status });
  } catch (error) {
    if (error instanceof UpstreamResponseError) return jsonError(error);
    throw error;
  }
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return tooLarge();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new UpstreamResponseError(502, {
      code: 'CHAT_UPSTREAM_INVALID',
      message: '인증 서비스 응답이 올바르지 않습니다.',
    });
  }
}

function safeError(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { code: 'CHAT_UPSTREAM_ERROR', message: '요청을 처리하지 못했습니다.' };
  }
  const source = value as Record<string, unknown>;
  return {
    code: typeof source.code === 'string' ? source.code : 'CHAT_UPSTREAM_ERROR',
    message: typeof source.message === 'string' ? source.message : '요청을 처리하지 못했습니다.',
  };
}

function tooLarge(): never {
  throw new UpstreamResponseError(413, {
    code: 'CHAT_PAYLOAD_TOO_LARGE',
    message: '요청 또는 응답 크기 제한을 초과했습니다.',
  });
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}

async function readBoundedBytes(stream: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!stream) return undefined;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new UpstreamResponseError(413, { code: 'BFF_PAYLOAD_TOO_LARGE', message: 'Payload is too large.' });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function getSetCookies(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') return getSetCookie.call(headers);
  const header = headers.get('set-cookie');
  if (!header) return [];
  const cookies: string[] = [];
  let start = 0;
  let insideExpires = false;
  for (let index = 0; index < header.length; index += 1) {
    if (header.slice(index, index + 8).toLowerCase() === 'expires=') insideExpires = true;
    const char = header[index];
    if (insideExpires && char === ';') insideExpires = false;
    if (!insideExpires && char === ',') { cookies.push(header.slice(start, index).trim()); start = index + 1; }
  }
  cookies.push(header.slice(start).trim());
  return cookies.filter(Boolean);
}

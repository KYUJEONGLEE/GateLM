import { assertCsrf, assertSameOrigin, proxyHttp, readJsonBody, UpstreamResponseError } from './index';

describe('web BFF security helpers', () => {
  it('requires exact origin and matching double-submit CSRF', () => {
    const request = new Request('https://chat.example.test/api/auth/login', {
      headers: { origin: 'https://chat.example.test', 'x-gatelm-csrf': 'csrf-value' },
    });
    expect(() => assertSameOrigin(request, 'https://chat.example.test')).not.toThrow();
    expect(() => assertCsrf(request, 'csrf-value')).not.toThrow();
    expect(() => assertSameOrigin(request, 'https://admin.example.test')).toThrow(UpstreamResponseError);
    expect(() => assertCsrf(request, 'different')).toThrow(UpstreamResponseError);
  });

  it('rejects oversized JSON before parsing', async () => {
    const request = new Request('https://chat.example.test', {
      body: JSON.stringify({ value: 'x'.repeat(128) }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    await expect(readJsonBody(request, 32)).rejects.toMatchObject({ status: 413 });
  });

  it('uses a method allowlist and does not call upstream for rejected methods', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn();
    try {
      const response = await proxyHttp({
        allowedMethods: ['GET', 'POST'], forwardHeaders: [], request: new Request('https://example.test', { method: 'DELETE' }), targetUrl: new URL('https://upstream.example.test'),
      });
      expect(response.status).toBe(405);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally { global.fetch = originalFetch; }
  });

  it('bounds upstream responses and forces no-store', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(new Response('x'.repeat(80), { headers: { 'content-type': 'text/plain' } }));
    try {
      const response = await proxyHttp({
        allowedMethods: ['GET'], forwardHeaders: [], maxResponseBytes: 32, request: new Request('https://example.test'), targetUrl: new URL('https://upstream.example.test'),
      });
      expect(response.status).toBe(413);
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally { global.fetch = originalFetch; }
  });
});

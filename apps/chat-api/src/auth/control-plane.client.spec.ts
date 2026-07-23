import { ControlPlaneClient } from './control-plane.client';

const config = {
  getOrThrow: (key: string) => {
    if (key === 'TENANT_CHAT_CONTROL_PLANE_BASE_URL') return 'http://control-plane.test';
    if (key === 'TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN') return 'test-service-token';
    if (key === 'TENANT_CHAT_CONTROL_PLANE_TIMEOUT_MS') return 1_000;
    throw new Error(`Unexpected config key: ${key}`);
  },
};

describe('ControlPlaneClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preserves the current Control Plane error envelope', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'CHAT_AUTH_REQUIRED',
            details: null,
            message: 'Email or password is invalid.',
            requestId: null,
            retryable: false,
          },
        },
        { status: 401 },
      ),
    );

    const client = new ControlPlaneClient(config as never);
    await expect(client.password('member@example.test', 'invalid-password')).rejects.toMatchObject({
      response: {
        code: 'CHAT_AUTH_REQUIRED',
        message: 'Email or password is invalid.',
      },
      status: 401,
    });
  });

  it('keeps compatibility with a flat upstream error payload', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json(
        {
          code: 'CHAT_ACCESS_STALE',
          message: 'Tenant access is stale.',
        },
        { status: 401 },
      ),
    );

    const client = new ControlPlaneClient(config as never);
    await expect(client.entitlements('user-id')).rejects.toMatchObject({
      response: {
        code: 'CHAT_ACCESS_STALE',
        message: 'Tenant access is stale.',
      },
      status: 401,
    });
  });

  it('sends only server-derived ranking scope and validates the response', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        items: [],
        metric: 'tokens',
        period: {
          from: '2026-07-16T12:00:00.000Z',
          timezone: 'UTC',
          to: '2026-07-23T12:00:00.000Z',
        },
        provenance: {
          generatedAt: '2026-07-23T12:00:00.000Z',
          lastSourceAt: null,
          source: 'raw',
        },
        range: '7d',
        rankedEmployeeCount: 0,
        viewer: null,
      }),
    );

    const client = new ControlPlaneClient(config as never);
    await client.usageRanking({
      metric: 'tokens',
      range: '7d',
      tenantId: '00000000-0000-4000-8000-000000000100',
      viewerEmployeeId: '00000000-0000-4000-8000-000000000101',
    });

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      'http://control-plane.test/internal/v1/tenant-chat/usage/rankings/00000000-0000-4000-8000-000000000100?metric=tokens&range=7d&viewerEmployeeId=00000000-0000-4000-8000-000000000101',
    );
    expect(new Headers(init?.headers).get('x-gatelm-tenant-chat-service-token')).toBe('test-service-token');
    expect(String(url)).not.toContain('userId');
  });

  it('rejects an unsafe ranking response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        employeeEmail: 'leak@example.test',
      }),
    );

    const client = new ControlPlaneClient(config as never);
    await expect(client.usageRanking({
      metric: 'cost',
      range: '30d',
      tenantId: '00000000-0000-4000-8000-000000000100',
    })).rejects.toThrow('invalid_usage_ranking_response');
  });
});

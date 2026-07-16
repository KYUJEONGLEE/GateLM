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
});

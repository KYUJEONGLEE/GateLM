import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('keeps liveness available while readiness fails closed without workload keys', async () => {
    const controller = new HealthController(
      { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as never,
      { isReady: jest.fn().mockResolvedValue(false) } as never,
      { isConfigured: jest.fn().mockReturnValue(true) } as never,
      { isReady: jest.fn().mockResolvedValue(true) } as never,
    );
    expect(controller.health()).toEqual({ status: 'ok' });
    await expect(controller.ready()).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CHAT_RUNTIME_UNAVAILABLE' }),
      status: 503,
    });
  });
});

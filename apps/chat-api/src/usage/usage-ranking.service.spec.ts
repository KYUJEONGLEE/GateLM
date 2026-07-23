import { HttpException } from '@nestjs/common';

import { UsageRankingService } from './usage-ranking.service';

describe('UsageRankingService', () => {
  it('derives tenant and viewer scope only from the authorized session', async () => {
    const sessions = {
      authorizeExecution: jest.fn().mockResolvedValue({
        employeeId: '00000000-0000-4000-8000-000000000101',
        tenantId: '00000000-0000-4000-8000-000000000100',
      }),
    };
    const result = ranking();
    const controlPlane = {
      usageRanking: jest.fn().mockResolvedValue(result),
    };
    const service = new UsageRankingService(sessions as never, controlPlane as never);

    await expect(service.read('access-token', '7d', 'tokens')).resolves.toBe(result);
    expect(sessions.authorizeExecution).toHaveBeenCalledWith('access-token');
    expect(controlPlane.usageRanking).toHaveBeenCalledWith({
      metric: 'tokens',
      range: '7d',
      tenantId: '00000000-0000-4000-8000-000000000100',
      viewerEmployeeId: '00000000-0000-4000-8000-000000000101',
    });
  });

  it('allows a tenant admin without an employee identity', async () => {
    const sessions = {
      authorizeExecution: jest.fn().mockResolvedValue({
        tenantId: '00000000-0000-4000-8000-000000000100',
      }),
    };
    const controlPlane = { usageRanking: jest.fn().mockResolvedValue(ranking()) };
    const service = new UsageRankingService(sessions as never, controlPlane as never);

    await service.read('access-token', '30d', 'cost');

    expect(controlPlane.usageRanking).toHaveBeenCalledWith({
      metric: 'cost',
      range: '30d',
      tenantId: '00000000-0000-4000-8000-000000000100',
    });
  });

  it('does not hide session authorization failures', async () => {
    const authorizationError = new HttpException({ code: 'CHAT_AUTH_REQUIRED' }, 401);
    const sessions = { authorizeExecution: jest.fn().mockRejectedValue(authorizationError) };
    const controlPlane = { usageRanking: jest.fn() };
    const service = new UsageRankingService(sessions as never, controlPlane as never);

    await expect(service.read('access-token', '30d', 'cost')).rejects.toBe(authorizationError);
    expect(controlPlane.usageRanking).not.toHaveBeenCalled();
  });

  it('isolates ranking failures as CHAT_USAGE_UNAVAILABLE', async () => {
    const sessions = {
      authorizeExecution: jest.fn().mockResolvedValue({
        tenantId: '00000000-0000-4000-8000-000000000100',
      }),
    };
    const controlPlane = { usageRanking: jest.fn().mockRejectedValue(new Error('private detail')) };
    const service = new UsageRankingService(sessions as never, controlPlane as never);

    await expect(service.read('access-token', '30d', 'cost')).rejects.toMatchObject({
      response: {
        code: 'CHAT_USAGE_UNAVAILABLE',
        message: 'Tenant Chat usage ranking is temporarily unavailable.',
      },
      status: 503,
    });
  });
});

function ranking() {
  return {
    items: [],
    metric: 'cost' as const,
    period: {
      from: '2026-06-23T12:00:00.000Z',
      timezone: 'UTC' as const,
      to: '2026-07-23T12:00:00.000Z',
    },
    provenance: {
      generatedAt: '2026-07-23T12:00:00.000Z',
      lastSourceAt: null,
      source: 'raw' as const,
    },
    range: '30d' as const,
    rankedEmployeeCount: 0,
    viewer: null,
  };
}

import { GUARDS_METADATA } from '@nestjs/common/constants';

import { TenantChatServiceAuthGuard } from '@/modules/tenant-chat-identity/tenant-chat-service-auth.guard';

import { TenantChatUsageRankingController } from './tenant-chat-usage-ranking.controller';

describe('TenantChatUsageRankingController', () => {
  it('is protected by the Tenant Chat service-token guard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      TenantChatUsageRankingController,
    ) as unknown[];
    expect(guards).toContain(TenantChatServiceAuthGuard);
  });

  it('forwards only the validated server-side scope to the usage service', async () => {
    const response = { items: [] };
    const usage = {
      listTenantChatUsageRanking: jest.fn().mockResolvedValue(response),
    };
    const controller = new TenantChatUsageRankingController(usage as never);

    await expect(controller.list(
      '00000000-0000-4000-8000-000000000100',
      {
        metric: 'tokens',
        range: '7d',
        viewerEmployeeId: '00000000-0000-4000-8000-000000000101',
      },
    )).resolves.toBe(response);
    expect(usage.listTenantChatUsageRanking).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000100',
      '00000000-0000-4000-8000-000000000101',
      '7d',
      'tokens',
    );
  });
});

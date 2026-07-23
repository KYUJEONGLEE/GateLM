import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ChatWebServiceGuard } from '@/auth/chat-web-service.guard';

import { UsageRankingController } from './usage-ranking.controller';
import { UsageRankingQueryDto } from './usage-ranking.dto';

describe('UsageRankingController', () => {
  it('requires the Chat Web service guard and forwards the access token', async () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      UsageRankingController,
    ) as unknown[];
    expect(guards).toContain(ChatWebServiceGuard);
    const usage = { read: jest.fn().mockResolvedValue({ items: [] }) };
    const controller = new UsageRankingController(usage as never);

    await controller.read('access-token', { metric: 'tokens', range: '24h' });

    expect(usage.read).toHaveBeenCalledWith('access-token', '24h', 'tokens');
  });

  it('rejects unsupported range and metric values', async () => {
    const query = plainToInstance(UsageRankingQueryDto, {
      metric: 'requests',
      range: '365d',
    });
    const errors = await validate(query);

    expect(errors.map((error) => error.property).sort()).toEqual(['metric', 'range']);
  });
});

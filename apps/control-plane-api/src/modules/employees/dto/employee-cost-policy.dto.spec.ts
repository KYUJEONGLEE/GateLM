import { ValidationPipe } from '@nestjs/common';

import {
  ListEmployeeCostPoliciesQueryDto,
  UpdateEmployeeCostPolicyDto,
} from './employee-cost-policy.dto';

describe('UpdateEmployeeCostPolicyDto', () => {
  const pipe = new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

  it('accepts explicit daily and weekly cost policies', async () => {
    await expect(
      pipe.transform(
        {
          daily: { enabled: true, limitMicroUsd: '5000000' },
          enforcementMode: 'restrict_high_cost',
          expectedVersion: '3',
          warningThresholdPercent: '80',
          weekly: { enabled: true, limitMicroUsd: '25000000' },
        },
        { type: 'body', metatype: UpdateEmployeeCostPolicyDto },
      ),
    ).resolves.toMatchObject({
      daily: { enabled: true, limitMicroUsd: 5_000_000 },
      enforcementMode: 'restrict_high_cost',
      expectedVersion: 3,
      warningThresholdPercent: 80,
      weekly: { enabled: true, limitMicroUsd: 25_000_000 },
    });
  });

  it.each([
    {
      daily: { enabled: true, limitMicroUsd: -1 },
      enforcementMode: 'monitor',
      expectedVersion: 0,
      warningThresholdPercent: 80,
      weekly: { enabled: false, limitMicroUsd: 0 },
    },
    {
      daily: { enabled: false, limitMicroUsd: 0 },
      enforcementMode: 'block_all',
      expectedVersion: 0,
      warningThresholdPercent: 80,
      weekly: { enabled: false, limitMicroUsd: 0 },
    },
    {
      daily: { enabled: false, limitMicroUsd: 0 },
      enforcementMode: 'monitor',
      expectedVersion: -1,
      warningThresholdPercent: 100,
      weekly: { enabled: false, limitMicroUsd: 0 },
    },
  ])('rejects malformed policy input %#', async (body) => {
    await expect(
      pipe.transform(body, {
        type: 'body',
        metatype: UpdateEmployeeCostPolicyDto,
      }),
    ).rejects.toThrow();
  });

  it('rejects client-supplied tenant and actor fields', async () => {
    await expect(
      pipe.transform(
        {
          daily: { enabled: false, limitMicroUsd: 0 },
          enforcementMode: 'monitor',
          expectedVersion: 0,
          tenantId: '00000000-0000-4000-8000-000000000100',
          updatedBy: '00000000-0000-4000-8000-000000000200',
          warningThresholdPercent: 80,
          weekly: { enabled: false, limitMicroUsd: 0 },
        },
        { type: 'body', metatype: UpdateEmployeeCostPolicyDto },
      ),
    ).rejects.toThrow();
  });
});

describe('ListEmployeeCostPoliciesQueryDto', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });

  it('transforms the bounded page size', async () => {
    await expect(
      pipe.transform(
        { limit: '25' },
        { type: 'query', metatype: ListEmployeeCostPoliciesQueryDto },
      ),
    ).resolves.toMatchObject({ limit: 25 });
  });

  it.each(['0', '101'])('rejects out-of-range page size %s', async (limit) => {
    await expect(
      pipe.transform(
        { limit },
        { type: 'query', metatype: ListEmployeeCostPoliciesQueryDto },
      ),
    ).rejects.toThrow();
  });
});

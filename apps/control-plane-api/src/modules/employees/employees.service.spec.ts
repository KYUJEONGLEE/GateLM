import { ConfigService } from '@nestjs/config';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';
import { InMemoryEmailSender } from '@/modules/auth/email-sender';

import { ProjectEmployeePolicyDto } from './dto/employee.dto';
import { EmployeesService } from './employees.service';

type EmployeePolicyReader = {
  mergeProjectEmployeePolicy(
    current: Record<string, unknown>,
    dto: Record<string, unknown>,
  ): Record<string, unknown>;
  toProjectEmployeePolicy(
    policy: Record<string, unknown>,
  ): ProjectEmployeePolicyDto;
  toProjectEmployeeQuotaStatus(
    limitMicroUsd: bigint,
    usedMicroUsd: bigint,
    warningThresholdPercent: number,
  ): 'exceeded' | 'not_configured' | 'warning' | 'within_limit';
};

describe('EmployeesService employee rate limit policy', () => {
  const service = new EmployeesService(
    {} as PrismaService,
    {} as ConfigService,
    new InMemoryEmailSender(),
  );
  const policyReader = service as unknown as EmployeePolicyReader;

  it('keeps legacy policy documents compatible with a disabled default', () => {
    const policy = policyReader.toProjectEmployeePolicy({
      allowedModelKeys: ['mock-balanced'],
      allowedProviderConnectionIds: [],
      note: 'legacy',
    });

    expect(policy.rateLimit).toEqual({
      enabled: false,
      limit: 60,
      windowSeconds: 60,
    });
    expect(policy.allowedModelKeys).toEqual(['mock-balanced']);
  });

  it('merges employee rate limit fields without dropping model policy', () => {
    const merged = policyReader.mergeProjectEmployeePolicy(
      {
        allowedModelKeys: ['mock-balanced'],
        allowedProviderConnectionIds: ['connection-1'],
        note: 'keep',
        rateLimit: { enabled: false, limit: 60, windowSeconds: 60 },
      },
      {
        rateLimitEnabled: true,
        rateLimitLimit: 5,
        rateLimitWindowSeconds: 30,
      },
    );

    expect(merged).toEqual({
      allowedModelKeys: ['mock-balanced'],
      allowedProviderConnectionIds: ['connection-1'],
      note: 'keep',
      rateLimit: { enabled: true, limit: 5, windowSeconds: 30 },
    });
  });

  it.each([
    { expected: 'not_configured', limit: 0n, used: 0n, warning: 80 },
    { expected: 'within_limit', limit: 100n, used: 79n, warning: 80 },
    { expected: 'warning', limit: 100n, used: 80n, warning: 80 },
    { expected: 'exceeded', limit: 100n, used: 100n, warning: 80 },
  ])(
    'returns $expected for the employee monthly quota',
    ({ expected, limit, used, warning }) => {
      expect(
        policyReader.toProjectEmployeeQuotaStatus(limit, used, warning),
      ).toBe(expected);
    },
  );
});

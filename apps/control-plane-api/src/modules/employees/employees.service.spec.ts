import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import 'reflect-metadata';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';
import { InMemoryEmailSender } from '@/modules/auth/email-sender';

import {
  ProjectEmployeePolicyDto,
  UpsertProjectEmployeeAssignmentDto,
} from './dto/employee.dto';
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

    expect(policy.dailyTokenLimit).toEqual({ enabled: false, limit: 0 });
    expect(policy.rateLimit).toEqual({
      enabled: false,
      limit: 60,
      windowSeconds: 60,
    });
    expect(policy).not.toHaveProperty('allowedModelKeys');
    expect(policy).not.toHaveProperty('allowedProviderConnectionIds');
  });

  it('merges employee limits without carrying legacy employee routing fields', () => {
    const merged = policyReader.mergeProjectEmployeePolicy(
      {
        allowedModelKeys: ['mock-balanced'],
        allowedProviderConnectionIds: ['connection-1'],
        dailyTokenLimit: { enabled: true, limit: 50000 },
        note: 'keep',
        rateLimit: { enabled: false, limit: 60, windowSeconds: 60 },
      },
      {
        dailyTokenLimit: 75000,
        rateLimitEnabled: true,
        rateLimitLimit: 5,
        rateLimitWindowSeconds: 30,
      },
    );

    expect(merged).toEqual({
      dailyTokenLimit: { enabled: true, limit: 75000 },
      note: 'keep',
      rateLimit: { enabled: true, limit: 5, windowSeconds: 30 },
    });
  });

  it('accepts employee rate limit fields through the strict request validation pipe', async () => {
    const validationPipe = new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    });

    const result = await validationPipe.transform(
      {
        dailyTokenLimit: 100000,
        monthlyBudgetLimitUsd: 25,
        rateLimitEnabled: true,
        rateLimitLimit: 12,
        rateLimitWindowSeconds: 60,
        warningThresholdPercent: 80,
      },
      {
        data: '',
        metatype: UpsertProjectEmployeeAssignmentDto,
        type: 'body',
      },
    );

    expect(result).toMatchObject({
      dailyTokenLimit: 100000,
      rateLimitEnabled: true,
      rateLimitLimit: 12,
      rateLimitWindowSeconds: 60,
    });
  });

  it('rejects removed employee Provider and Model fields', async () => {
    const validationPipe = new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    });

    await expect(
      validationPipe.transform(
        {
          allowedModelKeys: ['mock-balanced'],
          allowedProviderConnectionIds: ['00000000-0000-4000-8000-000000000001'],
          monthlyBudgetLimitUsd: 25,
        },
        {
          data: '',
          metatype: UpsertProjectEmployeeAssignmentDto,
          type: 'body',
        },
      ),
    ).rejects.toMatchObject({
      response: {
        message: expect.arrayContaining([
          'property allowedModelKeys should not exist',
          'property allowedProviderConnectionIds should not exist',
        ]),
      },
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

describe('EmployeesService employee invitation deletion', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const employeeId = '00000000-0000-4000-8000-000000000002';
  const timestamp = new Date('2026-07-15T00:00:00.000Z');
  const pendingEmployee = {
    _count: { projectAssignments: 2 },
    acceptedAt: null,
    createdAt: timestamp,
    deletedAt: null,
    department: 'Platform',
    email: 'employee@example.com',
    id: employeeId,
    invitationExpiresAt: new Date('2026-07-22T00:00:00.000Z'),
    invitationRevokedAt: null,
    invitationStatus: 'pending',
    invitationTokenHash: 'stored-token-hash',
    invitedAt: timestamp,
    name: 'Employee',
    status: 'staged',
    tenantId,
    updatedAt: timestamp,
    userId: null,
  };
  const employeeStore = {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  };
  const service = new EmployeesService(
    { employee: employeeStore } as unknown as PrismaService,
    {} as ConfigService,
    new InMemoryEmailSender(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('revokes only the tenant pending invitation and clears its token material', async () => {
    employeeStore.findFirst
      .mockResolvedValueOnce(pendingEmployee)
      .mockResolvedValueOnce({
        ...pendingEmployee,
        invitationExpiresAt: null,
        invitationRevokedAt: timestamp,
        invitationStatus: 'revoked',
        invitationTokenHash: null,
      });
    employeeStore.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.deleteEmployeeInvitation(tenantId, employeeId),
    ).resolves.toMatchObject({
      id: employeeId,
      invitationStatus: 'revoked',
      projectCount: 2,
      tenantId,
    });
    expect(employeeStore.updateMany).toHaveBeenCalledWith({
      data: {
        invitationExpiresAt: null,
        invitationRevokedAt: expect.any(Date),
        invitationStatus: 'revoked',
        invitationTokenHash: null,
      },
      where: {
        acceptedAt: null,
        deletedAt: null,
        id: employeeId,
        invitationStatus: 'pending',
        tenantId,
      },
    });
  });

  it('does not change an accepted invitation', async () => {
    employeeStore.findFirst.mockResolvedValue({
      ...pendingEmployee,
      acceptedAt: timestamp,
      invitationStatus: 'accepted',
    });

    await expect(
      service.deleteEmployeeInvitation(tenantId, employeeId),
    ).rejects.toThrow('Employee invitation is not pending.');
    expect(employeeStore.updateMany).not.toHaveBeenCalled();
  });

  it('rejects deletion when the invitation stopped being pending concurrently', async () => {
    employeeStore.findFirst.mockResolvedValue(pendingEmployee);
    employeeStore.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.deleteEmployeeInvitation(tenantId, employeeId),
    ).rejects.toThrow('Employee invitation is no longer pending.');
    expect(employeeStore.findFirst).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        id: employeeId,
        tenantId,
      },
    });
  });
});

import { PrismaAuthRepository } from './prisma-auth.repository';

describe('PrismaAuthRepository tenant admin account linkage', () => {
  it('creates the canonical membership and legacy admin projection in one transaction', async () => {
    const createdAt = new Date('2026-07-23T13:30:00.000Z');
    const user = {
      actorAuthzVersion: 1,
      authProvider: 'local',
      createdAt,
      deletedAt: null,
      email: 'owner@example.invalid',
      emailVerifiedAt: createdAt,
      id: '00000000-0000-4000-8000-000000000501',
      lastLoginAt: null,
      metadata: {},
      name: 'Owner',
      passwordHash: 'password-hash',
      status: 'active',
      updatedAt: createdAt,
    };
    const tenant = {
      authzVersion: 1,
      createdAt,
      id: '00000000-0000-4000-8000-000000000601',
      name: 'Owner Tenant',
      status: 'ACTIVE',
      totalBudgetUsd: null,
      updatedAt: createdAt,
    };
    const membership = {
      createdAt,
      deletedAt: null,
      id: '00000000-0000-4000-8000-000000000701',
      joinedAt: createdAt,
      role: 'tenant_admin',
      status: 'active',
      tenant,
      tenantId: tenant.id,
      updatedAt: createdAt,
      userId: user.id,
    };
    const transaction = {
      tenant: { create: jest.fn().mockResolvedValue(tenant) },
      tenantAdmin: { create: jest.fn().mockResolvedValue(undefined) },
      tenantMembership: { create: jest.fn().mockResolvedValue(membership) },
      user: {
        create: jest.fn().mockResolvedValue(user),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const repository = new PrismaAuthRepository(prisma as never);

    const result = await repository.createLocalUserTenantAndMembership({
      email: user.email,
      emailVerifiedAt: createdAt,
      name: user.name,
      organizationName: tenant.name,
      passwordHash: user.passwordHash,
    });

    expect(result).toEqual({ membership, tenant, user });
    expect(transaction.tenantAdmin.create).toHaveBeenCalledWith({
      data: { tenantId: tenant.id, userId: user.id },
    });
    expect(
      transaction.tenantMembership.create.mock.invocationCallOrder[0],
    ).toBeLessThan(transaction.tenantAdmin.create.mock.invocationCallOrder[0]!);
    expect(transaction).not.toHaveProperty('employee');
  });
});

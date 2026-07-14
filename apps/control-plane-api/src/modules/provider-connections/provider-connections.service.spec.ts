import { Logger } from '@nestjs/common';
import { Prisma, ProviderConnectionStatus } from '@prisma/client';

import { encryptProviderCredential } from '@/common/security/provider-credential-encryption';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ProviderConnectionsService } from './provider-connections.service';

describe('ProviderConnectionsService', () => {
  const projectId = '00000000-0000-4000-8000-000000000200';
  const applicationId = '00000000-0000-4000-8000-000000000300';
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const createdAt = new Date('2026-06-27T00:00:00.000Z');
  const encryptionKey = '12345678901234567890123456789012';
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  function createService(): {
    service: ProviderConnectionsService;
    prisma: {
      application: { findUnique: jest.Mock };
      project: { findUnique: jest.Mock };
      tenant: { findUnique: jest.Mock };
      providerPreset: { findMany: jest.Mock };
      providerConnection: {
        create: jest.Mock;
        delete: jest.Mock;
        findFirst: jest.Mock;
        findMany: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
        upsert: jest.Mock;
      };
      applicationProviderConnection: {
        count: jest.Mock;
        createMany: jest.Mock;
        deleteMany: jest.Mock;
        findMany: jest.Mock;
      };
      $executeRaw: jest.Mock;
      $queryRaw: jest.Mock;
      $transaction: jest.Mock;
    };
  } {
    const prisma = {
      $transaction: jest.fn(),
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      project: {
        findUnique: jest.fn(),
      },
      application: {
        findUnique: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn(),
      },
      providerPreset: {
        findMany: jest.fn(),
      },
      providerConnection: {
        create: jest.fn(),
        delete: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
      applicationProviderConnection: {
        count: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.$queryRaw.mockResolvedValue([]);

    return {
      service: new ProviderConnectionsService(
        prisma as unknown as PrismaService,
      ),
      prisma,
    };
  }

  it('returns credential preview without exposing secretRef', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(null);
    prisma.providerConnection.create.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000900',
      tenantId,
      projectId,
      provider: 'mock',
      displayName: 'Mock Provider',
      status: ProviderConnectionStatus.ACTIVE,
      baseUrl: 'http://mock-provider:8090',
      timeoutMs: 30000,
      secretRef: 'secret/provider/mock',
      credentialPrefix: 'mock_',
      credentialLast4: '9xA1',
      resolver: 'none',
      providerConfig: { model: 'mock-fast' },
      createdAt: new Date('2026-06-27T00:00:00.000Z'),
      updatedAt: new Date('2026-06-27T00:00:00.000Z'),
    });

    const result = await service.upsertProvider(projectId, {
      provider: 'mock',
      displayName: 'Mock Provider',
      baseUrl: 'http://mock-provider:8090',
      secretRef: 'secret/provider/mock',
      credentialPrefix: 'mock_',
      credentialLast4: '9xA1',
    });

    expect(result).not.toHaveProperty('secretRef');
    expect(result.credentialPreview).toEqual({
      prefix: 'mock_',
      last4: '9xA1',
    });
  });

  it('stores a one-time provider credential in the encrypted credential backend without persisting plaintext', async () => {
    const { service, prisma } = createService();
    process.env.GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const credentialValue = 'synthetic_provider_key_ABCDEFGH1234';
    const providerId = '00000000-0000-4000-8000-000000000919';
    const credentialRefId = `provider_credential:${providerId}`;
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(null);
    prisma.providerConnection.create.mockResolvedValue({
      id: providerId,
      tenantId,
      projectId,
      provider: 'openai-main',
      displayName: 'OpenAI Main',
      status: ProviderConnectionStatus.ACTIVE,
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 30000,
      secretRef: null,
      credentialPrefix: null,
      credentialLast4: null,
      resolver: 'none',
      providerConfig: { adapterType: 'openai_compatible' },
      createdAt,
      updatedAt: createdAt,
    });
    prisma.providerConnection.update.mockResolvedValue({
      id: providerId,
      tenantId,
      projectId,
      provider: 'openai-main',
      displayName: 'OpenAI Main',
      status: ProviderConnectionStatus.ACTIVE,
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 30000,
      secretRef: credentialRefId,
      credentialPrefix: 'provided_',
      credentialLast4: '1234',
      resolver: 'control_plane_secret_store',
      providerConfig: { adapterType: 'openai_compatible' },
      createdAt,
      updatedAt: createdAt,
    });

    const result = await service.upsertProvider(projectId, {
      provider: 'openai-main',
      displayName: 'OpenAI Main',
      baseUrl: 'https://api.openai.com/v1',
      credentialValue,
      resolver: 'environment',
    });
    const providerConnectionPayload = JSON.stringify([
      prisma.providerConnection.create.mock.calls,
      prisma.providerConnection.update.mock.calls,
    ]);
    const credentialStorePayload = JSON.stringify(
      prisma.$executeRaw.mock.calls,
    );

    expect(prisma.providerConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: providerId },
        data: expect.objectContaining({
          credentialLast4: '1234',
          credentialPrefix: 'provided_',
          resolver: 'control_plane_secret_store',
          secretRef: credentialRefId,
        }),
      }),
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(providerConnectionPayload).not.toContain(credentialValue);
    expect(credentialStorePayload).not.toContain(credentialValue);
    expect(credentialStorePayload).toContain(credentialRefId);
    expect(JSON.stringify(result)).not.toContain(credentialValue);
    expect(result.credentialPreview).toEqual({
      prefix: 'provided_',
      last4: '1234',
    });
  });

  it('derives provider credential preview for tenant provider registration', async () => {
    const { service, prisma } = createService();
    process.env.GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const credentialValue = 'synthetic_provider_key_ABCDEFGH9876';
    const providerId = '00000000-0000-4000-8000-000000000920';
    const credentialRefId = `provider_credential:${providerId}`;
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.providerConnection.findFirst.mockResolvedValue(null);
    prisma.providerConnection.create.mockResolvedValue({
      id: providerId,
      tenantId,
      projectId: null,
      provider: 'openai-main',
      displayName: 'OpenAI Main',
      status: ProviderConnectionStatus.ACTIVE,
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 30000,
      secretRef: null,
      credentialPrefix: null,
      credentialLast4: null,
      resolver: 'none',
      providerConfig: { adapterType: 'openai_compatible' },
      createdAt,
      updatedAt: createdAt,
    });
    prisma.providerConnection.update.mockResolvedValue({
      id: providerId,
      tenantId,
      projectId: null,
      provider: 'openai-main',
      displayName: 'OpenAI Main',
      status: ProviderConnectionStatus.ACTIVE,
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 30000,
      secretRef: credentialRefId,
      credentialPrefix: 'provided_',
      credentialLast4: '9876',
      resolver: 'control_plane_secret_store',
      providerConfig: { adapterType: 'openai_compatible' },
      createdAt,
      updatedAt: createdAt,
    });

    const result = await service.upsertTenantProvider(tenantId, {
      provider: 'openai-main',
      displayName: 'OpenAI Main',
      baseUrl: 'https://api.openai.com/v1',
      credentialValue,
      resolver: 'environment',
    });
    const providerConnectionPayload = JSON.stringify([
      prisma.providerConnection.create.mock.calls,
      prisma.providerConnection.update.mock.calls,
    ]);
    const credentialStorePayload = JSON.stringify(
      prisma.$executeRaw.mock.calls,
    );

    expect(prisma.providerConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: providerId },
        data: expect.objectContaining({
          credentialLast4: '9876',
          credentialPrefix: 'provided_',
          resolver: 'control_plane_secret_store',
          secretRef: credentialRefId,
        }),
      }),
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(providerConnectionPayload).not.toContain(credentialValue);
    expect(credentialStorePayload).not.toContain(credentialValue);
    expect(credentialStorePayload).toContain(credentialRefId);
    expect(JSON.stringify(result)).not.toContain(credentialValue);
    expect(result.credentialPreview).toEqual({
      prefix: 'provided_',
      last4: '9876',
    });
  });

  it('updates an existing tenant-level provider when registering it again', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000924';
    const tenantProvider = providerConnection(providerId, {
      baseUrl: 'https://api.openai.com/v1',
      credentialLast4: '0000',
      credentialPrefix: 'env_ref_',
      displayName: 'OpenAI Main',
      projectId: null,
      provider: 'openai-main',
      resolver: 'environment',
      secretRef: `provider_credential:${providerId}`,
      providerConfig: { adapterType: 'openai_compatible' },
    });
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.providerConnection.findFirst.mockResolvedValue(tenantProvider);
    prisma.providerConnection.update.mockResolvedValue(tenantProvider);

    const result = await service.upsertTenantProvider(tenantId, {
      provider: 'openai-main',
      displayName: 'OpenAI Main',
      baseUrl: 'https://api.openai.com/v1',
      resolver: 'environment',
      secretRef: `provider_credential:${providerId}`,
      credentialPrefix: 'env_ref_',
      credentialLast4: '0000',
      providerConfig: {
        adapterType: 'openai_compatible',
      },
    });

    expect(prisma.providerConnection.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId,
        provider: 'openai-main',
        projectId: null,
      },
    });
    expect(prisma.providerConnection.create).not.toHaveBeenCalled();
    expect(prisma.providerConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: providerId },
        data: expect.objectContaining({
          projectId: null,
          providerConfig: { adapterType: 'openai_compatible' },
        }),
      }),
    );
    expect(result).toMatchObject({
      id: providerId,
      projectId: null,
      provider: 'openai-main',
    });
  });

  it('renames an existing tenant-level provider connection without recreating it', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000925';
    const existingProvider = providerConnection(providerId, {
      baseUrl: 'https://api.openai.com/v1',
      displayName: 'OpenAI Main',
      projectId: null,
      provider: 'openai-main',
      providerConfig: {
        adapterType: 'openai_compatible',
        providerFamily: 'openai',
      },
    });
    const renamedProvider = {
      ...existingProvider,
      displayName: 'OpenAI Backup',
      provider: 'openai-backup',
    };
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.providerConnection.findFirst
      .mockResolvedValueOnce(existingProvider)
      .mockResolvedValueOnce(null);
    prisma.providerConnection.update.mockResolvedValue(renamedProvider);

    const result = await service.upsertTenantProvider(tenantId, {
      provider: 'openai-backup',
      previousProvider: 'openai-main',
      displayName: 'OpenAI Backup',
      baseUrl: 'https://api.openai.com/v1',
      providerConfig: {
        adapterType: 'openai_compatible',
        providerFamily: 'openai',
      },
    });

    expect(prisma.providerConnection.create).not.toHaveBeenCalled();
    expect(prisma.providerConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: providerId },
        data: expect.objectContaining({
          displayName: 'OpenAI Backup',
          provider: 'openai-backup',
        }),
      }),
    );
    expect(result).toMatchObject({
      id: providerId,
      provider: 'openai-backup',
      displayName: 'OpenAI Backup',
    });
  });

  it('rejects a stored provider credential ref owned by another tenant', async () => {
    const { service, prisma } = createService();
    process.env.GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const credentialValue = 'synthetic_provider_key_ABCDEFGH2468';
    const providerId = '00000000-0000-4000-8000-000000000922';
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.providerConnection.findFirst.mockResolvedValue(null);
    prisma.providerConnection.create.mockResolvedValue({
      id: providerId,
      tenantId,
      projectId: null,
      provider: 'openai-main',
      displayName: 'OpenAI Main',
      status: ProviderConnectionStatus.ACTIVE,
      baseUrl: 'https://api.openai.com/v1',
      timeoutMs: 30000,
      secretRef: null,
      credentialPrefix: null,
      credentialLast4: null,
      resolver: 'none',
      providerConfig: { adapterType: 'openai_compatible' },
      createdAt,
      updatedAt: createdAt,
    });
    prisma.$executeRaw.mockResolvedValue(0);

    await expect(
      service.upsertTenantProvider(tenantId, {
        provider: 'openai-main',
        displayName: 'OpenAI Main',
        baseUrl: 'https://api.openai.com/v1',
        credentialValue,
        resolver: 'environment',
        secretRef: 'provider_credential:shared-ref',
      }),
    ).rejects.toThrow(
      'Provider credential reference is already owned by another tenant.',
    );
    expect(prisma.providerConnection.update).not.toHaveBeenCalled();
    expect(JSON.stringify(prisma.$executeRaw.mock.calls)).not.toContain(
      credentialValue,
    );
  });

  it('lists provider presets without credential material', async () => {
    const { service, prisma } = createService();
    prisma.providerPreset.findMany.mockResolvedValue([
      {
        providerKey: 'openai',
        displayName: 'OpenAI',
        adapterType: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        modelsEndpointPath: '/models',
        credentialRequired: true,
        defaultResolver: 'environment',
        defaultTimeoutMs: 30000,
        status: 'ACTIVE',
        sortOrder: 10,
        providerConfig: {
          requestFormat: 'openai_chat_completions',
        },
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    const result = await service.listProviderPresets({});

    expect(prisma.providerPreset.findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { providerKey: 'asc' }],
      take: 51,
      where: { status: 'ACTIVE' },
    });
    expect(result.data).toEqual([
      expect.objectContaining({
        adapterType: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        credentialRequired: true,
        defaultResolver: 'environment',
        displayName: 'OpenAI',
        modelsEndpointPath: '/models',
        providerKey: 'openai',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('Authorization');
    expect(JSON.stringify(result)).not.toContain('Bearer ');
  });

  it('lists only tenant-level provider connections for the tenant/global provider registry', async () => {
    const { service, prisma } = createService();
    const tenantProvider = providerConnection(
      '00000000-0000-4000-8000-000000000929',
      {
        projectId: null,
        provider: 'openai-main',
      },
    );
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.providerConnection.findMany.mockResolvedValue([tenantProvider]);

    const result = await service.listTenantProviders(tenantId, { limit: 10 });

    expect(prisma.providerConnection.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 11,
      where: {
        tenantId,
        projectId: null,
      },
    });
    expect(result.data).toEqual([
      expect.objectContaining({
        projectId: null,
        provider: 'openai-main',
      }),
    ]);
  });

  it('rejects application provider assignments that reference project-scoped providers', async () => {
    const { service, prisma } = createService();
    const projectScopedProviderId =
      '00000000-0000-4000-8000-000000000928';
    prisma.application.findUnique.mockResolvedValue({
      id: applicationId,
      projectId,
      tenantId,
    });
    prisma.providerConnection.findMany.mockResolvedValue([]);

    await expect(
      service.setApplicationProviders(applicationId, {
        providerConnectionIds: [projectScopedProviderId],
      }),
    ).rejects.toThrow(
      'Application provider connections must reference tenant-level providers from the same tenant.',
    );

    expect(prisma.providerConnection.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [projectScopedProviderId] },
        projectId: null,
        tenantId,
      },
    });
    expect(prisma.applicationProviderConnection.deleteMany).not.toHaveBeenCalled();
    expect(prisma.applicationProviderConnection.createMany).not.toHaveBeenCalled();
  });

  it('deletes an unassigned tenant-level provider connection without exposing credential material', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000930';
    const tenantProvider = providerConnection(providerId, {
      projectId: null,
      provider: 'openai-main',
      displayName: 'OpenAI Main',
      resolver: 'control_plane_secret_store',
      secretRef: `provider_credential:${providerId}`,
      credentialPrefix: 'provided_',
      credentialLast4: '1234',
    });
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.providerConnection.findFirst.mockResolvedValue(tenantProvider);
    prisma.providerConnection.delete.mockResolvedValue(tenantProvider);

    const result = await service.deleteTenantProvider(
      tenantId,
      'openai-main',
    );

    expect(prisma.providerConnection.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId,
        provider: 'openai-main',
        projectId: null,
      },
    });
    expect(prisma.providerConnection.delete).toHaveBeenCalledWith({
      where: { id: providerId },
    });
    expect(result).toMatchObject({
      id: providerId,
      projectId: null,
      provider: 'openai-main',
    });
    expect(JSON.stringify(result)).not.toContain(`provider_credential:${providerId}`);
  });

  it('deletes a project provider connection and relies on cascade cleanup for application assignments', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000931';
    const projectProvider = providerConnection(providerId, {
      projectId,
      provider: 'openai-main',
    });
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(projectProvider);
    prisma.providerConnection.delete.mockResolvedValue(projectProvider);

    const result = await service.deleteProvider(projectId, 'openai-main');

    expect(prisma.providerConnection.findUnique).toHaveBeenCalledWith({
      where: {
        projectId_provider: {
          projectId,
          provider: 'openai-main',
        },
      },
    });
    expect(prisma.applicationProviderConnection.count).not.toHaveBeenCalled();
    expect(prisma.providerConnection.delete).toHaveBeenCalledWith({
      where: { id: providerId },
    });
    expect(result).toMatchObject({
      id: providerId,
      projectId,
      provider: 'openai-main',
    });
  });

  it('deletes a tenant provider connection and relies on cascade cleanup for application assignments', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000932';
    const tenantProvider = providerConnection(providerId, {
      projectId: null,
      provider: 'openai-main',
    });
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.providerConnection.findFirst.mockResolvedValue(tenantProvider);
    prisma.providerConnection.delete.mockResolvedValue(tenantProvider);

    const result = await service.deleteTenantProvider(
      tenantId,
      'openai-main',
    );

    expect(prisma.applicationProviderConnection.count).not.toHaveBeenCalled();
    expect(prisma.providerConnection.delete).toHaveBeenCalledWith({
      where: { id: providerId },
    });
    expect(result).toMatchObject({
      id: providerId,
      projectId: null,
      provider: 'openai-main',
    });
  });

  it('sets provider preset pagination cursor from the last returned provider key', async () => {
    const { service, prisma } = createService();
    prisma.providerPreset.findMany.mockResolvedValue([
      {
        providerKey: 'openai',
        displayName: 'OpenAI',
        adapterType: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        modelsEndpointPath: '/models',
        credentialRequired: true,
        defaultResolver: 'environment',
        defaultTimeoutMs: 30000,
        status: 'ACTIVE',
        sortOrder: 10,
        providerConfig: {},
        createdAt,
        updatedAt: createdAt,
      },
      {
        providerKey: 'gemini',
        displayName: 'Gemini',
        adapterType: 'openai_compatible',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        modelsEndpointPath: '/models',
        credentialRequired: true,
        defaultResolver: 'environment',
        defaultTimeoutMs: 30000,
        status: 'ACTIVE',
        sortOrder: 20,
        providerConfig: {},
        createdAt,
        updatedAt: createdAt,
      },
      {
        providerKey: 'claude',
        displayName: 'Claude',
        adapterType: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        modelsEndpointPath: '/models',
        credentialRequired: true,
        defaultResolver: 'environment',
        defaultTimeoutMs: 30000,
        status: 'ACTIVE',
        sortOrder: 30,
        providerConfig: {},
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    const result = await service.listProviderPresets({
      cursor: 'openai',
      limit: 2,
    });

    expect(prisma.providerPreset.findMany).toHaveBeenCalledWith({
      cursor: { providerKey: 'openai' },
      orderBy: [{ sortOrder: 'asc' }, { providerKey: 'asc' }],
      skip: 1,
      take: 3,
      where: { status: 'ACTIVE' },
    });
    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({
      limit: 2,
      nextCursor: 'gemini',
      hasMore: true,
    });
  });

  it('discovers provider models with an encrypted credential backend reference', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000921';
    const credentialRefId = `provider_credential:${providerId}`;
    const providerCredential = 'synthetic-provider-credential-from-store';
    process.env.GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY = encryptionKey;
    const encrypted = encryptProviderCredential(
      providerCredential,
      credentialRefId,
    );
    prisma.$queryRaw.mockResolvedValue([
      {
        credentialRefId,
        status: 'ACTIVE',
        encryptedValue: encrypted.encryptedValue,
        encryptionNonce: encrypted.encryptionNonce,
        encryptionTag: encrypted.encryptionTag,
        encryptionKeyVersion: encrypted.encryptionKeyVersion,
      },
    ]);
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-main',
        resolver: 'control_plane_secret_store',
        secretRef: credentialRefId,
        providerConfig: { adapterType: 'openai_compatible' },
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [{ id: 'gpt-4o-mini', object: 'model' }],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(
      projectId,
      'openai-main',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${providerCredential}`,
        }),
        method: 'GET',
      }),
    );
    expect(JSON.stringify(result)).not.toContain(providerCredential);
  });

  it('discovers provider models with an environment credential binding fallback', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000905';
    const providerCredential = 'test-provider-credential';
    process.env.CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP = `provider_credential:${providerId}=OPENAI_API_KEY`;
    process.env.OPENAI_API_KEY = providerCredential;
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-main',
        resolver: 'environment',
        secretRef: `provider_credential:${providerId}`,
        providerConfig: { adapterType: 'openai_compatible' },
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            capabilities: {
              completion_chat: true,
              json_mode: true,
              streaming: true,
            },
            id: 'gpt-4o-mini',
            max_context_length: 128000,
            object: 'model',
            created: 1715367049,
            owned_by: 'openai',
          },
        ],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(
      projectId,
      'openai-main',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${providerCredential}`,
        }),
        method: 'GET',
      }),
    );
    expect(result).toMatchObject({
      adapterType: 'openai_compatible',
      credentialRequired: true,
      modelCount: 1,
      models: [
        expect.objectContaining({
          chatCompletionSupported: true,
          contextWindowTokens: 128000,
          modelName: 'gpt-4o-mini',
          ownedBy: 'openai',
          provider: 'openai-main',
          providerId,
          supportsJsonMode: true,
          supportsStreaming: true,
        }),
      ],
      provider: 'openai-main',
      providerId,
    });
    expect(JSON.stringify(result)).not.toContain(providerCredential);
  });

  it('does not fall back to env-map when a stored provider credential is inactive', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000923';
    const credentialRefId = `provider_credential:${providerId}`;
    process.env.CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP = `${credentialRefId}=OPENAI_API_KEY`;
    process.env.OPENAI_API_KEY = 'synthetic-env-fallback-credential';
    prisma.$queryRaw.mockResolvedValue([
      {
        credentialRefId,
        status: 'REVOKED',
        encryptedValue: 'redacted',
        encryptionNonce: 'redacted',
        encryptionTag: 'redacted',
        encryptionKeyVersion: 'v1',
      },
    ]);
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-main',
        resolver: 'control_plane_secret_store',
        secretRef: credentialRefId,
        providerConfig: { adapterType: 'openai_compatible' },
      }),
    );
    global.fetch = jest.fn();

    await expect(
      service.discoverProviderModels(projectId, 'openai-main'),
    ).rejects.toThrow('Provider credential reference is not active.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('discovers provider models from a host-only OpenAI-compatible base URL', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000914';
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.openai.com',
        provider: 'openai-main',
        resolver: 'none',
        secretRef: null,
        providerConfig: {
          adapterType: 'openai_compatible',
          credentialRequired: false,
        },
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [{ id: 'gpt-4o-mini', object: 'model' }],
      }),
    } as unknown as Response);

    await service.discoverProviderModels(projectId, 'openai-main');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('discovers Gemini models through the OpenAI-compatible Gemini models endpoint', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000913';
    const providerCredential = 'AQ.synthetic-gemini-auth-key';
    process.env.CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP = `provider_credential:${providerId}=GEMINI_PROVIDER_CREDENTIAL`;
    process.env.GEMINI_PROVIDER_CREDENTIAL = providerCredential;
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        provider: 'gemini',
        resolver: 'environment',
        secretRef: `provider_credential:${providerId}`,
        providerConfig: {
          adapterType: 'openai_compatible',
          credentialRequired: true,
          modelDiscovery: {
            type: 'openai_compatible_models',
          },
          requestFormat: 'openai_chat_completions',
        },
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'gemini-1.5-flash',
            object: 'model',
            owned_by: 'google',
          },
          {
            id: 'embedding-001',
            object: 'model',
            owned_by: 'google',
          },
        ],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(projectId, 'gemini');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${providerCredential}`,
        }),
        method: 'GET',
      }),
    );
    expect(result).toMatchObject({
      adapterType: 'openai_compatible',
      credentialRequired: true,
      modelCount: 2,
      models: expect.arrayContaining([
        expect.objectContaining({
          displayName: 'gemini-1.5-flash',
          modelName: 'gemini-1.5-flash',
          object: 'model',
          provider: 'gemini',
          providerId,
        }),
      ]),
      provider: 'gemini',
      providerId,
    });
    expect(JSON.stringify(result)).not.toContain(providerCredential);
  });

  it('discovers Claude models through Anthropic model discovery headers', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000917';
    const providerCredential = 'synthetic-provider-credential';
    process.env.CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP = `provider_credential:${providerId}=CLAUDE_PROVIDER_CREDENTIAL`;
    process.env.CLAUDE_PROVIDER_CREDENTIAL = providerCredential;
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.anthropic.com/v1',
        provider: 'claude',
        resolver: 'environment',
        secretRef: `provider_credential:${providerId}`,
        providerConfig: {
          adapterType: 'anthropic',
          apiVersion: '2023-06-01',
          requestFormat: 'anthropic_messages',
        },
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'claude-synthetic-sonnet',
            type: 'model',
            display_name: 'Claude Synthetic Sonnet',
            created_at: '2026-07-02T00:00:00.000Z',
          },
        ],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(projectId, 'claude');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'anthropic-version': '2023-06-01',
          'x-api-key': providerCredential,
        }),
        method: 'GET',
      }),
    );
    expect(result).toMatchObject({
      adapterType: 'anthropic',
      credentialRequired: true,
      modelCount: 1,
      models: [
        expect.objectContaining({
          displayName: 'Claude Synthetic Sonnet',
          modelName: 'claude-synthetic-sonnet',
          object: 'model',
          provider: 'claude',
          providerId,
        }),
      ],
      provider: 'claude',
      providerId,
    });
    expect(JSON.stringify(result)).not.toContain(providerCredential);
  });

  it('strips query and fragment material from provider model discovery endpoints', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection('00000000-0000-4000-8000-000000000916', {
        baseUrl:
          'https://generativelanguage.googleapis.com/v1beta/openai?region=us#models',
        provider: 'gemini',
        resolver: 'none',
        secretRef: null,
        providerConfig: {
          adapterType: 'openai_compatible',
          credentialRequired: false,
          requestFormat: 'openai_chat_completions',
        },
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'gemini-1.5-flash',
            object: 'model',
          },
        ],
      }),
    } as unknown as Response);

    await service.discoverProviderModels(projectId, 'gemini');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('discovers provider models from a custom provider models endpoint path', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000911';
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.example.com/openai',
        provider: 'custom-openai',
        resolver: 'none',
        secretRef: null,
        providerConfig: {
          adapterType: 'openai_compatible',
          credentialRequired: false,
          modelsEndpointPath: '/v1/custom-models',
        },
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [{ id: 'custom-model', object: 'model' }],
      }),
    } as unknown as Response);

    await service.discoverProviderModels(projectId, 'custom-openai');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/openai/v1/custom-models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('ignores malformed upstream provider model records without throwing', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000918';
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'http://mock-provider:8090/v1',
        provider: 'mock',
        providerConfig: {
          adapterType: 'mock',
          credentialRequired: false,
        },
        resolver: 'none',
        secretRef: null,
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          { object: 'model' },
          { id: 12345, object: 'model' },
          { id: '   ', object: 'model' },
          null,
          { id: 'mock-balanced', object: 'model' },
        ],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(projectId, 'mock');

    expect(result.modelCount).toBe(1);
    expect(result.models.map((model) => model.modelName)).toEqual([
      'mock-balanced',
    ]);
  });

  it('sorts discovered provider models by newest created timestamp first', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000925';
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-main',
        providerConfig: {
          adapterType: 'openai_compatible',
          credentialRequired: false,
        },
        resolver: 'none',
        secretRef: null,
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'gpt-5-mini',
            object: 'model',
            created: 1900000000,
            owned_by: 'openai',
          },
          {
            id: 'gpt-4o',
            object: 'model',
            created: 1700000000,
            owned_by: 'openai',
          },
          {
            id: 'gpt-5',
            object: 'model',
            created: 1800000000,
            owned_by: 'openai',
          },
        ],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(
      projectId,
      'openai-main',
    );

    expect(result.models.map((model) => model.modelName)).toEqual([
      'gpt-5-mini',
      'gpt-5',
      'gpt-4o',
    ]);
  });

  it('sorts discovered models without created timestamps by provider model version', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000926';
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        provider: 'gemini',
        providerConfig: {
          adapterType: 'openai_compatible',
          credentialRequired: false,
        },
        resolver: 'none',
        secretRef: null,
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          { id: 'gemini-1.5-pro', object: 'model', owned_by: 'google' },
          { id: 'gemini-2.5-flash-lite', object: 'model', owned_by: 'google' },
          { id: 'gemini-2.0-flash', object: 'model', owned_by: 'google' },
          { id: 'gemini-2.5-pro', object: 'model', owned_by: 'google' },
          { id: 'gemini-1.5-flash', object: 'model', owned_by: 'google' },
        ],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(projectId, 'gemini');

    expect(result.models.map((model) => model.modelName)).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ]);
  });

  it('normalizes provider model created timestamps in milliseconds', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000908';
    const createdAtMs = 1715367049000;
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'http://mock-provider:8090/v1',
        provider: 'mock',
        providerConfig: {
          adapterType: 'mock',
          credentialRequired: false,
        },
        resolver: 'none',
        secretRef: null,
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'mock-balanced',
            object: 'model',
            created: createdAtMs,
            owned_by: 'mock',
          },
        ],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(projectId, 'mock');

    expect(result.models[0]?.createdAt).toBe(
      new Date(createdAtMs).toISOString(),
    );
  });

  it('normalizes provider model created timestamps from ISO strings', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000912';
    const createdAtIso = '2026-07-02T00:00:00.000Z';
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'http://mock-provider:8090/v1',
        provider: 'mock',
        providerConfig: {
          adapterType: 'mock',
          credentialRequired: false,
        },
        resolver: 'none',
        secretRef: null,
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'mock-balanced',
            object: 'model',
            created: createdAtIso,
            owned_by: 'mock',
          },
        ],
      }),
    } as unknown as Response);

    const result = await service.discoverProviderModels(projectId, 'mock');

    expect(result.models[0]?.createdAt).toBe(createdAtIso);
  });

  it('rejects provider model discovery when a required credential is not bound', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000906';
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-main',
        resolver: 'environment',
        secretRef: `provider_credential:${providerId}`,
        providerConfig: { adapterType: 'openai_compatible' },
      }),
    );
    global.fetch = jest.fn();

    await expect(
      service.discoverProviderModels(projectId, 'openai-main'),
    ).rejects.toThrow(
      'Provider credential reference is not bound to an available environment variable.',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(['api-key', 'credential', 'credentials', 'secret', 'password', 'pwd'])(
    'rejects provider model discovery base URLs with %s query material',
    async (queryKey) => {
      const { service, prisma } = createService();
      prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
      prisma.providerConnection.findUnique.mockResolvedValue(
        providerConnection('00000000-0000-4000-8000-000000000907', {
          baseUrl: `https://api.openai.com/v1?${queryKey}=synthetic`,
          provider: 'openai-main',
          resolver: 'none',
          providerConfig: {
            adapterType: 'openai_compatible',
            credentialRequired: false,
          },
        }),
      );
      global.fetch = jest.fn();

      await expect(
        service.discoverProviderModels(projectId, 'openai-main'),
      ).rejects.toThrow(
        'Provider baseUrl must not contain credential material.',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid provider model discovery base URLs with a clear message', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection('00000000-0000-4000-8000-000000000909', {
        baseUrl: 'not a valid url',
        provider: 'openai-main',
        resolver: 'none',
        providerConfig: {
          adapterType: 'openai_compatible',
          credentialRequired: false,
        },
      }),
    );
    global.fetch = jest.fn();

    await expect(
      service.discoverProviderModels(projectId, 'openai-main'),
    ).rejects.toThrow('Provider baseUrl is invalid.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('logs provider model discovery transport failures without credential material', async () => {
    const { service, prisma } = createService();
    const providerId = '00000000-0000-4000-8000-000000000910';
    const providerCredential = 'test-provider-credential';
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    process.env.CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP = `provider_credential:${providerId}=OPENAI_API_KEY`;
    process.env.OPENAI_API_KEY = providerCredential;
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(
      providerConnection(providerId, {
        baseUrl: 'https://api.openai.com/v1',
        provider: 'openai-main',
        resolver: 'environment',
        secretRef: `provider_credential:${providerId}`,
        providerConfig: { adapterType: 'openai_compatible' },
      }),
    );
    const transportError = new Error('synthetic network failure');
    Object.assign(transportError, { code: 'ECONNRESET' });
    global.fetch = jest.fn().mockRejectedValue(transportError);

    await expect(
      service.discoverProviderModels(projectId, 'openai-main'),
    ).rejects.toThrow('Provider model discovery failed.');

    expect(warnSpy).toHaveBeenCalledWith(
      'Provider model discovery upstream call failed. errorName=Error; errorCode=ECONNRESET',
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(providerCredential);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('Authorization');
  });

  it('sets hasMore and nextCursor from limit plus one pagination', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findMany.mockResolvedValue([
      providerConnection('00000000-0000-4000-8000-000000000901'),
      providerConnection('00000000-0000-4000-8000-000000000902'),
      providerConnection('00000000-0000-4000-8000-000000000903'),
    ]);

    const result = await service.listProviders(projectId, { limit: 2 });

    expect(prisma.providerConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({
      limit: 2,
      nextCursor: '00000000-0000-4000-8000-000000000902',
      hasMore: true,
    });
  });

  it('maps explicit null providerConfig to Prisma DbNull', async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({ id: projectId, tenantId });
    prisma.providerConnection.findUnique.mockResolvedValue(null);
    prisma.providerConnection.create.mockResolvedValue(
      providerConnection('00000000-0000-4000-8000-000000000904'),
    );

    await service.upsertProvider(projectId, {
      provider: 'mock',
      displayName: 'Mock Provider',
      baseUrl: 'http://mock-provider:8090',
      providerConfig: null,
    });

    expect(prisma.providerConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerConfig: Prisma.DbNull,
        }),
      }),
    );
  });

  function providerConnection(
    id: string,
    overrides: Partial<ProviderConnectionFixture> = {},
  ): ProviderConnectionFixture {
    return {
      id,
      tenantId,
      projectId,
      provider: 'mock',
      displayName: 'Mock Provider',
      status: ProviderConnectionStatus.ACTIVE,
      baseUrl: 'http://mock-provider:8090',
      timeoutMs: 30000,
      secretRef: 'secret/provider/mock',
      credentialPrefix: 'mock_',
      credentialLast4: '9xA1',
      resolver: 'none',
      providerConfig: { model: 'mock-fast' },
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    };
  }

  type ProviderConnectionFixture = {
    baseUrl: string;
    createdAt: Date;
    credentialLast4: string | null;
    credentialPrefix: string | null;
    displayName: string;
    id: string;
    projectId: string | null;
    provider: string;
    providerConfig: Prisma.JsonValue;
    resolver: string;
    secretRef: string | null;
    status: ProviderConnectionStatus;
    tenantId: string;
    timeoutMs: number;
    updatedAt: Date;
  };
});

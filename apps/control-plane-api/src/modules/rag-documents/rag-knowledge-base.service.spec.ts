import type { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import type { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { RagKnowledgeBaseService } from './rag-knowledge-base.service';

describe('RagKnowledgeBaseService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';

  it('returns the default disabled state when the tenant has no Knowledge Base', async () => {
    const { service } = createService({ globalEnabled: true, status: null });

    await expect(service.getSettings(tenantId)).resolves.toEqual({
      tenantEnabled: false,
      globalEnabled: true,
      effectiveEnabled: false,
    });
  });

  it('requires both the global and tenant switches for effective enablement', async () => {
    const globallyOff = createService({
      globalEnabled: false,
      status: 'ENABLED',
    });
    const globallyOn = createService({
      globalEnabled: true,
      status: 'ENABLED',
    });

    await expect(globallyOff.service.getSettings(tenantId)).resolves.toEqual({
      tenantEnabled: true,
      globalEnabled: false,
      effectiveEnabled: false,
    });
    await expect(globallyOn.service.getSettings(tenantId)).resolves.toEqual({
      tenantEnabled: true,
      globalEnabled: true,
      effectiveEnabled: true,
    });
  });

  it('enables a tenant using the fixed embedding profile', async () => {
    const { prisma, service } = createService({
      globalEnabled: true,
      status: 'ENABLED',
    });

    await expect(service.updateSettings(tenantId, true)).resolves.toEqual({
      tenantEnabled: true,
      globalEnabled: true,
      effectiveEnabled: true,
    });
    expect(prisma.ragKnowledgeBase.upsert).toHaveBeenCalledWith({
      where: { tenantId },
      create: {
        tenantId,
        status: 'ENABLED',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-large',
        embeddingDimensions: 1536,
        embeddingDistance: 'cosine',
        embeddingProfileVersion: 1,
      },
      update: { status: 'ENABLED' },
      select: { status: true },
    });
  });

  it('disables only the Knowledge Base status and leaves documents and indexes untouched', async () => {
    const { prisma, service } = createService({
      globalEnabled: true,
      status: 'DISABLED',
    });

    await expect(service.updateSettings(tenantId, false)).resolves.toMatchObject({
      tenantEnabled: false,
      effectiveEnabled: false,
    });
    expect(prisma.ragKnowledgeBase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { status: 'DISABLED' } }),
    );
    expect(prisma.ragDocument.deleteMany).not.toHaveBeenCalled();
    expect(prisma.ragDocumentIndex.deleteMany).not.toHaveBeenCalled();
    expect(prisma.ragChunk.deleteMany).not.toHaveBeenCalled();
  });

  it('recovers a concurrent singleton create and preserves the requested status', async () => {
    const { prisma, service } = createService({
      globalEnabled: true,
      status: 'ENABLED',
    });
    prisma.ragKnowledgeBase.upsert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique conflict', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );
    prisma.ragKnowledgeBase.update.mockResolvedValueOnce({ status: 'ENABLED' });

    await expect(service.updateSettings(tenantId, true)).resolves.toMatchObject({
      tenantEnabled: true,
      effectiveEnabled: true,
    });
    expect(prisma.ragKnowledgeBase.update).toHaveBeenCalledWith({
      where: { tenantId },
      data: { status: 'ENABLED' },
      select: { status: true },
    });
  });

  it('normalizes database failures without exposing persistence details', async () => {
    const { prisma, service } = createService({
      globalEnabled: true,
      status: null,
    });
    prisma.ragKnowledgeBase.findUnique.mockRejectedValueOnce(
      new Error('secret database detail'),
    );
    await expect(service.getSettings(tenantId)).rejects.toMatchObject({
      response: {
        code: 'RAG_KNOWLEDGE_BASE_UNAVAILABLE',
        message: 'Knowledge Base settings are temporarily unavailable.',
      },
    });

    prisma.ragKnowledgeBase.upsert.mockRejectedValueOnce(
      new Error('secret database detail'),
    );
    await expect(service.updateSettings(tenantId, true)).rejects.toMatchObject({
      response: {
        code: 'RAG_KNOWLEDGE_BASE_UNAVAILABLE',
        message: 'Knowledge Base settings are temporarily unavailable.',
      },
    });
  });
});

function createService({
  globalEnabled,
  status,
}: {
  globalEnabled: boolean;
  status: 'ENABLED' | 'DISABLED' | null;
}) {
  const prisma = {
    ragChunk: { deleteMany: jest.fn() },
    ragDocument: { deleteMany: jest.fn() },
    ragDocumentIndex: { deleteMany: jest.fn() },
    ragKnowledgeBase: {
      findUnique: jest.fn().mockResolvedValue(status ? { status } : null),
      update: jest.fn(),
      upsert: jest.fn().mockResolvedValue({ status: status ?? 'DISABLED' }),
    },
  };
  const config = {
    get: jest.fn().mockReturnValue(globalEnabled ? 'true' : 'false'),
  };
  return {
    prisma,
    service: new RagKnowledgeBaseService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    ),
  };
}

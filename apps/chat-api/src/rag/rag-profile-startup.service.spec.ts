import { RagEmbeddingProfileMismatchError } from '@gatelm/rag-config';

import type { PrismaService } from '@/database/prisma.service';

import { RagProfileStartupService } from './rag-profile-startup.service';

describe('Chat API RAG profile startup validation', () => {
  it('validates the DB profile even while the global feature flag defaults disabled', async () => {
    const findFirst = jest.fn();
    findFirst.mockResolvedValue(null);
    const service = createService(findFirst);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('accepts startup when no mismatched Knowledge Base exists', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = createService(findFirst);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('fails startup without exposing row identity when DB dimensions differ', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'internal-only' });
    const service = createService(findFirst);
    const startup = service.onApplicationBootstrap();

    await expect(startup).rejects.toBeInstanceOf(
      RagEmbeddingProfileMismatchError,
    );
    await expect(startup).rejects.not.toThrow(/internal-only/);
  });
});

function createService(findFirst: jest.Mock) {
  const prisma = {
    ragKnowledgeBase: { findFirst },
  } as unknown as PrismaService;
  return new RagProfileStartupService(prisma);
}

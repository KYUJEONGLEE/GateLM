import { RagEmbeddingProfileMismatchError } from '@gatelm/rag-config';

import type { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { RagProfileStartupService } from './rag-profile-startup.service';

describe('Control Plane RAG profile startup validation', () => {
  it('validates the DB profile before startup while the feature remains disabled', async () => {
    const findFirst = jest.fn();
    findFirst.mockResolvedValue(null);
    const service = createService(findFirst);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('accepts startup when no mismatched Knowledge Base exists', async () => {
    const service = createService(jest.fn().mockResolvedValue(null));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('fails startup safely when the database profile differs', async () => {
    const service = createService(
      jest.fn().mockResolvedValue({ id: 'internal-only' }),
    );
    await expect(service.onApplicationBootstrap()).rejects.toBeInstanceOf(
      RagEmbeddingProfileMismatchError,
    );
  });
});

function createService(findFirst: jest.Mock) {
  const prisma = {
    ragKnowledgeBase: { findFirst },
  } as unknown as PrismaService;
  return new RagProfileStartupService(prisma);
}

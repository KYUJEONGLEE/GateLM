import { randomUUID } from 'node:crypto';

import type { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { RagJobRepository, type PersistedEncryptedChunk } from './rag-job.repository';
import type { ClaimedRagJob } from './rag-worker.types';

describe('RagJobRepository', () => {
  it('batches large chunk inserts inside the existing completion transaction', async () => {
    const executeRaw = jest.fn().mockResolvedValue(500);
    const tx = {
      $executeRaw: executeRaw,
      ragJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ragDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ragDocumentIndex: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ragChunk: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      ragEmbeddingUsage: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      ragKnowledgeBase: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const repository = new RagJobRepository(prisma as unknown as PrismaService);
    const job: ClaimedRagJob = {
      id: randomUUID(),
      tenantId: randomUUID(),
      knowledgeBaseId: randomUUID(),
      documentId: randomUUID(),
      type: 'INGEST',
      deletionObjectKeySnapshot: null,
      attemptCount: 1,
      maxAttempts: 5,
    };
    const chunks = Array.from({ length: 1_001 }, (_, ordinal): PersistedEncryptedChunk => ({
      id: randomUUID(),
      ordinal,
      tokenCount: 1,
      pageStart: null,
      pageEnd: null,
      lineStart: ordinal + 1,
      lineEnd: ordinal + 1,
      sourceMetadata: { sourceType: 'txt' },
      ciphertext: Buffer.from([1]),
      nonce: Buffer.alloc(12, 2),
      authTag: Buffer.alloc(16, 3),
      contentKeyVersion: 1,
      embedding: [0.1],
    }));

    await expect(repository.completeIngestion({
      job,
      workerId: 'worker_001',
      indexId: randomUUID(),
      chunks,
      usages: [],
    })).resolves.toBe(true);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.ragJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ attemptCount: 1, lockedBy: 'worker_001' }),
    }));
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });
});

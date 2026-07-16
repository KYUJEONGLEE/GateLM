import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createRagChunkAadV1, encryptContent } from '@gatelm/tenant-content-crypto';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { RagJobRepository } from './rag-job.repository';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public';

describe('RagJobRepository PostgreSQL claim integration', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const repository = new RagJobRepository(prisma as PrismaService);
  const ids = {
    tenant: randomUUID(), user: randomUUID(), knowledgeBase: randomUUID(), document: randomUUID(), job: randomUUID(),
  };
  let recovered: Awaited<ReturnType<RagJobRepository['claimNext']>>;

  beforeAll(async () => {
    await prisma.tenant.create({ data: { id: ids.tenant, name: 'RAG worker integration tenant' } });
    await prisma.user.create({ data: { id: ids.user, email: `rag-worker-${ids.user}@example.invalid` } });
    await prisma.tenantChatContentKey.create({
      data: {
        tenantId: ids.tenant, contentKeyVersion: 1, wrappingKeyVersion: 1,
        wrappedKey: Buffer.alloc(32, 1), wrapNonce: Buffer.alloc(12, 2), wrapTag: Buffer.alloc(16, 3),
      },
    });
    await prisma.ragKnowledgeBase.create({ data: { id: ids.knowledgeBase, tenantId: ids.tenant } });
    await prisma.ragDocument.create({
      data: {
        id: ids.document, publicId: randomUUID(), tenantId: ids.tenant, knowledgeBaseId: ids.knowledgeBase,
        privateMetadataCiphertext: Buffer.from('fixture'), privateMetadataNonce: Buffer.alloc(12, 4),
        privateMetadataAuthTag: Buffer.alloc(16, 5), privateMetadataContentKeyVersion: 1,
        fileExtension: 'txt', mimeType: 'text/plain', sizeBytes: BigInt(7),
        s3ObjectKey: `rag/${ids.tenant}/${ids.document}/source`, uploadedByUserId: ids.user,
      },
    });
    await prisma.ragJob.create({
      data: {
        id: ids.job, tenantId: ids.tenant, knowledgeBaseId: ids.knowledgeBase, documentId: ids.document,
        type: 'INGEST', idempotencyKey: `test_${ids.job}`,
      },
    });
  });

  afterAll(async () => {
    await prisma.ragEmbeddingUsage.deleteMany({ where: { tenantId: ids.tenant } });
    await prisma.ragJob.deleteMany({ where: { tenantId: ids.tenant } });
    await prisma.ragDocument.deleteMany({ where: { tenantId: ids.tenant } });
    await prisma.ragKnowledgeBase.deleteMany({ where: { tenantId: ids.tenant } });
    await prisma.tenantChatContentKey.deleteMany({ where: { tenantId: ids.tenant } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.tenant.deleteMany({ where: { id: ids.tenant } });
    await prisma.$disconnect();
  });

  it('lets two workers atomically claim the same pending INGEST job only once', async () => {
    await prisma.ragJob.update({
      where: { id: ids.job },
      data: { status: 'PENDING', attemptCount: 0, availableAt: new Date(Date.now() - 1_000), lockedAt: null, lockedBy: null, leaseExpiresAt: null },
    });
    const [first, second] = await Promise.all([
      repository.claimNext('worker_a', 60_000),
      repository.claimNext('worker_b', 60_000),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(first?.id ?? second?.id).toBe(ids.job);
  });

  it('reclaims an expired worker lease and increments the attempt count', async () => {
    await prisma.ragJob.update({
      where: { id: ids.job },
      data: {
        status: 'RUNNING', attemptCount: 1, lockedBy: 'crashed_worker', lockedAt: new Date(Date.now() - 120_000),
        leaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    const claimed = await repository.claimNext('recovery_worker', 60_000);
    recovered = claimed;
    expect(claimed).toEqual(expect.objectContaining({ id: ids.job, attemptCount: 2 }));
  });

  it('renews a live fenced lease without moving its expiry backwards', async () => {
    const { documentId, jobId } = await createDocumentAndJob('INGEST');
    const leaseExpiresAt = new Date(Date.now() + 120_000);
    const job = {
      id: jobId,
      tenantId: ids.tenant,
      knowledgeBaseId: ids.knowledgeBase,
      documentId,
      type: 'INGEST' as const,
      deletionObjectKeySnapshot: null,
      attemptCount: 1,
      maxAttempts: 5,
    };
    try {
      await prisma.ragJob.update({
        where: { id: jobId },
        data: {
          status: 'RUNNING',
          attemptCount: job.attemptCount,
          lockedAt: new Date(),
          lockedBy: 'worker_a',
          leaseExpiresAt,
        },
      });

      await expect(repository.renewLease(job, 'worker_a', 1_000)).resolves.toBe(true);
      const renewed = await prisma.ragJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { leaseExpiresAt: true },
      });
      expect(renewed.leaseExpiresAt?.getTime()).toBeGreaterThanOrEqual(leaseExpiresAt.getTime());

      await expect(
        repository.renewLease({ ...job, attemptCount: 2 }, 'worker_a', 300_000),
      ).resolves.toBe(false);
    } finally {
      await prisma.ragJob.deleteMany({ where: { id: jobId } });
      await prisma.ragDocument.deleteMany({ where: { id: documentId } });
    }
  });

  it('atomically stores encrypted vector chunks and promotes only the complete index', async () => {
    if (!recovered) throw new Error('expected recovered job');
    const index = await prisma.ragDocumentIndex.create({
      data: { tenantId: ids.tenant, documentId: ids.document, version: 1, status: 'BUILDING', parserVersion: 1, chunkerVersion: 1, startedAt: new Date() },
    });
    const chunkId = randomUUID();
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptContent(key, 'integration chunk', createRagChunkAadV1({
      tenantId: ids.tenant, knowledgeBaseId: ids.knowledgeBase, documentId: ids.document,
      documentIndexId: index.id, chunkId, contentKeyVersion: 1,
    }));
    const completed = await repository.completeIngestion({
      job: recovered, workerId: 'recovery_worker', indexId: index.id,
      chunks: [{
        id: chunkId, ordinal: 0, tokenCount: 3, pageStart: null, pageEnd: null,
        lineStart: 1, lineEnd: 1, sourceMetadata: { kind: 'fixture' },
        ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, authTag: encrypted.tag,
        contentKeyVersion: 1, embedding: Array.from({ length: 1536 }, () => 0.01),
      }],
      usages: [{ operationId: `rag_ingest_${ids.job}_0`, batchOrdinal: 0, inputCount: 1, promptTokens: 3, totalTokens: 3 }],
    });
    expect(completed).toBe(true);
    await expect(prisma.ragDocument.findUnique({ where: { id: ids.document }, select: { status: true } })).resolves.toEqual({ status: 'READY' });
    await expect(prisma.ragDocumentIndex.findUnique({ where: { id: index.id }, select: { status: true } })).resolves.toEqual({ status: 'ACTIVE' });
    const stored = await prisma.$queryRaw<Array<{ ciphertext: Buffer; dimensions: number }>>`
      SELECT "content_ciphertext" AS ciphertext, vector_dims("embedding") AS dimensions
      FROM "rag_chunks" WHERE "id" = ${chunkId}::uuid
    `;
    expect(stored[0]?.dimensions).toBe(1536);
    expect(stored[0]?.ciphertext.toString('utf8')).not.toContain('integration chunk');
  });

  it('rejects a stale stage transition after the job has been reclaimed by another attempt', async () => {
    const { documentId, jobId } = await createDocumentAndJob('INGEST');
    const staleAttempt = {
      id: jobId,
      tenantId: ids.tenant,
      knowledgeBaseId: ids.knowledgeBase,
      documentId,
      type: 'INGEST' as const,
      deletionObjectKeySnapshot: null,
      attemptCount: 1,
      maxAttempts: 5,
    };
    try {
      await prisma.ragJob.update({
        where: { id: jobId },
        data: {
          status: 'RUNNING',
          attemptCount: 1,
          lockedAt: new Date(Date.now() - 1_000),
          lockedBy: 'worker_a',
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });
      await expect(
        repository.setDocumentStatus(staleAttempt, 'worker_a', 'EXTRACTING'),
      ).resolves.toBe(true);

      await prisma.ragJob.update({
        where: { id: jobId },
        data: {
          attemptCount: 2,
          lockedAt: new Date(),
          lockedBy: 'worker_b',
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });
      await prisma.ragDocument.update({
        where: { id: documentId },
        data: { status: 'READY' },
      });

      await expect(
        repository.setDocumentStatus(staleAttempt, 'worker_a', 'CHUNKING'),
      ).resolves.toBe(false);
      await expect(
        prisma.ragDocument.findUnique({ where: { id: documentId }, select: { status: true } }),
      ).resolves.toEqual({ status: 'READY' });
    } finally {
      await prisma.ragJob.deleteMany({ where: { id: jobId } });
      await prisma.ragDocument.deleteMany({ where: { id: documentId } });
    }
  });

  it.each([
    ['INGEST', 'FAILED'],
    ['DELETE', 'DELETING'],
  ] as const)(
    'terminalizes an expired final-attempt %s job and leaves the document in %s',
    async (type, expectedDocumentStatus) => {
      const { documentId, jobId } = await createDocumentAndJob(type);
      try {
        await prisma.ragJob.update({
          where: { id: jobId },
          data: {
            status: 'RUNNING',
            attemptCount: 5,
            maxAttempts: 5,
            lockedAt: new Date(Date.now() - 120_000),
            lockedBy: 'crashed_final_worker',
            leaseExpiresAt: new Date(Date.now() - 60_000),
          },
        });

        await repository.claimNext('terminalizer_worker', 60_000);

        await expect(
          prisma.ragJob.findUnique({
            where: { id: jobId },
            select: {
              status: true,
              lockedAt: true,
              lockedBy: true,
              leaseExpiresAt: true,
              lastErrorCode: true,
            },
          }),
        ).resolves.toEqual({
          status: 'FAILED',
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastErrorCode: 'RAG_JOB_LEASE_EXPIRED',
        });
        await expect(
          prisma.ragDocument.findUnique({ where: { id: documentId }, select: { status: true } }),
        ).resolves.toEqual({ status: expectedDocumentStatus });
      } finally {
        await prisma.ragJob.deleteMany({ where: { id: jobId } });
        await prisma.ragDocument.deleteMany({ where: { id: documentId } });
      }
    },
  );

  it('hard-deletes chunks, indexes, and document only after terminalizing and detaching every job', async () => {
    const deleteJobId = randomUUID();
    await prisma.ragDocument.update({
      where: { id: ids.document },
      data: { status: 'DELETING' },
    });
    await prisma.ragJob.create({
      data: {
        id: deleteJobId,
        tenantId: ids.tenant,
        knowledgeBaseId: ids.knowledgeBase,
        documentId: ids.document,
        type: 'DELETE',
        idempotencyKey: `delete:${ids.document}`,
        deletionObjectKeySnapshot: `rag/${ids.tenant}/${ids.document}/source`,
        availableAt: new Date(Date.now() - 1_000),
      },
    });

    const claimed = await repository.claimNext('delete_worker', 60_000);
    expect(claimed).toEqual(
      expect.objectContaining({
        id: deleteJobId,
        type: 'DELETE',
        deletionObjectKeySnapshot: `rag/${ids.tenant}/${ids.document}/source`,
      }),
    );
    if (!claimed) throw new Error('expected DELETE job claim');

    await expect(repository.completeDeletion(claimed, 'delete_worker')).resolves.toBe(true);
    await expect(
      prisma.ragDocument.findUnique({ where: { id: ids.document } }),
    ).resolves.toBeNull();
    await expect(
      prisma.ragDocumentIndex.count({ where: { tenantId: ids.tenant, documentId: ids.document } }),
    ).resolves.toBe(0);
    await expect(
      prisma.ragChunk.count({ where: { tenantId: ids.tenant, documentId: ids.document } }),
    ).resolves.toBe(0);
    await expect(
      prisma.ragJob.findMany({
        where: { tenantId: ids.tenant },
        select: { id: true, type: true, status: true, documentId: true, deletionObjectKeySnapshot: true },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids.job,
          type: 'INGEST',
          status: 'SUCCEEDED',
          documentId: null,
          deletionObjectKeySnapshot: null,
        }),
        expect.objectContaining({
          id: deleteJobId,
          type: 'DELETE',
          status: 'SUCCEEDED',
          documentId: null,
          deletionObjectKeySnapshot: `rag/${ids.tenant}/${ids.document}/source`,
        }),
      ]),
    );
  });

  async function createDocumentAndJob(type: 'INGEST' | 'DELETE') {
    const documentId = randomUUID();
    const jobId = randomUUID();
    await prisma.ragDocument.create({
      data: {
        id: documentId,
        publicId: randomUUID(),
        tenantId: ids.tenant,
        knowledgeBaseId: ids.knowledgeBase,
        privateMetadataCiphertext: Buffer.from('fixture'),
        privateMetadataNonce: Buffer.alloc(12, 4),
        privateMetadataAuthTag: Buffer.alloc(16, 5),
        privateMetadataContentKeyVersion: 1,
        fileExtension: 'txt',
        mimeType: 'text/plain',
        sizeBytes: BigInt(7),
        s3ObjectKey: `rag/${ids.tenant}/${documentId}/source`,
        uploadedByUserId: ids.user,
        status: type === 'DELETE' ? 'DELETING' : 'UPLOADED',
      },
    });
    await prisma.ragJob.create({
      data: {
        id: jobId,
        tenantId: ids.tenant,
        knowledgeBaseId: ids.knowledgeBase,
        documentId,
        type,
        idempotencyKey: `${type.toLowerCase()}:${documentId}`,
        deletionObjectKeySnapshot:
          type === 'DELETE' ? `rag/${ids.tenant}/${documentId}/source` : null,
      },
    });
    return { documentId, jobId };
  }
});

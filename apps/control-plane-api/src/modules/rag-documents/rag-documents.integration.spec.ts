import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import type { RagDocumentPrivateMetadataCodec } from './crypto/rag-document-private-metadata.codec';
import { RagDocumentsService } from './rag-documents.service';
import type { RagObjectStore } from './storage/object-store.port';
import type { RagUploadStreamService } from './storage/rag-upload-stream.service';

const databaseUrl = process.env.GATELM_TEST_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('RagDocumentsService database integration', () => {
  const digest = 'cd'.repeat(32);
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let uploadStream: { parseAndUpload: jest.Mock };
  let objectStore: { putObject: jest.Mock; deleteObject: jest.Mock };
  let metadataCodec: { encrypt: jest.Mock; decryptMany: jest.Mock };
  let service: RagDocumentsService;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    const [tenant, otherTenant, user] = await Promise.all([
      prisma.tenant.create({
        data: { name: `rag-documents-a-${randomUUID()}` },
        select: { id: true },
      }),
      prisma.tenant.create({
        data: { name: `rag-documents-b-${randomUUID()}` },
        select: { id: true },
      }),
      prisma.user.create({
        data: { email: `rag-documents-${randomUUID()}@example.test` },
        select: { id: true },
      }),
    ]);
    tenantId = tenant.id;
    otherTenantId = otherTenant.id;
    userId = user.id;
    await Promise.all([createContentKey(tenantId), createContentKey(otherTenantId)]);
  });

  beforeEach(() => {
    uploadStream = {
      parseAndUpload: jest.fn().mockResolvedValue({
        displayName: 'Tenant policy',
        fileExtension: 'txt',
        mimeType: 'text/plain',
        originalFilename: 'policy.txt',
        sha256Digest: digest,
        sizeBytes: 5,
      }),
    };
    objectStore = {
      putObject: jest.fn(),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    metadataCodec = {
      encrypt: jest.fn().mockResolvedValue({
        ciphertext: Buffer.from('encrypted-metadata'),
        nonce: Buffer.alloc(12, 1),
        authTag: Buffer.alloc(16, 2),
        contentKeyVersion: 1,
        schemaVersion: 1,
      }),
      decryptMany: jest.fn().mockImplementation(async (rows: unknown[]) =>
        rows.map(() => ({
          schemaVersion: 1,
          displayName: 'Tenant policy',
          originalFilename: 'policy.txt',
          sha256Digest: digest,
        })),
      ),
    };
    service = new RagDocumentsService(
      prisma,
      uploadStream as unknown as RagUploadStreamService,
      metadataCodec as unknown as RagDocumentPrivateMetadataCodec,
      objectStore as unknown as RagObjectStore,
      new ConfigService({ RAG_MAX_UPLOAD_BYTES: 20 * 1024 * 1024 }),
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.ragJob.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.ragDocument.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.ragKnowledgeBase.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.tenantChatContentKey.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenantId, otherTenantId] } },
    });
    await prisma.$disconnect();
  });

  it('commits one UPLOADED Document and one PENDING INGEST Job together', async () => {
    const response = await service.upload(tenantId, userId, {} as never);
    const document = await prisma.ragDocument.findFirstOrThrow({
      where: { tenantId, publicId: response.documentId },
      select: { id: true, status: true, s3ObjectKey: true },
    });
    const jobs = await prisma.ragJob.findMany({
      where: { tenantId, documentId: document.id },
      select: { type: true, status: true, deletionObjectKeySnapshot: true },
    });

    expect(document.status).toBe('UPLOADED');
    expect(document.s3ObjectKey).toMatch(/^rag\/[0-9a-f-]+\/[0-9a-f-]+\/source$/);
    expect(jobs).toEqual([
      {
        type: 'INGEST',
        status: 'PENDING',
        deletionObjectKeySnapshot: null,
      },
    ]);
  });

  it('rejects a same-tenant duplicate but permits the same digest in another tenant', async () => {
    await expect(
      service.upload(tenantId, userId, {} as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(objectStore.deleteObject).toHaveBeenCalledTimes(1);

    await expect(
      service.upload(otherTenantId, userId, {} as never),
    ).resolves.toMatchObject({ status: 'UPLOADED' });

    await expect(
      prisma.ragDocument.count({ where: { tenantId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.ragDocument.count({ where: { tenantId: otherTenantId } }),
    ).resolves.toBe(1);
  });

  it('serializes concurrent same-tenant duplicates into one Document and one Job', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: `rag-documents-concurrent-${randomUUID()}` },
      select: { id: true },
    });
    await createContentKey(tenant.id);
    objectStore.deleteObject.mockClear();

    try {
      const results = await Promise.allSettled([
        service.upload(tenant.id, userId, {} as never),
        service.upload(tenant.id, userId, {} as never),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
        1,
      );
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: expect.any(ConflictException),
      });
      const documents = await prisma.ragDocument.findMany({
        where: { tenantId: tenant.id },
        select: { id: true },
      });
      expect(documents).toHaveLength(1);
      await expect(
        prisma.ragJob.count({
          where: { tenantId: tenant.id, documentId: documents[0]?.id },
        }),
      ).resolves.toBe(1);
      expect(objectStore.deleteObject).toHaveBeenCalledTimes(1);
    } finally {
      await prisma.ragJob.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.ragDocument.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.ragKnowledgeBase.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenantChatContentKey.deleteMany({
        where: { tenantId: tenant.id },
      });
      await prisma.tenant.delete({ where: { id: tenant.id } });
    }
  });

  async function createContentKey(targetTenantId: string): Promise<void> {
    await prisma.tenantChatContentKey.create({
      data: {
        tenantId: targetTenantId,
        contentKeyVersion: 1,
        wrappingKeyVersion: 1,
        wrappedKey: Buffer.alloc(32, 1),
        wrapNonce: Buffer.alloc(12, 2),
        wrapTag: Buffer.alloc(16, 3),
      },
    });
  }
});

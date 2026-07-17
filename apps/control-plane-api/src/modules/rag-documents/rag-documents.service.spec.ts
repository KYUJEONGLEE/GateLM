import { ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';

import type { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import type { RagDocumentPrivateMetadataCodec } from './crypto/rag-document-private-metadata.codec';
import { RagDocumentsService } from './rag-documents.service';
import type { RagObjectStore } from './storage/object-store.port';
import type { RagUploadStreamService } from './storage/rag-upload-stream.service';
import { RagUploadException } from './storage/rag-upload.errors';

describe('RagDocumentsService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const knowledgeBaseId = '00000000-0000-4000-8000-000000000200';
  const uploaderId = '00000000-0000-4000-8000-000000000300';
  const existingDocumentId = '00000000-0000-4000-8000-000000000400';
  const existingPublicId = '00000000-0000-4000-8000-000000000401';
  const digest = 'ab'.repeat(32);
  const timestamp = new Date('2026-07-16T00:00:00.000Z');

  let tx: ReturnType<typeof createTransaction>;
  let prisma: ReturnType<typeof createPrisma>;
  let uploadStream: { parseAndUpload: jest.Mock };
  let metadataCodec: { encrypt: jest.Mock; decryptMany: jest.Mock };
  let objectStore: { putObject: jest.Mock; deleteObject: jest.Mock };
  let service: RagDocumentsService;

  beforeEach(() => {
    tx = createTransaction();
    prisma = createPrisma(tx);
    uploadStream = {
      parseAndUpload: jest.fn().mockResolvedValue({
        displayName: 'Policy handbook',
        fileExtension: 'txt',
        mimeType: 'text/plain',
        originalFilename: 'policy.txt',
        sha256Digest: digest,
        sizeBytes: 12,
      }),
    };
    metadataCodec = {
      encrypt: jest.fn().mockResolvedValue({
        ciphertext: Buffer.from('ciphertext'),
        nonce: Buffer.alloc(12, 1),
        authTag: Buffer.alloc(16, 2),
        contentKeyVersion: 1,
        schemaVersion: 1,
      }),
      decryptMany: jest.fn().mockResolvedValue([]),
    };
    objectStore = {
      putObject: jest.fn(),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      getOrThrow: jest.fn().mockReturnValue(20 * 1024 * 1024),
    };
    service = new RagDocumentsService(
      prisma as unknown as PrismaService,
      uploadStream as unknown as RagUploadStreamService,
      metadataCodec as unknown as RagDocumentPrivateMetadataCodec,
      objectStore as unknown as RagObjectStore,
      config as unknown as ConfigService,
    );
  });

  it('streams the upload and atomically creates UPLOADED Document plus PENDING INGEST Job', async () => {
    const response = await service.upload(
      tenantId,
      uploaderId,
      {} as Request,
    );

    expect(uploadStream.parseAndUpload).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxBytes: 20 * 1024 * 1024 }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.ragDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          knowledgeBaseId,
          uploadedByUserId: uploaderId,
          status: 'UPLOADED',
          mimeType: 'text/plain',
          s3ObjectKey: expect.stringMatching(
            /^rag\/[0-9a-f-]+\/[0-9a-f-]+\/source$/,
          ),
        }),
      }),
    );
    expect(tx.ragJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          knowledgeBaseId,
          type: 'INGEST',
          status: 'PENDING',
        }),
      }),
    );
    expect(response).toMatchObject({
      displayName: 'Policy handbook',
      mimeType: 'text/plain',
      sizeBytes: 12,
      status: 'UPLOADED',
      uploadedBy: { displayName: 'Tenant Admin' },
    });
    expect(response).not.toHaveProperty('s3ObjectKey');
    expect(response).not.toHaveProperty('sha256Digest');
    expect(response).not.toHaveProperty('knowledgeBaseId');
    expect(response).not.toHaveProperty('id');
  });

  it('recovers a concurrent first-upload Knowledge Base unique race', async () => {
    prisma.ragKnowledgeBase.upsert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique conflict', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );
    prisma.ragKnowledgeBase.findUnique.mockResolvedValueOnce({
      id: knowledgeBaseId,
    });

    await expect(
      service.upload(tenantId, uploaderId, {} as Request),
    ).resolves.toMatchObject({ status: 'UPLOADED' });
    expect(prisma.ragKnowledgeBase.findUnique).toHaveBeenCalledWith({
      where: { tenantId },
      select: { id: true },
    });
  });

  it('deletes the uploaded object and creates neither row on a duplicate', async () => {
    tx.ragDocument.findMany.mockResolvedValue([metadataRow()]);
    metadataCodec.decryptMany.mockResolvedValue([
      {
        schemaVersion: 1,
        displayName: 'Existing',
        originalFilename: 'existing.txt',
        sha256Digest: digest,
      },
    ]);

    await expect(
      service.upload(tenantId, uploaderId, {} as Request),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.ragDocument.create).not.toHaveBeenCalled();
    expect(tx.ragJob.create).not.toHaveBeenCalled();
    expect(objectStore.deleteObject).toHaveBeenCalledTimes(1);
  });

  it('compensates the S3 object when the atomic DB transaction fails', async () => {
    tx.ragDocument.create.mockRejectedValue(new Error('database detail'));

    await expect(
      service.upload(tenantId, uploaderId, {} as Request),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RAG_PERSISTENCE_UNAVAILABLE' }),
    });

    expect(tx.ragJob.create).not.toHaveBeenCalled();
    expect(objectStore.deleteObject).toHaveBeenCalledTimes(1);
  });

  it('rolls back Document creation and compensates when Job creation fails', async () => {
    tx.ragJob.create.mockRejectedValue(new Error('job insert failed'));

    await expect(
      service.upload(tenantId, uploaderId, {} as Request),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RAG_PERSISTENCE_UNAVAILABLE' }),
    });

    expect(tx.ragDocument.create).toHaveBeenCalledTimes(1);
    expect(tx.ragJob.create).toHaveBeenCalledTimes(1);
    expect(objectStore.deleteObject).toHaveBeenCalledTimes(1);
  });

  it('maps storage failure to a safe 503 before starting a DB transaction', async () => {
    uploadStream.parseAndUpload.mockRejectedValue(
      new RagUploadException('RAG_UPLOAD_STORAGE_UNAVAILABLE'),
    );

    await expect(
      service.upload(tenantId, uploaderId, {} as Request),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RAG_STORAGE_UNAVAILABLE' }),
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.ragDocument.create).not.toHaveBeenCalled();
    expect(tx.ragJob.create).not.toHaveBeenCalled();
    expect(objectStore.deleteObject).not.toHaveBeenCalled();
  });

  it('rejects the 501st document under the tenant lock and compensates', async () => {
    tx.ragDocument.count.mockResolvedValue(500);

    await expect(
      service.upload(tenantId, uploaderId, {} as Request),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RAG_DOCUMENT_LIMIT_REACHED' }),
    });

    expect(tx.ragDocument.findMany).not.toHaveBeenCalled();
    expect(metadataCodec.decryptMany).not.toHaveBeenCalled();
    expect(tx.ragDocument.create).not.toHaveBeenCalled();
    expect(tx.ragJob.create).not.toHaveBeenCalled();
    expect(objectStore.deleteObject).toHaveBeenCalledTimes(1);
  });

  it('does not delete a committed source after an ambiguous transaction response', async () => {
    const committed = documentRow();
    prisma.$transaction.mockRejectedValueOnce(new Error('commit response lost'));
    tx.ragDocument.findFirst.mockResolvedValue(committed);

    await expect(
      service.upload(tenantId, uploaderId, {} as Request),
    ).resolves.toMatchObject({ documentId: existingPublicId, status: 'UPLOADED' });

    expect(tx.ragDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId, publicId: expect.any(String) }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(objectStore.deleteObject).not.toHaveBeenCalled();
  });

  it('keeps the source for reconciliation when DB commit outcome cannot be read', async () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    prisma.$transaction.mockRejectedValue(new Error('commit response lost'));

    await expect(
      service.upload(tenantId, uploaderId, {} as Request),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RAG_PERSISTENCE_UNAVAILABLE' }),
    });

    expect(objectStore.deleteObject).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.mock.calls)).toContain(
      'RAG_PERSISTENCE_OUTCOME_UNKNOWN',
    );
    logger.mockRestore();
  });

  it('logs only a stable operational event when compensation deletion fails', async () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    tx.ragDocument.create.mockRejectedValue(new Error('db-secret-detail'));
    objectStore.deleteObject.mockRejectedValue(
      new Error('bucket/key/policy.txt/provider-secret'),
    );

    await expect(
      service.upload(tenantId, uploaderId, {} as Request),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('rag_upload_compensation_failed'),
    );
    const logEvent = JSON.parse(String(logger.mock.calls[0]?.[0]));
    expect(logEvent.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const serialized = JSON.stringify(logger.mock.calls);
    expect(serialized).not.toContain('policy.txt');
    expect(serialized).not.toContain('provider-secret');
    logger.mockRestore();
  });

  it('tenant-scopes list/status and returns only the response allowlist', async () => {
    const row = documentRow();
    prisma.ragDocument.findMany.mockResolvedValue([row]);
    prisma.ragDocument.findFirst.mockResolvedValue(row);
    metadataCodec.decryptMany.mockResolvedValue([
      {
        schemaVersion: 1,
        displayName: 'Policy handbook',
        originalFilename: 'policy.txt',
        sha256Digest: digest,
      },
    ]);

    const list = await service.list(tenantId, { limit: 50 });
    const status = await service.getStatus(tenantId, existingPublicId);

    expect(prisma.ragDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId } }),
    );
    expect(prisma.ragDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, publicId: existingPublicId } }),
    );
    expect(list.data[0]).toEqual(status);
    expect(Object.keys(status).sort()).toEqual(
      [
        'createdAt',
        'displayName',
        'documentId',
        'failureCode',
        'failureMessage',
        'mimeType',
        'sizeBytes',
        'status',
        'updatedAt',
        'uploadedBy',
      ].sort(),
    );
  });

  it('atomically marks a tenant document DELETING and creates one DELETE job with an internal snapshot', async () => {
    const current = documentRow({
      status: 'READY',
      s3ObjectKey: `rag/${tenantId}/${existingDocumentId}/source`,
    });
    const deleting = { ...current, status: 'DELETING' };
    tx.ragDocument.findFirst.mockResolvedValueOnce(current);
    tx.ragDocument.update.mockResolvedValueOnce(deleting);
    metadataCodec.decryptMany.mockResolvedValueOnce([
      {
        schemaVersion: 1,
        displayName: 'Policy handbook',
        originalFilename: 'policy.txt',
        sha256Digest: digest,
      },
    ]);

    const response = await service.requestDelete(tenantId, existingPublicId);

    expect(tx.ragDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELETING' }),
      }),
    );
    expect(tx.ragJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          knowledgeBaseId,
          documentId: existingDocumentId,
          type: 'DELETE',
          status: 'PENDING',
          deletionObjectKeySnapshot: `rag/${tenantId}/${existingDocumentId}/source`,
        }),
      }),
    );
    expect(response).toMatchObject({ documentId: existingPublicId, status: 'DELETING' });
    expect(response).not.toHaveProperty('s3ObjectKey');
  });

  it('returns the existing DELETING document without adding another DELETE job', async () => {
    const deleting = documentRow({
      status: 'DELETING',
      s3ObjectKey: `rag/${tenantId}/${existingDocumentId}/source`,
    });
    tx.ragDocument.findFirst.mockResolvedValueOnce(deleting);
    tx.ragJob.findFirst.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000500',
      status: 'PENDING',
    });
    metadataCodec.decryptMany.mockResolvedValueOnce([
      {
        schemaVersion: 1,
        displayName: 'Policy handbook',
        originalFilename: 'policy.txt',
        sha256Digest: digest,
      },
    ]);

    await expect(service.requestDelete(tenantId, existingPublicId)).resolves.toMatchObject({
      status: 'DELETING',
    });
    expect(tx.ragDocument.update).not.toHaveBeenCalled();
    expect(tx.ragJob.create).not.toHaveBeenCalled();
    expect(tx.ragJob.updateMany).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'CANCELLED'] as const)(
    'reactivates the same %s DELETE job when deletion is requested again',
    async (jobStatus) => {
      const deleting = documentRow({
        status: 'DELETING',
        s3ObjectKey: `rag/${tenantId}/${existingDocumentId}/source`,
      });
      const deleteJobId = '00000000-0000-4000-8000-000000000500';
      tx.ragDocument.findFirst.mockResolvedValueOnce(deleting);
      tx.ragJob.findFirst.mockResolvedValueOnce({ id: deleteJobId, status: jobStatus });
      metadataCodec.decryptMany.mockResolvedValueOnce([
        {
          schemaVersion: 1,
          displayName: 'Policy handbook',
          originalFilename: 'policy.txt',
          sha256Digest: digest,
        },
      ]);

      await expect(service.requestDelete(tenantId, existingPublicId)).resolves.toMatchObject({
        status: 'DELETING',
      });

      expect(tx.ragJob.updateMany).toHaveBeenCalledWith({
        where: {
          id: deleteJobId,
          tenantId,
          status: { in: ['FAILED', 'CANCELLED'] },
        },
        data: expect.objectContaining({
          status: 'PENDING',
          attemptCount: 0,
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          sanitizedLastError: null,
          deletionObjectKeySnapshot: `rag/${tenantId}/${existingDocumentId}/source`,
        }),
      });
      expect(tx.ragJob.create).not.toHaveBeenCalled();
    },
  );

  it('uses the same not-found result for an absent or other-tenant document delete', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      service.requestDelete(tenantId, existingPublicId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RAG_DOCUMENT_NOT_FOUND' }),
    });
    expect(tx.ragDocument.findFirst).not.toHaveBeenCalled();
    expect(tx.ragJob.create).not.toHaveBeenCalled();
  });

  it('maps list and status database failures to the contracted safe 503', async () => {
    prisma.ragDocument.findMany.mockRejectedValueOnce(new Error('db detail'));
    await expect(service.list(tenantId, { limit: 50 })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RAG_PERSISTENCE_UNAVAILABLE' }),
    });

    prisma.ragDocument.findFirst.mockRejectedValueOnce(new Error('db detail'));
    await expect(
      service.getStatus(tenantId, existingPublicId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RAG_PERSISTENCE_UNAVAILABLE' }),
    });
  });

  function createTransaction() {
    const ragDocument = {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      create: jest.fn().mockImplementation(async ({ data }) =>
        documentRow({
          id: data.id,
          publicId: data.publicId,
          tenantId: data.tenantId,
          knowledgeBaseId: data.knowledgeBaseId,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          privateMetadataCiphertext: data.privateMetadataCiphertext,
          privateMetadataNonce: data.privateMetadataNonce,
          privateMetadataAuthTag: data.privateMetadataAuthTag,
          privateMetadataContentKeyVersion:
            data.privateMetadataContentKeyVersion,
          privateMetadataSchemaVersion: data.privateMetadataSchemaVersion,
        }),
      ),
    };
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ id: knowledgeBaseId }]),
      ragDocument,
      ragJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
  }

  function createPrisma(transaction: ReturnType<typeof createTransaction>) {
    return {
      ragKnowledgeBase: {
        upsert: jest.fn().mockResolvedValue({ id: knowledgeBaseId }),
        findUnique: jest.fn(),
      },
      ragDocument: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (callback) =>
        callback(transaction),
      ),
    };
  }

  function metadataRow() {
    return {
      id: existingDocumentId,
      tenantId,
      knowledgeBaseId,
      privateMetadataCiphertext: Uint8Array.from([1]),
      privateMetadataNonce: Uint8Array.from(Buffer.alloc(12, 1)),
      privateMetadataAuthTag: Uint8Array.from(Buffer.alloc(16, 2)),
      privateMetadataContentKeyVersion: 1,
      privateMetadataSchemaVersion: 1,
    };
  }

  function documentRow(overrides: Record<string, unknown> = {}) {
    return {
      ...metadataRow(),
      publicId: existingPublicId,
      mimeType: 'text/plain',
      sizeBytes: 12n,
      status: 'UPLOADED',
      failureCode: null,
      sanitizedFailureMessage: null,
      uploadedByUser: { name: 'Tenant Admin' },
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }
});

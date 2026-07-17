import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type RagDocument } from '@prisma/client';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';

import type { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { ContentIntegrityError, ContentKeyUnavailable } from './crypto/content.errors';
import {
  equalSha256Digest,
  RagDocumentPrivateMetadataCodec,
  type RagDocumentPrivateMetadataV1,
  type StoredRagDocumentPrivateMetadata,
} from './crypto/rag-document-private-metadata.codec';
import type { TenantContentKeyReadClient } from './crypto/tenant-content-key.service';
import {
  ListRagDocumentsQueryDto,
  type RagDocumentResponseDto,
} from './dto/rag-document.dto';
import {
  RAG_OBJECT_STORE,
  RagObjectStoreError,
  type RagObjectStore,
} from './storage/object-store.port';
import { createRagSourceObjectKey } from './storage/rag-object-key';
import { RagUploadException } from './storage/rag-upload.errors';
import {
  RagUploadStreamService,
  type ParsedRagUpload,
} from './storage/rag-upload-stream.service';

const MAX_DOCUMENTS_PER_TENANT = 500;
const DUPLICATE_CANDIDATE_STATUSES = [
  'UPLOADING',
  'UPLOADED',
  'EXTRACTING',
  'CHUNKING',
  'EMBEDDING',
  'INDEXING',
  'READY',
] as const;

type RagDocumentWithMetadata = Pick<
  RagDocument,
  | 'id'
  | 'publicId'
  | 'tenantId'
  | 'knowledgeBaseId'
  | 'privateMetadataCiphertext'
  | 'privateMetadataNonce'
  | 'privateMetadataAuthTag'
  | 'privateMetadataContentKeyVersion'
  | 'privateMetadataSchemaVersion'
  | 'mimeType'
  | 'sizeBytes'
  | 'status'
  | 'failureCode'
  | 'sanitizedFailureMessage'
  | 'createdAt'
  | 'updatedAt'
> & {
  uploadedByUser: { name: string | null };
};

@Injectable()
export class RagDocumentsService {
  private readonly logger = new Logger(RagDocumentsService.name);
  private readonly maxUploadBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadStream: RagUploadStreamService,
    private readonly metadataCodec: RagDocumentPrivateMetadataCodec,
    @Inject(RAG_OBJECT_STORE) private readonly objectStore: RagObjectStore,
    config: ConfigService,
  ) {
    this.maxUploadBytes = config.getOrThrow<number>('RAG_MAX_UPLOAD_BYTES');
  }

  async upload(
    tenantId: string,
    uploadedByUserId: string,
    request: Request,
  ): Promise<RagDocumentResponseDto> {
    const knowledgeBase = await this.ensureKnowledgeBase(tenantId);
    const documentId = randomUUID();
    const operationId = randomUUID();
    const publicId = randomUUID();
    const objectKey = createRagSourceObjectKey(tenantId, documentId);

    let uploaded: ParsedRagUpload;
    try {
      uploaded = await this.uploadStream.parseAndUpload(request, {
        maxBytes: this.maxUploadBytes,
        objectKey,
        operationId,
      });
    } catch (error) {
      throw this.toSafeUploadError(error);
    }

    const displayName = uploaded.displayName ?? uploaded.originalFilename;
    const responseMetadata: RagDocumentPrivateMetadataV1 = {
      schemaVersion: 1,
      displayName,
      originalFilename: uploaded.originalFilename,
      sha256Digest: uploaded.sha256Digest,
    };
    let encryptedMetadata: Readonly<{
      ciphertext: Buffer;
      nonce: Buffer;
      authTag: Buffer;
      contentKeyVersion: number;
      schemaVersion: 1;
    }>;
    try {
      encryptedMetadata = await this.metadataCodec.encrypt(
        { tenantId, knowledgeBaseId: knowledgeBase.id, documentId },
        {
          displayName,
          originalFilename: uploaded.originalFilename,
          sha256Digest: uploaded.sha256Digest,
        },
      );
    } catch (error) {
      await this.compensateUploadedObject(objectKey, operationId);
      throw this.toSafePersistenceError(error);
    }

    const persistenceInput = {
      documentId,
      publicId,
      tenantId,
      knowledgeBaseId: knowledgeBase.id,
      uploadedByUserId,
      objectKey,
      uploaded,
      encryptedMetadata,
    } as const;

    try {
      const document = await this.persistUploadedDocument(persistenceInput);
      return this.toResponse(document, responseMetadata);
    } catch (error) {
      if (error instanceof RagTransactionRolledBack) {
        await this.compensateUploadedObject(objectKey, operationId);
        throw this.toSafePersistenceError(error.cause);
      }

      // A transaction-level rejection can mean that COMMIT succeeded but its
      // acknowledgement was lost. Retry the exact finalization under the same
      // tenant KB row lock. Whichever transaction owns the lock first either
      // creates the predetermined IDs or observes them, so the retry is
      // idempotent and never deletes a committed document's source object.
      try {
        const recovered = await this.persistUploadedDocument(persistenceInput);
        return this.toResponse(recovered, responseMetadata);
      } catch (recoveryError) {
        if (
          recoveryError instanceof RagTransactionRolledBack &&
          recoveryError.serializationLockAcquired
        ) {
          await this.compensateUploadedObject(objectKey, operationId);
          throw this.toSafePersistenceError(recoveryError.cause);
        }

        this.logger.error(
          JSON.stringify({
            event: 'rag_upload_persistence_outcome_unknown',
            code: 'RAG_PERSISTENCE_OUTCOME_UNKNOWN',
            operationId,
          }),
        );
        throw codedServiceUnavailable(
          'RAG_PERSISTENCE_UNAVAILABLE',
          'RAG document persistence is temporarily unavailable.',
        );
      }
    }
  }

  async list(
    tenantId: string,
    query: ListRagDocumentsQueryDto,
  ): Promise<ListEnvelope<RagDocumentResponseDto>> {
    try {
      const limit = query.limit ?? 50;
      if (query.cursor) {
        const cursorExists = await this.prisma.ragDocument.findFirst({
          where: { tenantId, publicId: query.cursor },
          select: { id: true },
        });
        if (!cursorExists) {
          throw codedBadRequest(
            'RAG_DOCUMENT_CURSOR_INVALID',
            'The document cursor is invalid.',
          );
        }
      }

      const rows = await this.prisma.ragDocument.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { publicId: 'desc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { publicId: query.cursor }, skip: 1 } : {}),
        select: documentResponseSelection,
      });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const metadata = await this.decryptMetadata(page);

      return {
        data: page.map((row, index) =>
          this.toResponse(row, metadata[index] as RagDocumentPrivateMetadataV1),
        ),
        pagination: {
          limit,
          nextCursor: hasMore ? page[page.length - 1]?.publicId ?? null : null,
          hasMore,
        },
      };
    } catch (error) {
      throw this.toSafeReadError(error);
    }
  }

  async getStatus(
    tenantId: string,
    publicId: string,
  ): Promise<RagDocumentResponseDto> {
    try {
      const document = await this.prisma.ragDocument.findFirst({
        where: { tenantId, publicId },
        select: documentResponseSelection,
      });
      if (!document) {
        throw new NotFoundException({
          code: 'RAG_DOCUMENT_NOT_FOUND',
          message: 'RAG document was not found.',
        });
      }

      const [metadata] = await this.decryptMetadata([document]);
      return this.toResponse(document, metadata as RagDocumentPrivateMetadataV1);
    } catch (error) {
      throw this.toSafeReadError(error);
    }
  }

  /**
   * Deletion is intentionally logical first.  The locked transaction makes the
   * document immediately invisible to retrieval and durablely records the
   * opaque object-key snapshot that the DELETE worker needs after the row is
   * physically removed.
   */
  async requestDelete(
    tenantId: string,
    publicId: string,
  ): Promise<RagDocumentResponseDto> {
    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "rag_documents"
          WHERE "tenant_id" = ${tenantId}::uuid
            AND "public_id" = ${publicId}::uuid
          FOR UPDATE
        `);
        if (locked.length !== 1) {
          throw new NotFoundException({
            code: 'RAG_DOCUMENT_NOT_FOUND',
            message: 'RAG document was not found.',
          });
        }

        const current = await tx.ragDocument.findFirst({
          where: { id: locked[0]!.id, tenantId, publicId },
          select: deletionResponseSelection,
        });
        if (!current) {
          throw new NotFoundException({
            code: 'RAG_DOCUMENT_NOT_FOUND',
            message: 'RAG document was not found.',
          });
        }

        if (current.status === 'DELETING') {
          const deleteJob = await tx.ragJob.findFirst({
            where: {
              tenantId,
              documentId: current.id,
              type: 'DELETE',
              idempotencyKey: `delete:${current.id}`,
            },
            select: { id: true, status: true },
          });
          if (deleteJob && (deleteJob.status === 'FAILED' || deleteJob.status === 'CANCELLED')) {
            await tx.ragJob.updateMany({
              where: {
                id: deleteJob.id,
                tenantId,
                status: { in: ['FAILED', 'CANCELLED'] },
              },
              data: {
                status: 'PENDING',
                attemptCount: 0,
                availableAt: new Date(),
                lockedAt: null,
                lockedBy: null,
                leaseExpiresAt: null,
                lastErrorCode: null,
                sanitizedLastError: null,
                deletionObjectKeySnapshot: current.s3ObjectKey,
              },
            });
          }
          return current;
        }

        const updated = await tx.ragDocument.update({
          where: { id: current.id },
          data: {
            status: 'DELETING',
            failureCode: null,
            sanitizedFailureMessage: null,
          },
          select: deletionResponseSelection,
        });
        await tx.ragJob.create({
          data: {
            tenantId,
            knowledgeBaseId: current.knowledgeBaseId,
            documentId: current.id,
            type: 'DELETE',
            status: 'PENDING',
            // A stable key means an ambiguous API transaction can be retried
            // without ever enqueuing a second deletion for this document.
            idempotencyKey: `delete:${current.id}`,
            deletionObjectKeySnapshot: current.s3ObjectKey,
          },
        });
        return updated;
      });

      const [metadata] = await this.decryptMetadata([document]);
      return this.toResponse(
        document,
        metadata as RagDocumentPrivateMetadataV1,
      );
    } catch (error) {
      throw this.toSafeDeleteError(error);
    }
  }

  private async ensureKnowledgeBase(tenantId: string): Promise<{ id: string }> {
    try {
      return await this.prisma.ragKnowledgeBase.upsert({
        where: { tenantId },
        create: { tenantId },
        update: {},
        select: { id: true },
      });
    } catch (error) {
      // Prisma can implement this upsert as a read followed by an insert. Two
      // first uploads for the same tenant may therefore race on the unique
      // tenant_id constraint even though both are logically ensuring the same
      // singleton. Once P2002 is returned, the winner is committed and safe to
      // read; all other persistence failures remain fail-closed.
      if (isPrismaUniqueViolation(error)) {
        try {
          const existing = await this.prisma.ragKnowledgeBase.findUnique({
            where: { tenantId },
            select: { id: true },
          });
          if (existing) return existing;
        } catch {
          // Normalize the recovery read below without exposing DB details.
        }
      }
      throw codedServiceUnavailable(
        'RAG_PERSISTENCE_UNAVAILABLE',
        'RAG document persistence is temporarily unavailable.',
      );
    }
  }

  private async persistUploadedDocument(input: Readonly<{
    documentId: string;
    publicId: string;
    tenantId: string;
    knowledgeBaseId: string;
    uploadedByUserId: string;
    objectKey: string;
    uploaded: ParsedRagUpload;
    encryptedMetadata: Readonly<{
      ciphertext: Buffer;
      nonce: Buffer;
      authTag: Buffer;
      contentKeyVersion: number;
      schemaVersion: 1;
    }>;
  }>): Promise<RagDocumentWithMetadata> {
    let serializationLockAcquired = false;
    return this.prisma.$transaction(
      async (tx) => {
        try {
          const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "rag_knowledge_bases"
            WHERE "id" = ${input.knowledgeBaseId}::uuid
              AND "tenant_id" = ${input.tenantId}::uuid
            FOR UPDATE
          `);
          if (locked.length !== 1) {
            throw codedServiceUnavailable(
              'RAG_PERSISTENCE_UNAVAILABLE',
              'RAG document persistence is temporarily unavailable.',
            );
          }
          serializationLockAcquired = true;

          const existing = await tx.ragDocument.findFirst({
            where: {
              tenantId: input.tenantId,
              id: input.documentId,
              publicId: input.publicId,
            },
            select: documentResponseSelection,
          });
          if (existing) return existing;

          const documentCount = await tx.ragDocument.count({
            where: { tenantId: input.tenantId },
          });
          if (documentCount >= MAX_DOCUMENTS_PER_TENANT) {
            throw new ConflictException({
              code: 'RAG_DOCUMENT_LIMIT_REACHED',
              message: 'The tenant document limit has been reached.',
            });
          }

          const candidates = await tx.ragDocument.findMany({
            where: {
              tenantId: input.tenantId,
              status: { in: [...DUPLICATE_CANDIDATE_STATUSES] },
            },
            select: metadataSelection,
          });
          const candidateMetadata = await this.decryptMetadata(candidates, tx);
          if (
            candidateMetadata.some((metadata) =>
              equalSha256Digest(metadata.sha256Digest, input.uploaded.sha256Digest),
            )
          ) {
            throw new ConflictException({
              code: 'RAG_DOCUMENT_DUPLICATE',
              message:
                'An identical document is already available or processing.',
            });
          }

          const document = await tx.ragDocument.create({
            data: {
              id: input.documentId,
              publicId: input.publicId,
              tenantId: input.tenantId,
              knowledgeBaseId: input.knowledgeBaseId,
              privateMetadataCiphertext: Uint8Array.from(
                input.encryptedMetadata.ciphertext,
              ),
              privateMetadataNonce: Uint8Array.from(
                input.encryptedMetadata.nonce,
              ),
              privateMetadataAuthTag: Uint8Array.from(
                input.encryptedMetadata.authTag,
              ),
              privateMetadataContentKeyVersion:
                input.encryptedMetadata.contentKeyVersion,
              privateMetadataSchemaVersion:
                input.encryptedMetadata.schemaVersion,
              fileExtension: input.uploaded.fileExtension,
              mimeType: input.uploaded.mimeType,
              sizeBytes: BigInt(input.uploaded.sizeBytes),
              s3ObjectKey: input.objectKey,
              uploadedByUserId: input.uploadedByUserId,
              status: 'UPLOADED',
            },
            select: documentResponseSelection,
          });
          await tx.ragJob.create({
            data: {
              tenantId: input.tenantId,
              knowledgeBaseId: input.knowledgeBaseId,
              documentId: input.documentId,
              type: 'INGEST',
              status: 'PENDING',
              idempotencyKey: randomUUID(),
            },
          });

          return document;
        } catch (error) {
          throw new RagTransactionRolledBack(
            error,
            serializationLockAcquired,
          );
        }
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
  }

  private async decryptMetadata(
    rows: readonly RagDocumentWithMetadata[] | readonly MetadataRow[],
    keyClient?: TenantContentKeyReadClient,
  ): Promise<readonly RagDocumentPrivateMetadataV1[]> {
    try {
      return await this.metadataCodec.decryptMany(
        rows.map((row) => this.toStoredMetadata(row)),
        keyClient,
      );
    } catch (error) {
      if (
        error instanceof ContentKeyUnavailable ||
        error instanceof ContentIntegrityError
      ) {
        throw codedServiceUnavailable(
          'RAG_METADATA_KEY_UNAVAILABLE',
          'RAG document metadata is temporarily unavailable.',
        );
      }
      throw error;
    }
  }

  private toStoredMetadata(row: MetadataRow): StoredRagDocumentPrivateMetadata {
    return {
      tenantId: row.tenantId,
      knowledgeBaseId: row.knowledgeBaseId,
      documentId: row.id,
      ciphertext: row.privateMetadataCiphertext,
      nonce: row.privateMetadataNonce,
      authTag: row.privateMetadataAuthTag,
      contentKeyVersion: row.privateMetadataContentKeyVersion,
      schemaVersion: row.privateMetadataSchemaVersion,
    };
  }

  private toResponse(
    document: RagDocumentWithMetadata,
    metadata: RagDocumentPrivateMetadataV1,
  ): RagDocumentResponseDto {
    return {
      documentId: document.publicId,
      displayName: metadata.displayName,
      mimeType: document.mimeType as 'application/pdf' | 'text/plain',
      sizeBytes: Number(document.sizeBytes),
      status: document.status,
      failureCode: document.failureCode,
      failureMessage: document.sanitizedFailureMessage,
      uploadedBy: {
        displayName: safeUploaderDisplayName(document.uploadedByUser.name),
      },
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  private async compensateUploadedObject(
    objectKey: string,
    operationId: string,
  ): Promise<void> {
    try {
      await this.objectStore.deleteObject({ objectKey });
    } catch {
      this.logger.error(
        JSON.stringify({
          event: 'rag_upload_compensation_failed',
          code: 'RAG_OBJECT_DELETE_FAILED',
          operationId,
        }),
      );
    }
  }

  private toSafeUploadError(error: unknown): Error {
    if (error instanceof RagUploadException) {
      if (error.code === 'RAG_UPLOAD_FILE_TOO_LARGE') {
        return new PayloadTooLargeException({
          code: 'RAG_DOCUMENT_TOO_LARGE',
          message: 'The uploaded file exceeds the configured size limit.',
        });
      }
      if (
        error.code === 'RAG_UPLOAD_STORAGE_UNAVAILABLE' ||
        error.code === 'RAG_UPLOAD_CONFIGURATION_INVALID'
      ) {
        return codedServiceUnavailable(
          'RAG_STORAGE_UNAVAILABLE',
          'Document storage is temporarily unavailable.',
        );
      }
      return codedBadRequest(
        'RAG_DOCUMENT_INVALID_UPLOAD',
        'The uploaded document is invalid.',
      );
    }
    return codedServiceUnavailable(
      'RAG_STORAGE_UNAVAILABLE',
      'Document storage is temporarily unavailable.',
    );
  }

  private toSafePersistenceError(error: unknown): Error {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof NotFoundException ||
      error instanceof ServiceUnavailableException
    ) {
      return error;
    }
    if (
      error instanceof ContentKeyUnavailable ||
      error instanceof ContentIntegrityError
    ) {
      return codedServiceUnavailable(
        'RAG_METADATA_KEY_UNAVAILABLE',
        'RAG document metadata is temporarily unavailable.',
      );
    }
    if (error instanceof RagObjectStoreError) {
      return codedServiceUnavailable(
        'RAG_STORAGE_UNAVAILABLE',
        'Document storage is temporarily unavailable.',
      );
    }
    return codedServiceUnavailable(
      'RAG_PERSISTENCE_UNAVAILABLE',
      'RAG document persistence is temporarily unavailable.',
    );
  }

  private toSafeReadError(error: unknown): Error {
    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException ||
      error instanceof ServiceUnavailableException
    ) {
      return error;
    }
    if (
      error instanceof ContentKeyUnavailable ||
      error instanceof ContentIntegrityError
    ) {
      return codedServiceUnavailable(
        'RAG_METADATA_KEY_UNAVAILABLE',
        'RAG document metadata is temporarily unavailable.',
      );
    }
    return codedServiceUnavailable(
      'RAG_PERSISTENCE_UNAVAILABLE',
      'RAG document persistence is temporarily unavailable.',
    );
  }

  private toSafeDeleteError(error: unknown): Error {
    if (
      error instanceof NotFoundException ||
      error instanceof ServiceUnavailableException
    ) {
      return error;
    }
    if (
      error instanceof ContentKeyUnavailable ||
      error instanceof ContentIntegrityError
    ) {
      return codedServiceUnavailable(
        'RAG_METADATA_KEY_UNAVAILABLE',
        'RAG document metadata is temporarily unavailable.',
      );
    }
    if (isPrismaUniqueViolation(error)) {
      // A concurrent request may have committed the deterministic DELETE job
      // immediately before this transaction received its commit result.  The
      // caller can safely repeat DELETE and observe the DELETING document.
      return codedServiceUnavailable(
        'RAG_PERSISTENCE_UNAVAILABLE',
        'RAG document deletion is temporarily unavailable.',
      );
    }
    return codedServiceUnavailable(
      'RAG_PERSISTENCE_UNAVAILABLE',
      'RAG document deletion is temporarily unavailable.',
    );
  }
}

type MetadataRow = Pick<
  RagDocument,
  | 'id'
  | 'tenantId'
  | 'knowledgeBaseId'
  | 'privateMetadataCiphertext'
  | 'privateMetadataNonce'
  | 'privateMetadataAuthTag'
  | 'privateMetadataContentKeyVersion'
  | 'privateMetadataSchemaVersion'
>;

const metadataSelection = {
  id: true,
  tenantId: true,
  knowledgeBaseId: true,
  privateMetadataCiphertext: true,
  privateMetadataNonce: true,
  privateMetadataAuthTag: true,
  privateMetadataContentKeyVersion: true,
  privateMetadataSchemaVersion: true,
} satisfies Prisma.RagDocumentSelect;

const documentResponseSelection = {
  ...metadataSelection,
  publicId: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  failureCode: true,
  sanitizedFailureMessage: true,
  uploadedByUser: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RagDocumentSelect;

const deletionResponseSelection = {
  ...documentResponseSelection,
  s3ObjectKey: true,
} satisfies Prisma.RagDocumentSelect;

function codedBadRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

function codedServiceUnavailable(
  code: string,
  message: string,
): ServiceUnavailableException {
  return new ServiceUnavailableException({ code, message });
}

function safeUploaderDisplayName(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().normalize('NFC');
  if (
    normalized.length < 1 ||
    normalized.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isPrismaUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

class RagTransactionRolledBack extends Error {
  constructor(
    override readonly cause: unknown,
    readonly serializationLockAcquired: boolean,
  ) {
    super('RAG transaction rolled back');
    this.name = 'RagTransactionRolledBack';
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma, type RagDocument, type RagDocumentIndex } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import type { ClaimedRagJob, RagEmbeddingUsage } from './rag-worker.types';

const CHUNK_INSERT_BATCH_SIZE = 500;

type WorkerDocument = Pick<
  RagDocument,
  'id' | 'tenantId' | 'knowledgeBaseId' | 'mimeType' | 's3ObjectKey' | 'status'
>;

export type PersistedEncryptedChunk = Readonly<{
  id: string;
  ordinal: number;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  sourceMetadata: Record<string, unknown>;
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  contentKeyVersion: number;
  embedding: readonly number[];
}>;

@Injectable()
export class RagJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimNext(workerId: string, leaseDurationMs: number): Promise<ClaimedRagJob | null> {
    const leaseUntil = new Date(Date.now() + leaseDurationMs);
    const rows = await this.prisma.$transaction((tx) => tx.$queryRaw<ClaimedRagJob[]>(Prisma.sql`
        WITH expired_final_attempt AS (
          SELECT "id"
          FROM "rag_jobs"
          WHERE "type" IN ('INGEST', 'DELETE', 'REINDEX')
            AND "status" = 'RUNNING'
            AND "lease_expires_at" <= CURRENT_TIMESTAMP
            AND "attempt_count" >= "max_attempts"
          ORDER BY "lease_expires_at" ASC, "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 100
        ), failed_jobs AS (
          UPDATE "rag_jobs" AS job
          SET "status" = 'FAILED',
              "locked_at" = NULL,
              "locked_by" = NULL,
              "lease_expires_at" = NULL,
              "last_error_code" = 'RAG_JOB_LEASE_EXPIRED',
              "sanitized_last_error" = 'RAG job stopped after maximum attempts.',
              "updated_at" = CURRENT_TIMESTAMP
          FROM expired_final_attempt
          WHERE job."id" = expired_final_attempt."id"
          RETURNING job."tenant_id", job."knowledge_base_id", job."document_id", job."type"
        ), failed_documents AS (
          UPDATE "rag_documents" AS document
          SET "status" = 'FAILED',
              "failure_code" = 'RAG_JOB_LEASE_EXPIRED',
              "sanitized_failure_message" = 'RAG ingestion stopped after maximum attempts.',
              "updated_at" = CURRENT_TIMESTAMP
          FROM failed_jobs
          WHERE failed_jobs."type" IN ('INGEST', 'REINDEX')
            AND failed_jobs."document_id" IS NOT NULL
            AND document."id" = failed_jobs."document_id"
            AND document."tenant_id" = failed_jobs."tenant_id"
            AND document."knowledge_base_id" = failed_jobs."knowledge_base_id"
            AND document."status" <> 'DELETING'
          RETURNING document."id"
        ), candidate AS (
          SELECT "id"
          FROM "rag_jobs"
          WHERE "type" IN ('INGEST', 'DELETE')
            AND "document_id" IS NOT NULL
            AND "attempt_count" < "max_attempts"
            AND (
              ("status" IN ('PENDING', 'RETRY_WAIT') AND "available_at" <= CURRENT_TIMESTAMP)
              OR ("status" = 'RUNNING' AND "lease_expires_at" <= CURRENT_TIMESTAMP)
            )
          ORDER BY "available_at" ASC, "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "rag_jobs" AS job
        SET "status" = 'RUNNING',
            "attempt_count" = job."attempt_count" + 1,
            "locked_at" = CURRENT_TIMESTAMP,
            "locked_by" = ${workerId},
            "lease_expires_at" = ${leaseUntil},
            "last_error_code" = NULL,
            "sanitized_last_error" = NULL,
            "updated_at" = CURRENT_TIMESTAMP
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING job."id", job."tenant_id" AS "tenantId",
                  job."knowledge_base_id" AS "knowledgeBaseId",
                  job."document_id" AS "documentId",
                  job."type",
                  job."deletion_object_key_snapshot" AS "deletionObjectKeySnapshot",
                  job."attempt_count" AS "attemptCount",
                  job."max_attempts" AS "maxAttempts"
      `));
    const job = rows[0];
    if (!job || !job.documentId) return null;
    return Object.freeze(job);
  }

  async renewLease(job: ClaimedRagJob, workerId: string, leaseDurationMs: number): Promise<boolean> {
    const changed = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "rag_jobs"
      SET "lease_expires_at" = GREATEST(
            "lease_expires_at",
            CURRENT_TIMESTAMP + make_interval(secs => ${leaseDurationMs}::double precision / 1000.0)
          ),
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${job.id}::uuid
        AND "tenant_id" = ${job.tenantId}::uuid
        AND "status" = 'RUNNING'
        AND "locked_by" = ${workerId}
        AND "attempt_count" = ${job.attemptCount}
        AND "lease_expires_at" > CURRENT_TIMESTAMP
    `);
    return changed === 1;
  }

  async loadDocument(job: ClaimedRagJob): Promise<WorkerDocument | null> {
    return this.prisma.ragDocument.findFirst({
      where: { id: job.documentId, tenantId: job.tenantId, knowledgeBaseId: job.knowledgeBaseId },
      select: { id: true, tenantId: true, knowledgeBaseId: true, mimeType: true, s3ObjectKey: true, status: true },
    });
  }

  async setDocumentStatus(job: ClaimedRagJob, workerId: string, status: string): Promise<boolean> {
    const changed = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "rag_documents" AS document
      SET "status" = ${status},
          "failure_code" = NULL,
          "sanitized_failure_message" = NULL,
          "updated_at" = CURRENT_TIMESTAMP
      FROM "rag_jobs" AS job
      WHERE document."id" = ${job.documentId}::uuid
        AND document."tenant_id" = ${job.tenantId}::uuid
        AND document."knowledge_base_id" = ${job.knowledgeBaseId}::uuid
        AND document."status" <> 'DELETING'
        AND job."id" = ${job.id}::uuid
        AND job."tenant_id" = ${job.tenantId}::uuid
        AND job."knowledge_base_id" = ${job.knowledgeBaseId}::uuid
        AND job."document_id" = document."id"
        AND job."status" = 'RUNNING'
        AND job."locked_by" = ${workerId}
        AND job."lease_expires_at" > CURRENT_TIMESTAMP
        AND job."attempt_count" = ${job.attemptCount}
    `);
    return changed === 1;
  }

  async getOrCreateBuildingIndex(
    job: ClaimedRagJob,
    parserVersion: number,
    chunkerVersion: number,
  ): Promise<RagDocumentIndex> {
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "rag_knowledge_bases"
        WHERE "id" = ${job.knowledgeBaseId}::uuid AND "tenant_id" = ${job.tenantId}::uuid
        FOR UPDATE
      `);
      if (lock.length !== 1) throw new Error('knowledge base unavailable');
      const current = await tx.ragDocumentIndex.findFirst({
        where: { tenantId: job.tenantId, documentId: job.documentId, status: 'BUILDING' },
        orderBy: { version: 'desc' },
      });
      if (current) return current;
      const maximum = await tx.ragDocumentIndex.aggregate({
        where: { tenantId: job.tenantId, documentId: job.documentId },
        _max: { version: true },
      });
      return tx.ragDocumentIndex.create({
        data: {
          tenantId: job.tenantId,
          documentId: job.documentId,
          version: (maximum._max.version ?? 0) + 1,
          status: 'BUILDING',
          parserVersion,
          chunkerVersion,
          startedAt: new Date(),
        },
      });
    });
  }

  async completeIngestion(input: Readonly<{
    job: ClaimedRagJob;
    workerId: string;
    indexId: string;
    chunks: readonly PersistedEncryptedChunk[];
    usages: readonly (RagEmbeddingUsage & { operationId: string; batchOrdinal: number })[];
  }>): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const liveJob = await tx.ragJob.updateMany({
        where: {
          id: input.job.id,
          tenantId: input.job.tenantId,
          status: 'RUNNING',
          lockedBy: input.workerId,
          attemptCount: input.job.attemptCount,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          status: 'SUCCEEDED', lockedAt: null, lockedBy: null, leaseExpiresAt: null,
          lastErrorCode: null, sanitizedLastError: null,
        },
      });
      if (liveJob.count !== 1) return false;

      const document = await tx.ragDocument.updateMany({
        where: {
          id: input.job.documentId,
          tenantId: input.job.tenantId,
          knowledgeBaseId: input.job.knowledgeBaseId,
          status: { not: 'DELETING' },
        },
        data: { status: 'READY', failureCode: null, sanitizedFailureMessage: null },
      });
      if (document.count !== 1) throw new Error('document is unavailable');

      await tx.ragDocumentIndex.updateMany({
        where: {
          tenantId: input.job.tenantId,
          documentId: input.job.documentId,
          status: 'ACTIVE',
          id: { not: input.indexId },
        },
        data: { status: 'RETIRED', completedAt: new Date() },
      });
      const index = await tx.ragDocumentIndex.updateMany({
        where: { id: input.indexId, tenantId: input.job.tenantId, documentId: input.job.documentId, status: 'BUILDING' },
        data: { status: 'ACTIVE', completedAt: new Date() },
      });
      if (index.count !== 1) throw new Error('building index unavailable');
      await tx.ragChunk.deleteMany({
        where: { tenantId: input.job.tenantId, documentId: input.job.documentId, documentIndexId: input.indexId },
      });
      await insertChunks(tx, input.job, input.indexId, input.chunks);
      await tx.ragEmbeddingUsage.createMany({
        data: input.usages.map((usage) => ({
          tenantId: input.job.tenantId,
          purpose: 'RAG_INGESTION',
          operationId: usage.operationId,
          batchOrdinal: usage.batchOrdinal,
          inputCount: usage.inputCount,
          promptTokens: usage.promptTokens,
          totalTokens: usage.totalTokens,
        })),
        skipDuplicates: true,
      });
      const knowledgeBase = await tx.ragKnowledgeBase.updateMany({
        where: { id: input.job.knowledgeBaseId, tenantId: input.job.tenantId },
        data: { revision: { increment: 1 } },
      });
      if (knowledgeBase.count !== 1) throw new Error('knowledge base unavailable');
      return true;
    });
  }

  async recordEmbeddingUsage(
    job: ClaimedRagJob,
    usage: RagEmbeddingUsage & { operationId: string; batchOrdinal: number },
  ): Promise<void> {
    await this.prisma.ragEmbeddingUsage.createMany({
      data: [{
        tenantId: job.tenantId,
        purpose: 'RAG_INGESTION',
        operationId: usage.operationId,
        batchOrdinal: usage.batchOrdinal,
        inputCount: usage.inputCount,
        promptTokens: usage.promptTokens,
        totalTokens: usage.totalTokens,
      }],
      skipDuplicates: true,
    });
  }

  async failOrRetry(input: Readonly<{
    job: ClaimedRagJob;
    workerId: string;
    indexId?: string;
    code: string;
    message: string;
    retryable: boolean;
    retryDelayMs: number;
  }>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const retry = input.retryable && input.job.attemptCount < input.job.maxAttempts;
      const changed = await tx.ragJob.updateMany({
        where: {
          id: input.job.id,
          tenantId: input.job.tenantId,
          status: 'RUNNING',
          lockedBy: input.workerId,
          attemptCount: input.job.attemptCount,
          leaseExpiresAt: { gt: new Date() },
        },
        data: retry
          ? {
              status: 'RETRY_WAIT', availableAt: new Date(Date.now() + input.retryDelayMs),
              lockedAt: null, lockedBy: null, leaseExpiresAt: null,
              lastErrorCode: input.code, sanitizedLastError: input.message,
            }
          : {
              status: 'FAILED', lockedAt: null, lockedBy: null, leaseExpiresAt: null,
              lastErrorCode: input.code, sanitizedLastError: input.message,
          },
      });
      if (changed.count !== 1) return;
      if (input.indexId) {
        await tx.ragDocumentIndex.updateMany({
          where: { id: input.indexId, tenantId: input.job.tenantId, documentId: input.job.documentId, status: 'BUILDING' },
          data: { status: 'FAILED', completedAt: new Date() },
        });
      }
      if (retry || input.job.type === 'DELETE') return;
      await tx.ragDocument.updateMany({
        where: {
          id: input.job.documentId, tenantId: input.job.tenantId,
          knowledgeBaseId: input.job.knowledgeBaseId, status: { not: 'DELETING' },
        },
        data: { status: 'FAILED', failureCode: input.code, sanitizedFailureMessage: input.message },
      });
    });
  }

  async cancel(job: ClaimedRagJob, workerId: string): Promise<void> {
    await this.prisma.ragJob.updateMany({
      where: {
        id: job.id,
        tenantId: job.tenantId,
        status: 'RUNNING',
        lockedBy: workerId,
        attemptCount: job.attemptCount,
        leaseExpiresAt: { gt: new Date() },
      },
      data: { status: 'CANCELLED', lockedAt: null, lockedBy: null, leaseExpiresAt: null },
    });
  }

  async succeedNoop(job: ClaimedRagJob, workerId: string): Promise<void> {
    await this.prisma.ragJob.updateMany({
      where: {
        id: job.id,
        tenantId: job.tenantId,
        status: 'RUNNING',
        lockedBy: workerId,
        attemptCount: job.attemptCount,
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        status: 'SUCCEEDED', lockedAt: null, lockedBy: null, leaseExpiresAt: null,
        lastErrorCode: null, sanitizedLastError: null,
      },
    });
  }

  /**
   * Must run only after S3 DeleteObject succeeds.  The transaction preserves
   * the DELETE job snapshot, terminalizes/detaches every other document job,
   * and deletes the Document last so a failed DB commit never loses the key
   * required for an idempotent retry.
   */
  async completeDeletion(job: ClaimedRagJob, workerId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const liveDelete = await tx.ragJob.updateMany({
        where: {
          id: job.id,
          tenantId: job.tenantId,
          documentId: job.documentId,
          type: 'DELETE',
          status: 'RUNNING',
          lockedBy: workerId,
          attemptCount: job.attemptCount,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          status: 'SUCCEEDED',
          documentId: null,
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          sanitizedLastError: null,
        },
      });
      if (liveDelete.count !== 1) return false;

      const document = await tx.ragDocument.findFirst({
        where: {
          id: job.documentId,
          tenantId: job.tenantId,
          knowledgeBaseId: job.knowledgeBaseId,
          status: 'DELETING',
        },
        select: { id: true },
      });
      if (!document) throw new Error('deleting document is unavailable');

      await tx.ragJob.updateMany({
        where: {
          tenantId: job.tenantId,
          documentId: job.documentId,
          status: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT'] },
        },
        data: {
          status: 'CANCELLED',
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          sanitizedLastError: null,
        },
      });
      // The schema permits a null documentId for INGEST/REINDEX only after
      // terminalization.  Clear it for every historical job before delete so
      // the NO ACTION FK cannot lose the retry/audit history.
      await tx.ragJob.updateMany({
        where: { tenantId: job.tenantId, documentId: job.documentId },
        data: { documentId: null },
      });
      const removed = await tx.ragDocument.deleteMany({
        where: {
          id: job.documentId,
          tenantId: job.tenantId,
          knowledgeBaseId: job.knowledgeBaseId,
          status: 'DELETING',
        },
      });
      if (removed.count !== 1) throw new Error('deleting document is unavailable');
      await tx.ragKnowledgeBase.updateMany({
        where: { id: job.knowledgeBaseId, tenantId: job.tenantId },
        data: { revision: { increment: 1 } },
      });
      return true;
    });
  }
}

async function insertChunks(
  tx: Prisma.TransactionClient,
  job: ClaimedRagJob,
  indexId: string,
  chunks: readonly PersistedEncryptedChunk[],
): Promise<void> {
  if (chunks.length < 1) throw new Error('empty chunks');
  for (let offset = 0; offset < chunks.length; offset += CHUNK_INSERT_BATCH_SIZE) {
    const values = chunks.slice(offset, offset + CHUNK_INSERT_BATCH_SIZE).map((chunk) => Prisma.sql`(
      ${chunk.id}::uuid, ${job.tenantId}::uuid, ${job.documentId}::uuid, ${indexId}::uuid,
      ${chunk.ordinal}, ${chunk.tokenCount}, ${chunk.pageStart}, ${chunk.pageEnd},
      ${chunk.lineStart}, ${chunk.lineEnd}, ${JSON.stringify(chunk.sourceMetadata)}::jsonb,
      ${chunk.ciphertext}, ${chunk.nonce}, ${chunk.authTag}, ${chunk.contentKeyVersion},
      ${JSON.stringify(chunk.embedding)}::vector, CURRENT_TIMESTAMP
    )`);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "rag_chunks" (
        "id", "tenant_id", "document_id", "document_index_id", "ordinal", "token_count",
        "page_start", "page_end", "line_start", "line_end", "source_metadata",
        "content_ciphertext", "content_nonce", "content_auth_tag", "content_key_version",
        "embedding", "created_at"
      ) VALUES ${Prisma.join(values)}
    `);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  createRagChunkAadV1,
  encryptContent,
} from '@/modules/rag-documents/crypto/tenant-crypto';
import { ControlPlaneTenantContentKeyService } from '@/modules/rag-documents/crypto/tenant-content-key.service';
import {
  RAG_OBJECT_STORE,
  RagObjectStoreError,
  type RagObjectStore,
} from '@/modules/rag-documents/storage';

import { RagJobRepository, type PersistedEncryptedChunk } from './rag-job.repository';
import { RagWorkerSettings } from './rag-worker-settings';
import {
  RAG_EMBEDDING_DIMENSIONS,
  RagWorkerError,
  isRagWorkerError,
  type ClaimedRagJob,
  type ExtractedRagChunk,
  type RagEmbeddingClient,
  type RagEmbeddingUsage,
  type RagExtractionClient,
} from './rag-worker.types';

export const RAG_EXTRACTION_CLIENT = Symbol('RAG_EXTRACTION_CLIENT');
export const RAG_EMBEDDING_CLIENT = Symbol('RAG_EMBEDDING_CLIENT');

@Injectable()
export class RagIngestionProcessor {
  constructor(
    private readonly repository: RagJobRepository,
    private readonly settings: RagWorkerSettings,
    private readonly keys: ControlPlaneTenantContentKeyService,
    @Inject(RAG_OBJECT_STORE) private readonly objectStore: RagObjectStore,
    @Inject(RAG_EXTRACTION_CLIENT) private readonly extraction: RagExtractionClient,
    @Inject(RAG_EMBEDDING_CLIENT) private readonly embeddings: RagEmbeddingClient,
  ) {}

  async process(job: ClaimedRagJob, workerId: string, signal: AbortSignal): Promise<void> {
    let indexId: string | undefined;
    try {
      const document = await this.repository.loadDocument(job);
      if (!document || document.status === 'DELETING') {
        await this.repository.cancel(job, workerId);
        return;
      }
      if (document.status === 'READY') {
        await this.repository.succeedNoop(job, workerId);
        return;
      }
      if (document.status === 'FAILED') {
        await this.repository.cancel(job, workerId);
        return;
      }
      if (document.mimeType !== 'text/plain' && document.mimeType !== 'application/pdf') {
        throw new RagWorkerError('RAG_UNSUPPORTED_FORMAT', 'The document format is not supported.', false);
      }
      await this.requireStage(job, workerId, 'EXTRACTING');
      const getObject = this.objectStore.getObject;
      if (!getObject) throw new RagWorkerError('RAG_OBJECT_READ_FAILED', 'Document storage is temporarily unavailable.', true);
      const source = await getObject.call(this.objectStore, { objectKey: document.s3ObjectKey, abortSignal: signal });
      const extracted = await this.extraction.extract({ body: source, mimeType: document.mimeType, signal });
      assertExtractionProfile(extracted.parserVersion, extracted.chunkerVersion, extracted.chunks);
      await this.requireStage(job, workerId, 'CHUNKING');
      const index = await this.repository.getOrCreateBuildingIndex(job, 1, 1);
      indexId = index.id;
      await this.requireStage(job, workerId, 'EMBEDDING');
      const vectorsAndUsage = await this.embedInBatches(job, extracted.chunks, signal);
      const encrypted = await this.encryptChunks(job, index.id, extracted.chunks, vectorsAndUsage.vectors);
      await this.requireStage(job, workerId, 'INDEXING');
      const completed = await this.repository.completeIngestion({
        job,
        workerId,
        indexId: index.id,
        chunks: encrypted,
        usages: vectorsAndUsage.usages,
      });
      if (!completed) return;
    } catch (error) {
      const normalized = normalizeError(error);
      await this.repository.failOrRetry({
        job,
        workerId,
        indexId,
        code: normalized.code,
        message: normalized.sanitizedMessage,
        retryable: normalized.retryable,
        retryDelayMs: backoffMs(job.attemptCount, this.settings.value.retryBaseMs, this.settings.value.retryCapMs),
      });
    }
  }

  private async requireStage(job: ClaimedRagJob, workerId: string, status: string): Promise<void> {
    if (!(await this.repository.setDocumentStatus(job, workerId, status))) {
      throw new RagWorkerError('RAG_DOCUMENT_UNAVAILABLE', 'The document is no longer available.', false);
    }
  }

  private async embedInBatches(
    job: ClaimedRagJob,
    chunks: readonly ExtractedRagChunk[],
    signal: AbortSignal,
  ): Promise<Readonly<{ vectors: readonly (readonly number[])[]; usages: readonly (RagEmbeddingUsage & { operationId: string; batchOrdinal: number })[] }>> {
    if (chunks.length < 1) throw new RagWorkerError('RAG_EXTRACTION_EMPTY_TEXT', 'The document has no extractable text.', false);
    const vectors: (readonly number[])[] = [];
    const usages: (RagEmbeddingUsage & { operationId: string; batchOrdinal: number })[] = [];
    const batchSize = this.settings.value.embeddingBatchSize;
    for (let start = 0, batchOrdinal = 0; start < chunks.length; start += batchSize, batchOrdinal += 1) {
      if (signal.aborted) throw new RagWorkerError('RAG_WORKER_CANCELLED', 'RAG ingestion was cancelled.', true);
      const batch = chunks.slice(start, start + batchSize);
      const operationId = `rag_ingest_${job.id}_${batchOrdinal}`;
      const result = await this.embeddings.embed({
        tenantId: job.tenantId,
        operationId,
        requestId: `rag_request_${job.id}_${batchOrdinal}`,
        inputs: batch.map((chunk) => chunk.text),
        signal,
      });
      if (result.embeddings.length !== batch.length || result.usage.inputCount !== batch.length) {
        throw new RagWorkerError('RAG_EMBEDDING_INVALID_RESPONSE', 'RAG embedding response is invalid.', false);
      }
      for (const vector of result.embeddings) {
        if (vector.length !== RAG_EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
          throw new RagWorkerError('RAG_EMBEDDING_DIMENSION_MISMATCH', 'RAG embedding dimensions are invalid.', false);
        }
        vectors.push(vector);
      }
      const usage = { ...result.usage, operationId, batchOrdinal };
      await this.repository.recordEmbeddingUsage(job, usage);
      usages.push(usage);
    }
    return Object.freeze({ vectors: Object.freeze(vectors), usages: Object.freeze(usages) });
  }

  private async encryptChunks(
    job: ClaimedRagJob,
    indexId: string,
    chunks: readonly ExtractedRagChunk[],
    vectors: readonly (readonly number[])[],
  ): Promise<readonly PersistedEncryptedChunk[]> {
    if (chunks.length !== vectors.length) throw new RagWorkerError('RAG_EMBEDDING_INVALID_RESPONSE', 'RAG embedding response is invalid.', false);
    return this.keys.withActiveKey(job.tenantId, (key, contentKeyVersion) => Object.freeze(chunks.map((chunk, index) => {
      const id = randomUUID();
      const encrypted = encryptContent(key, chunk.text, createRagChunkAadV1({
        tenantId: job.tenantId,
        knowledgeBaseId: job.knowledgeBaseId,
        documentId: job.documentId,
        documentIndexId: indexId,
        chunkId: id,
        contentKeyVersion,
      }));
      return Object.freeze({
        id, ordinal: chunk.ordinal, tokenCount: chunk.tokenCount,
        pageStart: chunk.pageStart, pageEnd: chunk.pageEnd,
        lineStart: chunk.lineStart, lineEnd: chunk.lineEnd,
        sourceMetadata: chunk.sourceMetadata,
        ciphertext: encrypted.ciphertext, nonce: encrypted.nonce, authTag: encrypted.tag,
        contentKeyVersion, embedding: vectors[index] as readonly number[],
      });
    })));
  }
}

function assertExtractionProfile(
  parserVersion: string,
  chunkerVersion: string,
  chunks: readonly ExtractedRagChunk[],
): void {
  if (
    !['utf8-nfc-text-v1', 'pypdf-6.14.2-text-v1'].includes(parserVersion) ||
    chunkerVersion !== 'cl100k-base-chunker-v1' ||
    chunks.some((chunk, index) => chunk.ordinal !== index || chunk.parserVersion !== parserVersion || chunk.chunkerVersion !== chunkerVersion)
  ) {
    throw new RagWorkerError('RAG_EXTRACTION_PROFILE_MISMATCH', 'RAG extraction output is incompatible.', false);
  }
}

function normalizeError(error: unknown): RagWorkerError {
  if (isRagWorkerError(error)) return error;
  if (error instanceof RagObjectStoreError) {
    return new RagWorkerError(error.code, 'Document storage is temporarily unavailable.', true);
  }
  return new RagWorkerError('RAG_INGESTION_UNAVAILABLE', 'RAG ingestion is temporarily unavailable.', true);
}

export function backoffMs(attempt: number, base: number, cap: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 20));
  return Math.min(cap, base * 2 ** exponent);
}

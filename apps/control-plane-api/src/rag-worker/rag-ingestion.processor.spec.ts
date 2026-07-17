import { Readable } from 'node:stream';

import { decryptContent } from '@gatelm/tenant-content-crypto';

import { RagIngestionProcessor, backoffMs } from './rag-ingestion.processor';
import { type PersistedEncryptedChunk, RagJobRepository } from './rag-job.repository';
import { RagWorkerSettings } from './rag-worker-settings';
import type { ClaimedRagJob, ExtractedRagChunk, RagEmbeddingClient, RagExtractionClient } from './rag-worker.types';

const tenantId = '00000000-0000-4000-8000-000000000100';
const knowledgeBaseId = '00000000-0000-4000-8000-000000000101';
const documentId = '00000000-0000-4000-8000-000000000102';
const job: ClaimedRagJob = {
  id: '00000000-0000-4000-8000-000000000103', tenantId, knowledgeBaseId, documentId,
  type: 'INGEST', deletionObjectKeySnapshot: null,
  attemptCount: 1, maxAttempts: 5,
};

describe('RagIngestionProcessor', () => {
  it('persists only encrypted chunks after all embedding batches succeed', async () => {
    const harness = createHarness();
    await harness.processor.process(job, 'worker_001', new AbortController().signal);

    expect(harness.stages).toEqual(['EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING']);
    expect(harness.embeddings.embed).toHaveBeenCalledWith(expect.objectContaining({
      tenantId, inputs: ['First source paragraph.', 'Second source paragraph.'],
    }));
    const completion = harness.complete.mock.calls[0]?.[0];
    expect(completion).toEqual(expect.objectContaining({ indexId: '00000000-0000-4000-8000-000000000104' }));
    const chunk = completion?.chunks[0] as PersistedEncryptedChunk;
    expect(chunk.ciphertext.toString('utf8')).not.toContain('First source paragraph.');
    const decrypted = decryptContent(harness.contentKey, {
      ciphertext: chunk.ciphertext, nonce: chunk.nonce, tag: chunk.authTag,
    }, {
      schemaVersion: 1, tenantId, knowledgeBaseId, documentId,
      documentIndexId: '00000000-0000-4000-8000-000000000104', chunkId: chunk.id,
      contentKind: 'rag_chunk', contentKeyVersion: 2,
    });
    expect(decrypted).toBe('First source paragraph.');
    expect(completion?.usages).toEqual([expect.objectContaining({ inputCount: 2, batchOrdinal: 0 })]);
    expect(harness.recordEmbeddingUsage).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ inputCount: 2, batchOrdinal: 0 }),
    );
    expect(harness.failed).not.toHaveBeenCalled();
  });

  it('never completes an index when a later embedding batch fails', async () => {
    const harness = createHarness({ batchSize: 1, failSecondEmbedding: true });
    await harness.processor.process(job, 'worker_001', new AbortController().signal);
    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.recordEmbeddingUsage).toHaveBeenCalledTimes(1);
    expect(harness.recordEmbeddingUsage).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ batchOrdinal: 0, inputCount: 1 }),
    );
    expect(harness.failed).toHaveBeenCalledWith(expect.objectContaining({
      indexId: '00000000-0000-4000-8000-000000000104', retryable: true,
    }));
  });

  it('marks extraction permanent errors as non-retryable without source text', async () => {
    const harness = createHarness({ extractionError: { code: 'RAG_EXTRACTION_SCANNED_PDF_NOT_SUPPORTED', retryable: false } });
    await harness.processor.process(job, 'worker_001', new AbortController().signal);
    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.failed).toHaveBeenCalledWith(expect.objectContaining({
      code: 'RAG_EXTRACTION_SCANNED_PDF_NOT_SUPPORTED', retryable: false,
      message: expect.not.stringContaining('source'),
    }));
  });

  it('rejects a non-1536-dimensional vector before persistence', async () => {
    const harness = createHarness({ badDimension: true });
    await harness.processor.process(job, 'worker_001', new AbortController().signal);
    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.failed).toHaveBeenCalledWith(expect.objectContaining({
      code: 'RAG_EMBEDDING_DIMENSION_MISMATCH', retryable: false,
    }));
  });

  it('cancels an INGEST job before any external call when deletion has won the race', async () => {
    const harness = createHarness({ documentStatus: 'DELETING' });
    await harness.processor.process(job, 'worker_001', new AbortController().signal);

    expect(harness.cancel).toHaveBeenCalledWith(job, 'worker_001');
    expect(harness.objectStore.getObject).not.toHaveBeenCalled();
    expect(harness.embeddings.embed).not.toHaveBeenCalled();
  });

  it('uses bounded exponential retry delays', () => {
    expect(backoffMs(1, 1_000, 30_000)).toBe(1_000);
    expect(backoffMs(3, 1_000, 30_000)).toBe(4_000);
    expect(backoffMs(99, 1_000, 30_000)).toBe(30_000);
  });
});

function createHarness(options: Readonly<{ batchSize?: number; failSecondEmbedding?: boolean; badDimension?: boolean; documentStatus?: string; extractionError?: { code: string; retryable: boolean } }> = {}) {
  const stages: string[] = [];
  const complete = jest.fn().mockResolvedValue(true);
  const failed = jest.fn().mockResolvedValue(undefined);
  const recordEmbeddingUsage = jest.fn().mockResolvedValue(undefined);
  const contentKey = Buffer.alloc(32, 7);
  const repository = {
    loadDocument: jest.fn().mockResolvedValue({
      id: documentId, tenantId, knowledgeBaseId, mimeType: 'text/plain', s3ObjectKey: 'rag/source', status: options.documentStatus ?? 'UPLOADED',
    }),
    setDocumentStatus: jest.fn().mockImplementation(async (_job: unknown, _workerId: string, status: string) => {
      stages.push(status); return true;
    }),
    getOrCreateBuildingIndex: jest.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000104' }),
    completeIngestion: complete,
    recordEmbeddingUsage,
    failOrRetry: failed,
    cancel: jest.fn().mockResolvedValue(undefined),
    succeedNoop: jest.fn().mockResolvedValue(undefined),
  } as unknown as RagJobRepository;
  const extraction: RagExtractionClient = {
    extract: jest.fn().mockImplementation(async () => {
      if (options.extractionError) {
        const { RagWorkerError } = await import('./rag-worker.types');
        throw new RagWorkerError(options.extractionError.code, 'The document cannot be processed for RAG.', options.extractionError.retryable);
      }
      return {
        parserVersion: 'utf8-nfc-text-v1', chunkerVersion: 'cl100k-base-chunker-v1',
        chunks: [chunk(0, 'First source paragraph.'), chunk(1, 'Second source paragraph.')],
      };
    }),
  };
  let embeddingCall = 0;
  const embeddings: RagEmbeddingClient = {
    embed: jest.fn().mockImplementation(async ({ inputs }: { inputs: readonly string[] }) => {
      embeddingCall += 1;
      if (options.failSecondEmbedding && embeddingCall === 2) {
        const { RagWorkerError } = await import('./rag-worker.types');
        throw new RagWorkerError('RAG_GATEWAY_UNAVAILABLE', 'RAG embedding service is temporarily unavailable.', true);
      }
      return {
        embeddings: inputs.map(() => Array.from({ length: options.badDimension ? 1535 : 1536 }, () => 0.01)),
        usage: { inputCount: inputs.length, promptTokens: 2, totalTokens: 2 },
      };
    }),
  };
  const settings = { value: { embeddingBatchSize: options.batchSize ?? 64, retryBaseMs: 1_000, retryCapMs: 30_000 } } as RagWorkerSettings;
  const keys = { withActiveKey: async (_tenant: string, operation: (key: Buffer, version: number) => unknown) => operation(contentKey, 2) };
  const objectStore = { getObject: jest.fn().mockResolvedValue(Readable.from('fixture')) };
  return {
    processor: new RagIngestionProcessor(repository, settings, keys as never, objectStore as never, extraction, embeddings),
    stages, complete, failed, recordEmbeddingUsage,
    cancel: (repository as unknown as { cancel: jest.Mock }).cancel,
    embeddings, objectStore, contentKey,
  };
}

function chunk(ordinal: number, text: string): ExtractedRagChunk {
  return {
    ordinal, text, tokenCount: 5, pageStart: null, pageEnd: null,
    lineStart: ordinal + 1, lineEnd: ordinal + 1, sourceMetadata: { kind: 'paragraph' },
    parserVersion: 'utf8-nfc-text-v1', chunkerVersion: 'cl100k-base-chunker-v1',
  };
}

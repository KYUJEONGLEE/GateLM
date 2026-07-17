import { RagDeletionProcessor } from './rag-deletion.processor';
import { RagJobRepository } from './rag-job.repository';
import { RagWorkerSettings } from './rag-worker-settings';
import { RagObjectStoreError } from '@/modules/rag-documents/storage';
import type { ClaimedRagJob } from './rag-worker.types';

const job: ClaimedRagJob = {
  id: '00000000-0000-4000-8000-000000000301',
  tenantId: '00000000-0000-4000-8000-000000000302',
  knowledgeBaseId: '00000000-0000-4000-8000-000000000303',
  documentId: '00000000-0000-4000-8000-000000000304',
  type: 'DELETE',
  deletionObjectKeySnapshot:
    'rag/00000000-0000-4000-8000-000000000302/00000000-0000-4000-8000-000000000304/source',
  attemptCount: 1,
  maxAttempts: 5,
};

describe('RagDeletionProcessor', () => {
  it('treats an already-missing S3 object as success and completes the DB hard delete', async () => {
    const harness = createHarness();
    await harness.processor.process(job, 'worker_001', new AbortController().signal);

    expect(harness.objectStore.deleteObject).toHaveBeenCalledWith({
      objectKey: job.deletionObjectKeySnapshot,
    });
    expect(harness.completeDeletion).toHaveBeenCalledWith(job, 'worker_001');
    expect(harness.failOrRetry).not.toHaveBeenCalled();
  });

  it('keeps the document DELETING and schedules a retry when S3 delete times out', async () => {
    const harness = createHarness();
    harness.objectStore.deleteObject.mockRejectedValueOnce(
      new RagObjectStoreError('RAG_OBJECT_DELETE_FAILED'),
    );

    await harness.processor.process(job, 'worker_001', new AbortController().signal);

    expect(harness.completeDeletion).not.toHaveBeenCalled();
    expect(harness.failOrRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'RAG_OBJECT_DELETE_FAILED',
        retryable: true,
        message: 'Document storage is temporarily unavailable.',
      }),
    );
  });

  it('repeats idempotent S3 deletion after a DB finalization failure', async () => {
    const harness = createHarness();
    harness.completeDeletion.mockRejectedValueOnce(new Error('database detail'));

    await harness.processor.process(job, 'worker_001', new AbortController().signal);
    await harness.processor.process(
      { ...job, attemptCount: 2 },
      'worker_001',
      new AbortController().signal,
    );

    expect(harness.objectStore.deleteObject).toHaveBeenCalledTimes(2);
    expect(harness.failOrRetry).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RAG_DELETION_UNAVAILABLE', retryable: true }),
    );
    expect(harness.completeDeletion).toHaveBeenCalledTimes(2);
  });
});

function createHarness() {
  const completeDeletion = jest.fn().mockResolvedValue(true);
  const failOrRetry = jest.fn().mockResolvedValue(undefined);
  const objectStore = {
    putObject: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const repository = {
    loadDocument: jest.fn().mockResolvedValue({ status: 'DELETING' }),
    completeDeletion,
    failOrRetry,
    cancel: jest.fn().mockResolvedValue(undefined),
    succeedNoop: jest.fn().mockResolvedValue(undefined),
  } as unknown as RagJobRepository;
  const settings = {
    value: { retryBaseMs: 1_000, retryCapMs: 30_000 },
  } as RagWorkerSettings;
  return {
    processor: new RagDeletionProcessor(repository, settings, objectStore),
    objectStore,
    completeDeletion,
    failOrRetry,
  };
}

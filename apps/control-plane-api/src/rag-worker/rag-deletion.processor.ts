import { Inject, Injectable } from '@nestjs/common';

import {
  RAG_OBJECT_STORE,
  RagObjectStoreError,
  type RagObjectStore,
} from '@/modules/rag-documents/storage';

import { RagJobRepository } from './rag-job.repository';
import { RagWorkerSettings } from './rag-worker-settings';
import {
  RagWorkerError,
  isRagWorkerError,
  type ClaimedRagJob,
} from './rag-worker.types';
import { backoffMs } from './rag-ingestion.processor';

@Injectable()
export class RagDeletionProcessor {
  constructor(
    private readonly repository: RagJobRepository,
    private readonly settings: RagWorkerSettings,
    @Inject(RAG_OBJECT_STORE) private readonly objectStore: RagObjectStore,
  ) {}

  async process(
    job: ClaimedRagJob,
    workerId: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      if (job.type !== 'DELETE') {
        throw new RagWorkerError(
          'RAG_JOB_TYPE_INVALID',
          'RAG deletion job is invalid.',
          false,
        );
      }
      if (signal.aborted) {
        throw new RagWorkerError(
          'RAG_WORKER_CANCELLED',
          'RAG deletion was cancelled.',
          true,
        );
      }
      const snapshot = job.deletionObjectKeySnapshot;
      if (!snapshot) {
        throw new RagWorkerError(
          'RAG_DELETE_SNAPSHOT_UNAVAILABLE',
          'RAG document deletion cannot continue.',
          false,
        );
      }
      const document = await this.repository.loadDocument(job);
      if (!document) {
        await this.repository.succeedNoop(job, workerId);
        return;
      }
      if (document.status !== 'DELETING') {
        await this.repository.cancel(job, workerId);
        return;
      }

      // S3 DeleteObject is idempotent: an already-missing object is a
      // successful desired state.  A DB failure afterwards therefore safely
      // retries this exact call from the durable snapshot.
      await this.objectStore.deleteObject({ objectKey: snapshot });
      if (signal.aborted) {
        throw new RagWorkerError(
          'RAG_WORKER_CANCELLED',
          'RAG deletion was cancelled.',
          true,
        );
      }
      await this.repository.completeDeletion(job, workerId);
    } catch (error) {
      const normalized = normalizeDeletionError(error);
      await this.repository.failOrRetry({
        job,
        workerId,
        code: normalized.code,
        message: normalized.sanitizedMessage,
        retryable: normalized.retryable,
        retryDelayMs: backoffMs(
          job.attemptCount,
          this.settings.value.retryBaseMs,
          this.settings.value.retryCapMs,
        ),
      });
    }
  }
}

function normalizeDeletionError(error: unknown): RagWorkerError {
  if (isRagWorkerError(error)) return error;
  if (error instanceof RagObjectStoreError) {
    return new RagWorkerError(
      error.code,
      'Document storage is temporarily unavailable.',
      true,
    );
  }
  return new RagWorkerError(
    'RAG_DELETION_UNAVAILABLE',
    'RAG document deletion is temporarily unavailable.',
    true,
  );
}

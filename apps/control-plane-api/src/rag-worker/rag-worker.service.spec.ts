import { randomUUID } from 'node:crypto';

import type { RagDeletionProcessor } from './rag-deletion.processor';
import type { RagIngestionProcessor } from './rag-ingestion.processor';
import type { RagJobRepository } from './rag-job.repository';
import { RagWorkerService } from './rag-worker.service';
import type { RagWorkerSettings } from './rag-worker-settings';
import type { ClaimedRagJob } from './rag-worker.types';

describe('RagWorkerService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('never overlaps heartbeat lease renewals for one claimed job', async () => {
    jest.useFakeTimers();
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
    const firstRenewal = deferred<boolean>();
    const processing = deferred<void>();
    const repository = {
      claimNext: jest.fn().mockResolvedValue(job),
      renewLease: jest.fn()
        .mockReturnValueOnce(firstRenewal.promise)
        .mockResolvedValue(true),
    };
    const ingestion = { process: jest.fn().mockReturnValue(processing.promise) };
    const settings = {
      value: {
        workerId: 'worker_001',
        leaseDurationMs: 3_000,
        pollIntervalMs: 1_000,
      },
    };
    const service = new RagWorkerService(
      repository as unknown as RagJobRepository,
      ingestion as unknown as RagIngestionProcessor,
      {} as RagDeletionProcessor,
      settings as RagWorkerSettings,
    );

    const running = service.runOnce();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(repository.renewLease).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5_000);
    expect(repository.renewLease).toHaveBeenCalledTimes(1);

    firstRenewal.resolve(true);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(repository.renewLease).toHaveBeenCalledTimes(2);

    processing.resolve();
    await expect(running).resolves.toBe(true);
  });
});

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

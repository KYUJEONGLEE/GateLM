import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { RagIngestionProcessor } from './rag-ingestion.processor';
import { RagDeletionProcessor } from './rag-deletion.processor';
import { RagJobRepository } from './rag-job.repository';
import { RagWorkerSettings } from './rag-worker-settings';

@Injectable()
export class RagWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagWorkerService.name);
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly repository: RagJobRepository,
    private readonly ingestionProcessor: RagIngestionProcessor,
    private readonly deletionProcessor: RagDeletionProcessor,
    private readonly settings: RagWorkerSettings,
  ) {}

  onModuleInit(): void {
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  async runOnce(): Promise<boolean> {
    const job = await this.repository.claimNext(
      this.settings.value.workerId,
      this.settings.value.leaseDurationMs,
    );
    if (!job) return false;
    const controller = new AbortController();
    let leaseLost = false;
    let heartbeatActive = true;
    let heartbeatRenewal: Promise<void> | undefined;
    const loseLease = (): void => {
      if (!heartbeatActive) return;
      leaseLost = true;
      controller.abort();
    };
    const renewLease = (): void => {
      if (!heartbeatActive || leaseLost || heartbeatRenewal) return;
      const renewal = Promise.resolve()
        .then(() => this.repository.renewLease(
          job,
          this.settings.value.workerId,
          this.settings.value.leaseDurationMs,
        ))
        .then((renewed) => {
          if (!renewed) loseLease();
        })
        .catch(() => loseLease())
        .finally(() => {
          if (heartbeatRenewal === renewal) heartbeatRenewal = undefined;
        });
      heartbeatRenewal = renewal;
    };
    const heartbeat = setInterval(
      renewLease,
      Math.max(1_000, Math.floor(this.settings.value.leaseDurationMs / 3)),
    );
    heartbeat.unref();
    try {
      if (job.type === 'DELETE') {
        await this.deletionProcessor.process(
          job,
          this.settings.value.workerId,
          controller.signal,
        );
      } else {
        await this.ingestionProcessor.process(
          job,
          this.settings.value.workerId,
          controller.signal,
        );
      }
      return !leaseLost;
    } finally {
      heartbeatActive = false;
      clearInterval(heartbeat);
      await heartbeatRenewal;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.drain()
        .catch(() => {
          // The worker intentionally logs only its stable event code. Source
          // documents, chunks, vectors, object locations, and provider bodies
          // never enter an exception log.
          this.logger.error(JSON.stringify({ event: 'rag_worker_run_failed', code: 'RAG_WORKER_UNAVAILABLE' }));
        })
        .finally(() => {
          this.running = undefined;
          this.schedule(this.settings.value.pollIntervalMs);
        });
    }, delayMs);
  }

  private async drain(): Promise<void> {
    while (!this.stopped && (await this.runOnce())) {
      // Drain available work before sleeping. Multiple processes coordinate via
      // the row-level SKIP LOCKED claim, not an in-memory mutex.
    }
  }
}

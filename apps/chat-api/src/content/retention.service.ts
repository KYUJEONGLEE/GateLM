import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ExecutionBridgeService } from '@/execution/execution-bridge.service';

import { ActiveTurnRegistry } from './active-turn-registry';
import { EncryptedChatStore } from './encrypted-chat-store';

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    config: ConfigService,
    private readonly store: EncryptedChatStore,
    private readonly activeTurns: ActiveTurnRegistry,
    private readonly bridge: ExecutionBridgeService,
  ) {
    this.batchSize = config.getOrThrow<number>('TENANT_CHAT_RETENTION_BATCH_SIZE');
    this.intervalMs = config.getOrThrow<number>('TENANT_CHAT_RETENTION_INTERVAL_MS');
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), this.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const result = await this.store.deleteExpiredBatch(this.batchSize);
      const handles = result.cancelledTurnIds.flatMap((turnId) => this.activeTurns.abort(turnId));
      await Promise.allSettled(handles.map((handle) => this.bridge.cancel(handle)));
      return result.deleted;
    } finally {
      this.running = false;
    }
  }
}

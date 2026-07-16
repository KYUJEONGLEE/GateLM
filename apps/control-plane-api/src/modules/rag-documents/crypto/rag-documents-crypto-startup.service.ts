import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ControlPlaneTenantContentKeyService } from './tenant-content-key.service';

@Injectable()
export class RagDocumentsCryptoStartupService
  implements OnApplicationBootstrap
{
  constructor(
    private readonly config: ConfigService,
    private readonly keys: ControlPlaneTenantContentKeyService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('TENANT_CHAT_RAG_ENABLED') !== 'true') {
      return;
    }
    if (this.config.getOrThrow<string>('RAG_OBJECT_STORE_DRIVER') !== 's3') {
      return;
    }
    if (!(await this.keys.isReady())) {
      throw new Error('RAG document crypto is not ready');
    }
  }
}

import { ConfigService } from '@nestjs/config';

import { RagDocumentsCryptoStartupService } from './rag-documents-crypto-startup.service';
import type { ControlPlaneTenantContentKeyService } from './tenant-content-key.service';

describe('RagDocumentsCryptoStartupService', () => {
  it('fails startup when S3 mode cannot read a rollback-safe wrapping key set', async () => {
    const keys = { isReady: jest.fn().mockResolvedValue(false) };
    const service = new RagDocumentsCryptoStartupService(
      new ConfigService({
        TENANT_CHAT_RAG_ENABLED: 'true',
        RAG_OBJECT_STORE_DRIVER: 's3',
      }),
      keys as unknown as ControlPlaneTenantContentKeyService,
    );

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'RAG document crypto is not ready',
    );
  });

  it('permits explicit local/test fake mode without mounting production keys', async () => {
    const keys = { isReady: jest.fn() };
    const service = new RagDocumentsCryptoStartupService(
      new ConfigService({
        TENANT_CHAT_RAG_ENABLED: 'true',
        RAG_OBJECT_STORE_DRIVER: 'fake',
      }),
      keys as unknown as ControlPlaneTenantContentKeyService,
    );

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(keys.isReady).not.toHaveBeenCalled();
  });

  it('skips wrapping-key readiness when RAG is disabled', async () => {
    const keys = { isReady: jest.fn() };
    const service = new RagDocumentsCryptoStartupService(
      new ConfigService({ TENANT_CHAT_RAG_ENABLED: 'false' }),
      keys as unknown as ControlPlaneTenantContentKeyService,
    );

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(keys.isReady).not.toHaveBeenCalled();
  });
});

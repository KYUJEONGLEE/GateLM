import { ConfigService } from '@nestjs/config';

import { createRagObjectStore } from './rag-documents.module';
import {
  DisabledLocalRagObjectStore,
  S3RagObjectStore,
} from './storage';

describe('RagDocumentsModule object-store adapter selection', () => {
  it('uses the disabled test double only for explicit fake mode', () => {
    expect(
      createRagObjectStore(
        new ConfigService({
          TENANT_CHAT_RAG_ENABLED: 'true',
          RAG_OBJECT_STORE_DRIVER: 'fake',
        }),
      ),
    ).toBeInstanceOf(DisabledLocalRagObjectStore);
  });

  it('constructs the actual S3 adapter for S3 mode', () => {
    const store = createRagObjectStore(
      new ConfigService({
        TENANT_CHAT_RAG_ENABLED: 'true',
        RAG_OBJECT_STORE_DRIVER: 's3',
        RAG_S3_BUCKET: 'private-rag-test',
        RAG_S3_ENDPOINT: 'http://localhost:9000',
        RAG_S3_FORCE_PATH_STYLE: 'true',
        RAG_S3_KMS_KEY_ID: 'local-test-kms',
        RAG_S3_REGION: 'ap-northeast-2',
      }),
    );

    expect(store).toBeInstanceOf(S3RagObjectStore);
  });

  it('uses the disabled adapter without reading S3 settings when RAG is off', () => {
    expect(
      createRagObjectStore(
        new ConfigService({ TENANT_CHAT_RAG_ENABLED: 'false' }),
      ),
    ).toBeInstanceOf(DisabledLocalRagObjectStore);
  });
});

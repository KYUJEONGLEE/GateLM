import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'node:crypto';

import { RagQueryCredentialsService } from './rag-query-credentials.service';
import { RagQueryWorkloadSigner } from './rag-query-workload-signer';

describe('RagQueryWorkloadSigner', () => {
  it('receives its credential service through Nest dependency injection', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const credentials = {
      load: jest.fn().mockResolvedValue({
        kid: 'chat-rag-key',
        privateKey,
        bindingKey: Buffer.alloc(32, 1),
      }),
    };
    const module = await Test.createTestingModule({
      providers: [
        RagQueryWorkloadSigner,
        { provide: RagQueryCredentialsService, useValue: credentials },
      ],
    }).compile();

    const result = await module.get(RagQueryWorkloadSigner).authorize(
      '00000000-0000-4000-8000-000000000001',
      { purpose: 'RAG_QUERY', profileVersion: 1, inputs: ['synthetic query'] },
    );

    expect(credentials.load).toHaveBeenCalledTimes(1);
    expect(result.token.split('.')).toHaveLength(3);
    await module.close();
  });
});

import { randomBytes } from 'node:crypto';

import {
  ContentIntegrityError,
  createMessageAad,
  createMessageCitationsAad,
  createRagChunkAadV1,
  createRagDocumentPrivateMetadataAadV1,
  createTitleAad,
  decryptContent,
  encryptContent,
  newTenantKey,
  unwrapTenantKey,
} from './index';

const ids = Object.freeze({
  tenantId: '10000000-0000-4000-8000-000000000001',
  knowledgeBaseId: '20000000-0000-4000-8000-000000000001',
  documentId: '30000000-0000-4000-8000-000000000001',
  documentIndexId: '40000000-0000-4000-8000-000000000001',
  chunkId: '50000000-0000-4000-8000-000000000001',
});

describe('tenant content crypto compatibility', () => {
  it('decrypts the fixed legacy Tenant Chat message fixture', () => {
    const key = Buffer.from(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
      'hex',
    );
    try {
      const aad = createMessageAad(
        ids.tenantId,
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'user',
        7,
      );
      expect(
        decryptContent(
          key,
          {
            ciphertext: Buffer.from(
              '8a7d1b4c26b22fcc1b0bf3bb620ea9bd5dc13c63e1d62509',
              'hex',
            ),
            nonce: Buffer.from('a0a1a2a3a4a5a6a7a8a9aaab', 'hex'),
            tag: Buffer.from('624b6d508b5361e09357609394cef62b', 'hex'),
          },
          aad,
        ),
      ).toBe('legacy-synthetic-message');
    } finally {
      key.fill(0);
    }
  });

  it('decrypts the fixed legacy Tenant Chat title fixture', () => {
    const key = Buffer.from(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
      'hex',
    );
    try {
      expect(
        decryptContent(
          key,
          {
            ciphertext: Buffer.from('f5303dca8fb4962c3e96e3caa829e1a1a94820a6794b', 'hex'),
            nonce: Buffer.from('b0b1b2b3b4b5b6b7b8b9babb', 'hex'),
            tag: Buffer.from('57f3f82bf38639d91f039c8cbfdb28d7', 'hex'),
          },
          createTitleAad(
            ids.tenantId,
            '20000000-0000-4000-8000-000000000001',
            7,
          ),
        ),
      ).toBe('legacy-synthetic-title');
    } finally {
      key.fill(0);
    }
  });

  it('unwraps the fixed legacy tenant DEK fixture', () => {
    const wrappingKey = Buffer.from(
      '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f',
      'hex',
    );
    let unwrapped: Buffer | undefined;
    try {
      unwrapped = unwrapTenantKey(
        {
          wrappedKey: Buffer.from(
            '7f6512ed5ebf1bcc5c900e1d878e8ce2afc46c62ea1b183fc48a095714474479',
            'hex',
          ),
          wrapNonce: Buffer.from('c0c1c2c3c4c5c6c7c8c9cacb', 'hex'),
          wrapTag: Buffer.from('9699ae6096e03b1d963f95143da07dcb', 'hex'),
          wrappingKeyVersion: 3,
        },
        wrappingKey,
        ids.tenantId,
        7,
      );
      expect(unwrapped.toString('hex')).toBe(
        '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f',
      );
    } finally {
      unwrapped?.fill(0);
      wrappingKey.fill(0);
    }
  });

  it('round-trips a RAG chunk and preserves its content key version', () => {
    const key = newTenantKey();
    try {
      const aad = createRagChunkAadV1({ ...ids, contentKeyVersion: 11 });
      const encrypted = encryptContent(key, 'synthetic-rag-chunk', aad);
      expect(encrypted.contentKeyVersion).toBe(11);
      expect(encrypted.nonce).toHaveLength(12);
      expect(encrypted.tag).toHaveLength(16);
      expect(decryptContent(key, encrypted, aad)).toBe('synthetic-rag-chunk');
    } finally {
      key.fill(0);
    }
  });

  it('encrypts a citation snapshot under a distinct assistant-record AAD', () => {
    const key = newTenantKey();
    const citationAad = createMessageCitationsAad(
      ids.tenantId,
      ids.knowledgeBaseId,
      ids.documentId,
      7,
    );
    const messageAad = createMessageAad(
      ids.tenantId,
      ids.knowledgeBaseId,
      ids.documentId,
      'assistant',
      7,
    );
    try {
      const encrypted = encryptContent(key, '[{\"sourceId\":\"S1\"}]', citationAad);
      expect(decryptContent(key, encrypted, citationAad)).toBe('[{\"sourceId\":\"S1\"}]');
      expect(() => decryptContent(key, encrypted, messageAad)).toThrow(ContentIntegrityError);
    } finally {
      key.fill(0);
    }
  });

  it('fails closed with another tenant key', () => {
    const tenantAKey = newTenantKey();
    const tenantBKey = newTenantKey();
    try {
      const aad = createRagChunkAadV1({ ...ids, contentKeyVersion: 3 });
      const encrypted = encryptContent(tenantAKey, 'synthetic-rag-chunk', aad);
      expect(() => decryptContent(tenantBKey, encrypted, aad)).toThrow(
        ContentIntegrityError,
      );
    } finally {
      tenantAKey.fill(0);
      tenantBKey.fill(0);
    }
  });

  it.each([
    ['tenant', { tenantId: '10000000-0000-4000-8000-000000000002' }],
    ['knowledge base', { knowledgeBaseId: '20000000-0000-4000-8000-000000000002' }],
    ['document', { documentId: '30000000-0000-4000-8000-000000000002' }],
    ['document index', { documentIndexId: '40000000-0000-4000-8000-000000000002' }],
    ['chunk', { chunkId: '50000000-0000-4000-8000-000000000002' }],
    ['key version', { contentKeyVersion: 4 }],
  ])('fails closed when RAG %s AAD changes', (_, changed) => {
    const key = newTenantKey();
    try {
      const aad = createRagChunkAadV1({ ...ids, contentKeyVersion: 3 });
      const encrypted = encryptContent(key, 'synthetic-rag-chunk', aad);
      const wrongAad = createRagChunkAadV1({
        ...ids,
        contentKeyVersion: 3,
        ...changed,
      });
      expect(() => decryptContent(key, encrypted, wrongAad)).toThrow(
        ContentIntegrityError,
      );
    } finally {
      key.fill(0);
    }
  });

  it.each([
    ['schema version', { schemaVersion: 2 }],
    ['content kind', { contentKind: 'message' }],
    ['non-UUID tenant', { tenantId: 'tenant-a' }],
    ['extra field', { unexpected: 'value' }],
  ])('rejects malformed RAG chunk %s AAD at the crypto boundary', (_, changed) => {
    const key = newTenantKey();
    try {
      const aad = createRagChunkAadV1({ ...ids, contentKeyVersion: 3 });
      const encrypted = encryptContent(key, 'synthetic-rag-chunk', aad);
      expect(() =>
        decryptContent(
          key,
          encrypted,
          { ...aad, ...changed } as unknown as typeof aad,
        ),
      ).toThrow(ContentIntegrityError);
    } finally {
      key.fill(0);
    }
  });

  it('round-trips private document metadata', () => {
    const key = newTenantKey();
    try {
      const aad = createRagDocumentPrivateMetadataAadV1({
        tenantId: ids.tenantId,
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: ids.documentId,
        contentKeyVersion: 9,
      });
      const encrypted = encryptContent(key, '{"displayName":"synthetic.txt"}', aad);
      expect(decryptContent(key, encrypted, aad)).toBe('{"displayName":"synthetic.txt"}');
    } finally {
      key.fill(0);
    }
  });

  it.each([
    ['tenant', { tenantId: '10000000-0000-4000-8000-000000000002' }],
    ['knowledge base', { knowledgeBaseId: '20000000-0000-4000-8000-000000000002' }],
    ['document', { documentId: '30000000-0000-4000-8000-000000000002' }],
    ['key version', { contentKeyVersion: 10 }],
    ['content kind', { contentKind: 'rag_chunk' }],
  ])('rejects private metadata %s AAD substitution', (_, changed) => {
    const key = newTenantKey();
    try {
      const aad = createRagDocumentPrivateMetadataAadV1({
        tenantId: ids.tenantId,
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: ids.documentId,
        contentKeyVersion: 9,
      });
      const encrypted = encryptContent(key, '{"displayName":"synthetic.txt"}', aad);
      expect(() =>
        decryptContent(
          key,
          encrypted,
          { ...aad, ...changed } as unknown as typeof aad,
        ),
      ).toThrow(ContentIntegrityError);
    } finally {
      key.fill(0);
    }
  });

  it('zeroes plaintext bytes when encryption validation fails', () => {
    const key = newTenantKey();
    const fillSpy = jest.spyOn(Buffer.prototype, 'fill');
    try {
      const aad = createRagChunkAadV1({ ...ids, contentKeyVersion: 1 });
      expect(() => encryptContent(key, '', aad)).toThrow(ContentIntegrityError);
      expect(fillSpy).toHaveBeenCalledWith(0);
    } finally {
      fillSpy.mockRestore();
      key.fill(0);
    }
  });

  it('never reuses a fixed nonce for chunk encryption', () => {
    const key = randomBytes(32);
    try {
      const aad = createRagChunkAadV1({ ...ids, contentKeyVersion: 1 });
      const first = encryptContent(key, 'synthetic-rag-chunk', aad);
      const second = encryptContent(key, 'synthetic-rag-chunk', aad);
      expect(first.nonce.equals(second.nonce)).toBe(false);
    } finally {
      key.fill(0);
    }
  });
});

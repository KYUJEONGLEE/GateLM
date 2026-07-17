import {
  canonicalizeJson,
  ContentIntegrityError,
  createRagDocumentPrivateMetadataAadV1,
  encryptContent,
  type TenantKeyResolver,
} from '@gatelm/tenant-content-crypto';

import { ControlPlaneTenantContentKeyService } from './tenant-content-key.service';
import {
  equalSha256Digest,
  RagDocumentPrivateMetadataCodec,
  type StoredRagDocumentPrivateMetadata,
} from './rag-document-private-metadata.codec';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const KNOWLEDGE_BASE_ID = '33333333-3333-4333-8333-333333333333';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

describe('RagDocumentPrivateMetadataCodec', () => {
  it('encrypts and decrypts exact v1 metadata while preserving key version', async () => {
    const resolver = new MemoryKeyResolver(
      new Map([[TENANT_A, { key: Buffer.alloc(32, 7), version: 9 }]]),
    );
    const codec = new RagDocumentPrivateMetadataCodec(asService(resolver));
    const encrypted = await codec.encrypt(identity(TENANT_A), {
      displayName: '  운영 규정.pdf  ',
      originalFilename: '  운영 규정.pdf  ',
      sha256Digest: DIGEST_A,
    });

    expect(encrypted.contentKeyVersion).toBe(9);
    expect(encrypted.schemaVersion).toBe(1);
    expect(encrypted.ciphertext.toString('utf8')).not.toContain('운영 규정.pdf');

    await expect(
      codec.decrypt({
        ...identity(TENANT_A),
        ...encrypted,
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      displayName: '운영 규정.pdf',
      originalFilename: '운영 규정.pdf',
      sha256Digest: DIGEST_A,
    });
  });

  it('fails authentication when tenant or record-bound AAD changes', async () => {
    const resolver = new MemoryKeyResolver(
      new Map([
        [TENANT_A, { key: Buffer.alloc(32, 7), version: 1 }],
        [TENANT_B, { key: Buffer.alloc(32, 8), version: 1 }],
      ]),
    );
    const codec = new RagDocumentPrivateMetadataCodec(asService(resolver));
    const encrypted = await codec.encrypt(identity(TENANT_A), metadata());

    await expect(
      codec.decrypt({ ...identity(TENANT_B), ...encrypted }),
    ).rejects.toBeInstanceOf(ContentIntegrityError);
    await expect(
      codec.decrypt({
        ...identity(TENANT_A),
        documentId: '55555555-5555-4555-8555-555555555555',
        ...encrypted,
      }),
    ).rejects.toBeInstanceOf(ContentIntegrityError);
  });

  it('rejects an authenticated payload with additional metadata fields', async () => {
    const key = Buffer.alloc(32, 7);
    const resolver = new MemoryKeyResolver(
      new Map([[TENANT_A, { key, version: 1 }]]),
    );
    const codec = new RagDocumentPrivateMetadataCodec(asService(resolver));
    const aad = createRagDocumentPrivateMetadataAadV1({
      ...identity(TENANT_A),
      contentKeyVersion: 1,
    });
    const encrypted = encryptContent(
      key,
      JSON.stringify({
        schemaVersion: 1,
        displayName: 'policy.pdf',
        originalFilename: 'policy.pdf',
        sha256Digest: DIGEST_A,
        unexpected: true,
      }),
      aad,
    );

    await expect(
      codec.decrypt({
        ...identity(TENANT_A),
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        authTag: encrypted.tag,
        contentKeyVersion: 1,
        schemaVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ContentIntegrityError);
  });

  it('rejects authenticated metadata that is not in canonical JSON form', async () => {
    const key = Buffer.alloc(32, 7);
    const resolver = new MemoryKeyResolver(
      new Map([[TENANT_A, { key, version: 1 }]]),
    );
    const codec = new RagDocumentPrivateMetadataCodec(asService(resolver));
    const aad = createRagDocumentPrivateMetadataAadV1({
      ...identity(TENANT_A),
      contentKeyVersion: 1,
    });
    const encrypted = encryptContent(
      key,
      JSON.stringify({
        schemaVersion: 1,
        displayName: 'policy.pdf',
        originalFilename: 'policy.pdf',
        sha256Digest: DIGEST_A,
      }),
      aad,
    );

    await expect(
      codec.decrypt({
        ...identity(TENANT_A),
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        authTag: encrypted.tag,
        contentKeyVersion: 1,
        schemaVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ContentIntegrityError);
  });

  it.each([
    { originalFilename: '../policy.pdf', sha256Digest: DIGEST_A },
    { originalFilename: 'nested/policy.pdf', sha256Digest: DIGEST_A },
    { originalFilename: 'policy.pdf', sha256Digest: DIGEST_A.toUpperCase() },
    { originalFilename: 'policy.pdf', sha256Digest: 'not-a-digest' },
  ])('rejects unsafe or non-canonical metadata', async (candidate) => {
    const codec = new RagDocumentPrivateMetadataCodec(
      asService(
        new MemoryKeyResolver(
          new Map([[TENANT_A, { key: Buffer.alloc(32, 7), version: 1 }]]),
        ),
      ),
    );

    await expect(
      codec.encrypt(identity(TENANT_A), {
        displayName: 'policy.pdf',
        ...candidate,
      }),
    ).rejects.toBeInstanceOf(ContentIntegrityError);
  });

  it('compares canonical SHA-256 digests without early-exit string comparison', () => {
    expect(equalSha256Digest(DIGEST_A, DIGEST_A)).toBe(true);
    expect(equalSha256Digest(DIGEST_A, DIGEST_B)).toBe(false);
    expect(() => equalSha256Digest(DIGEST_A, 'A'.repeat(64))).toThrow(
      ContentIntegrityError,
    );
  });

  it('decrypts a batch once per key version and preserves input order', async () => {
    const keys = new Map([
      [1, Buffer.alloc(32, 1)],
      [2, Buffer.alloc(32, 2)],
    ]);
    const resolver: TenantKeyResolver = {
      withActiveKey: jest.fn(),
      withKeyVersion: jest.fn(async (_tenantId, version, operation) => {
        const source = keys.get(version);
        if (!source) throw new Error('key unavailable');
        const key = Buffer.from(source);
        try {
          return await operation(key);
        } finally {
          key.fill(0);
        }
      }),
    };
    const codec = new RagDocumentPrivateMetadataCodec(asService(resolver));
    const rows = [
      encryptedRow(keys.get(1)!, 1, '55555555-5555-4555-8555-555555555551', 'first.txt'),
      encryptedRow(keys.get(2)!, 2, '55555555-5555-4555-8555-555555555552', 'second.txt'),
      encryptedRow(keys.get(1)!, 1, '55555555-5555-4555-8555-555555555553', 'third.txt'),
    ];

    const result = await codec.decryptMany(rows);

    expect(result.map((item) => item.displayName)).toEqual([
      'first.txt',
      'second.txt',
      'third.txt',
    ]);
    expect(resolver.withKeyVersion).toHaveBeenCalledTimes(2);
  });

  it('fails the whole batch when one row fails integrity validation', async () => {
    const key = Buffer.alloc(32, 1);
    const resolver = new MemoryKeyResolver(
      new Map([[TENANT_A, { key, version: 1 }]]),
    );
    const codec = new RagDocumentPrivateMetadataCodec(asService(resolver));
    const valid = encryptedRow(
      key,
      1,
      '55555555-5555-4555-8555-555555555551',
      'valid.txt',
    );
    const corrupt = encryptedRow(
      key,
      1,
      '55555555-5555-4555-8555-555555555552',
      'corrupt.txt',
    );
    corrupt.authTag[0] = (corrupt.authTag[0] ?? 0) ^ 0xff;

    await expect(codec.decryptMany([valid, corrupt])).rejects.toBeInstanceOf(
      ContentIntegrityError,
    );
  });

  it('rejects a mixed-tenant decrypt batch before resolving any key', async () => {
    const key = Buffer.alloc(32, 1);
    const resolver: TenantKeyResolver = {
      withActiveKey: jest.fn(),
      withKeyVersion: jest.fn(),
    };
    const codec = new RagDocumentPrivateMetadataCodec(asService(resolver));
    const first = encryptedRow(
      key,
      1,
      '55555555-5555-4555-8555-555555555551',
      'first.txt',
    );

    await expect(
      codec.decryptMany([{ ...first, tenantId: TENANT_B }, first]),
    ).rejects.toBeInstanceOf(ContentIntegrityError);
    expect(resolver.withKeyVersion).not.toHaveBeenCalled();
  });
});

function identity(tenantId: string) {
  return {
    tenantId,
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    documentId: DOCUMENT_ID,
  };
}

function metadata() {
  return {
    displayName: 'policy.pdf',
    originalFilename: 'policy.pdf',
    sha256Digest: DIGEST_A,
  };
}

function encryptedRow(
  key: Buffer,
  contentKeyVersion: number,
  documentId: string,
  displayName: string,
): StoredRagDocumentPrivateMetadata & { authTag: Buffer } {
  const rowIdentity = {
    tenantId: TENANT_A,
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    documentId,
  };
  const aad = createRagDocumentPrivateMetadataAadV1({
    ...rowIdentity,
    contentKeyVersion,
  });
  const encrypted = encryptContent(
    key,
    canonicalizeJson({
      schemaVersion: 1,
      displayName,
      originalFilename: displayName,
      sha256Digest: DIGEST_A,
    }),
    aad,
  );
  return {
    ...rowIdentity,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: Buffer.from(encrypted.tag),
    contentKeyVersion,
    schemaVersion: 1,
  };
}

function asService(resolver: TenantKeyResolver): ControlPlaneTenantContentKeyService {
  const withKeyVersions = async <T>(
    tenantId: string,
    versions: readonly number[],
    operation: (keys: ReadonlyMap<number, Buffer>) => Promise<T> | T,
  ): Promise<T> => {
    const resolved = new Map<number, Buffer>();
    const visit = async (index: number): Promise<T> => {
      const version = versions[index];
      if (version === undefined) return operation(resolved);
      return resolver.withKeyVersion(tenantId, version, async (key) => {
        resolved.set(version, key);
        return visit(index + 1);
      });
    };
    return visit(0);
  };
  return Object.assign(resolver, {
    withKeyVersions,
    withKeyVersionsFrom: async <T>(
      _client: unknown,
      tenantId: string,
      versions: readonly number[],
      operation: (keys: ReadonlyMap<number, Buffer>) => Promise<T> | T,
    ): Promise<T> => withKeyVersions(tenantId, versions, operation),
  }) as ControlPlaneTenantContentKeyService;
}

class MemoryKeyResolver implements TenantKeyResolver {
  constructor(
    private readonly values: ReadonlyMap<
      string,
      Readonly<{ key: Buffer; version: number }>
    >,
  ) {}

  async withActiveKey<T>(
    tenantId: string,
    operation: (key: Buffer, contentKeyVersion: number) => Promise<T> | T,
  ): Promise<T> {
    const value = this.values.get(tenantId);
    if (!value) throw new Error('key unavailable');
    const key = Buffer.from(value.key);
    try {
      return await operation(key, value.version);
    } finally {
      key.fill(0);
    }
  }

  async withKeyVersion<T>(
    tenantId: string,
    contentKeyVersion: number,
    operation: (key: Buffer) => Promise<T> | T,
  ): Promise<T> {
    const value = this.values.get(tenantId);
    if (!value || value.version !== contentKeyVersion) {
      throw new Error('key unavailable');
    }
    const key = Buffer.from(value.key);
    try {
      return await operation(key);
    } finally {
      key.fill(0);
    }
  }
}

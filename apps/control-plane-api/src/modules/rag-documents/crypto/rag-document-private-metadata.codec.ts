import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

import { ContentIntegrityError } from './content.errors';
import {
  canonicalizeJson,
  createRagDocumentPrivateMetadataAadV1,
  decryptContent,
  encryptContent,
  type EncryptedPayload,
} from './tenant-crypto';
import {
  ControlPlaneTenantContentKeyService,
  type TenantContentKeyReadClient,
} from './tenant-content-key.service';

const METADATA_SCHEMA_VERSION = 1;
const MAX_DECRYPT_BATCH_SIZE = 500;
const MAX_NAME_CHARACTERS = 255;
const MAX_NAME_BYTES = 1024;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const PATH_SEPARATOR = /[\\/]/u;

export type RagDocumentPrivateMetadataV1 = Readonly<{
  schemaVersion: 1;
  displayName: string;
  originalFilename: string;
  sha256Digest: string;
}>;

export type RagDocumentMetadataIdentity = Readonly<{
  tenantId: string;
  knowledgeBaseId: string;
  documentId: string;
}>;

export type EncryptedRagDocumentPrivateMetadata = Readonly<{
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  contentKeyVersion: number;
  schemaVersion: 1;
}>;

export type StoredRagDocumentPrivateMetadata = RagDocumentMetadataIdentity &
  Readonly<{
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    authTag: Uint8Array;
    contentKeyVersion: number;
    schemaVersion: number;
  }>;

@Injectable()
export class RagDocumentPrivateMetadataCodec {
  constructor(private readonly keys: ControlPlaneTenantContentKeyService) {}

  async encrypt(
    identity: RagDocumentMetadataIdentity,
    input: Readonly<{
      displayName: string;
      originalFilename: string;
      sha256Digest: string;
    }>,
  ): Promise<EncryptedRagDocumentPrivateMetadata> {
    const metadata = createMetadata(input);
    return this.keys.withActiveKey(
      identity.tenantId,
      (key, contentKeyVersion) => {
        const aad = createRagDocumentPrivateMetadataAadV1({
          ...identity,
          contentKeyVersion,
        });
        const encrypted = encryptContent(key, canonicalizeJson(metadata), aad);
        return toStoredPayload(encrypted);
      },
    );
  }

  async decrypt(
    stored: StoredRagDocumentPrivateMetadata,
  ): Promise<RagDocumentPrivateMetadataV1> {
    assertStoredSchema(stored);
    return this.keys.withKeyVersion(
      stored.tenantId,
      stored.contentKeyVersion,
      (key) => decryptStoredMetadata(key, stored),
    );
  }

  async decryptMany(
    stored: readonly StoredRagDocumentPrivateMetadata[],
    keyClient?: TenantContentKeyReadClient,
  ): Promise<readonly RagDocumentPrivateMetadataV1[]> {
    if (stored.length === 0) return Object.freeze([]);
    if (stored.length > MAX_DECRYPT_BATCH_SIZE) {
      throw new ContentIntegrityError();
    }
    stored.forEach(assertStoredSchema);

    const tenantId = stored[0]?.tenantId;
    if (!tenantId || stored.some((row) => row.tenantId !== tenantId)) {
      throw new ContentIntegrityError();
    }

    const byVersion = new Map<
      number,
      Array<Readonly<{ index: number; row: StoredRagDocumentPrivateMetadata }>>
    >();
    stored.forEach((row, index) => {
      const group = byVersion.get(row.contentKeyVersion) ?? [];
      group.push(Object.freeze({ index, row }));
      byVersion.set(row.contentKeyVersion, group);
    });

    const decrypted = new Array<RagDocumentPrivateMetadataV1 | undefined>(
      stored.length,
    );
    const decryptAll = (keys: ReadonlyMap<number, Buffer>): void => {
      for (const [contentKeyVersion, group] of byVersion) {
        const key = keys.get(contentKeyVersion);
        if (!key) throw new ContentIntegrityError();
        for (const item of group) {
          decrypted[item.index] = decryptStoredMetadata(key, item.row);
        }
      }
    };
    const versions = [...byVersion.keys()];
    if (keyClient) {
      await this.keys.withKeyVersionsFrom(
        keyClient,
        tenantId,
        versions,
        decryptAll,
      );
    } else {
      await this.keys.withKeyVersions(tenantId, versions, decryptAll);
    }

    if (decrypted.some((metadata) => metadata === undefined)) {
      throw new ContentIntegrityError();
    }
    return Object.freeze(decrypted as RagDocumentPrivateMetadataV1[]);
  }
}

export function equalSha256Digest(left: string, right: string): boolean {
  if (!SHA256_HEX.test(left) || !SHA256_HEX.test(right)) {
    throw new ContentIntegrityError();
  }

  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  try {
    return timingSafeEqual(leftBytes, rightBytes);
  } finally {
    leftBytes.fill(0);
    rightBytes.fill(0);
  }
}

function createMetadata(input: Readonly<{
  displayName: string;
  originalFilename: string;
  sha256Digest: string;
}>): RagDocumentPrivateMetadataV1 {
  const displayName = normalizeName(input.displayName);
  const originalFilename = normalizeName(input.originalFilename);
  assertSafeFilename(originalFilename);
  assertDigest(input.sha256Digest);

  return Object.freeze({
    schemaVersion: METADATA_SCHEMA_VERSION,
    displayName,
    originalFilename,
    sha256Digest: input.sha256Digest,
  });
}

function parseMetadata(plaintext: string): RagDocumentPrivateMetadataV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new ContentIntegrityError();
  }

  if (
    !exactObject(parsed, [
      'displayName',
      'originalFilename',
      'schemaVersion',
      'sha256Digest',
    ]) ||
    parsed.schemaVersion !== METADATA_SCHEMA_VERSION ||
    typeof parsed.displayName !== 'string' ||
    typeof parsed.originalFilename !== 'string' ||
    typeof parsed.sha256Digest !== 'string'
  ) {
    throw new ContentIntegrityError();
  }

  const metadata = createMetadata({
    displayName: parsed.displayName,
    originalFilename: parsed.originalFilename,
    sha256Digest: parsed.sha256Digest,
  });
  if (
    metadata.displayName !== parsed.displayName ||
    metadata.originalFilename !== parsed.originalFilename ||
    canonicalizeJson(metadata) !== plaintext
  ) {
    throw new ContentIntegrityError();
  }

  return metadata;
}

function normalizeName(value: string): string {
  if (typeof value !== 'string') throw new ContentIntegrityError();
  const normalized = value.normalize('NFC').trim();
  if (
    normalized.length < 1 ||
    normalized.length > MAX_NAME_CHARACTERS ||
    Buffer.byteLength(normalized, 'utf8') > MAX_NAME_BYTES ||
    CONTROL_CHARACTER.test(normalized)
  ) {
    throw new ContentIntegrityError();
  }
  return normalized;
}

function assertSafeFilename(value: string): void {
  if (value === '.' || value === '..' || PATH_SEPARATOR.test(value)) {
    throw new ContentIntegrityError();
  }
}

function assertDigest(value: string): void {
  if (!SHA256_HEX.test(value)) throw new ContentIntegrityError();
}

function exactObject(value: unknown, expected: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function toStoredPayload(
  encrypted: EncryptedPayload,
): EncryptedRagDocumentPrivateMetadata {
  return Object.freeze({
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.tag,
    contentKeyVersion: encrypted.contentKeyVersion,
    schemaVersion: encrypted.schemaVersion,
  });
}

function decryptStoredMetadata(
  key: Buffer,
  stored: StoredRagDocumentPrivateMetadata,
): RagDocumentPrivateMetadataV1 {
  if (stored.schemaVersion !== METADATA_SCHEMA_VERSION) {
    throw new ContentIntegrityError();
  }

  const aad = createRagDocumentPrivateMetadataAadV1({
    tenantId: stored.tenantId,
    knowledgeBaseId: stored.knowledgeBaseId,
    documentId: stored.documentId,
    contentKeyVersion: stored.contentKeyVersion,
  });
  const plaintext = decryptContent(
    key,
    {
      ciphertext: Buffer.from(stored.ciphertext),
      nonce: Buffer.from(stored.nonce),
      tag: Buffer.from(stored.authTag),
    },
    aad,
  );
  return parseMetadata(plaintext);
}

function assertStoredSchema(stored: StoredRagDocumentPrivateMetadata): void {
  if (stored.schemaVersion !== METADATA_SCHEMA_VERSION) {
    throw new ContentIntegrityError();
  }
}

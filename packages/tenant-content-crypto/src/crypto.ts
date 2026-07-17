import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { assertCanonicalUuid, assertPositiveVersion } from './aad';
import { canonicalizeJson, type JsonValue } from './canonical-json';
import { ContentIntegrityError, ContentKeyUnavailable } from './errors';
import type {
  ContentAad,
  EncryptedPayload,
  RagChunkAadV1,
  RagDocumentPrivateMetadataAadV1,
  TenantContentAad,
  WrappedTenantKey,
} from './types';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_CONTENT_BYTES = 1024 * 1024;

export function encryptContent(
  key: Buffer,
  plaintext: string,
  aad: TenantContentAad,
): EncryptedPayload {
  assertKey(key);
  const input = Buffer.from(plaintext, 'utf8');
  try {
    if (input.length < 1 || input.length > MAX_CONTENT_BYTES) {
      throw new ContentIntegrityError();
    }
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(contentAadBytes(aad));
    const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
    return Object.freeze({
      ciphertext,
      nonce,
      tag: cipher.getAuthTag(),
      contentKeyVersion: aad.contentKeyVersion,
      schemaVersion: 1,
    });
  } finally {
    input.fill(0);
  }
}

export function decryptContent(
  key: Buffer,
  encrypted: Pick<EncryptedPayload, 'ciphertext' | 'nonce' | 'tag'>,
  aad: TenantContentAad,
): string {
  try {
    assertKey(key);
    if (
      encrypted.ciphertext.length < 1 ||
      encrypted.ciphertext.length > MAX_CONTENT_BYTES ||
      encrypted.nonce.length !== NONCE_BYTES ||
      encrypted.tag.length !== TAG_BYTES
    ) {
      throw new ContentIntegrityError();
    }
    const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(contentAadBytes(aad));
    decipher.setAuthTag(encrypted.tag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final(),
    ]);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    } finally {
      plaintext.fill(0);
    }
  } catch (error) {
    if (error instanceof ContentKeyUnavailable) {
      throw error;
    }
    throw new ContentIntegrityError();
  }
}

export function wrapTenantKey(
  tenantKey: Buffer,
  wrappingKey: Buffer,
  tenantId: string,
  contentKeyVersion: number,
  wrappingKeyVersion: number,
): WrappedTenantKey {
  assertKey(tenantKey);
  assertKey(wrappingKey);
  const wrapNonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, wrappingKey, wrapNonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(wrappingAadBytes(tenantId, contentKeyVersion, wrappingKeyVersion));
  const wrappedKey = Buffer.concat([cipher.update(tenantKey), cipher.final()]);
  return Object.freeze({
    wrappedKey,
    wrapNonce,
    wrapTag: cipher.getAuthTag(),
    wrappingKeyVersion,
  });
}

export function unwrapTenantKey(
  encrypted: Pick<
    WrappedTenantKey,
    'wrappedKey' | 'wrapNonce' | 'wrapTag' | 'wrappingKeyVersion'
  >,
  wrappingKey: Buffer,
  tenantId: string,
  contentKeyVersion: number,
): Buffer {
  let updated: Buffer | undefined;
  let finalized: Buffer | undefined;
  let key: Buffer | undefined;
  try {
    assertKey(wrappingKey);
    if (
      encrypted.wrappedKey.length !== KEY_BYTES ||
      encrypted.wrapNonce.length !== NONCE_BYTES ||
      encrypted.wrapTag.length !== TAG_BYTES
    ) {
      throw new ContentIntegrityError();
    }
    const decipher = createDecipheriv(ALGORITHM, wrappingKey, encrypted.wrapNonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(
      wrappingAadBytes(tenantId, contentKeyVersion, encrypted.wrappingKeyVersion),
    );
    decipher.setAuthTag(encrypted.wrapTag);
    updated = decipher.update(encrypted.wrappedKey);
    finalized = decipher.final();
    key = Buffer.concat([updated, finalized]);
    assertKey(key);
    return key;
  } catch {
    key?.fill(0);
    throw new ContentIntegrityError();
  } finally {
    updated?.fill(0);
    finalized?.fill(0);
  }
}

export function newTenantKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

function contentAadBytes(aad: TenantContentAad): Buffer {
  if (!aad || typeof aad !== 'object') {
    throw new ContentIntegrityError();
  }
  if (aad.contentKind === 'title' || aad.contentKind === 'message' || aad.contentKind === 'message_citations') {
    validateChatAad(aad);
  } else if (aad.contentKind === 'rag_chunk') {
    validateRagChunkAad(aad);
  } else if (aad.contentKind === 'rag_document_private_metadata') {
    validateRagPrivateMetadataAad(aad);
  } else {
    throw new ContentIntegrityError();
  }
  return Buffer.from(canonicalizeJson(aad as unknown as JsonValue), 'utf8');
}

function validateChatAad(aad: ContentAad): void {
  if (
    aad.schemaVersion !== 1 ||
    !positiveVersion(aad.contentKeyVersion) ||
    !['title', 'message', 'message_citations'].includes(aad.contentKind) ||
    !['none', 'user', 'assistant'].includes(aad.role) ||
    (aad.contentKind === 'title' && aad.role !== 'none') ||
    (aad.contentKind === 'message' && aad.role === 'none') ||
    (aad.contentKind === 'message_citations' && aad.role !== 'assistant')
  ) {
    throw new ContentIntegrityError();
  }
}

function validateRagChunkAad(aad: RagChunkAadV1): void {
  if (
    aad.schemaVersion !== 1 ||
    !positiveVersion(aad.contentKeyVersion) ||
    !exactKeys(aad, [
      'schemaVersion',
      'tenantId',
      'knowledgeBaseId',
      'documentId',
      'documentIndexId',
      'chunkId',
      'contentKind',
      'contentKeyVersion',
    ])
  ) {
    throw new ContentIntegrityError();
  }
  assertCanonicalUuid(aad.tenantId);
  assertCanonicalUuid(aad.knowledgeBaseId);
  assertCanonicalUuid(aad.documentId);
  assertCanonicalUuid(aad.documentIndexId);
  assertCanonicalUuid(aad.chunkId);
}

function validateRagPrivateMetadataAad(aad: RagDocumentPrivateMetadataAadV1): void {
  if (
    aad.schemaVersion !== 1 ||
    !positiveVersion(aad.contentKeyVersion) ||
    !exactKeys(aad, [
      'schemaVersion',
      'tenantId',
      'knowledgeBaseId',
      'documentId',
      'contentKind',
      'contentKeyVersion',
    ])
  ) {
    throw new ContentIntegrityError();
  }
  assertCanonicalUuid(aad.tenantId);
  assertCanonicalUuid(aad.knowledgeBaseId);
  assertCanonicalUuid(aad.documentId);
}

function wrappingAadBytes(
  tenantId: string,
  contentKeyVersion: number,
  wrappingKeyVersion: number,
): Buffer {
  assertPositiveVersion(contentKeyVersion);
  assertPositiveVersion(wrappingKeyVersion);
  return Buffer.from(
    canonicalizeJson({
      contentKeyVersion,
      contentKind: 'tenant_dek',
      schemaVersion: 1,
      tenantId,
      wrappingKeyVersion,
    }),
    'utf8',
  );
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new ContentKeyUnavailable();
  }
}

function positiveVersion(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 2_147_483_647;
}

function exactKeys(value: object, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

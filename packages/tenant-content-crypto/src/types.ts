export type ContentRole = 'none' | 'user' | 'assistant';
export type ContentKind = 'title' | 'message' | 'message_citations';

export type BoundMessageSafetyStatus = 'sanitized' | 'provider_generated';

export type ContentAadV1 = Readonly<{
  schemaVersion: 1;
  tenantId: string;
  conversationId: string;
  recordId: string;
  contentKind: ContentKind;
  role: ContentRole;
  contentKeyVersion: number;
}>;

export type ContentAadV2 = Readonly<{
  schemaVersion: 2;
  tenantId: string;
  conversationId: string;
  recordId: string;
  contentKind: 'message';
  role: 'user' | 'assistant';
  contentKeyVersion: number;
  safetyStatus: BoundMessageSafetyStatus;
  safetyPolicyDigest: string | null;
}>;

export type ContentAad = ContentAadV1 | ContentAadV2;

export type RagChunkAadV1 = Readonly<{
  schemaVersion: 1;
  tenantId: string;
  knowledgeBaseId: string;
  documentId: string;
  documentIndexId: string;
  chunkId: string;
  contentKind: 'rag_chunk';
  contentKeyVersion: number;
}>;

export type RagDocumentPrivateMetadataAadV1 = Readonly<{
  schemaVersion: 1;
  tenantId: string;
  knowledgeBaseId: string;
  documentId: string;
  contentKind: 'rag_document_private_metadata';
  contentKeyVersion: number;
}>;

export type TenantContentAad =
  | ContentAad
  | RagChunkAadV1
  | RagDocumentPrivateMetadataAadV1;

export type EncryptedPayload = Readonly<{
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
  contentKeyVersion: number;
  schemaVersion: 1 | 2;
}>;

export type EncryptedContent = EncryptedPayload;

export type WrappedTenantKey = Readonly<{
  wrappedKey: Buffer;
  wrapNonce: Buffer;
  wrapTag: Buffer;
  wrappingKeyVersion: number;
}>;

export type WrappingKey = Readonly<{
  version: number;
  wrappingKey: Buffer;
  integrityKey: Buffer;
}>;

export type WrappingKeySet = Readonly<{
  activeVersion: number;
  keys: ReadonlyMap<number, WrappingKey>;
}>;

// Least-privilege projection for services that wrap tenant DEKs but never
// calculate Tenant Chat binding MACs.
export type DataWrappingKey = Readonly<{
  version: number;
  wrappingKey: Buffer;
}>;

export type DataWrappingKeySet = Readonly<{
  activeVersion: number;
  keys: ReadonlyMap<number, DataWrappingKey>;
}>;

export interface TenantDataEncryptor {
  encrypt(key: Buffer, plaintext: string, aad: TenantContentAad): EncryptedPayload;
}

export interface TenantDataDecryptor {
  decrypt(
    key: Buffer,
    encrypted: Pick<EncryptedPayload, 'ciphertext' | 'nonce' | 'tag'>,
    aad: TenantContentAad,
  ): string;
}

export interface TenantKeyResolver {
  withActiveKey<T>(
    tenantId: string,
    operation: (key: Buffer, contentKeyVersion: number) => Promise<T> | T,
  ): Promise<T>;

  withKeyVersion<T>(
    tenantId: string,
    contentKeyVersion: number,
    operation: (key: Buffer) => Promise<T> | T,
  ): Promise<T>;
}

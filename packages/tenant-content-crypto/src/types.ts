export type ContentRole = 'none' | 'user' | 'assistant';
export type ContentKind = 'title' | 'message';

export type ContentAad = Readonly<{
  schemaVersion: 1;
  tenantId: string;
  conversationId: string;
  recordId: string;
  contentKind: ContentKind;
  role: ContentRole;
  contentKeyVersion: number;
}>;

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
  schemaVersion: 1;
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

import { ContentIntegrityError } from './errors';
import type {
  ContentAad,
  RagChunkAadV1,
  RagDocumentPrivateMetadataAadV1,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createTitleAad(
  tenantId: string,
  conversationId: string,
  contentKeyVersion: number,
): ContentAad {
  return Object.freeze({
    schemaVersion: 1,
    tenantId,
    conversationId,
    recordId: conversationId,
    contentKind: 'title',
    role: 'none',
    contentKeyVersion,
  });
}

export function createMessageAad(
  tenantId: string,
  conversationId: string,
  recordId: string,
  role: 'user' | 'assistant',
  contentKeyVersion: number,
): ContentAad {
  return Object.freeze({
    schemaVersion: 1,
    tenantId,
    conversationId,
    recordId,
    contentKind: 'message',
    role,
    contentKeyVersion,
  });
}

export function createMessageCitationsAad(
  tenantId: string,
  conversationId: string,
  recordId: string,
  contentKeyVersion: number,
): ContentAad {
  return Object.freeze({
    schemaVersion: 1,
    tenantId,
    conversationId,
    recordId,
    contentKind: 'message_citations',
    role: 'assistant',
    contentKeyVersion,
  });
}

export function createRagChunkAadV1(input: Readonly<{
  tenantId: string;
  knowledgeBaseId: string;
  documentId: string;
  documentIndexId: string;
  chunkId: string;
  contentKeyVersion: number;
}>): RagChunkAadV1 {
  assertCanonicalUuid(input.tenantId);
  assertCanonicalUuid(input.knowledgeBaseId);
  assertCanonicalUuid(input.documentId);
  assertCanonicalUuid(input.documentIndexId);
  assertCanonicalUuid(input.chunkId);
  assertPositiveVersion(input.contentKeyVersion);
  return Object.freeze({
    schemaVersion: 1,
    tenantId: input.tenantId,
    knowledgeBaseId: input.knowledgeBaseId,
    documentId: input.documentId,
    documentIndexId: input.documentIndexId,
    chunkId: input.chunkId,
    contentKind: 'rag_chunk',
    contentKeyVersion: input.contentKeyVersion,
  });
}

export function createRagDocumentPrivateMetadataAadV1(input: Readonly<{
  tenantId: string;
  knowledgeBaseId: string;
  documentId: string;
  contentKeyVersion: number;
}>): RagDocumentPrivateMetadataAadV1 {
  assertCanonicalUuid(input.tenantId);
  assertCanonicalUuid(input.knowledgeBaseId);
  assertCanonicalUuid(input.documentId);
  assertPositiveVersion(input.contentKeyVersion);
  return Object.freeze({
    schemaVersion: 1,
    tenantId: input.tenantId,
    knowledgeBaseId: input.knowledgeBaseId,
    documentId: input.documentId,
    contentKind: 'rag_document_private_metadata',
    contentKeyVersion: input.contentKeyVersion,
  });
}

export function assertPositiveVersion(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new ContentIntegrityError();
  }
}

export function assertCanonicalUuid(value: string): void {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new ContentIntegrityError();
  }
}

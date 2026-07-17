import { randomUUID } from 'node:crypto';

import { createRagChunkAadV1, createRagDocumentPrivateMetadataAadV1, encryptContent } from '@/content/content-crypto';
import type { AuthorizedExecution } from '@/auth/auth.types';

import { RagRetrievalDisabledError, RagRetrievalIntegrityError } from './rag-retrieval.errors';
import { RagRetrievalService } from './rag-retrieval.service';

const tenantId = randomUUID();
const knowledgeBaseId = randomUUID();
const documentId = randomUUID();
const publicDocumentId = randomUUID();
const documentIndexId = randomUUID();
const chunkId = randomUUID();
const key = Buffer.alloc(32, 7);
const vector = () => Array.from({ length: 1536 }, () => 0.01);

describe('RagRetrievalService', () => {
  it('retrieves only the server-selected enabled knowledge base and decrypts the result', async () => {
    const repository = repositoryMock([row()]);
    const embeddingClient = { embedQuery: jest.fn().mockResolvedValue(embeddingResult()) };
    const service = createService(repository, embeddingClient);

    await expect(service.retrieve(actor(), 'leave policy')).resolves.toEqual([
      expect.objectContaining({ chunkId, documentId: publicDocumentId, displayName: 'Leave policy', content: 'Annual leave is 15 days.', ordinal: 0 }),
    ]);
    expect(repository.findEnabledKnowledgeBase).toHaveBeenCalledWith(tenantId);
    expect(repository.recordQueryEmbeddingUsage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId, operationId: 'operation-1', inputCount: 1, promptTokens: 4, totalTokens: 4,
    }));
    expect(repository.search).toHaveBeenCalledWith(expect.objectContaining({ tenantId, knowledgeBaseId, topK: 6, minimumScore: 0.3 }));
    expect(embeddingClient.embedQuery).toHaveBeenCalledWith(tenantId, 'leave policy');
  });

  it('fails closed when the authenticated tenant has no enabled knowledge base', async () => {
    const repository = repositoryMock();
    repository.findEnabledKnowledgeBase.mockResolvedValue(null);
    const embeddingClient = { embedQuery: jest.fn() };
    const service = createService(repository, embeddingClient);
    await expect(service.retrieve(actor(), 'leave policy')).rejects.toBeInstanceOf(RagRetrievalDisabledError);
    expect(embeddingClient.embedQuery).not.toHaveBeenCalled();
    expect(repository.search).not.toHaveBeenCalled();
  });

  it('fails closed when the global feature flag is disabled', async () => {
    const embeddingClient = { embedQuery: jest.fn() };
    const repository = repositoryMock();
    const service = createService(repository, embeddingClient, 'false');
    await expect(service.retrieve(actor(), 'leave policy')).rejects.toBeInstanceOf(RagRetrievalDisabledError);
    expect(repository.findEnabledKnowledgeBase).not.toHaveBeenCalled();
    expect(embeddingClient.embedQuery).not.toHaveBeenCalled();
  });

  it('rejects malformed query embedding dimensions before SQL search', async () => {
    const repository = repositoryMock();
    const service = createService(repository, { embedQuery: jest.fn().mockResolvedValue(embeddingResult([0.1])) });
    await expect(service.retrieve(actor(), 'leave policy')).rejects.toBeInstanceOf(RagRetrievalIntegrityError);
    expect(repository.search).not.toHaveBeenCalled();
  });

  it('fails the whole retrieval if chunk AAD authentication fails', async () => {
    const invalid = row();
    invalid.contentAuthTag = Buffer.alloc(16, 9);
    const service = createService(
      repositoryMock([invalid]),
      { embedQuery: jest.fn().mockResolvedValue(embeddingResult()) },
    );
    await expect(service.retrieve(actor(), 'leave policy')).rejects.toBeInstanceOf(RagRetrievalIntegrityError);
  });

  it('uses the server-owned configured topK', async () => {
    const repository = repositoryMock();
    const service = createService(repository, { embedQuery: jest.fn().mockResolvedValue(embeddingResult()) }, 'true', { RAG_TOP_K: 6 });
    await service.retrieve(actor(), 'leave policy');
    expect(repository.search).toHaveBeenCalledWith(expect.objectContaining({ topK: 6 }));
  });

  it('fails closed before vector search when query usage cannot be recorded', async () => {
    const repository = repositoryMock();
    repository.recordQueryEmbeddingUsage.mockRejectedValue(new Error('database unavailable'));
    const service = createService(repository, { embedQuery: jest.fn().mockResolvedValue(embeddingResult()) });

    await expect(service.retrieve(actor(), 'leave policy')).rejects.toMatchObject({
      code: 'RAG_QUERY_USAGE_UNAVAILABLE',
    });
    expect(repository.search).not.toHaveBeenCalled();
  });
});

function repositoryMock(rows: any[] = []) {
  return {
    findEnabledKnowledgeBase: jest.fn().mockResolvedValue({ id: knowledgeBaseId }),
    recordQueryEmbeddingUsage: jest.fn().mockResolvedValue(undefined),
    search: jest.fn().mockResolvedValue(rows),
  };
}

function embeddingResult(embedding: number[] = vector()) {
  return {
    embedding,
    operationId: 'operation-1',
    requestId: 'request-1',
    usage: { inputCount: 1, promptTokens: 4, totalTokens: 4 },
  };
}

function createService(repository: any, embeddingClient: any, enabled = 'true', overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    TENANT_CHAT_RAG_ENABLED: enabled, RAG_TOP_K: 6,
    RAG_MIN_SCORE: 0.3, ...overrides,
  };
  const config = { getOrThrow: (name: string) => values[name] };
  const keys = { withKeyVersion: async (_tenantId: string, _version: number, callback: (tenantKey: Buffer) => unknown) => callback(key) };
  return new RagRetrievalService(config as never, repository as never, embeddingClient as never, keys as never);
}

function actor(): AuthorizedExecution {
  return {
    tenantId, userId: randomUUID(), actorKind: 'employee', sessionId: randomUUID(),
    sessionVersion: 1, actorAuthzVersion: 1, tenantAuthzVersion: 1,
  };
}

function row(): any {
  const metadata = encryptContent(key, JSON.stringify({ displayName: 'Leave policy', originalFilename: 'leave-policy.pdf', schemaVersion: 1, sha256Digest: 'a'.repeat(64) }), createRagDocumentPrivateMetadataAadV1({ tenantId, knowledgeBaseId, documentId, contentKeyVersion: 1 }));
  const content = encryptContent(key, 'Annual leave is 15 days.', createRagChunkAadV1({ tenantId, knowledgeBaseId, documentId, documentIndexId, chunkId, contentKeyVersion: 1 }));
  return {
    chunkId, tenantId, knowledgeBaseId, documentId, publicDocumentId, documentIndexId, ordinal: 0, tokenCount: 6,
    pageStart: 1, pageEnd: 1, lineStart: null, lineEnd: null, sourceMetadata: { page: 1 },
    contentCiphertext: content.ciphertext, contentNonce: content.nonce, contentAuthTag: content.tag, contentKeyVersion: 1,
    privateMetadataCiphertext: metadata.ciphertext, privateMetadataNonce: metadata.nonce, privateMetadataAuthTag: metadata.tag,
    privateMetadataContentKeyVersion: 1, privateMetadataSchemaVersion: 1, score: 0.9,
  };
}

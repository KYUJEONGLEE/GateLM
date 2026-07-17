import { RagRetrievalRepository } from './rag-retrieval.repository';

describe('RagRetrievalRepository', () => {
  it('keeps tenant and searchable-state constraints inside parameterized SQL', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const repository = new RagRetrievalRepository(prisma as never);
    await repository.search({ tenantId: '00000000-0000-4000-8000-000000000001', knowledgeBaseId: '00000000-0000-4000-8000-000000000002', embedding: Array.from({ length: 1536 }, () => 0.1), minimumScore: 0.3, topK: 6 });
    const query = prisma.$queryRaw.mock.calls[0][0];
    const sql = query.strings.join('?');
    expect(sql).toContain('chunk.tenant_id = ?::uuid');
    expect(sql).toContain('document.tenant_id = ?::uuid');
    expect(sql).toContain('document_index.tenant_id = ?::uuid');
    expect(sql).toContain('knowledge_base.tenant_id = ?::uuid');
    expect(sql).toContain("knowledge_base.status = 'ENABLED'");
    expect(sql).toContain("document.status = 'READY'");
    expect(sql).toContain("document.status NOT IN ('DELETING', 'FAILED')");
    expect(sql).toContain("document_index.status = 'ACTIVE'");
    expect(sql).toContain('chunk.document_index_id = document_index.id');
    expect(sql).toContain('chunk.embedding <=> ?::vector');
  });

  it('rejects an invalid embedding before executing SQL', async () => {
    const prisma = { $queryRaw: jest.fn() };
    const repository = new RagRetrievalRepository(prisma as never);
    await expect(repository.search({ tenantId: 'tenant', knowledgeBaseId: 'kb', embedding: [0.1], minimumScore: 0.3, topK: 6 })).rejects.toThrow('invalid query embedding');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('records query embedding usage idempotently without query text or vectors', async () => {
    const ragEmbeddingUsage = {
      createMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue({
        embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-large',
        embeddingDimensions: 1536, embeddingProfileVersion: 1,
        inputCount: 1, promptTokens: 7, totalTokens: 7,
      }),
    };
    const repository = new RagRetrievalRepository({ ragEmbeddingUsage } as never);
    const usage = {
      tenantId: '00000000-0000-4000-8000-000000000001',
      operationId: 'operation-1', inputCount: 1 as const, promptTokens: 7, totalTokens: 7,
    };

    await repository.recordQueryEmbeddingUsage(usage);
    await repository.recordQueryEmbeddingUsage(usage);

    const written = ragEmbeddingUsage.createMany.mock.calls[0][0].data[0];
    expect(written).toEqual(expect.objectContaining({
      purpose: 'RAG_QUERY', operationId: 'operation-1', inputCount: 1,
      promptTokens: 7, totalTokens: 7,
    }));
    expect(written).not.toHaveProperty('query');
    expect(written).not.toHaveProperty('embedding');
    expect(ragEmbeddingUsage.findFirst).toHaveBeenCalledTimes(1);
  });

  it('fails closed when an idempotency replay has different usage values', async () => {
    const repository = new RagRetrievalRepository({
      ragEmbeddingUsage: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue({
          embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-large',
          embeddingDimensions: 1536, embeddingProfileVersion: 1,
          inputCount: 1, promptTokens: 8, totalTokens: 8,
        }),
      },
    } as never);

    await expect(repository.recordQueryEmbeddingUsage({
      tenantId: '00000000-0000-4000-8000-000000000001',
      operationId: 'operation-1', inputCount: 1, promptTokens: 7, totalTokens: 7,
    })).rejects.toThrow('idempotency conflict');
  });
});

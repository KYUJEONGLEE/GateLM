import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { PrismaService } from '@/database/prisma.service';
import { createRagChunkAadV1, createRagDocumentPrivateMetadataAadV1, encryptContent } from '@/content/content-crypto';

import { RagContextBuilder } from './rag-context.builder';
import { validateRagCitations } from './rag-citations';
import { RagRetrievalRepository } from './rag-retrieval.repository';
import { RagRetrievalService } from './rag-retrieval.service';

const databaseUrl = process.env.GATELM_TEST_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;
const contentKey = Buffer.alloc(32, 17);

describeIntegration('RAG tenant isolation through pgvector retrieval and prompt construction', () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  let tenantAAdmin: string;
  let tenantAUser: string;
  let tenantBAdmin: string;
  let tenantBUser: string;
  let knowledgeBaseA: string;
  let knowledgeBaseB: string;
  let documentA: SeededDocument;
  let documentB: SeededDocument;
  let service: RagRetrievalService;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
    [tenantA, tenantB] = await Promise.all([
      createTenant('rag-e2e-a'), createTenant('rag-e2e-b'),
    ]);
    [tenantAAdmin, tenantAUser, tenantBAdmin, tenantBUser] = await Promise.all([
      createUser('rag-e2e-a-admin'), createUser('rag-e2e-a-user'), createUser('rag-e2e-b-admin'), createUser('rag-e2e-b-user'),
    ]);
    await Promise.all([
      prisma.tenantAdmin.create({ data: { tenantId: tenantA, userId: tenantAAdmin } }),
      prisma.tenantAdmin.create({ data: { tenantId: tenantB, userId: tenantBAdmin } }),
      createContentKey(tenantA), createContentKey(tenantB),
    ]);
    [knowledgeBaseA, knowledgeBaseB] = await Promise.all([
      createKnowledgeBase(tenantA), createKnowledgeBase(tenantB),
    ]);
    documentA = await seedReadyDocument({
      tenantId: tenantA, knowledgeBaseId: knowledgeBaseA, uploadedByUserId: tenantAAdmin,
      displayName: 'Tenant A leave policy.txt', content: 'Tenant A annual leave allowance is 15 days.', vectorIndex: 0, lineStart: 1,
    });
    documentB = await seedReadyDocument({
      tenantId: tenantB, knowledgeBaseId: knowledgeBaseB, uploadedByUserId: tenantBAdmin,
      displayName: 'Tenant B confidential benefit.txt', content: 'Tenant B commuter benefit is 120000 KRW.', vectorIndex: 0, lineStart: 1,
    });
    const repository = new RagRetrievalRepository(prisma);
    const embeddings = { embedQuery: jest.fn(async (_tenantId: string, query: string) => ({
      embedding: basisVector(query === 'no evidence' ? 2 : 0),
      operationId: randomUUID(),
      requestId: randomUUID(),
      usage: { inputCount: 1 as const, promptTokens: 2, totalTokens: 2 },
    })) };
    const keys = { withKeyVersion: async (_tenantId: string, _version: number, operation: (key: Buffer) => unknown) => operation(contentKey) };
    service = new RagRetrievalService(
      { getOrThrow: (name: string) => ({ TENANT_CHAT_RAG_ENABLED: 'true', RAG_TOP_K: 6, RAG_MIN_SCORE: 0.3 })[name] } as never,
      repository,
      embeddings as never,
      keys as never,
    );
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.ragEmbeddingUsage.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.ragJob.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.ragDocument.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.ragKnowledgeBase.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.tenantChatContentKey.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.tenantAdmin.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [tenantAAdmin, tenantAUser, tenantBAdmin, tenantBUser] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await prisma.$disconnect();
  });

  it('returns only tenant A chunks and never places tenant B content in the Gateway RAG context', async () => {
    const results = await service.retrieve(actor(tenantA, tenantAUser), 'annual leave');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ documentId: documentA.publicId, displayName: 'Tenant A leave policy.txt' });
    expect(results.map((result) => result.documentId)).not.toContain(documentB.publicId);
    expect(results.map((result) => result.content).join('\n')).not.toContain('Tenant B confidential benefit');

    const context = new RagContextBuilder({ getOrThrow: (name: string) => ({ RAG_CONTEXT_MAX_TOKENS: 6000, RAG_TOP_K: 6, RAG_PROMPT_VERSION: 1 })[name] } as never).build(results);
    expect(context.message.content).toContain('Tenant A annual leave allowance');
    expect(context.message.content).not.toContain('Tenant B confidential benefit');
    expect(context.citationSources).toEqual([expect.objectContaining({ documentId: documentA.publicId })]);
    expect(validateRagCitations('Answer [S1] and fabricated [S999] [S1].', context.citationSources)).toEqual(context.citationSources);
  });

  it('excludes DELETING immediately and stays excluded after hard delete', async () => {
    await prisma.ragDocument.update({ where: { id: documentA.id }, data: { status: 'DELETING' } });
    await expect(service.retrieve(actor(tenantA, tenantAUser), 'annual leave')).resolves.toEqual([]);

    await prisma.ragDocument.delete({ where: { id: documentA.id } });
    await expect(service.retrieve(actor(tenantA, tenantAUser), 'annual leave')).resolves.toEqual([]);
    await expect(prisma.ragChunk.count({ where: { tenantId: tenantA, documentId: documentA.id } })).resolves.toBe(0);
  });

  it('returns a normal empty result for a no-evidence query without cross-tenant fallback', async () => {
    await expect(service.retrieve(actor(tenantA, tenantAUser), 'no evidence')).resolves.toEqual([]);
  });

  async function createTenant(prefix: string): Promise<string> {
    return (await prisma.tenant.create({ data: { name: `${prefix}-${randomUUID()}` }, select: { id: true } })).id;
  }

  async function createUser(prefix: string): Promise<string> {
    return (await prisma.user.create({ data: { email: `${prefix}-${randomUUID()}@example.test` }, select: { id: true } })).id;
  }

  async function createContentKey(tenantId: string): Promise<void> {
    await prisma.tenantChatContentKey.create({ data: {
      tenantId, contentKeyVersion: 1, wrappingKeyVersion: 1,
      wrappedKey: Buffer.alloc(32, 1), wrapNonce: Buffer.alloc(12, 2), wrapTag: Buffer.alloc(16, 3),
    } });
  }

  async function createKnowledgeBase(tenantId: string): Promise<string> {
    return (await prisma.ragKnowledgeBase.create({ data: { tenantId, status: 'ENABLED' }, select: { id: true } })).id;
  }

  async function seedReadyDocument(input: Readonly<{ tenantId: string; knowledgeBaseId: string; uploadedByUserId: string; displayName: string; content: string; vectorIndex: number; lineStart: number }>): Promise<SeededDocument> {
    const documentId = randomUUID();
    const publicId = randomUUID();
    const indexId = randomUUID();
    const chunkId = randomUUID();
    const metadata = encryptContent(contentKey, JSON.stringify({ schemaVersion: 1, displayName: input.displayName, originalFilename: 'fixture.txt', sha256Digest: 'a'.repeat(64) }), createRagDocumentPrivateMetadataAadV1({ tenantId: input.tenantId, knowledgeBaseId: input.knowledgeBaseId, documentId, contentKeyVersion: 1 }));
    const content = encryptContent(contentKey, input.content, createRagChunkAadV1({ tenantId: input.tenantId, knowledgeBaseId: input.knowledgeBaseId, documentId, documentIndexId: indexId, chunkId, contentKeyVersion: 1 }));
    await prisma.ragDocument.create({ data: {
      id: documentId, publicId, tenantId: input.tenantId, knowledgeBaseId: input.knowledgeBaseId, uploadedByUserId: input.uploadedByUserId,
      privateMetadataCiphertext: Uint8Array.from(metadata.ciphertext), privateMetadataNonce: Uint8Array.from(metadata.nonce), privateMetadataAuthTag: Uint8Array.from(metadata.tag), privateMetadataContentKeyVersion: 1,
      fileExtension: 'txt', mimeType: 'text/plain', sizeBytes: BigInt(Buffer.byteLength(input.content)), s3ObjectKey: `rag/${input.tenantId}/${documentId}/source`, status: 'READY',
    } });
    await prisma.ragDocumentIndex.create({ data: { id: indexId, tenantId: input.tenantId, documentId, version: 1, status: 'ACTIVE', startedAt: new Date(), completedAt: new Date() } });
    const vector = `[${basisVector(input.vectorIndex).join(',')}]`;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO rag_chunks (
        id, tenant_id, document_id, document_index_id, ordinal, token_count, page_start, page_end, line_start, line_end,
        source_metadata, content_ciphertext, content_nonce, content_auth_tag, content_key_version, embedding
      ) VALUES (
        ${chunkId}::uuid, ${input.tenantId}::uuid, ${documentId}::uuid, ${indexId}::uuid, 0, 8, NULL, NULL, ${input.lineStart}, ${input.lineStart},
        '{}'::jsonb, ${Uint8Array.from(content.ciphertext)}, ${Uint8Array.from(content.nonce)}, ${Uint8Array.from(content.tag)}, 1, ${vector}::vector
      )
    `);
    return { id: documentId, publicId };
  }
});

type SeededDocument = Readonly<{ id: string; publicId: string }>;

function actor(tenantId: string, userId: string) {
  return { tenantId, userId, actorKind: 'employee' as const, sessionId: randomUUID(), sessionVersion: 1, actorAuthzVersion: 1, tenantAuthzVersion: 1 };
}

function basisVector(index: number): number[] {
  const vector = Array.from({ length: 1536 }, () => 0);
  vector[index] = 1;
  return vector;
}

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(new URL('../../apps/control-plane-api/package.json', import.meta.url));
const { Prisma, PrismaClient } = require('@prisma/client');

const databaseUrl = process.env.RAG_BENCHMARK_DATABASE_URL;
if (!databaseUrl) throw new Error('RAG_BENCHMARK_DATABASE_URL must point to a disposable PostgreSQL 16 + pgvector database.');

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const vector = `[1${',0'.repeat(1535)}]`;
const sizes = [100, 1000, 5000];
const samplesPerSize = 25;
const tenantId = randomUUID();
const userId = randomUUID();
const knowledgeBaseId = randomUUID();
const documentId = randomUUID();
const indexId = randomUUID();

try {
  await prisma.$connect();
  await prisma.tenant.create({ data: { id: tenantId, name: `rag-benchmark-${tenantId}` } });
  await prisma.user.create({ data: { id: userId, email: `rag-benchmark-${userId}@example.test` } });
  await prisma.tenantChatContentKey.create({ data: { tenantId, contentKeyVersion: 1, wrappingKeyVersion: 1, wrappedKey: Buffer.alloc(32, 1), wrapNonce: Buffer.alloc(12, 2), wrapTag: Buffer.alloc(16, 3) } });
  await prisma.ragKnowledgeBase.create({ data: { id: knowledgeBaseId, tenantId, status: 'ENABLED' } });
  await prisma.ragDocument.create({ data: {
    id: documentId, tenantId, knowledgeBaseId, uploadedByUserId: userId, status: 'READY',
    privateMetadataCiphertext: Uint8Array.from([1]), privateMetadataNonce: Uint8Array.from(new Array(12).fill(1)), privateMetadataAuthTag: Uint8Array.from(new Array(16).fill(1)), privateMetadataContentKeyVersion: 1,
    fileExtension: 'txt', mimeType: 'text/plain', sizeBytes: BigInt(1), s3ObjectKey: `rag/${tenantId}/${documentId}/source`,
  } });
  await prisma.ragDocumentIndex.create({ data: { id: indexId, tenantId, documentId, version: 1, status: 'ACTIVE', startedAt: new Date(), completedAt: new Date() } });

  const report = [];
  for (const size of sizes) {
    await prisma.$executeRaw`DELETE FROM rag_chunks WHERE tenant_id = ${tenantId}::uuid`;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO rag_chunks (
        id, tenant_id, document_id, document_index_id, ordinal, token_count,
        page_start, page_end, line_start, line_end, source_metadata,
        content_ciphertext, content_nonce, content_auth_tag, content_key_version, embedding
      )
      SELECT
        md5(${tenantId} || value::text)::uuid, ${tenantId}::uuid, ${documentId}::uuid, ${indexId}::uuid,
        value, 1, NULL, NULL, NULL, NULL, '{}'::jsonb,
        decode('00', 'hex'), decode('000000000000000000000000', 'hex'), decode('00000000000000000000000000000000', 'hex'), 1,
        ${vector}::vector
      FROM generate_series(0, ${size - 1}) AS value
    `);
    const durations = [];
    for (let sample = 0; sample < samplesPerSize; sample += 1) {
      const startedAt = performance.now();
      await prisma.$queryRaw(Prisma.sql`
        SELECT chunk.id
        FROM rag_chunks AS chunk
        INNER JOIN rag_document_indexes AS document_index
          ON document_index.id = chunk.document_index_id
          AND document_index.document_id = chunk.document_id
          AND document_index.tenant_id = chunk.tenant_id
        INNER JOIN rag_documents AS document
          ON document.id = chunk.document_id AND document.tenant_id = chunk.tenant_id
        INNER JOIN rag_knowledge_bases AS knowledge_base
          ON knowledge_base.id = document.knowledge_base_id AND knowledge_base.tenant_id = document.tenant_id
        WHERE chunk.tenant_id = ${tenantId}::uuid
          AND document.tenant_id = ${tenantId}::uuid
          AND document_index.tenant_id = ${tenantId}::uuid
          AND knowledge_base.tenant_id = ${tenantId}::uuid
          AND knowledge_base.id = ${knowledgeBaseId}::uuid
          AND knowledge_base.status = 'ENABLED'
          AND document.status = 'READY'
          AND document_index.status = 'ACTIVE'
          AND 1 - (chunk.embedding <=> ${vector}::vector) >= 0.3
        ORDER BY chunk.embedding <=> ${vector}::vector ASC, chunk.id ASC
        LIMIT 6
      `);
      durations.push(performance.now() - startedAt);
    }
    report.push({ tenantChunkCount: size, samples: samplesPerSize, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95) });
  }
  console.log(JSON.stringify({ engine: 'postgresql-16-pgvector-exact-cosine', hnsw: false, report }, null, 2));
} finally {
  await prisma.ragJob.deleteMany({ where: { tenantId } }).catch(() => undefined);
  await prisma.ragDocument.deleteMany({ where: { tenantId } }).catch(() => undefined);
  await prisma.ragKnowledgeBase.deleteMany({ where: { tenantId } }).catch(() => undefined);
  await prisma.tenantChatContentKey.deleteMany({ where: { tenantId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
  await prisma.$disconnect();
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)].toFixed(3));
}

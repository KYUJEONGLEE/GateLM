import { randomUUID } from 'node:crypto';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

const databaseUrl = process.env.GATELM_TEST_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;
const zeroVector1536 = `[${Array.from({ length: 1536 }, () => '0').join(',')}]`;

describeIntegration('Tenant Chat RAG database foundation integration', () => {
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let knowledgeBaseId: string;
  let otherKnowledgeBaseId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();

    const [tenant, otherTenant, user] = await Promise.all([
      prisma.tenant.create({
        data: { name: `rag-foundation-a-${randomUUID()}` },
        select: { id: true },
      }),
      prisma.tenant.create({
        data: { name: `rag-foundation-b-${randomUUID()}` },
        select: { id: true },
      }),
      prisma.user.create({
        data: { email: `rag-foundation-${randomUUID()}@example.com` },
        select: { id: true },
      }),
    ]);
    tenantId = tenant.id;
    otherTenantId = otherTenant.id;
    userId = user.id;

    await Promise.all([
      createContentKey(tenantId),
      createContentKey(otherTenantId),
    ]);
    knowledgeBaseId = await createKnowledgeBase(tenantId);
    otherKnowledgeBaseId = await createKnowledgeBase(otherTenantId);
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    await prisma.$executeRaw`
      DELETE FROM rag_jobs WHERE tenant_id IN (${tenantId}::uuid, ${otherTenantId}::uuid)
    `;
    await prisma.$executeRaw`
      DELETE FROM rag_documents WHERE tenant_id IN (${tenantId}::uuid, ${otherTenantId}::uuid)
    `;
    await prisma.$executeRaw`
      DELETE FROM rag_knowledge_bases WHERE tenant_id IN (${tenantId}::uuid, ${otherTenantId}::uuid)
    `;
    await prisma.tenantChatContentKey.deleteMany({
      where: { tenantId: { in: [tenantId, otherTenantId] } },
    });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenantId, otherTenantId] } },
    });
    await prisma.$disconnect();
  });

  it('installs vector(1536) and preserves the custom partial index in the catalog', async () => {
    const extensions = await prisma.$queryRaw<
      Array<{ extname: string; extversion: string }>
    >`
      SELECT extname, extversion
      FROM pg_extension
      WHERE extname = 'vector'
    `;
    expect(extensions).toHaveLength(1);
    expect(extensions[0]?.extversion).toBe('0.8.5');

    const serverVersions = await prisma.$queryRaw<
      Array<{ serverVersionNum: number }>
    >`
      SELECT current_setting('server_version_num')::integer AS "serverVersionNum"
    `;
    expect(Math.trunc((serverVersions[0]?.serverVersionNum ?? 0) / 10000)).toBe(
      16,
    );

    const vectorColumns = await prisma.$queryRaw<Array<{ dataType: string }>>`
      SELECT format_type(attribute.atttypid, attribute.atttypmod) AS "dataType"
      FROM pg_attribute AS attribute
      JOIN pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = current_schema()
        AND relation.relname = 'rag_chunks'
        AND attribute.attname = 'embedding'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    `;
    expect(vectorColumns).toEqual([{ dataType: 'vector(1536)' }]);

    const activeIndexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'rag_document_indexes_one_active_per_document_idx'
    `;
    expect(activeIndexes).toHaveLength(1);
    expect(activeIndexes[0]?.indexdef).toContain('UNIQUE INDEX');
    expect(activeIndexes[0]?.indexdef).toContain("WHERE (status = 'ACTIVE'::text)");

    const nullableTenantColumns = await prisma.$queryRaw<Array<{ tableName: string }>>`
      SELECT table_name AS "tableName"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN (
          'rag_knowledge_bases', 'rag_documents', 'rag_document_indexes',
          'rag_chunks', 'rag_jobs'
        )
        AND column_name = 'tenant_id'
        AND is_nullable <> 'NO'
    `;
    expect(nullableTenantColumns).toEqual([]);

    const constraints = await prisma.$queryRaw<Array<{ constraintName: string }>>`
      SELECT catalog_constraint.conname AS "constraintName"
      FROM pg_constraint AS catalog_constraint
      JOIN pg_class AS relation ON relation.oid = catalog_constraint.conrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = current_schema()
        AND relation.relname IN (
          'rag_knowledge_bases', 'rag_documents', 'rag_document_indexes',
          'rag_chunks', 'rag_jobs'
        )
    `;
    const constraintNames = constraints.map((row) => row.constraintName);
    expect(constraintNames).toEqual(
      expect.arrayContaining([
        'rag_knowledge_bases_tenant_key',
        'rag_documents_knowledge_base_tenant_fkey',
        'rag_document_indexes_document_tenant_fkey',
        'rag_chunks_document_tenant_fkey',
        'rag_chunks_document_index_tenant_fkey',
        'rag_jobs_document_tenant_fkey',
        'rag_jobs_document_snapshot_check',
        'rag_jobs_lock_shape_check',
        'rag_documents_status_check',
        'rag_document_indexes_status_check',
        'rag_jobs_status_check',
      ]),
    );
  });

  it('enforces one Knowledge Base per tenant and rejects a cross-tenant Document relation', async () => {
    await expect(createKnowledgeBase(tenantId)).rejects.toThrow(
      'Key (tenant_id)',
    );

    await expect(
      createDocument(otherTenantId, knowledgeBaseId),
    ).rejects.toThrow('rag_documents_knowledge_base_tenant_fkey');

    await createDocument(tenantId, knowledgeBaseId);
    await expect(prisma.$executeRaw`
      DELETE FROM rag_knowledge_bases
      WHERE id = ${knowledgeBaseId}::uuid AND tenant_id = ${tenantId}::uuid
    `).rejects.toThrow('rag_documents_knowledge_base_tenant_fkey');
  });

  it('rejects cross-tenant DocumentIndex and Chunk relations', async () => {
    const documentId = await createDocument(tenantId, knowledgeBaseId);
    const otherDocumentId = await createDocument(
      otherTenantId,
      otherKnowledgeBaseId,
    );
    const indexId = await createDocumentIndex(tenantId, documentId, 1);

    await expect(
      createDocumentIndex(otherTenantId, documentId, 1),
    ).rejects.toThrow('rag_document_indexes_document_tenant_fkey');

    await expect(
      createChunk(otherTenantId, documentId, indexId, zeroVector1536),
    ).rejects.toThrow('rag_chunks_document_tenant_fkey');

    await expect(
      createChunk(otherTenantId, otherDocumentId, indexId, zeroVector1536),
    ).rejects.toThrow('rag_chunks_document_index_tenant_fkey');
  });

  it('rejects a second ACTIVE index for one Document', async () => {
    const documentId = await createDocument(tenantId, knowledgeBaseId);
    await createDocumentIndex(tenantId, documentId, 1, 'ACTIVE');

    await expect(
      createDocumentIndex(tenantId, documentId, 2, 'ACTIVE'),
    ).rejects.toThrow('Key (tenant_id, document_id)');
  });

  it('rejects a vector dimension mismatch and accepts exactly 1536 dimensions', async () => {
    const documentId = await createDocument(tenantId, knowledgeBaseId);
    const indexId = await createDocumentIndex(tenantId, documentId, 1);

    await expect(
      createChunk(tenantId, documentId, indexId, '[0,0,0]'),
    ).rejects.toThrow('expected 1536 dimensions');

    await expect(
      createChunk(tenantId, documentId, indexId, zeroVector1536, 901),
    ).rejects.toThrow('rag_chunks_counts_check');

    await expect(
      createChunk(tenantId, documentId, indexId, zeroVector1536),
    ).resolves.toBeDefined();
  });

  it('rejects unrecoverable job references and invalid lease-state combinations', async () => {
    const documentId = await createDocument(tenantId, knowledgeBaseId);

    await expect(prisma.$executeRaw`
      INSERT INTO rag_jobs (
        id, tenant_id, knowledge_base_id, document_id, type, status,
        idempotency_key
      ) VALUES (
        ${randomUUID()}::uuid, ${tenantId}::uuid, ${knowledgeBaseId}::uuid,
        ${documentId}::uuid, 'DELETE', 'PENDING', ${`delete-${randomUUID()}`}
      )
    `).rejects.toThrow('rag_jobs_document_snapshot_check');

    await expect(prisma.$executeRaw`
      INSERT INTO rag_jobs (
        id, tenant_id, knowledge_base_id, document_id, type, status,
        idempotency_key
      ) VALUES (
        ${randomUUID()}::uuid, ${tenantId}::uuid, ${knowledgeBaseId}::uuid,
        NULL, 'INGEST', 'PENDING', ${`ingest-${randomUUID()}`}
      )
    `).rejects.toThrow('rag_jobs_document_snapshot_check');

    await expect(prisma.$executeRaw`
      INSERT INTO rag_jobs (
        id, tenant_id, knowledge_base_id, document_id, type, status,
        idempotency_key
      ) VALUES (
        ${randomUUID()}::uuid, ${tenantId}::uuid, ${knowledgeBaseId}::uuid,
        ${documentId}::uuid, 'INGEST', 'RUNNING', ${`running-${randomUUID()}`}
      )
    `).rejects.toThrow('rag_jobs_lock_shape_check');

    const lockedAt = new Date();
    const leaseExpiresAt = new Date(lockedAt.getTime() + 30_000);
    await expect(prisma.$executeRaw`
      INSERT INTO rag_jobs (
        id, tenant_id, knowledge_base_id, document_id, type, status,
        idempotency_key, locked_at, locked_by, lease_expires_at
      ) VALUES (
        ${randomUUID()}::uuid, ${tenantId}::uuid, ${knowledgeBaseId}::uuid,
        ${documentId}::uuid, 'INGEST', 'PENDING', ${`pending-${randomUUID()}`},
        ${lockedAt}, 'worker-test', ${leaseExpiresAt}
      )
    `).rejects.toThrow('rag_jobs_lock_shape_check');
  });

  it('cascades Index and Chunk after leased jobs are terminalized and detached', async () => {
    const documentId = await createDocument(tenantId, knowledgeBaseId);
    const indexId = await createDocumentIndex(tenantId, documentId, 1);
    await createChunk(tenantId, documentId, indexId, zeroVector1536);
    const jobId = randomUUID();
    const ingestJobId = randomUUID();
    const objectKeySnapshot = `tenants/${tenantId}/rag/${randomUUID()}`;
    const lockedAt = new Date();
    const leaseExpiresAt = new Date(lockedAt.getTime() + 30_000);

    await prisma.$executeRaw`
      INSERT INTO rag_jobs (
        id, tenant_id, knowledge_base_id, document_id, type, status,
        idempotency_key, deletion_object_key_snapshot,
        locked_at, locked_by, lease_expires_at
      ) VALUES (
        ${jobId}::uuid, ${tenantId}::uuid, ${knowledgeBaseId}::uuid,
        ${documentId}::uuid, 'DELETE', 'RUNNING', ${`delete-${jobId}`},
        ${objectKeySnapshot}, ${lockedAt}, 'delete-worker', ${leaseExpiresAt}
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO rag_jobs (
        id, tenant_id, knowledge_base_id, document_id, type, status,
        idempotency_key, locked_at, locked_by, lease_expires_at
      ) VALUES (
        ${ingestJobId}::uuid, ${tenantId}::uuid, ${knowledgeBaseId}::uuid,
        ${documentId}::uuid, 'INGEST', 'RUNNING', ${`ingest-${ingestJobId}`},
        ${lockedAt}, 'ingest-worker', ${leaseExpiresAt}
      )
    `;

    await expect(prisma.$executeRaw`
      DELETE FROM rag_documents WHERE id = ${documentId}::uuid
    `).rejects.toThrow('rag_jobs_document_tenant_fkey');

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        UPDATE rag_jobs
        SET status = CASE
              WHEN type IN ('INGEST', 'REINDEX') THEN 'CANCELLED'
              WHEN type = 'DELETE' THEN 'SUCCEEDED'
              ELSE status
            END,
            document_id = NULL,
            locked_at = NULL,
            locked_by = NULL,
            lease_expires_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE document_id = ${documentId}::uuid
          AND tenant_id = ${tenantId}::uuid
      `;
      await transaction.$executeRaw`
        DELETE FROM rag_documents
        WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid
      `;
    });

    const [indexCount, chunkCount, jobs] = await Promise.all([
      countRows('rag_document_indexes', indexId),
      countRows('rag_chunks', undefined, documentId),
      prisma.$queryRaw<
        Array<{
          id: string;
          tenantId: string;
          documentId: string | null;
          type: string;
          status: string;
          lockedAt: Date | null;
          lockedBy: string | null;
          leaseExpiresAt: Date | null;
          deletionObjectKeySnapshot: string | null;
        }>
      >`
        SELECT id, tenant_id AS "tenantId", document_id AS "documentId",
               type, status, locked_at AS "lockedAt", locked_by AS "lockedBy",
               lease_expires_at AS "leaseExpiresAt",
               deletion_object_key_snapshot AS "deletionObjectKeySnapshot"
        FROM rag_jobs
        WHERE id IN (${jobId}::uuid, ${ingestJobId}::uuid)
        ORDER BY type
      `,
    ]);

    expect(indexCount).toBe(0n);
    expect(chunkCount).toBe(0n);
    expect(jobs).toEqual([
      {
        id: jobId,
        tenantId,
        documentId: null,
        type: 'DELETE',
        status: 'SUCCEEDED',
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        deletionObjectKeySnapshot: objectKeySnapshot,
      },
      {
        id: ingestJobId,
        tenantId,
        documentId: null,
        type: 'INGEST',
        status: 'CANCELLED',
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        deletionObjectKeySnapshot: null,
      },
    ]);
  });

  async function createContentKey(targetTenantId: string): Promise<void> {
    await prisma.tenantChatContentKey.create({
      data: {
        tenantId: targetTenantId,
        contentKeyVersion: 1,
        wrappingKeyVersion: 1,
        wrappedKey: Buffer.alloc(32, 1),
        wrapNonce: Buffer.alloc(12, 2),
        wrapTag: Buffer.alloc(16, 3),
      },
    });
  }

  async function createKnowledgeBase(targetTenantId: string): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO rag_knowledge_bases (id, tenant_id)
      VALUES (${id}::uuid, ${targetTenantId}::uuid)
    `;
    return id;
  }

  async function createDocument(
    targetTenantId: string,
    targetKnowledgeBaseId: string,
  ): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO rag_documents (
        id, public_id, tenant_id, knowledge_base_id,
        private_metadata_ciphertext, private_metadata_nonce,
        private_metadata_auth_tag, private_metadata_content_key_version,
        file_extension, mime_type, size_bytes, s3_object_key,
        uploaded_by_user_id, status
      ) VALUES (
        ${id}::uuid, ${randomUUID()}::uuid, ${targetTenantId}::uuid,
        ${targetKnowledgeBaseId}::uuid, ${Buffer.from('encrypted-metadata')},
        ${Buffer.alloc(12, 4)}, ${Buffer.alloc(16, 5)}, 1,
        'txt', 'text/plain', 128, ${`tenants/${targetTenantId}/rag/${id}`},
        ${userId}::uuid, 'UPLOADED'
      )
    `;
    return id;
  }

  async function createDocumentIndex(
    targetTenantId: string,
    documentId: string,
    version: number,
    status = 'BUILDING',
  ): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO rag_document_indexes (
        id, tenant_id, document_id, version, status
      ) VALUES (
        ${id}::uuid, ${targetTenantId}::uuid, ${documentId}::uuid,
        ${version}, ${status}
      )
    `;
    return id;
  }

  async function createChunk(
    targetTenantId: string,
    documentId: string,
    documentIndexId: string,
    embedding: string,
    tokenCount = 10,
  ): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO rag_chunks (
        id, tenant_id, document_id, document_index_id, ordinal, token_count,
        content_ciphertext, content_nonce, content_auth_tag,
        content_key_version, embedding
      ) VALUES (
        ${id}::uuid, ${targetTenantId}::uuid, ${documentId}::uuid,
        ${documentIndexId}::uuid, 0, ${tokenCount}, ${Buffer.from('encrypted-chunk')},
        ${Buffer.alloc(12, 6)}, ${Buffer.alloc(16, 7)}, 1,
        ${embedding}::vector
      )
    `;
    return id;
  }

  async function countRows(
    table: 'rag_document_indexes' | 'rag_chunks',
    id?: string,
    documentId?: string,
  ): Promise<bigint> {
    if (table === 'rag_document_indexes') {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM rag_document_indexes
        WHERE id = ${id}::uuid
      `;
      return rows[0]?.count ?? -1n;
    }

    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM rag_chunks
      WHERE document_id = ${documentId}::uuid
    `;
    return rows[0]?.count ?? -1n;
  }
});

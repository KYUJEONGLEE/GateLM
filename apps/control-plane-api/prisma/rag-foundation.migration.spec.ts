import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  'migrations/20260716150000_rag_db_foundation/migration.sql',
);
const invariantsMigrationPath = resolve(
  __dirname,
  'migrations/20260716153000_rag_db_foundation_invariants/migration.sql',
);
const schemaPath = resolve(__dirname, 'schema.prisma');
const repositoryRoot = resolve(__dirname, '../../..');
const pgvectorImage =
  'pgvector/pgvector:0.8.5-pg16-trixie@sha256:073acab878025cadf03fe6fed01babaaa285b8d09ddc9c43882cf02d409546d7';
const migrationSql = readFileSync(migrationPath, 'utf8');
const invariantsMigrationSql = readFileSync(invariantsMigrationPath, 'utf8');
const schema = readFileSync(schemaPath, 'utf8');
const compactSql = migrationSql.replace(/\s+/g, ' ').trim();
const compactInvariantsSql = invariantsMigrationSql.replace(/\s+/g, ' ').trim();

describe('Tenant Chat RAG database foundation migration', () => {
  it('pins one immutable pgvector PostgreSQL 16 image across local, CI, and deployments', () => {
    for (const manifest of [
      'docker-compose.yml',
      '.github/workflows/ci.yml',
      'deploy/selfhost/docker-compose.yml',
      'deploy/aws-triage/docker-compose.yml',
      'deploy/aws-triage/docker-compose.perf.distributed.yml',
    ]) {
      const source = readFileSync(resolve(repositoryRoot, manifest), 'utf8');
      expect(source).toContain(pgvectorImage);
      expect(source).not.toMatch(/^\s*image:\s*postgres:16\s*$/m);
    }
  });

  it('derives the pre-RAG upgrade baseline instead of hard-coding a migration count', () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, '.github/workflows/ci.yml'),
      'utf8',
    );

    expect(workflow).toContain('Verify upgrade from every pre-RAG migration');
    expect(workflow).toContain(
      'expected_baseline_count=$((expected_baseline_count + 1))',
    );
    expect(workflow).toContain(
      '"${baseline_count}" -ne "${expected_baseline_count}"',
    );
    expect(workflow).not.toMatch(/\$\{baseline_count\}" -eq \d+/);
  });

  it('enables pgvector and declares the fixed 1536-dimensional Prisma field', () => {
    expect(migrationSql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector;/);
    expect(migrationSql).toMatch(/"embedding" vector\(1536\) NOT NULL/);
    expect(schema).toContain('embedding         Unsupported("vector(1536)")');
    expect(compactSql).toContain('"embedding_provider" = \'openai\'');
    expect(compactSql).toContain(
      '"embedding_model" = \'text-embedding-3-large\'',
    );
    expect(compactSql).toContain('"embedding_dimensions" = 1536');
    expect(compactSql).toContain('"embedding_profile_version" = 1');
  });

  it('creates only additive tenant-scoped RAG tables', () => {
    for (const table of [
      'rag_knowledge_bases',
      'rag_documents',
      'rag_document_indexes',
      'rag_chunks',
      'rag_jobs',
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE "${table}"`);
    }

    expect(migrationSql).not.toMatch(/^\s*(?:DROP|TRUNCATE|UPDATE|DELETE\s+FROM)\b/im);
    expect(invariantsMigrationSql).not.toMatch(
      /^\s*(?:DROP\s+TABLE|TRUNCATE|UPDATE|DELETE\s+FROM)\b/im,
    );
    const alteredTables = [...migrationSql.matchAll(/ALTER TABLE\s+"([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    expect(alteredTables.length).toBeGreaterThan(0);
    expect(alteredTables.every((table) => table.startsWith('rag_'))).toBe(true);
  });

  it('keeps tenant identity non-null and enforces composite tenant relations', () => {
    expect(migrationSql.match(/"tenant_id" UUID NOT NULL/g)).toHaveLength(5);
    expect(compactSql).toContain(
      'FOREIGN KEY ("knowledge_base_id", "tenant_id") REFERENCES "rag_knowledge_bases"("id", "tenant_id")',
    );
    expect(compactSql).toContain(
      'FOREIGN KEY ("document_id", "tenant_id") REFERENCES "rag_documents"("id", "tenant_id")',
    );
    expect(compactSql).toContain(
      'FOREIGN KEY ("document_index_id", "document_id", "tenant_id") REFERENCES "rag_document_indexes"("id", "document_id", "tenant_id")',
    );
    expect(compactSql).toContain(
      'FOREIGN KEY ("tenant_id", "content_key_version") REFERENCES "tenant_chat_content_keys"("tenant_id", "content_key_version")',
    );
  });

  it('defines every required lifecycle value with named checks', () => {
    for (const state of [
      'UPLOADED',
      'EXTRACTING',
      'CHUNKING',
      'EMBEDDING',
      'INDEXING',
      'READY',
      'FAILED',
      'DELETING',
      'BUILDING',
      'ACTIVE',
      'RETIRED',
      'PENDING',
      'RUNNING',
      'RETRY_WAIT',
      'SUCCEEDED',
      'CANCELLED',
      'INGEST',
      'DELETE',
      'REINDEX',
    ]) {
      expect(migrationSql).toContain(`'${state}'`);
    }
    expect(migrationSql).toContain('rag_documents_status_check');
    expect(migrationSql).toContain('rag_document_indexes_status_check');
    expect(migrationSql).toContain('rag_jobs_status_check');
    expect(migrationSql).toContain('rag_jobs_type_check');
  });

  it('uses a partial unique ACTIVE index and no approximate vector index', () => {
    expect(compactSql).toContain(
      'CREATE UNIQUE INDEX "rag_document_indexes_one_active_per_document_idx" ON "rag_document_indexes" ("tenant_id", "document_id") WHERE "status" = \'ACTIVE\'',
    );
    expect(migrationSql).not.toMatch(/\b(?:HNSW|IVFFLAT)\b/i);
    expect(schema).toContain(
      'Prisma cannot express the one-ACTIVE-index partial unique index.',
    );
  });

  it('creates tenant-first B-tree indexes for document, index, chunk, and job access', () => {
    for (const index of [
      'rag_documents_tenant_status_idx',
      'rag_documents_tenant_knowledge_base_idx',
      'rag_document_indexes_tenant_status_idx',
      'rag_document_indexes_tenant_document_status_idx',
      'rag_chunks_tenant_document_idx',
      'rag_chunks_tenant_document_index_idx',
      'rag_jobs_claim_idx',
      'rag_jobs_tenant_status_available_idx',
      'rag_jobs_tenant_document_idx',
    ]) {
      expect(migrationSql).toContain(`"${index}"`);
    }
  });

  it('cascades document indexes/chunks but preserves jobs through explicit detachment', () => {
    expect(compactSql).toContain(
      'CONSTRAINT "rag_document_indexes_document_tenant_fkey" FOREIGN KEY ("document_id", "tenant_id") REFERENCES "rag_documents"("id", "tenant_id") ON DELETE CASCADE',
    );
    expect(compactSql).toContain(
      'CONSTRAINT "rag_chunks_document_index_tenant_fkey" FOREIGN KEY ("document_index_id", "document_id", "tenant_id") REFERENCES "rag_document_indexes"("id", "document_id", "tenant_id") ON DELETE CASCADE',
    );
    expect(compactSql).toContain(
      'CONSTRAINT "rag_jobs_document_tenant_fkey" FOREIGN KEY ("document_id", "tenant_id") REFERENCES "rag_documents"("id", "tenant_id") ON DELETE NO ACTION',
    );
    expect(schema).toContain('clears every job documentId');
  });

  it('prevents Knowledge Base deletion from bypassing document object cleanup', () => {
    expect(compactInvariantsSql).toContain(
      'CONSTRAINT "rag_documents_knowledge_base_tenant_fkey" FOREIGN KEY ("knowledge_base_id", "tenant_id") REFERENCES "rag_knowledge_bases"("id", "tenant_id") ON DELETE RESTRICT',
    );
    expect(schema).toContain(
      'references: [id, tenantId], onDelete: Restrict, onUpdate: NoAction, map: "rag_documents_knowledge_base_tenant_fkey"',
    );
  });

  it('enforces the 800-token chunk bound and recoverable job/lease shapes', () => {
    expect(compactInvariantsSql).toContain(
      '"token_count" BETWEEN 1 AND 800',
    );
    expect(compactInvariantsSql).toContain(
      '"status" = \'RUNNING\' AND "locked_at" IS NOT NULL',
    );
    expect(compactInvariantsSql).toContain(
      '"status" <> \'RUNNING\' AND "locked_at" IS NULL',
    );
    expect(compactInvariantsSql).toContain(
      'CONSTRAINT "rag_jobs_document_snapshot_check"',
    );
    expect(compactInvariantsSql).toContain(
      '"type" = \'DELETE\' AND "deletion_object_key_snapshot" IS NOT NULL',
    );
    expect(compactInvariantsSql).toContain(
      '"type" IN (\'INGEST\', \'REINDEX\') AND "deletion_object_key_snapshot" IS NULL',
    );
  });

  it('stores filename and digest only inside encrypted private metadata', () => {
    expect(migrationSql).toContain('"private_metadata_ciphertext" BYTEA NOT NULL');
    expect(migrationSql).toContain('"private_metadata_nonce" BYTEA NOT NULL');
    expect(migrationSql).toContain('"private_metadata_auth_tag" BYTEA NOT NULL');
    expect(migrationSql).not.toMatch(
      /"(?:display_name|original_filename|sha256_digest)"/i,
    );
    expect(migrationSql).not.toMatch(
      /raw_(?:prompt|response|query|document|chunk)|authorization|api_key|app_token|provider_key/i,
    );
  });
});

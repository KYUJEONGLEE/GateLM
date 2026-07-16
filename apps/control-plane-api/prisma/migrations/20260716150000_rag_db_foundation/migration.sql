-- Tenant Chat RAG database foundation. This migration is additive: it enables
-- pgvector and creates tenant-scoped RAG tables without changing existing data.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "rag_knowledge_bases" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DISABLED',
  "embedding_provider" TEXT NOT NULL DEFAULT 'openai',
  "embedding_model" TEXT NOT NULL DEFAULT 'text-embedding-3-large',
  "embedding_dimensions" INTEGER NOT NULL DEFAULT 1536,
  "embedding_distance" TEXT NOT NULL DEFAULT 'cosine',
  "embedding_profile_version" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rag_knowledge_bases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rag_knowledge_bases_tenant_key" UNIQUE ("tenant_id"),
  CONSTRAINT "rag_knowledge_bases_id_tenant_key" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "rag_knowledge_bases_status_check"
    CHECK ("status" IN ('ENABLED', 'DISABLED')),
  CONSTRAINT "rag_knowledge_bases_embedding_profile_check" CHECK (
    "embedding_provider" = 'openai'
    AND "embedding_model" = 'text-embedding-3-large'
    AND "embedding_dimensions" = 1536
    AND "embedding_distance" = 'cosine'
    AND "embedding_profile_version" = 1
  ),
  CONSTRAINT "rag_knowledge_bases_revision_check" CHECK ("revision" >= 1)
);

CREATE TABLE "rag_documents" (
  "id" UUID NOT NULL,
  "public_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "knowledge_base_id" UUID NOT NULL,
  "private_metadata_ciphertext" BYTEA NOT NULL,
  "private_metadata_nonce" BYTEA NOT NULL,
  "private_metadata_auth_tag" BYTEA NOT NULL,
  "private_metadata_content_key_version" INTEGER NOT NULL,
  "private_metadata_schema_version" INTEGER NOT NULL DEFAULT 1,
  "file_extension" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "s3_object_key" TEXT NOT NULL,
  "uploaded_by_user_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UPLOADED',
  "failure_code" TEXT,
  "sanitized_failure_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rag_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rag_documents_public_id_key" UNIQUE ("public_id"),
  CONSTRAINT "rag_documents_id_tenant_key" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "rag_documents_status_check" CHECK (
    "status" IN (
      'UPLOADING', 'UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING',
      'INDEXING', 'READY', 'FAILED', 'DELETING'
    )
  ),
  CONSTRAINT "rag_documents_private_metadata_shape_check" CHECK (
    octet_length("private_metadata_ciphertext") BETWEEN 1 AND 8192
    AND octet_length("private_metadata_nonce") = 12
    AND octet_length("private_metadata_auth_tag") = 16
    AND "private_metadata_content_key_version" >= 1
    AND "private_metadata_schema_version" = 1
  ),
  CONSTRAINT "rag_documents_file_type_check" CHECK (
    ("file_extension" = 'pdf' AND "mime_type" = 'application/pdf')
    OR ("file_extension" = 'txt' AND "mime_type" = 'text/plain')
  ),
  CONSTRAINT "rag_documents_size_check"
    CHECK ("size_bytes" BETWEEN 1 AND 20971520),
  CONSTRAINT "rag_documents_object_key_check"
    CHECK (char_length("s3_object_key") BETWEEN 1 AND 1024),
  CONSTRAINT "rag_documents_failure_check" CHECK (
    (
      "failure_code" IS NULL
      OR "failure_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'
    )
    AND (
      "sanitized_failure_message" IS NULL
      OR char_length("sanitized_failure_message") BETWEEN 1 AND 512
    )
    AND ("status" <> 'FAILED' OR "failure_code" IS NOT NULL)
  )
);

CREATE TABLE "rag_document_indexes" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'BUILDING',
  "parser_version" INTEGER NOT NULL DEFAULT 1,
  "chunker_version" INTEGER NOT NULL DEFAULT 1,
  "embedding_provider" TEXT NOT NULL DEFAULT 'openai',
  "embedding_model" TEXT NOT NULL DEFAULT 'text-embedding-3-large',
  "embedding_dimensions" INTEGER NOT NULL DEFAULT 1536,
  "embedding_profile_version" INTEGER NOT NULL DEFAULT 1,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rag_document_indexes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rag_document_indexes_identity_key"
    UNIQUE ("id", "document_id", "tenant_id"),
  CONSTRAINT "rag_document_indexes_version_key"
    UNIQUE ("tenant_id", "document_id", "version"),
  CONSTRAINT "rag_document_indexes_status_check"
    CHECK ("status" IN ('BUILDING', 'ACTIVE', 'FAILED', 'RETIRED')),
  CONSTRAINT "rag_document_indexes_versions_check" CHECK (
    "version" >= 1 AND "parser_version" >= 1 AND "chunker_version" >= 1
  ),
  CONSTRAINT "rag_document_indexes_embedding_profile_check" CHECK (
    "embedding_provider" = 'openai'
    AND "embedding_model" = 'text-embedding-3-large'
    AND "embedding_dimensions" = 1536
    AND "embedding_profile_version" = 1
  ),
  CONSTRAINT "rag_document_indexes_timestamps_check" CHECK (
    "completed_at" IS NULL
    OR "started_at" IS NULL
    OR "completed_at" >= "started_at"
  )
);

CREATE TABLE "rag_chunks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "document_index_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "token_count" INTEGER NOT NULL,
  "page_start" INTEGER,
  "page_end" INTEGER,
  "line_start" INTEGER,
  "line_end" INTEGER,
  "source_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "content_ciphertext" BYTEA NOT NULL,
  "content_nonce" BYTEA NOT NULL,
  "content_auth_tag" BYTEA NOT NULL,
  "content_key_version" INTEGER NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rag_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rag_chunks_index_document_ordinal_key"
    UNIQUE ("tenant_id", "document_index_id", "document_id", "ordinal"),
  CONSTRAINT "rag_chunks_counts_check"
    CHECK ("ordinal" >= 0 AND "token_count" BETWEEN 1 AND 6000),
  CONSTRAINT "rag_chunks_page_range_check" CHECK (
    ("page_start" IS NULL AND "page_end" IS NULL)
    OR (
      "page_start" IS NOT NULL AND "page_end" IS NOT NULL
      AND "page_start" >= 1 AND "page_end" >= "page_start"
    )
  ),
  CONSTRAINT "rag_chunks_line_range_check" CHECK (
    ("line_start" IS NULL AND "line_end" IS NULL)
    OR (
      "line_start" IS NOT NULL AND "line_end" IS NOT NULL
      AND "line_start" >= 1 AND "line_end" >= "line_start"
    )
  ),
  CONSTRAINT "rag_chunks_source_metadata_check" CHECK (
    jsonb_typeof("source_metadata") = 'object'
    AND octet_length("source_metadata"::text) <= 8192
  ),
  CONSTRAINT "rag_chunks_content_shape_check" CHECK (
    octet_length("content_ciphertext") BETWEEN 1 AND 1048576
    AND octet_length("content_nonce") = 12
    AND octet_length("content_auth_tag") = 16
    AND "content_key_version" >= 1
  )
);

CREATE TABLE "rag_jobs" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "knowledge_base_id" UUID NOT NULL,
  "document_id" UUID,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "idempotency_key" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" TEXT,
  "lease_expires_at" TIMESTAMPTZ(6),
  "last_error_code" TEXT,
  "sanitized_last_error" TEXT,
  "deletion_object_key_snapshot" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rag_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rag_jobs_id_tenant_key" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "rag_jobs_idempotency_key"
    UNIQUE ("tenant_id", "type", "idempotency_key"),
  CONSTRAINT "rag_jobs_type_check"
    CHECK ("type" IN ('INGEST', 'DELETE', 'REINDEX')),
  CONSTRAINT "rag_jobs_status_check" CHECK (
    "status" IN (
      'PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED'
    )
  ),
  CONSTRAINT "rag_jobs_attempts_check" CHECK (
    "attempt_count" >= 0
    AND "max_attempts" >= 1
    AND "attempt_count" <= "max_attempts"
  ),
  CONSTRAINT "rag_jobs_idempotency_length_check"
    CHECK (char_length("idempotency_key") BETWEEN 1 AND 128),
  CONSTRAINT "rag_jobs_lock_shape_check" CHECK (
    ("locked_at" IS NULL AND "locked_by" IS NULL AND "lease_expires_at" IS NULL)
    OR (
      "locked_at" IS NOT NULL AND "locked_by" IS NOT NULL
      AND "lease_expires_at" IS NOT NULL
      AND "lease_expires_at" > "locked_at"
      AND char_length("locked_by") BETWEEN 1 AND 128
    )
  ),
  CONSTRAINT "rag_jobs_error_shape_check" CHECK (
    (
      "last_error_code" IS NULL
      OR "last_error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'
    )
    AND (
      "sanitized_last_error" IS NULL
      OR char_length("sanitized_last_error") BETWEEN 1 AND 512
    )
  ),
  CONSTRAINT "rag_jobs_delete_snapshot_check" CHECK (
    "deletion_object_key_snapshot" IS NULL
    OR char_length("deletion_object_key_snapshot") BETWEEN 1 AND 1024
  )
);

CREATE INDEX "rag_knowledge_bases_tenant_status_idx"
  ON "rag_knowledge_bases" ("tenant_id", "status");

CREATE INDEX "rag_documents_tenant_status_idx"
  ON "rag_documents" ("tenant_id", "status");
CREATE INDEX "rag_documents_tenant_knowledge_base_idx"
  ON "rag_documents" ("tenant_id", "knowledge_base_id");
CREATE INDEX "rag_documents_tenant_uploader_idx"
  ON "rag_documents" ("tenant_id", "uploaded_by_user_id");

CREATE INDEX "rag_document_indexes_tenant_status_idx"
  ON "rag_document_indexes" ("tenant_id", "status");
CREATE INDEX "rag_document_indexes_tenant_document_status_idx"
  ON "rag_document_indexes" ("tenant_id", "document_id", "status");
CREATE UNIQUE INDEX "rag_document_indexes_one_active_per_document_idx"
  ON "rag_document_indexes" ("tenant_id", "document_id")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "rag_chunks_tenant_document_idx"
  ON "rag_chunks" ("tenant_id", "document_id");
CREATE INDEX "rag_chunks_tenant_document_index_idx"
  ON "rag_chunks" ("tenant_id", "document_index_id");

CREATE INDEX "rag_jobs_claim_idx"
  ON "rag_jobs" ("status", "available_at", "lease_expires_at");
CREATE INDEX "rag_jobs_tenant_status_available_idx"
  ON "rag_jobs" ("tenant_id", "status", "available_at");
CREATE INDEX "rag_jobs_tenant_document_idx"
  ON "rag_jobs" ("tenant_id", "document_id");

ALTER TABLE "rag_knowledge_bases"
  ADD CONSTRAINT "rag_knowledge_bases_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "rag_documents"
  ADD CONSTRAINT "rag_documents_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "rag_documents"
  ADD CONSTRAINT "rag_documents_knowledge_base_tenant_fkey"
  FOREIGN KEY ("knowledge_base_id", "tenant_id")
  REFERENCES "rag_knowledge_bases"("id", "tenant_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "rag_documents"
  ADD CONSTRAINT "rag_documents_uploaded_by_user_fkey"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "rag_documents"
  ADD CONSTRAINT "rag_documents_metadata_key_fkey"
  FOREIGN KEY ("tenant_id", "private_metadata_content_key_version")
  REFERENCES "tenant_chat_content_keys"("tenant_id", "content_key_version")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "rag_document_indexes"
  ADD CONSTRAINT "rag_document_indexes_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "rag_document_indexes"
  ADD CONSTRAINT "rag_document_indexes_document_tenant_fkey"
  FOREIGN KEY ("document_id", "tenant_id")
  REFERENCES "rag_documents"("id", "tenant_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "rag_chunks"
  ADD CONSTRAINT "rag_chunks_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "rag_chunks"
  ADD CONSTRAINT "rag_chunks_document_tenant_fkey"
  FOREIGN KEY ("document_id", "tenant_id")
  REFERENCES "rag_documents"("id", "tenant_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "rag_chunks"
  ADD CONSTRAINT "rag_chunks_document_index_tenant_fkey"
  FOREIGN KEY ("document_index_id", "document_id", "tenant_id")
  REFERENCES "rag_document_indexes"("id", "document_id", "tenant_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "rag_chunks"
  ADD CONSTRAINT "rag_chunks_content_key_fkey"
  FOREIGN KEY ("tenant_id", "content_key_version")
  REFERENCES "tenant_chat_content_keys"("tenant_id", "content_key_version")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "rag_jobs"
  ADD CONSTRAINT "rag_jobs_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "rag_jobs"
  ADD CONSTRAINT "rag_jobs_knowledge_base_tenant_fkey"
  FOREIGN KEY ("knowledge_base_id", "tenant_id")
  REFERENCES "rag_knowledge_bases"("id", "tenant_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "rag_jobs"
  ADD CONSTRAINT "rag_jobs_document_tenant_fkey"
  FOREIGN KEY ("document_id", "tenant_id")
  REFERENCES "rag_documents"("id", "tenant_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMENT ON COLUMN "rag_chunks"."embedding" IS
  'OpenAI text-embedding-3-large profile v1; 1536 dimensions; cosine distance; raw SQL only';

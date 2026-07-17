-- Dedicated RAG worker foundation. This is additive: it reconciles the
-- approved extraction profile with the already-applied M2 constraint and adds
-- content-free, idempotent embedding-usage accounting.

ALTER TABLE "rag_chunks"
  DROP CONSTRAINT "rag_chunks_counts_check";
ALTER TABLE "rag_chunks"
  ADD CONSTRAINT "rag_chunks_counts_check"
  CHECK ("ordinal" >= 0 AND "token_count" BETWEEN 1 AND 900);

CREATE TABLE "rag_embedding_usages" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "purpose" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "batch_ordinal" INTEGER NOT NULL,
  "embedding_provider" TEXT NOT NULL DEFAULT 'openai',
  "embedding_model" TEXT NOT NULL DEFAULT 'text-embedding-3-large',
  "embedding_dimensions" INTEGER NOT NULL DEFAULT 1536,
  "embedding_profile_version" INTEGER NOT NULL DEFAULT 1,
  "input_count" INTEGER NOT NULL,
  "prompt_tokens" INTEGER,
  "total_tokens" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rag_embedding_usages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rag_embedding_usages_idempotency_key"
    UNIQUE ("tenant_id", "purpose", "operation_id", "batch_ordinal"),
  CONSTRAINT "rag_embedding_usages_purpose_check"
    CHECK ("purpose" IN ('RAG_INGESTION', 'RAG_QUERY')),
  CONSTRAINT "rag_embedding_usages_operation_check"
    CHECK (char_length("operation_id") BETWEEN 1 AND 128),
  CONSTRAINT "rag_embedding_usages_counts_check"
    CHECK (
      "batch_ordinal" >= 0
      AND "input_count" BETWEEN 1 AND 128
      AND ("prompt_tokens" IS NULL OR "prompt_tokens" >= 0)
      AND ("total_tokens" IS NULL OR "total_tokens" >= 0)
    ),
  CONSTRAINT "rag_embedding_usages_profile_check"
    CHECK (
      "embedding_provider" = 'openai'
      AND "embedding_model" = 'text-embedding-3-large'
      AND "embedding_dimensions" = 1536
      AND "embedding_profile_version" = 1
    )
);

CREATE INDEX "rag_embedding_usages_tenant_created_idx"
  ON "rag_embedding_usages" ("tenant_id", "created_at");

ALTER TABLE "rag_embedding_usages"
  ADD CONSTRAINT "rag_embedding_usages_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

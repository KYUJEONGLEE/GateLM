-- Harden M2 lifecycle invariants without rewriting the already-applied
-- 20260716150000 foundation migration or touching non-RAG tables/data.

-- A Knowledge Base cannot bypass document deletion orchestration. Documents
-- must be hard-deleted through their S3/job lifecycle before the KB is removed.
ALTER TABLE "rag_documents"
  DROP CONSTRAINT "rag_documents_knowledge_base_tenant_fkey";
ALTER TABLE "rag_documents"
  ADD CONSTRAINT "rag_documents_knowledge_base_tenant_fkey"
  FOREIGN KEY ("knowledge_base_id", "tenant_id")
  REFERENCES "rag_knowledge_bases"("id", "tenant_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Profile v1 defines an 800-token hard chunk bound. The separate 6,000-token
-- value is a total retrieval-context cap and is not a valid per-chunk bound.
ALTER TABLE "rag_chunks"
  DROP CONSTRAINT "rag_chunks_counts_check";
ALTER TABLE "rag_chunks"
  ADD CONSTRAINT "rag_chunks_counts_check"
  CHECK ("ordinal" >= 0 AND "token_count" BETWEEN 1 AND 800);

-- RUNNING jobs always own a complete, unexpired lease shape. Every other state
-- is unleased, so abandoned work can be found and reclaimed deterministically.
ALTER TABLE "rag_jobs"
  DROP CONSTRAINT "rag_jobs_lock_shape_check";
ALTER TABLE "rag_jobs"
  ADD CONSTRAINT "rag_jobs_lock_shape_check" CHECK (
    (
      "status" = 'RUNNING'
      AND "locked_at" IS NOT NULL
      AND "locked_by" IS NOT NULL
      AND "lease_expires_at" IS NOT NULL
      AND "lease_expires_at" > "locked_at"
      AND char_length("locked_by") BETWEEN 1 AND 128
    )
    OR (
      "status" <> 'RUNNING'
      AND "locked_at" IS NULL
      AND "locked_by" IS NULL
      AND "lease_expires_at" IS NULL
    )
  );

-- DELETE jobs always snapshot the opaque object key before they can outlive the
-- Document. Active INGEST/REINDEX jobs require a Document; terminal historical
-- jobs may be detached during hard deletion and never retain an object key.
ALTER TABLE "rag_jobs"
  ADD CONSTRAINT "rag_jobs_document_snapshot_check" CHECK (
    (
      "type" = 'DELETE'
      AND "deletion_object_key_snapshot" IS NOT NULL
    )
    OR (
      "type" IN ('INGEST', 'REINDEX')
      AND "deletion_object_key_snapshot" IS NULL
      AND (
        "document_id" IS NOT NULL
        OR "status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
      )
    )
  );

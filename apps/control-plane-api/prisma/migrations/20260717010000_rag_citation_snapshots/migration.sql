ALTER TABLE "tenant_chat_messages"
  ADD COLUMN "citation_ciphertext" BYTEA,
  ADD COLUMN "citation_nonce" BYTEA,
  ADD COLUMN "citation_tag" BYTEA,
  ADD COLUMN "citation_content_key_version" INTEGER,
  ADD COLUMN "citation_schema_version" INTEGER;

ALTER TABLE "tenant_chat_messages"
  ADD CONSTRAINT "tenant_chat_messages_citation_shape_check" CHECK (
    ("citation_ciphertext" IS NULL AND "citation_nonce" IS NULL AND "citation_tag" IS NULL
      AND "citation_content_key_version" IS NULL AND "citation_schema_version" IS NULL)
    OR
    ("citation_ciphertext" IS NOT NULL AND "citation_nonce" IS NOT NULL AND "citation_tag" IS NOT NULL
      AND "citation_content_key_version" IS NOT NULL AND "citation_schema_version" = 1)
  );

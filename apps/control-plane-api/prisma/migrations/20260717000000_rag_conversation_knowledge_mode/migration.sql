-- Conversation-scoped RAG selection is server-persisted. Existing Tenant Chat
-- conversations intentionally remain ordinary chat after this additive change.
ALTER TABLE "tenant_chat_conversations"
  ADD COLUMN "knowledge_mode" TEXT NOT NULL DEFAULT 'off',
  ADD CONSTRAINT "tenant_chat_conversations_knowledge_mode_check"
    CHECK ("knowledge_mode" IN ('off', 'tenant'));

CREATE INDEX "tenant_chat_conversations_tenant_knowledge_mode_idx"
  ON "tenant_chat_conversations" ("tenant_id", "knowledge_mode");

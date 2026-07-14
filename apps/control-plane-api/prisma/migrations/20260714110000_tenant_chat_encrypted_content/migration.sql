CREATE TABLE "tenant_chat_content_key_states" (
  "tenant_id" UUID NOT NULL,
  "active_content_key_version" INTEGER NOT NULL DEFAULT 1,
  "wrapping_key_rollback_floor" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_chat_content_key_states_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "tenant_chat_content_key_state_versions_check" CHECK (
    "active_content_key_version" >= 1 AND "wrapping_key_rollback_floor" >= 1
  )
);

CREATE TABLE "tenant_chat_content_keys" (
  "tenant_id" UUID NOT NULL,
  "content_key_version" INTEGER NOT NULL,
  "wrapping_key_version" INTEGER NOT NULL,
  "algorithm" TEXT NOT NULL DEFAULT 'A256GCM',
  "wrapped_key" BYTEA NOT NULL,
  "wrap_nonce" BYTEA NOT NULL,
  "wrap_tag" BYTEA NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rewrapped_at" TIMESTAMPTZ(6),
  "retired_at" TIMESTAMPTZ(6),
  CONSTRAINT "tenant_chat_content_keys_pkey" PRIMARY KEY ("tenant_id", "content_key_version"),
  CONSTRAINT "tenant_chat_content_key_versions_check" CHECK (
    "content_key_version" >= 1 AND "wrapping_key_version" >= 1
  ),
  CONSTRAINT "tenant_chat_content_key_algorithm_check" CHECK ("algorithm" = 'A256GCM'),
  CONSTRAINT "tenant_chat_content_key_status_check" CHECK ("status" IN ('active', 'grace', 'retired')),
  CONSTRAINT "tenant_chat_content_key_shape_check" CHECK (
    octet_length("wrapped_key") = 32 AND octet_length("wrap_nonce") = 12 AND octet_length("wrap_tag") = 16
  )
);

CREATE TABLE "tenant_chat_conversations" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "create_idempotency_key" TEXT NOT NULL,
  "creation_binding_mac" TEXT NOT NULL,
  "creation_binding_key_version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 1,
  "cache_epoch" BIGINT NOT NULL DEFAULT 1,
  "next_message_sequence" BIGINT NOT NULL DEFAULT 1,
  "history_retention_days" INTEGER NOT NULL DEFAULT 30,
  "title_ciphertext" BYTEA,
  "title_nonce" BYTEA,
  "title_tag" BYTEA,
  "title_content_key_version" INTEGER,
  "title_schema_version" INTEGER,
  "expires_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_chat_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_chat_conversation_actor_identity_key" UNIQUE ("id", "tenant_id", "user_id"),
  CONSTRAINT "tenant_chat_conversation_create_idempotency_key" UNIQUE ("tenant_id", "user_id", "create_idempotency_key"),
  CONSTRAINT "tenant_chat_conversation_status_check" CHECK ("status" IN ('active', 'deleted')),
  CONSTRAINT "tenant_chat_conversation_versions_check" CHECK (
    "version" >= 1 AND "cache_epoch" >= 1 AND "next_message_sequence" >= 1
  ),
  CONSTRAINT "tenant_chat_conversation_retention_check" CHECK ("history_retention_days" IN (0, 7, 30, 90)),
  CONSTRAINT "tenant_chat_conversation_creation_mac_check" CHECK (
    "creation_binding_mac" ~ '^hmac-sha256:[A-Za-z0-9_-]{43}$' AND "creation_binding_key_version" >= 1
  ),
  CONSTRAINT "tenant_chat_conversation_title_shape_check" CHECK (
    (
      "status" = 'active' AND "title_ciphertext" IS NOT NULL AND "title_nonce" IS NOT NULL AND
      "title_tag" IS NOT NULL AND "title_content_key_version" IS NOT NULL AND "title_schema_version" = 1 AND
      octet_length("title_ciphertext") BETWEEN 1 AND 1024 AND octet_length("title_nonce") = 12 AND
      octet_length("title_tag") = 16
    ) OR (
      "status" = 'deleted' AND "title_ciphertext" IS NULL AND "title_nonce" IS NULL AND "title_tag" IS NULL AND
      "title_content_key_version" IS NULL AND "title_schema_version" IS NULL AND "deleted_at" IS NOT NULL
    )
  )
);

CREATE INDEX "tenant_chat_conversation_actor_updated_idx"
  ON "tenant_chat_conversations"("tenant_id", "user_id", "updated_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;
CREATE INDEX "tenant_chat_conversation_retention_idx"
  ON "tenant_chat_conversations"("expires_at", "id")
  WHERE "deleted_at" IS NULL AND "expires_at" IS NOT NULL;

CREATE TABLE "tenant_chat_turns" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "request_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_binding_mac" TEXT NOT NULL,
  "request_binding_key_version" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending_admission',
  "captured_cache_epoch" BIGINT NOT NULL,
  "actor_kind" TEXT,
  "employee_id" UUID,
  "actor_authz_version" INTEGER,
  "tenant_authz_version" INTEGER,
  "session_version" INTEGER,
  "snapshot_version" BIGINT,
  "snapshot_digest" TEXT,
  "policy_version" BIGINT,
  "employee_notice_version" BIGINT,
  "pricing_version" BIGINT,
  "admission_id" UUID,
  "admission_expires_at" TIMESTAMPTZ(6),
  "safe_error_code" TEXT,
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_chat_turns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_chat_turn_request_id_key" UNIQUE ("request_id"),
  CONSTRAINT "tenant_chat_turn_actor_identity_key" UNIQUE ("id", "conversation_id", "tenant_id", "user_id"),
  CONSTRAINT "tenant_chat_turn_idempotency_key" UNIQUE ("tenant_id", "user_id", "idempotency_key"),
  CONSTRAINT "tenant_chat_turn_request_mac_check" CHECK (
    "request_binding_mac" ~ '^hmac-sha256:[A-Za-z0-9_-]{43}$' AND "request_binding_key_version" >= 1
  ),
  CONSTRAINT "tenant_chat_turn_state_check" CHECK (
    "state" IN ('pending_admission', 'user_persisted', 'streaming', 'completed', 'failed', 'cancelled', 'deleted')
  ),
  CONSTRAINT "tenant_chat_turn_cache_epoch_check" CHECK ("captured_cache_epoch" >= 1),
  CONSTRAINT "tenant_chat_turn_id_lengths_check" CHECK (
    char_length("request_id") BETWEEN 1 AND 128 AND char_length("idempotency_key") BETWEEN 1 AND 128
  )
);

CREATE INDEX "tenant_chat_turn_conversation_created_idx"
  ON "tenant_chat_turns"("tenant_id", "user_id", "conversation_id", "created_at" DESC);
CREATE INDEX "tenant_chat_turn_active_idx"
  ON "tenant_chat_turns"("tenant_id", "user_id", "conversation_id", "state")
  WHERE "state" IN ('pending_admission', 'user_persisted', 'streaming');

CREATE TABLE "tenant_chat_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "turn_id" UUID NOT NULL,
  "request_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "sequence" BIGINT NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "nonce" BYTEA NOT NULL,
  "tag" BYTEA NOT NULL,
  "content_key_version" INTEGER NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_chat_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_chat_message_conversation_sequence_key" UNIQUE ("conversation_id", "sequence"),
  CONSTRAINT "tenant_chat_message_turn_role_key" UNIQUE ("turn_id", "role"),
  CONSTRAINT "tenant_chat_message_role_check" CHECK ("role" IN ('user', 'assistant')),
  CONSTRAINT "tenant_chat_message_shape_check" CHECK (
    "sequence" >= 1 AND "schema_version" = 1 AND octet_length("ciphertext") BETWEEN 1 AND 1048576 AND
    octet_length("nonce") = 12 AND octet_length("tag") = 16
  )
);

CREATE INDEX "tenant_chat_message_history_idx"
  ON "tenant_chat_messages"("tenant_id", "user_id", "conversation_id", "sequence");
CREATE INDEX "tenant_chat_message_expiry_idx"
  ON "tenant_chat_messages"("expires_at", "id")
  WHERE "expires_at" IS NOT NULL;

ALTER TABLE "tenant_chat_content_key_states" ADD CONSTRAINT "tenant_chat_content_key_states_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_content_keys" ADD CONSTRAINT "tenant_chat_content_keys_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_conversations" ADD CONSTRAINT "tenant_chat_conversations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_conversations" ADD CONSTRAINT "tenant_chat_conversations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_conversations" ADD CONSTRAINT "tenant_chat_conversation_title_key_fkey"
  FOREIGN KEY ("tenant_id", "title_content_key_version") REFERENCES "tenant_chat_content_keys"("tenant_id", "content_key_version") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_turns" ADD CONSTRAINT "tenant_chat_turns_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_turns" ADD CONSTRAINT "tenant_chat_turns_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_turns" ADD CONSTRAINT "tenant_chat_turn_conversation_fkey"
  FOREIGN KEY ("conversation_id", "tenant_id", "user_id") REFERENCES "tenant_chat_conversations"("id", "tenant_id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_messages" ADD CONSTRAINT "tenant_chat_messages_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_messages" ADD CONSTRAINT "tenant_chat_messages_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_messages" ADD CONSTRAINT "tenant_chat_message_conversation_fkey"
  FOREIGN KEY ("conversation_id", "tenant_id", "user_id") REFERENCES "tenant_chat_conversations"("id", "tenant_id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_messages" ADD CONSTRAINT "tenant_chat_message_turn_fkey"
  FOREIGN KEY ("turn_id", "conversation_id", "tenant_id", "user_id") REFERENCES "tenant_chat_turns"("id", "conversation_id", "tenant_id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "tenant_chat_messages" ADD CONSTRAINT "tenant_chat_message_content_key_fkey"
  FOREIGN KEY ("tenant_id", "content_key_version") REFERENCES "tenant_chat_content_keys"("tenant_id", "content_key_version") ON DELETE RESTRICT ON UPDATE NO ACTION;

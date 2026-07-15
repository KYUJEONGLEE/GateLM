ALTER TABLE "tenant_chat_messages"
ADD COLUMN "effective_model_key" TEXT;

ALTER TABLE "tenant_chat_messages"
ADD CONSTRAINT "tenant_chat_message_effective_model_key_check"
CHECK (
  "effective_model_key" IS NULL OR (
    "role" = 'assistant' AND
    "effective_model_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
  )
);

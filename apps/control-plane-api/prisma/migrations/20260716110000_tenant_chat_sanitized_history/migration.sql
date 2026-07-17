ALTER TABLE "tenant_chat_messages"
  ADD COLUMN "safety_status" text NOT NULL DEFAULT 'legacy_unverified',
  ADD COLUMN "safety_policy_digest" text;

UPDATE "tenant_chat_messages"
SET "safety_status" = 'provider_generated'
WHERE "role" = 'assistant';

ALTER TABLE "tenant_chat_messages"
  DROP CONSTRAINT "tenant_chat_message_shape_check";

ALTER TABLE "tenant_chat_messages"
  ADD CONSTRAINT "tenant_chat_message_shape_check" CHECK (
    sequence >= 1 AND schema_version IN (1, 2) AND
    octet_length(ciphertext) BETWEEN 1 AND 1048576 AND
    octet_length(nonce) = 12 AND octet_length(tag) = 16
  ),
  ADD CONSTRAINT "tenant_chat_message_safety_check" CHECK (
    (
      schema_version = 1 AND
      (
        (role = 'user' AND safety_status = 'legacy_unverified' AND safety_policy_digest IS NULL) OR
        (role = 'assistant' AND safety_status = 'provider_generated' AND safety_policy_digest IS NULL)
      )
    ) OR
    (
      schema_version = 2 AND
      (
        (
          role = 'user' AND safety_status = 'sanitized' AND
          safety_policy_digest ~ '^sha256:[A-Za-z0-9_-]{43}$'
        ) OR
        (role = 'assistant' AND safety_status = 'provider_generated' AND safety_policy_digest IS NULL)
      )
    )
  );

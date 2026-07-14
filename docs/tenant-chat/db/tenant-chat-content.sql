-- Active Tenant Chat content storage contract. This is not the applied migration.
-- The implementation migration must preserve these names, constraints, and ciphertext-only semantics.

CREATE TABLE tenant_chat_content_key_states (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  active_content_key_version integer NOT NULL DEFAULT 1,
  wrapping_key_rollback_floor integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_chat_content_key_state_versions_check CHECK (
    active_content_key_version >= 1 AND wrapping_key_rollback_floor >= 1
  )
);

CREATE TABLE tenant_chat_content_keys (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  content_key_version integer NOT NULL,
  wrapping_key_version integer NOT NULL,
  algorithm text NOT NULL DEFAULT 'A256GCM',
  wrapped_key bytea NOT NULL,
  wrap_nonce bytea NOT NULL,
  wrap_tag bytea NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  rewrapped_at timestamptz,
  retired_at timestamptz,
  PRIMARY KEY (tenant_id, content_key_version),
  CONSTRAINT tenant_chat_content_key_versions_check CHECK (
    content_key_version >= 1 AND wrapping_key_version >= 1
  ),
  CONSTRAINT tenant_chat_content_key_algorithm_check CHECK (algorithm = 'A256GCM'),
  CONSTRAINT tenant_chat_content_key_status_check CHECK (status IN ('active', 'grace', 'retired')),
  CONSTRAINT tenant_chat_content_key_shape_check CHECK (
    octet_length(wrapped_key) = 32 AND octet_length(wrap_nonce) = 12 AND octet_length(wrap_tag) = 16
  )
);

CREATE TABLE tenant_chat_conversations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  create_idempotency_key text NOT NULL,
  creation_binding_mac text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  cache_epoch bigint NOT NULL DEFAULT 1,
  next_message_sequence bigint NOT NULL DEFAULT 1,
  history_retention_days integer NOT NULL DEFAULT 30,
  title_ciphertext bytea,
  title_nonce bytea,
  title_tag bytea,
  title_content_key_version integer,
  title_schema_version integer,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_chat_conversation_actor_identity_key UNIQUE (id, tenant_id, user_id),
  CONSTRAINT tenant_chat_conversation_create_idempotency_key UNIQUE (tenant_id, user_id, create_idempotency_key),
  CONSTRAINT tenant_chat_conversation_status_check CHECK (status IN ('active', 'deleted')),
  CONSTRAINT tenant_chat_conversation_versions_check CHECK (
    version >= 1 AND cache_epoch >= 1 AND next_message_sequence >= 1
  ),
  CONSTRAINT tenant_chat_conversation_retention_check CHECK (history_retention_days IN (0, 7, 30, 90)),
  CONSTRAINT tenant_chat_conversation_creation_mac_check CHECK (
    creation_binding_mac ~ '^hmac-sha256:[A-Za-z0-9_-]{43}$'
  ),
  CONSTRAINT tenant_chat_conversation_title_shape_check CHECK (
    (
      status = 'active' AND title_ciphertext IS NOT NULL AND title_nonce IS NOT NULL AND
      title_tag IS NOT NULL AND title_content_key_version IS NOT NULL AND title_schema_version = 1 AND
      octet_length(title_ciphertext) BETWEEN 1 AND 1024 AND octet_length(title_nonce) = 12 AND
      octet_length(title_tag) = 16
    ) OR (
      status = 'deleted' AND title_ciphertext IS NULL AND title_nonce IS NULL AND title_tag IS NULL AND
      title_content_key_version IS NULL AND title_schema_version IS NULL AND deleted_at IS NOT NULL
    )
  ),
  CONSTRAINT tenant_chat_conversation_title_key_fkey FOREIGN KEY (tenant_id, title_content_key_version)
    REFERENCES tenant_chat_content_keys(tenant_id, content_key_version) ON DELETE RESTRICT
);

CREATE INDEX tenant_chat_conversation_actor_updated_idx
  ON tenant_chat_conversations(tenant_id, user_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX tenant_chat_conversation_retention_idx
  ON tenant_chat_conversations(expires_at, id)
  WHERE deleted_at IS NULL AND expires_at IS NOT NULL;

CREATE TABLE tenant_chat_turns (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  request_id text NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  request_binding_mac text NOT NULL,
  state text NOT NULL DEFAULT 'pending_admission',
  captured_cache_epoch bigint NOT NULL,
  actor_kind text,
  employee_id uuid,
  actor_authz_version integer,
  tenant_authz_version integer,
  session_version integer,
  snapshot_version bigint,
  snapshot_digest text,
  policy_version bigint,
  employee_notice_version bigint,
  pricing_version bigint,
  admission_id uuid,
  admission_expires_at timestamptz,
  safe_error_code text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_chat_turn_actor_identity_key UNIQUE (id, conversation_id, tenant_id, user_id),
  CONSTRAINT tenant_chat_turn_idempotency_key UNIQUE (tenant_id, user_id, idempotency_key),
  CONSTRAINT tenant_chat_turn_conversation_fkey FOREIGN KEY (conversation_id, tenant_id, user_id)
    REFERENCES tenant_chat_conversations(id, tenant_id, user_id) ON DELETE CASCADE,
  CONSTRAINT tenant_chat_turn_request_mac_check CHECK (
    request_binding_mac ~ '^hmac-sha256:[A-Za-z0-9_-]{43}$'
  ),
  CONSTRAINT tenant_chat_turn_state_check CHECK (
    state IN ('pending_admission', 'user_persisted', 'streaming', 'completed', 'failed', 'cancelled', 'deleted')
  ),
  CONSTRAINT tenant_chat_turn_cache_epoch_check CHECK (captured_cache_epoch >= 1),
  CONSTRAINT tenant_chat_turn_id_lengths_check CHECK (
    char_length(request_id) BETWEEN 1 AND 128 AND char_length(idempotency_key) BETWEEN 1 AND 128
  )
);

CREATE INDEX tenant_chat_turn_conversation_created_idx
  ON tenant_chat_turns(tenant_id, user_id, conversation_id, created_at DESC);
CREATE INDEX tenant_chat_turn_active_idx
  ON tenant_chat_turns(tenant_id, user_id, conversation_id, state)
  WHERE state IN ('pending_admission', 'user_persisted', 'streaming');

CREATE TABLE tenant_chat_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  turn_id uuid NOT NULL,
  request_id text NOT NULL,
  role text NOT NULL,
  sequence bigint NOT NULL,
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  tag bytea NOT NULL,
  content_key_version integer NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_chat_message_conversation_sequence_key UNIQUE (conversation_id, sequence),
  CONSTRAINT tenant_chat_message_turn_role_key UNIQUE (turn_id, role),
  CONSTRAINT tenant_chat_message_conversation_fkey FOREIGN KEY (conversation_id, tenant_id, user_id)
    REFERENCES tenant_chat_conversations(id, tenant_id, user_id) ON DELETE CASCADE,
  CONSTRAINT tenant_chat_message_turn_fkey FOREIGN KEY (turn_id, conversation_id, tenant_id, user_id)
    REFERENCES tenant_chat_turns(id, conversation_id, tenant_id, user_id) ON DELETE CASCADE,
  CONSTRAINT tenant_chat_message_content_key_fkey FOREIGN KEY (tenant_id, content_key_version)
    REFERENCES tenant_chat_content_keys(tenant_id, content_key_version) ON DELETE RESTRICT,
  CONSTRAINT tenant_chat_message_role_check CHECK (role IN ('user', 'assistant')),
  CONSTRAINT tenant_chat_message_shape_check CHECK (
    sequence >= 1 AND schema_version = 1 AND octet_length(ciphertext) BETWEEN 1 AND 1048576 AND
    octet_length(nonce) = 12 AND octet_length(tag) = 16
  )
);

CREATE INDEX tenant_chat_message_history_idx
  ON tenant_chat_messages(tenant_id, user_id, conversation_id, sequence);
CREATE INDEX tenant_chat_message_expiry_idx
  ON tenant_chat_messages(expires_at, id)
  WHERE expires_at IS NOT NULL;

-- Runtime Chat API roles receive only SELECT/INSERT/UPDATE/DELETE on these five tables.
-- No table contains title/message plaintext, provider raw errors, credentials, or Authorization values.

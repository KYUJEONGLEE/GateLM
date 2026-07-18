ALTER TABLE tenant_chat_request_admissions
  ADD COLUMN masking_action text,
  ADD COLUMN masking_detected_types jsonb,
  ADD COLUMN masking_detected_count integer,
  ADD COLUMN safety_policy_digest text;

ALTER TABLE tenant_chat_request_admissions
  ADD CONSTRAINT tenant_chat_admission_safety_summary_check CHECK (
    (
      masking_action IS NULL
      AND masking_detected_types IS NULL
      AND masking_detected_count IS NULL
      AND safety_policy_digest IS NULL
    ) OR (
      masking_action IN ('none', 'redacted', 'blocked')
      AND jsonb_typeof(masking_detected_types) = 'array'
      AND jsonb_array_length(masking_detected_types) <= 32
      AND masking_detected_count BETWEEN 0 AND 1000000
      AND safety_policy_digest ~ '^sha256:[A-Za-z0-9_-]{43}$'
    )
  );

ALTER TABLE tenant_chat_invocation_logs
  ADD COLUMN masking_detected_types jsonb,
  ADD COLUMN masking_detected_count integer,
  ADD COLUMN safety_policy_digest text;

ALTER TABLE tenant_chat_invocation_logs
  ADD CONSTRAINT tenant_chat_log_safety_summary_check CHECK (
    (
      masking_detected_types IS NULL
      AND masking_detected_count IS NULL
      AND safety_policy_digest IS NULL
      AND (masking_action IS NULL OR masking_action IN ('none', 'redacted', 'blocked'))
    ) OR (
      masking_action IN ('none', 'redacted', 'blocked')
      AND jsonb_typeof(masking_detected_types) = 'array'
      AND jsonb_array_length(masking_detected_types) <= 32
      AND masking_detected_count BETWEEN 0 AND 1000000
      AND safety_policy_digest ~ '^sha256:[A-Za-z0-9_-]{43}$'
    )
  );

CREATE INDEX tenant_chat_log_security_coverage_idx
  ON tenant_chat_invocation_logs (tenant_id, completed_at)
  WHERE safety_policy_digest IS NOT NULL;

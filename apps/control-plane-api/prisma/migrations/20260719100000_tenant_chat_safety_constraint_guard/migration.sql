ALTER TABLE tenant_chat_request_admissions
  ADD CONSTRAINT tenant_chat_admission_safety_summary_guard_check CHECK (
    (
      masking_action IS NULL
      AND masking_detected_types IS NULL
      AND masking_detected_count IS NULL
      AND safety_policy_digest IS NULL
    ) OR (
      masking_action IN ('none', 'redacted', 'blocked')
      AND jsonb_typeof(masking_detected_types) = 'array'
      AND CASE
        WHEN jsonb_typeof(masking_detected_types) = 'array'
          THEN jsonb_array_length(masking_detected_types) <= 32
        ELSE false
      END
      AND masking_detected_count BETWEEN 0 AND 1000000
      AND safety_policy_digest ~ '^sha256:[A-Za-z0-9_-]{43}$'
    )
  ) NOT VALID;

ALTER TABLE tenant_chat_request_admissions
  VALIDATE CONSTRAINT tenant_chat_admission_safety_summary_guard_check;

ALTER TABLE tenant_chat_request_admissions
  DROP CONSTRAINT tenant_chat_admission_safety_summary_check;

ALTER TABLE tenant_chat_request_admissions
  RENAME CONSTRAINT tenant_chat_admission_safety_summary_guard_check
  TO tenant_chat_admission_safety_summary_check;

ALTER TABLE tenant_chat_invocation_logs
  ADD CONSTRAINT tenant_chat_log_safety_summary_guard_check CHECK (
    (
      masking_detected_types IS NULL
      AND masking_detected_count IS NULL
      AND safety_policy_digest IS NULL
      AND (masking_action IS NULL OR masking_action IN ('none', 'redacted', 'blocked'))
    ) OR (
      masking_action IN ('none', 'redacted', 'blocked')
      AND jsonb_typeof(masking_detected_types) = 'array'
      AND CASE
        WHEN jsonb_typeof(masking_detected_types) = 'array'
          THEN jsonb_array_length(masking_detected_types) <= 32
        ELSE false
      END
      AND masking_detected_count BETWEEN 0 AND 1000000
      AND safety_policy_digest ~ '^sha256:[A-Za-z0-9_-]{43}$'
    )
  ) NOT VALID;

ALTER TABLE tenant_chat_invocation_logs
  VALIDATE CONSTRAINT tenant_chat_log_safety_summary_guard_check;

ALTER TABLE tenant_chat_invocation_logs
  DROP CONSTRAINT tenant_chat_log_safety_summary_check;

ALTER TABLE tenant_chat_invocation_logs
  RENAME CONSTRAINT tenant_chat_log_safety_summary_guard_check
  TO tenant_chat_log_safety_summary_check;

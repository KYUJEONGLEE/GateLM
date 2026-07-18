ALTER TABLE tenant_chat_usage_reservations
  ADD COLUMN routing_difficulty text,
  ADD CONSTRAINT tenant_chat_reservation_routing_difficulty_check
    CHECK (routing_difficulty IS NULL OR routing_difficulty IN ('simple', 'complex'));

ALTER TABLE tenant_chat_invocation_logs
  ADD COLUMN routing_difficulty text,
  ADD CONSTRAINT tenant_chat_log_routing_difficulty_check
    CHECK (routing_difficulty IS NULL OR routing_difficulty IN ('simple', 'complex'));

CREATE INDEX tenant_chat_log_routing_difficulty_idx
  ON tenant_chat_invocation_logs (tenant_id, completed_at DESC, routing_difficulty);

-- Historical requests intentionally remain NULL. A provider/model or legacy route
-- tier does not prove which simple/complex matrix cell selected the request.

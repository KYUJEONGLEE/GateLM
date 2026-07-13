ALTER TABLE tenant_chat_usage_reservations
  ADD COLUMN usage_pending_at timestamptz NULL;

CREATE INDEX tenant_chat_reservation_usage_pending_idx
  ON tenant_chat_usage_reservations (usage_pending_at, reservation_id)
  WHERE state = 'reserved' AND usage_pending_at IS NOT NULL;

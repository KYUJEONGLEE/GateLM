-- Non-destructive retention update for system log tables created before the
-- config.d policy was installed. Expired rows are reclaimed by normal merges;
-- no forced OPTIMIZE or TRUNCATE is performed here.

ALTER TABLE system.query_log
    MODIFY TTL event_date + INTERVAL 7 DAY DELETE;

ALTER TABLE system.text_log
    MODIFY TTL event_date + INTERVAL 3 DAY DELETE;

ALTER TABLE system.metric_log
    MODIFY TTL event_date + INTERVAL 7 DAY DELETE;

ALTER TABLE system.trace_log
    MODIFY TTL event_date + INTERVAL 1 DAY DELETE;

ALTER TABLE system.processors_profile_log
    MODIFY TTL event_date + INTERVAL 1 DAY DELETE;

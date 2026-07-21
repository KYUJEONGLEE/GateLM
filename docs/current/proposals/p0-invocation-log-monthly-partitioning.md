# P0 Invocation Log Monthly Partitioning Proposal

| Field | Value |
|---|---|
| Status | Proposal |
| Applies to | `p0_llm_invocation_logs` physical storage and deployment migration |
| Development baseline | `origin/dev` |
| Partition key | UTC `created_at` |
| Partition grain | Calendar month |

## 1. Problem

`p0_llm_invocation_logs` is an append-mostly PostgreSQL table shared by Request Log,
Dashboard Rollup discovery, and Analytics readers. A sustained production Mock run
demonstrated that request completion does not prove the capacity of the asynchronous
Dashboard path: raw scans and bucket rebuilds can continue to consume the shared Data
host after the request stage has finished.

The table currently has tenant/time indexes but remains one physical heap. As retained
history grows, index locality, vacuum work, retention deletion, and bounded historical
scans all continue to share that heap.

## 2. Decision

The target physical table is declaratively range-partitioned by `created_at` with UTC
calendar-month bounds. Partition names use `p0_llm_invocation_logs_yYYYYmMM`.

This is a storage and operations change. It does not change Request Log API fields,
terminal outcome semantics, tenant/project scope, billing data, or raw-data security
rules.

Partition pruning is expected only when a reader carries compatible `created_at`
predicates. Partitioning does not replace Dashboard or policy-impact Rollups and must
not be presented as proof of lower endpoint latency until measured on the target data.

## 3. Global Idempotency

PostgreSQL requires every `PRIMARY KEY` or `UNIQUE` constraint on a partitioned table
to include the partition key. The current writer depends on global
`UNIQUE (request_id)`, so replacing it with only
`UNIQUE (request_id, created_at)` would allow one request ID in multiple months.

The migration therefore introduces `p0_llm_invocation_log_keys` as the global identity
registry:

- `request_id` is the primary key;
- `log_id` is globally unique;
- `created_at` records the immutable partition route;
- claiming the key and inserting the log row occur in one PostgreSQL transaction;
- a duplicate `request_id` remains a no-op, including at a month boundary.

The partitioned table retains local composite uniqueness for
`(request_id, created_at)` and `(id, created_at)`.

## 4. Partition Lifecycle

- Migration creates a partition for every retained source month.
- The current and next calendar month are provisioned before cutover.
- A default partition is retained as a fail-safe for an unexpected timestamp.
- Scheduled maintenance creates future partitions before the month begins. It refuses
  to attach a month when matching rows are already in the default partition, so those
  rows require a separately controlled recovery first.
- Retention is performed only by an explicit, separately approved detach/drop
  operation. This proposal does not delete raw logs or set a retention period.

All bounds and partition routing use UTC. Application-local time zones do not affect
the physical partition.

## 5. Two-Stage Rollout

Production deploys the Data role before replacing the two Gateway roles. A one-release
table swap would therefore expose the new partitioned table to an older writer that
still names `ON CONFLICT (request_id)` and would fail.

### Stage A: compatibility preparation

1. Create and backfill the global key registry.
2. Capture keys for concurrent legacy-table inserts.
3. Change writers to target-less `ON CONFLICT DO NOTHING`, which works with both the
   legacy and partitioned physical constraints.
4. Verify registry parity and deploy both Gateway replicas.

### Stage B: controlled cutover

1. Create the shadow partitioned parent, retained monthly children, and indexes.
2. Mirror concurrent legacy inserts while copying historical rows.
3. Compare row count, request-ID count, key registry parity, and bounded checksums.
4. Acquire a short final table lock, apply the remaining delta, and swap relation names.
5. Verify writer idempotency, month-boundary routing, partition pruning, Rollup
   discovery, Analytics, and Request Detail reads.

Stage B must not run until every active Gateway uses the Stage A-compatible writer.

## 6. Rollback Boundary

Before cutover, rollback is dropping the shadow structure after parity evidence is
preserved. After the relation-name swap, the legacy heap remains intact under a backup
name until smoke tests and an observation window pass. Application rollback is allowed
only while its writer remains compatible with target-less conflict handling.

Database migrations are not automatically reversed by the production CD workflow.
Any destructive removal of the legacy heap or old partitions requires separate user
approval and a verified backup.

## 7. Security And Cardinality

- No prompt, response, detected value, credential, authorization header, Provider raw
  error, hash, employee ID, or other new payload is added.
- The key registry stores only existing internal request identity and routing fields.
- Tenant predicates remain inside readers; partitioning is not a tenant isolation
  boundary.
- Partition names contain only UTC year and month.

## 8. Acceptance

1. Existing rows and distinct `request_id` counts are unchanged after cutover.
2. The same `request_id` submitted concurrently or across adjacent months produces one
   logical log row.
3. Current-month and next-month inserts route to their expected child partitions.
4. A bounded time query shows partition pruning in `EXPLAIN`.
5. Existing Gateway writer, Request Log, Dashboard Rollup, Analytics, and employee-usage
   tests pass.
6. Migration retry is idempotent and a failed cutover leaves the legacy heap readable.
7. Production claims cite measured query latency, DB CPU, migration duration, and disk
   amplification rather than the presence of partitions alone.

## 9. Evidence

- [PostgreSQL monthly partition cutover smoke, 2026-07-21](../../../reports/perf/postgresql-monthly-partition-cutover-smoke-20260721.ko.md)

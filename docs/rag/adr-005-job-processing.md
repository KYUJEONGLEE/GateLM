# ADR-005: PostgreSQL-backed dedicated RAG worker

Status: **Accepted / M2 job schema applied / worker runtime contract pending**

Date: 2026-07-16

## Context

RAG ingestion and deletion span PostgreSQL, S3, AI extraction, Gateway embeddings, and tenant encryption. They cannot be one atomic distributed transaction and may outlive an HTTP request. The repository has Redis but no robust reusable Redis queue/BullMQ implementation. Existing `FOR UPDATE SKIP LOCKED` pollers demonstrate a PostgreSQL pattern, while `apps/worker` is only an empty scaffold.

## Decision

Use `RagJob` as the approved durable PostgreSQL work queue and run a dedicated Control Plane worker process from the `apps/control-plane-api` codebase. Redis/BullMQ and the empty generic worker scaffold are not alternate MVP modes.

### Runtime

- Proposed entry point: `apps/control-plane-api/src/rag-worker.ts`.
- Proposed module: `RagWorkerModule` imports only config, Prisma, object storage, tenant crypto adapter, internal AI/Gateway clients, and job orchestration.
- It runs as a distinct process/container with its own health/readiness and graceful shutdown.
- The Control Plane HTTP API only creates jobs and reports state; it never performs ingestion/deletion loops.

### Job record

Every job has `tenantId`, Knowledge Base/nullable Document references, `type`, `status`, unique idempotency key, attempts/max attempts, `availableAt`, lease timestamps/owner, safe failure fields, a type-constrained deletion object-key snapshot, and timestamps. DELETE requires that snapshot at creation; INGEST/REINDEX forbid it. RUNNING requires a complete valid lease triple, while every non-RUNNING state requires all lease fields to be null.

MVP types:

- `INGEST`
- `DELETE`
- `REINDEX`

States:

- `PENDING`
- `RUNNING`
- `RETRY_WAIT`
- `SUCCEEDED`
- `FAILED`
- `CANCELLED`

### Leasing

1. In a short transaction, select eligible jobs ordered by availability/creation with `FOR UPDATE SKIP LOCKED` and a bounded batch.
2. Mark claimed jobs RUNNING, increment attempt, set the complete `lockedAt`/`lockedBy`/`leaseExpiresAt` lease triple, and commit.
3. Perform S3/HTTP/crypto work outside the lease transaction.
4. Heartbeat only at bounded stage boundaries; an expired RUNNING lease becomes retryable.
5. Before every side effect, re-read tenant-scoped job/document state and ensure deletion has not superseded ingestion.

No raw text or provider/library error is written into the job row. Only a stable code and low-cardinality stage are recorded.

### Retry classification

Retryable with exponential backoff, jitter, and bounded attempts:

- S3/network timeout or throttling;
- internal service timeout/temporary unavailable;
- OpenAI transient/rate-limit mapped by Gateway;
- transient PostgreSQL conflict/deadlock;
- worker loss/lease expiry.

Terminal:

- unsupported type;
- invalid/malformed UTF-8;
- encrypted PDF;
- scanned/image-only PDF or no extractable text;
- configured size/page/chunk limit exceeded;
- deterministic dimension/profile mismatch;
- tenant/key state that policy declares permanently unavailable.

### Idempotent ingestion

- A server-keyed opaque value derived in memory from the decrypted upload digest plus document/index/profile version forms idempotency material; the plaintext digest is not stored.
- Unique `(tenantId, type, idempotencyKey)` prevents duplicate jobs.
- Chunks are unique by `(tenantId,documentIndexId,documentId,ordinal)`. Partial rows remain hidden behind the non-READY document and BUILDING `RagDocumentIndex`.
- Retry may replace only rows for its own non-READY document/target index; it never rewrites chunks for another READY document.
- Document becomes READY only after the expected complete chunk set is durable in one transaction.
- ACTIVE promotion is a separate per-Document atomic status transaction protected by the partial unique index.

### Approved ingestion bounds

- maximum upload: 20 MB, implemented as `20 * 1024 * 1024` bytes;
- maximum PDF pages: 300;
- maximum existing document rows per tenant: 500, counting DELETING until hard deletion completes;
- `chunkingProfileVersion = 1`: 600 target tokens, 100-token overlap, 900-token maximum, pinned `cl100k_base` tokenizer, deterministic paragraph/sentence-aware boundaries, PDF page identity preserved;
- empty extractable text, scanned/image-only PDF, encrypted PDF, or bound violation is terminal.

### PDF library selection gate

The implementation milestone may select a library only if it:

- supports Python 3.12 and deterministic page-level text extraction;
- exposes encrypted-PDF and image-only/no-text detection without OCR;
- supports bounded bytes/pages/memory and does not require network access or native subprocess execution;
- does not execute embedded PDF scripts, attachments, or active content;
- is actively maintained for security fixes and has a repository-compatible license;
- can be exercised entirely with committed safe fixtures in the default test suite.

### Idempotent hard deletion

1. Admin transaction locks the tenant-scoped document, marks DELETING, and inserts/deduplicates DELETE with the server-owned opaque object-key snapshot already populated.
2. Retrieval excludes DELETING in SQL immediately.
3. Worker deletes the S3 object; not-found is success.
4. In one database transaction, the worker verifies/preserves the DELETE job's existing `deletionObjectKeySnapshot`, cancels any non-terminal INGEST/REINDEX jobs, clears their leases, clears `documentId` on every job that references the Document, and finalizes DELETE before hard-deleting the Document. Indexes/chunks cascade; detached terminal/history jobs survive. Past citations are tenant-encrypted conversation snapshots, so deletion does not rewrite them; history marks them unavailable when their tenant-scoped READY document no longer exists.
5. If the database transaction fails after S3 deletion, retry observes S3 not-found and completes.

A delete request supersedes ingestion. An ingestion worker that observes DELETING stops without making the document READY.

## Observability and operations

Allowed metrics/log fields are low cardinality: job type, safe state/stage, safe error code, attempt bucket, duration, queue depth/oldest age, and worker identity. Tenant IDs may be included only where current secure structured-logging policy already permits them; never use them as metric labels.

Forbidden: filename/display name, object key/bucket, raw document/chunk/query, ciphertext, vector, source excerpt, API key/token, provider raw body, or arbitrary exception text.

### Runtime adapter policy

- Unit/integration tests use fake S3, fake Gateway embeddings, and fake AI Service or local test doubles; default suites never call AWS/OpenAI/deployed services.
- Explicit local development may enable local doubles through an explicit local-only profile.
- Staging/production register only real private S3/KMS, the Gateway private embedding endpoint, and the authenticated AI Service. Any fake/mock/local endpoint configuration fails startup.
- Staging and production use separate private S3 buckets and KMS keys, workload IAM roles only, and a distinct AI Service token per environment. Static AWS credentials fail startup.

Readiness should fail if database/config/keyset/internal-service prerequisites are missing. Liveness should reflect the process loop, not external provider availability. Shutdown stops leasing, finishes or releases bounded in-flight work, and preserves leases for recovery.

## Rationale

- PostgreSQL is already transactional with document state and idempotency records.
- `SKIP LOCKED` supports multiple workers without introducing a new broker operationally.
- Separate runtime isolates long work from admin API latency/restarts.
- Staged state and leases make distributed partial failure explicit.

## Consequences

- Polling adds database load; batch size, poll interval, concurrency, and indices require measurement.
- Postgres queue is sufficient for MVP, not a claim that it is the permanent high-throughput architecture.
- Compose/CI/deployment must run and monitor a new process.
- Orphan S3 reconciliation is required for upload-success/database-failure gaps.
- Job/audit retention must be set without retaining secret/raw errors.
- Deployment readiness depends on real-adapter configuration; provider/storage outage never triggers fake fallback.

## Rejected alternatives

- **Synchronous upload-and-ingest request:** rejected due to duration, retry, and distributed failure.
- **In-process Control Plane scheduler:** rejected because HTTP replica lifecycle and worker concurrency become coupled.
- **Redis queue immediately:** rejected because no robust queue convention exists and it creates a second durability/transaction boundary.
- **Generic `apps/worker` now:** rejected because the scaffold has no runtime/package and duplicates Control Plane adapters.
- **Exactly-once claim:** rejected because S3/HTTP/DB cannot provide a distributed exactly-once transaction; the design is at-least-once plus idempotency.

## Verification gate

- Integration tests cover duplicate delivery, two workers, lease expiry, retry/terminal classification, crash at every stage, and delete-during-ingest.
- Two-tenant fixtures prove jobs cannot read/mutate another tenant's document/key/object metadata.
- Unit/integration tests use fake/local test doubles; no default test contacts AWS/OpenAI. Staging/production startup tests reject those settings and controlled smoke tests exercise actual S3/KMS/Gateway/AI Service boundaries.
- Deployment checks prove worker health, graceful restart, queue lag visibility, and recovery after process loss.

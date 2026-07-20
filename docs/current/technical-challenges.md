# GateLM Technical Challenges: Code-backed Engineering Evidence

| Field | Value |
|---|---|
| Status | Supporting implementation evidence; not an API, DB, event, or release contract |
| Reviewed branch | `origin/dev` |
| Reviewed commit | `40d96325e114d9f7d633dd214ccbc2bfef672e0c` |
| Reviewed at | 2026-07-17 |
| Scope | Gateway, Tenant Chat, and Tenant Chat RAG code paths inspected in this snapshot |

## How To Read This Document

This document describes problems that the checked-in code and tests address. It does not claim a production SLA, a completed release, or measured throughput. In particular, a distributed primitive such as Redis Lua or PostgreSQL `SKIP LOCKED` is evidence of a scale-aware design, not evidence of a specific RPS, p95, or p99 result.

Each item intentionally separates:

1. the failure mode;
2. the implementation mechanism;
3. the checked-in code and test evidence; and
4. the claim boundary.

## 1. Streaming Retry Without Duplicate Provider Calls or Double Settlement

### Failure mode

An SSE connection may end after a provider call has started. Retrying the same turn must not create a second provider execution, duplicate an assistant message, or charge the same tenant twice.

### How the implementation addresses it

- The Gateway creates a persisted usage reservation before opening the provider stream.
- A replayed reservation attaches to the active shared session when the original request is still running; it does not open another provider stream.
- A completed request uses terminal replay rather than creating a new execution.
- The shared session retains emitted events only for the replay window and clears delta text during cleanup.
- The Chat API also keeps a per-turn in-flight promise so parallel local handling of one turn joins the same work.

### Evidence

- [Gateway reservation/replay branch](../../apps/gateway-core/internal/services/tenantchat/completion/service.go)
- [Gateway in-flight replay test with one provider call](../../apps/gateway-core/internal/services/tenantchat/completion/service_test.go)
- [Chat API in-flight turn map](../../apps/chat-api/src/content/conversation.service.ts)

### Claim boundary

The tests prove replay attachment behavior for the covered process and request identity path. They do not by themselves prove multi-region SSE recovery or a measured reconnect success rate.

## 2. Provider Usage Is Not Always Knowable at Failure Time

### Failure mode

After a provider request is dispatched, a timeout or network failure does not prove that the provider consumed zero tokens. Immediately releasing all reserved cost can undercharge; charging the full reservation can overcharge.

### How the implementation addresses it

- The request moves through a reservation lifecycle that distinguishes pre-call failure, dispatched execution, confirmed usage, and unconfirmed usage.
- A known pre-call failure is finalized without treating it as a provider-consumed request.
- A dispatched request without confirmed usage is persisted as pending for later reconciliation.
- Reconciliation claims pending rows with `FOR UPDATE SKIP LOCKED`, which permits multiple reconcilers without claiming the same row twice.
- Fallback attempts remain tied to the same reservation and attempt number sequence.

### Evidence

- [Completion dispatch and settlement flow](../../apps/gateway-core/internal/services/tenantchat/completion/service.go)
- [Pending/unconfirmed persistence](../../apps/gateway-core/internal/adapters/tenantchat/usage/postgres/pending_store.go)
- [Concurrent reconciler claim query](../../apps/gateway-core/internal/adapters/tenantchat/usage/postgres/reconciliation_store.go)

### Claim boundary

This is a correctness mechanism for ambiguous external-call outcomes. It is not evidence that every provider exposes a reconciliation API or that accounting reconciliation has been operated at production volume.

## 3. Exact Cache Correctness Includes Execution Semantics, Not Just Prompt Equality

### Failure mode

Caching a streamed answer before final completion can serve a partial answer later. Reusing an answer across a different model, policy snapshot, route, or output budget can also be semantically incorrect.

### How the implementation addresses it

- Stream deltas are accumulated only for a cache-eligible first attempt.
- The response is stored after a successful terminal path; fallback responses are not stored.
- Cache material is bound to tenant/user namespace, runtime snapshot, routing result, and usage intent rather than prompt text alone.
- The tenant-chat Redis cache value is encrypted; prompt and response plaintext are not stored in the Redis envelope.
- A tampered encrypted envelope fails closed rather than becoming a cache hit.

### Evidence

- [Exact cache store after completion flow](../../apps/gateway-core/internal/services/tenantchat/completion/service.go)
- [Routing-aware exact cache regressions](../../apps/gateway-core/internal/http/handlers/chat_completions_exact_cache_routing_aware_test.go)
- [Tenant/user namespace, encryption, and tamper test](../../apps/gateway-core/internal/adapters/tenantchat/cache/redis/store_test.go)

### Claim boundary

The snapshot does **not** show response-cache miss coalescing or distributed single-flight. Concurrent identical cache misses can still create more than one provider call; that must not be presented as an implemented cache-stampede solution.

## 4. Semantic Cache Is a Policy-Controlled Reuse Decision

### Failure mode

Embedding similarity alone is unsafe for answers dependent on user state, credentials, authorization, support outcomes, or provider failure behavior.

### How the implementation addresses it

- Semantic storage is classified by response cacheability class, intent category, required slots, provider outcome, fallback state, stream state, and forbidden-payload state.
- The default policy enables strict storage only for static general guidance; sensitive, dynamic, account, tool, support, reasoning, and unknown categories are disabled.
- Shadow mode records a would-hit outcome without returning the cached response, allowing a rollout to observe risk before enforcement.
- A classifier can skip embedding lookup and storage where the input is not suitable for semantic reuse.

### Evidence

- [Semantic cache store policy](../../apps/gateway-core/internal/domain/cache/semantic_store_policy.go)
- [Dynamic user-state cache denial regression](../../apps/gateway-core/internal/http/handlers/chat_completions_semantic_cache_test.go)
- [Shadow would-hit regression](../../apps/gateway-core/internal/http/handlers/chat_completions_semantic_cache_test.go)

### Claim boundary

The implementation status document classifies Semantic Cache as disabled/shadow by default. This document does not claim it is a default production response path.

## 5. Tenant Content Encryption Binds Ciphertext to Its Record Identity

### Failure mode

Encrypting a chunk is insufficient if an attacker or a defective data path can copy its ciphertext into another tenant, document, index, or chunk row and still decrypt it.

### How the implementation addresses it

- Content uses AES-256-GCM with a random 12-byte nonce and a 16-byte authentication tag.
- Canonical AAD is validated before encryption/decryption.
- RAG chunk AAD includes `tenantId`, `knowledgeBaseId`, `documentId`, `documentIndexId`, `chunkId`, content kind, schema version, and content-key version.
- Tenant content keys are data-encryption keys wrapped by versioned wrapping keys.
- Key rotation advances a rollback floor; a process whose wrapping key set is older than that floor refuses to read or write content.
- Key buffers and plaintext buffers are cleared after use where the implementation owns them.

### Evidence

- [AES-GCM and canonical AAD implementation](../../packages/tenant-content-crypto/src/crypto.ts)
- [RAG AAD validation](../../packages/tenant-content-crypto/src/crypto.ts)
- [Tenant key rotation and rollback floor](../../apps/chat-api/src/content/tenant-content-key.service.ts)
- [Cross-tenant/AAD/nonce crypto regressions](../../packages/tenant-content-crypto/src/crypto.spec.ts)

### Claim boundary

This is application-layer envelope encryption evidence. It does not replace infrastructure controls such as KMS access policy, database backup encryption, or key-management operational review.

## 6. RAG Retrieval Enforces Tenant Isolation Inside the Vector Query

### Failure mode

Filtering foreign-tenant chunks in application code after vector search is too late: a logging, prompt-building, or error-handling defect can expose a result before the filter runs.

### How the implementation addresses it

- The raw vector SQL repeats authenticated `tenantId` conditions across chunk, document index, document, and knowledge-base joins.
- It searches only an enabled knowledge base, `READY` documents, and `ACTIVE` indexes.
- It computes exact cosine score in PostgreSQL with pgvector and accepts only finite 1536-dimension query vectors.
- Decryption uses the row's tenant-bound AAD; an integrity or key failure fails the retrieval rather than silently skipping the chunk.
- Query embedding usage is recorded idempotently and the in-memory query vector is cleared after retrieval.

### Evidence

- [Tenant-scoped pgvector query](../../apps/chat-api/src/rag/rag-retrieval.repository.ts)
- [Retrieval/decrypt/integrity flow](../../apps/chat-api/src/rag/rag-retrieval.service.ts)
- [Cross-tenant Gateway-context integration regression](../../apps/chat-api/src/rag/rag-tenant-isolation.integration.spec.ts)

### Claim boundary

The query is an exact search implementation. It does not claim an ANN/HNSW performance profile or a measured tenant-size threshold for index introduction.

## 7. RAG Worker Scale-Out Requires a Lease and a Fencing Condition

### Failure mode

With multiple ingestion workers, two workers can claim one job, a crashed worker can leave a job `RUNNING`, or a stale worker can resume and overwrite the state written by a newer worker.

### How the implementation addresses it

- Candidate `RagJob` rows are selected with `FOR UPDATE SKIP LOCKED` and atomically changed to `RUNNING`.
- The claim records `lockedBy`, `attemptCount`, and `leaseExpiresAt`.
- An expired lease is eligible for recovery by another worker and increments the attempt count.
- Every renewal and later document-state transition checks worker ID, attempt number, and unexpired lease.
- Therefore a stale worker cannot commit a stage transition after a newer claim has fenced it off.
- Index construction remains `BUILDING`; only the final transaction retires a previous active index and promotes the complete index to `ACTIVE`.

### Evidence

- [Atomic RAG job claim and fenced status transition](../../apps/control-plane-api/src/rag-worker/rag-job.repository.ts)
- [Two-worker claim, lease recovery, and stale-attempt integration tests](../../apps/control-plane-api/src/rag-worker/rag-job.repository.integration.spec.ts)
- [No-overlapping heartbeat test](../../apps/control-plane-api/src/rag-worker/rag-worker.service.spec.ts)

### Claim boundary

The implementation supports multiple workers; it does not provide a measured documents/hour result, a queue-depth SLO, or a completed multi-worker soak-test result.

## 8. Two Different Distributed Limits Protect Different Bottlenecks

### Failure mode

Request-per-second limiting alone does not prevent a small number of very large prompts from consuming a provider's token quota. Conversely, a token-window guard alone does not protect every public application scope from request floods.

### How the implementation addresses it

1. **Gateway request limiter**
   - Uses a Redis Lua token bucket for atomic refill, consume, and TTL update.
   - Keys are tenant and scope specific: application, project, or employee.
   - Redis/config failures return an internal limiter error rather than allowing an unverified request through.
2. **Tenant Chat provider-token limiter**
   - Uses estimated input tokens plus maximum output tokens as a weight.
   - Atomically adds the weight to a tenant/provider/window counter in Redis.
   - Rejects an execution before provider dispatch when the provider token budget would be exceeded.

### Evidence

- [Redis Lua request token bucket](../../apps/gateway-core/internal/adapters/ratelimit/redis/token_bucket_limiter.go)
- [Provider-token weighted Redis guard](../../apps/gateway-core/internal/adapters/tenantchat/ratelimit/redis/limiter.go)
- [Rate-limit pipeline stops before provider regression](../../apps/gateway-core/internal/app/gateway_v1_readiness_smoke_test.go)

### Claim boundary

These are scale-control primitives, not a capacity benchmark. Their Redis Cluster compatibility, failover behavior, and target throughput need dedicated operational tests.

## 9. Internal RAG Embedding Requests Are One-Time Across Gateway Replicas

### Failure mode

A signed service-to-service request can be replayed while it remains valid. Signature verification alone does not make a short-lived request one-time when multiple Gateway replicas accept it.

### How the implementation addresses it

- The workload token JTI is consumed with Redis `SETNX` under a namespaced key.
- TTL includes allowed clock skew so a valid token remains replay-protected across the whole acceptable validity window.
- Reused JTI and Redis unavailability both fail closed.
- Tokens beyond the maximum allowed lifetime are rejected before Redis is touched.

### Evidence

- [One-time JTI consumer](../../apps/gateway-core/internal/adapters/rag/workloadauth/jti.go)
- [Replay, Redis outage, and skew-boundary tests](../../apps/gateway-core/internal/adapters/rag/workloadauth/jti_test.go)

### Claim boundary

This establishes the shared-state replay guard. It does not by itself prove signing-key rotation operations or cross-region Redis replication behavior.

## 10. Request-Path Success Does Not Prove Dashboard Pipeline Capacity

### Failure mode

A sustained request run can complete and persist every terminal log while the asynchronous dashboard pipeline is already falling behind. When a closed Rollup bucket cannot be rebuilt, aggregate coverage remains incomplete. A dashboard reader can then return to the raw request log while the Rollup worker is also scanning and rewriting aggregate state. Repeating that work from a one-second UI poll can saturate the shared PostgreSQL host after the load generator has stopped.

### How the current implementation exposes the failure

- The Web dashboard requests a snapshot every one second.
- One snapshot route fans out overview, cost, live-request, and month-to-date reads in parallel.
- The Gateway uses Rollup rows only when coverage is complete; otherwise it executes the raw aggregation path.
- A Rollup bucket rebuild runs in a transaction with a 60-second timeout.
- A failed bucket is retried with exponential backoff capped at 300 seconds.

### Operational evidence and containment

On 2026-07-20, a Krafton-isolated `300 RPS × 10 minute` Mock run wrote 180,001 successful request-log rows. The request stage completed, but the Data host later reached PostgreSQL container CPU of about 190–199%. Closing the dashboard and draining its raw reads reduced CPU to about 100%; relation locks identified the remaining query as the Control Plane Rollup worker reading `p0_llm_invocation_logs` and writing the Rollup tables.

The active Rollup transaction was canceled and `DASHBOARD_ROLLUP_ENABLED` was temporarily changed to `false` before recreating only Control Plane. PostgreSQL CPU changed from `100.24%` to `0.07% / 0.06% / 0.29%` at the immediate, 15-second, and 45-second samples. Both Gateway NLB targets, the Control Plane health check, and the public Web and Chat boundaries remained healthy.

Read-only profiling then isolated the failed hour bucket at 37,886 source rows with metadata averaging 3,518 bytes. The original light dimension plan expanded it to 303,088 intermediate rows, spilled a 72,680 kB external merge sort, and took 13,209.823 ms. Materializing the normalized source CTE reduced the same light comparison to 3,289.948 ms (75.1% lower); the full dimension histogram query completed in 5,341.990 ms. This is evidence for the query-plan fix on that bucket, not yet proof that the undiscovered 180,001-row Krafton bucket or concurrent Dashboard traffic is safe.

### Evidence

- [Production 300 RPS × 10 minute Rollup incident report](../../reports/perf/production-krafton-300rps-10m-dashboard-rollup-incident-20260720.ko.md)
- [One-second dashboard snapshot interval](../../apps/web/src/lib/dashboard/live-dashboard-snapshot.ts)
- [Dashboard snapshot fan-out](../../apps/web/src/app/api/dashboard/snapshot/route.ts)
- [Incomplete Rollup coverage falls back to the raw path](../../apps/gateway-core/internal/adapters/invocationlog/postgres/query_reader.go)
- [Hybrid Rollup and raw-range reader](../../apps/gateway-core/internal/adapters/invocationlog/postgres/dashboard_rollup_hybrid.go)
- [Rollup transaction timeout and retry backoff](../../apps/control-plane-api/src/modules/dashboard-rollup/dashboard-rollup.service.ts)
- [Production query profile and claim boundary](../../reports/perf/production-krafton-300rps-10m-dashboard-rollup-incident-20260720.ko.md)

### Claim boundary

The operational evidence was collected on 2026-07-20 with deployed image tag `production-distributed-23c6e6d847de`. It proves the diagnosed failure and the immediate containment on that environment. It does not prove a permanent fix: the production Rollup worker is temporarily disabled, and opening the dashboard can still reintroduce raw-query pressure until polling, fallback, query budgets, and Rollup backfill are changed and retested.

## 11. Large-Scale Validation Still Required

The following claims must not be made until they are measured on the target environment:

- requests per second, p50/p95/p99 latency, or concurrent SSE connection capacity;
- document ingestion throughput per worker;
- pgvector exact-search latency as tenant chunk count grows;
- Redis failover behavior, Cluster behavior, or cache hit rate at production traffic;
- multi-instance reconnect success rate;
- provider quota behavior under sustained load.

Suggested evidence-producing tests are:

1. concurrent identical idempotency retries: verify one provider call, one assistant record, and one ledger settlement;
2. multiple RAG workers with forced lease expiry: verify one claim per attempt and no stale transition;
3. fixed tenant chunk-size tiers: measure exact vector-query p50/p95 and document when ANN indexing becomes necessary;
4. request and token-weight burst tests: verify Redis limiter decisions and zero provider calls after rejection;
5. long-running SSE reconnect soak: verify no duplicate stream completion or duplicate persistence;
6. dashboard-aware load drain: stop k6, wait for log queue drain and Rollup catch-up, then verify zero dirty buckets, bounded snapshot p95, and PostgreSQL CPU recovery.

## Presentation-safe Summary

> GateLM's difficult work is not forwarding a prompt to an LLM. It is preserving correct behavior when requests retry, streams disconnect, providers fail ambiguously, workers scale out, and tenant data must never cross a retrieval, cache, or encryption boundary.

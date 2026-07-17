# RAG MVP release-candidate review

Review date: 2026-07-17

## Release readiness

**Not ready for release or merge as a release candidate.** The implemented tenant-isolation, encryption, cache, citation, worker, and deletion boundaries pass their local deterministic and PostgreSQL-backed tests, but the following release blockers remain:

1. `RagKnowledgeBase.status` defaults to `DISABLED`, upload does not enable it, and there is no tenant-admin enable/disable API or Web Console control. The Chat API correctly requires `ENABLED`, so a tenant cannot start a knowledge conversation through the product without a direct database seed/write.
2. No branch PR or GitHub Actions run exists for this uncommitted candidate. The candidate is synchronized to `origin/dev` commit `f3a67232ea`, but the local Corepack process reports Node 24 while the supported CI/runtime baseline is Node 22.
3. Real staging boundaries have not been exercised: managed PostgreSQL pgvector/extension privilege, restored-volume rehearsal, private S3 with SSE-KMS, IAM workload roles, Gateway-owned OpenAI credentials, AI Service token, and full upload-to-delete smoke.
4. Current hard delete assumes S3 bucket versioning is disabled or suspended. `DeleteObject` without version enumeration does not hard-delete historical versions.
5. A failed upload compensation or unknown database commit outcome can leave an S3 orphan. The candidate logs a safe operation code but has no automatic orphan reconciler.
6. There is no executable real-boundary RAG smoke/evaluator yet. `rag:evaluate:openai` validates opt-in variables and then intentionally throws, while current deployment smoke checks process/public-chat health rather than upload → READY → RAG answer/citation → hard delete. The built-in local `fake` object store is intentionally fail-closed, so a repository-owned full local smoke environment is also absent.

## End-to-end code trace

- Admin authentication and tenant scope: `AdminAuthGuard` validates the full session and active tenant-admin membership against the route tenant. The RAG controller accepts tenant scope only from the guarded route and the acting user only from authenticated request state.
- Upload and S3: the Control Plane streams TXT/PDF, enforces size/type/signature checks, computes SHA-256 while streaming, uses an opaque UUID object key, and writes private S3 objects with SSE-KMS. Filename/digest metadata is encrypted before database persistence.
- Document and job: a transaction creates the `UPLOADED` document and `INGEST/PENDING` job. A definite database failure triggers best-effort object deletion; an ambiguous commit is retried with predetermined IDs instead of deleting a potentially committed object.
- Worker claim: PostgreSQL `FOR UPDATE SKIP LOCKED`, worker/attempt fencing, leases, bounded retry, and terminal max-attempt handling prevent ordinary duplicate activation and recover expired work.
- Extraction: the worker streams the object to the authenticated AI Service. The service has no S3, PostgreSQL, OpenAI, or tenant-key access; it performs bounded TXT/text-PDF extraction and deterministic token-based chunking only.
- Embedding: only the private Gateway endpoint owns the OpenAI credential. It fixes the model/profile/dimension, validates batch responses, rejects non-finite/wrong-size vectors, and records safe per-purpose usage without caching embeddings.
- Encryption and activation: chunk text is encrypted with tenant AES-256-GCM and AAD binding tenant, Knowledge Base, document, index, chunk, purpose, and key version. Vector writes and the BUILDING-to-ACTIVE/READY switch occur in the completion transaction; the database partial unique index allows at most one ACTIVE index per document.
- Retrieval: the Chat API derives `tenantId` from authenticated execution. Parameterized exact-cosine SQL constrains chunk, document, index, and Knowledge Base tenant IDs and requires `ENABLED`, `READY`, and `ACTIVE` before decryption.
- RAG generation: context is a bounded JSON envelope marked as untrusted source data. It is inserted into the actual provider messages, `cacheStrategy=off` is signed server-side, and the final message list—including RAG context—is used for the conservative input-token reservation before provider streaming.
- Citation and persistence: request-local `S1` IDs map to server-owned metadata. Fabricated IDs are ignored. Assistant text and the validated citation snapshot are encrypted with separate AAD and persisted atomically; raw chunks are not stored in conversation messages.
- Deletion: the API atomically changes the document to `DELETING`, creates/reuses a DELETE job, and invalidates INGEST work. Retrieval excludes it immediately. The worker deletes S3 first, then hard-deletes document/index/chunk/vector rows while retaining a detached successful job record.

## Critical and high defects fixed during review

- RAG context size and budget validation now permits only marked bounded RAG context and accounts for JSON/UTF-8 serialization overhead; ordinary message limits remain unchanged.
- Query embedding usage is persisted idempotently without query text/vector data. Successful ingestion embedding batches record usage immediately, so paid earlier batches are not lost when a later batch fails.
- Worker stage transitions and completion are fenced by job, tenant, document, worker, attempt, and live lease. Expired last-attempt jobs are terminalized, repeated DELETE can reactivate a failed/cancelled job, and chunk inserts are batched below PostgreSQL parameter limits.
- Worker heartbeat renewal is serialized and lease expiry is monotonic, preventing a late overlapping renewal from shortening a newer lease.
- AI extraction error envelopes are parsed correctly, valid chunk text is no longer subject to an accidental 128-character cap, and extraction output has an explicit bounded chunk size.
- AI PDF work uses a dedicated temporary directory, startup cleanup, concurrency limits, child memory/CPU limits, and a locked runtime dependency set in the production image.
- Tenant Chat Web preserves the default ordinary-chat mode, sends explicit conversation knowledge mode, handles source/citation replay idempotently, and shows bounded RAG failure copy.
- RAG-disabled production/self-host deployment no longer requires RAG-only S3, key, token, worker, or workload secret dependencies. Explicit fake/static-key settings remain rejected in production-like environments.
- Citation ADR/contract text now matches encrypted assistant-message snapshots and tenant-scoped `available`/`unavailable` history behavior.
- The CI migration baseline is derived by migration ordering instead of a fixed migration count.
- A secret-shaped bearer token literal in a Chat API test was replaced with a constructed test value, allowing the repository-wide forbidden-secret scan to remain strict.
- Synchronization retained the newer Gateway transport contract by removing the obsolete RAG `RequestTimeout` initializer while preserving provider and response-header timeouts.
- AWS runbook commands now keep the RAG-disabled base stack as the default and use the RAG overlay and worker only for explicitly enabled deployments; the worker example points at its isolated binding-key file.

## Validation evidence

The default suite used only mocks/fakes/local test doubles for external services; it did not call OpenAI, AWS, or a deployed internal service.

- Prisma schema validation and client generation: pass, Prisma Client 6.19.3.
- Fresh migrated pgvector database: 43 migrations applied, vector 0.8.5 active, and migration status current.
- PostgreSQL integration: Control Plane foundation/document/job 18/18; Chat API two-tenant retrieval/deletion/no-evidence 3/3.
- Repository hardening (`verify:v2-final`): pass on the synchronized baseline, including forbidden-secret scan, documentation checks, Control Plane typecheck and 552/552 executed tests, Web Console typecheck, and the complete Gateway Go suite.
- TypeScript workspace lint and typecheck: pass. Focused ingestion/deletion and non-RAG conversation tests remain covered by the full service suites; Chat Web is 36/36 and Web Console Playwright unit tests are 195/195 after synchronization.
- Go: `gofmt`, `go vet ./...`, and `go test -count=1 ./...` pass, including Semantic Cache and private Tenant Chat completion regression.
- Python: Ruff lint and scoped formatting pass; scoped RAG mypy passes; the AI Service unittest suite is 200/200 both locally and in the Python 3.12.13 production image with the source tree mounted at its repository-relative path. Repository-wide Python mypy is not an established clean baseline.
- Web builds: Tenant Chat Web and Web Console production builds pass. The unchanged legacy Application build hits a Windows standalone symlink `EPERM` and still requires the official Linux CI result.
- Deterministic retrieval evaluation: Hit@1/3/6 = 1.0, MRR = 1.0, no-answer false retrieval rate = 0.0. This fixture uses deterministic mock embeddings and is not evidence of real OpenAI retrieval quality.
- Exact cosine local baseline: 100 chunks p50/p95 7.240/17.440 ms; 1,000 chunks 40.262/59.251 ms; 5,000 chunks 185.522/235.568 ms. Staging hardware and expected tenant corpus still require measurement before deciding on HNSW.

## Supported MVP behavior

- Tenant Chat only; ordinary chat remains the default per conversation.
- Tenant-admin TXT/UTF-8 and text-layer PDF upload, list/status, processing UI, and asynchronous hard delete.
- Private S3 SSE-KMS originals, durable PostgreSQL jobs, encrypted private metadata/chunks/citations, and plaintext `vector(1536)` for search.
- Stateless authenticated AI extraction, fixed private Gateway embedding, exact tenant-scoped cosine retrieval, bounded context, cache bypass, no-evidence response, SSE citations, and citation reload.

## Explicitly unsupported

- Public Gateway/Application Chat RAG, arbitrary Knowledge Base/model/dimension/document filters, or a public raw retrieval endpoint.
- OCR, scanned/image/encrypted PDF, external connectors/crawling, document download, hybrid search, HNSW, reranking, query rewriting, agents, or automatic ordinary-chat fallback.
- S3 version-aware deletion, an upload-orphan reconciler, a tenant-admin enable/disable product flow, and a real OpenAI staging evaluator are not implemented in this candidate.

## Production rollout order

1. Organize the synchronized diff into reviewable commits, open a `dev` PR, and run the complete GitHub Actions matrix on Node 22.
2. Add and review the tenant-admin Knowledge Base enable/disable contract, API, UI, and end-to-end test in a separate approved milestone.
3. Verify managed PostgreSQL 16 pgvector installation privileges; rehearse backup plus restore into a production-like clone before migration.
4. Provision environment-separated private S3 buckets with versioning disabled/suspended, KMS keys, and least-privilege IAM roles. Do not use AWS static keys.
5. Provision role-separated workload signing/JWKS/HMAC files, tenant wrapping-key projection, environment-specific AI token, and Gateway-only OpenAI credential.
6. Deploy additive migrations and services with global and tenant RAG flags off. Verify existing non-RAG Tenant Chat and Semantic Cache first.
7. Run an actual staging upload, extraction, embedding, READY retrieval/citation, DELETING exclusion, S3 deletion, and database hard-delete smoke; inspect bounded logs/metrics and exact-search latency.
8. Enable one internal tenant as a canary, then expand only after job lag, failures, no-evidence rate, latency, embedding usage, and deletion retry signals are healthy. Repeat the same separated provisioning and canary sequence in production.

## Rollback

- Disable the global flag and tenant Knowledge Base first; this stops new RAG conversations without changing ordinary Tenant Chat.
- Stop the RAG worker and roll application images back to the previous compatible versions. Keep the role-separated secrets available for retry/forensics until all claimed jobs are settled.
- Do not reverse or drop additive RAG migrations, vector extension, or encrypted data during an application rollback. The previous services ignore the additive tables/columns.
- Preserve S3 objects and database rows for retry. Use the compatible worker to finish or retry deletions; do not delete database metadata before the S3 object key is no longer needed.
- Use the rehearsed database restore only for a database disaster, not as the routine application rollback. Rotate any workload/provider secret if exposure is suspected.

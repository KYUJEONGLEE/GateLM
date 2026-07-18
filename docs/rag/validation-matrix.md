# RAG MVP validation matrix

This matrix maps the MVP security and isolation claims to executable tests. It does not make staging or production configuration claims; those environments need their own deployment verification.

## Executable local commands

Use a disposable database created from the pinned pgvector compose service. These commands use no OpenAI, AWS, or deployed internal-service calls:

```powershell
$env:DATABASE_URL = 'postgresql://gatelm:gatelm@localhost:5432/<disposable-db>?schema=public'
$env:GATELM_TEST_DATABASE_URL = $env:DATABASE_URL
corepack pnpm --filter @gatelm/control-plane-api exec prisma migrate deploy --schema prisma/schema.prisma
corepack pnpm --filter @gatelm/control-plane-api db:generate
corepack pnpm --filter @gatelm/control-plane-api exec jest --runInBand prisma/rag-foundation.integration.spec.ts src/modules/rag-documents/rag-documents.integration.spec.ts src/rag-worker/rag-job.repository.integration.spec.ts
corepack pnpm --filter @gatelm/chat-api exec jest --runInBand src/rag/rag-tenant-isolation.integration.spec.ts
corepack pnpm --filter @gatelm/web exec playwright test src/features/rag-documents/knowledge-documents-model.spec.ts --config playwright.unit.config.ts --workers=1
corepack pnpm rag:evaluate
```

Run `corepack pnpm rag:benchmark:exact` only after setting `RAG_BENCHMARK_DATABASE_URL` to another disposable migrated database. The candidate does not yet provide an executable real S3/KMS/Gateway/AI Service upload-to-delete smoke: `rag:evaluate:openai` remains an intentional staging-runner stub. That absence is a release blocker, not a passing validation row.

## End-to-end tenant isolation

`apps/chat-api/src/rag/rag-tenant-isolation.integration.spec.ts` runs against a migrated pgvector database when `GATELM_TEST_DATABASE_URL` is present. It seeds two tenants, their administrators and regular users, encrypted READY chunks, and enabled Knowledge Bases. The test proves that the production retrieval SQL returns only the authenticated tenant's chunk and that the final built RAG context has no other-tenant content. It also proves immediate `DELETING` exclusion, post-hard-delete exclusion, citation source-map rejection of a fabricated `S999`, and the no-evidence result.

The `rag-db-foundation` CI job runs this test after both the baseline migrated database and a fresh empty-database migration. Local runs skip it rather than select a developer database.

## Request and content controls

- `apps/control-plane-api/src/modules/rag-documents/rag-documents.service.spec.ts`: tenant-admin authorization, tenant scope, duplicate handling, document/job transaction, delete idempotency, and object-store compensation.
- `apps/control-plane-api/src/modules/rag-documents/storage/rag-upload-stream.service.spec.ts`: accepted types, empty/oversized files, digesting while streaming, path-traversal filenames, and MIME/signature validation.
- `apps/control-plane-api/src/modules/rag-documents/storage/s3-rag-object-store.spec.ts`: private S3 behavior, SSE-KMS settings, opaque object keys, and safe error paths.
- `apps/ai-service/app/tests/domain/rag_extraction/`: malformed, encrypted, oversized, and effectively scanned PDF failures; UTF-8 validation; deterministic chunking; prompt-injection text treated as data; no OCR fallback.
- `apps/chat-api/src/rag/rag-citations.spec.ts`: server source-map-only citations, deduplication, fabricated source-ID rejection, and model-supplied filename/page rejection.
- `apps/chat-api/src/content/conversation.service.spec.ts`: RAG `off|exact` preservation, current-source citation validation on cache hit, delimiter-safe context construction, prompt-injection resistance, no-evidence behavior, final-prompt budget reservation, and non-RAG conversation regression.
- `apps/gateway-core/internal/adapters/tenantchat/cache/redis/store_test.go` and `internal/services/tenantchat/completion/service_test.go`: same-tenant/same-user RAG response reuse, cross-tenant/cross-user isolation, changed-context miss, encrypted value storage, and a miss followed by a hit with only one Provider call.

## Sensitive-data observability

`apps/gateway-core/internal/http/rag/router_test.go` verifies that the private embedding metric has only bounded labels and cannot include query text, tenant/document IDs, or an API key. `apps/gateway-core/internal/domain/metrics/registry_test.go` enforces the registry's forbidden label set. RAG upload, worker, extraction, and retrieval tests assert sanitized error behavior; no test fixture logs source text, vectors, credentials, or object-storage locations.

## Retrieval quality baseline

`scripts/rag/evaluate-retrieval.test.mjs` and `scripts/rag/evaluate-retrieval.mjs` use `fixtures/retrieval-evaluation.v1.json` with deterministic mock embeddings. The fixture contains tenant-local TXT/PDF answers, numeric/date facts, semantic wording, no-answer, cross-tenant-only, deleted-document, and prompt-injection cases. It reports Hit@1, Hit@3, Hit@6, MRR, and no-answer false retrieval rate without OpenAI, S3, or network access.

`scripts/rag/benchmark-exact-search.mjs` uses the same tenant-scoped production SQL shape against a disposable pgvector database. Its measured baseline and the no-HNSW decision are recorded in [exact-search-performance.md](evaluation/exact-search-performance.md).

# RAG MVP local operation and validation

## Local prerequisites

Use the pinned PostgreSQL 16 pgvector image from `docker-compose.yml`; plain `postgres:16` is not valid because the RAG migration needs `CREATE EXTENSION vector`.

```powershell
docker compose up -d postgres redis
corepack pnpm --filter @gatelm/control-plane-api exec prisma migrate deploy --schema prisma/schema.prisma
corepack pnpm --filter @gatelm/control-plane-api db:generate
```

Unit and integration tests inject explicit in-memory object-store fakes and never contact S3 or KMS. The application-level `RAG_OBJECT_STORE_DRIVER=fake` adapter is deliberately fail-closed: upload and read operations fail, so it is not an upload-to-READY smoke environment. An interactive local smoke test currently requires a separately operated S3-compatible test endpoint configured through the `s3` driver; that endpoint is not bundled in this repository. Staging and production reject fake/local endpoints and static AWS keys at startup.

## Local service processes

```powershell
corepack pnpm --filter @gatelm/control-plane-api dev
corepack pnpm --filter @gatelm/control-plane-api dev:rag-worker
Push-Location apps/ai-service
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
Pop-Location
Push-Location apps/gateway-core
go run ./cmd/gateway
Pop-Location
corepack pnpm --filter @gatelm/chat-api dev
```

For the worker, configure the separately operated local S3-compatible endpoint, local wrapping-key projection, AI Service token, and Worker embedding workload files through the existing RAG environment variables. The worker owns ingestion/deletion; the Control Plane HTTP process must not run parsing or embedding itself. The deterministic unit/integration suites remain the supported no-network test path until a repository-owned S3 test double is added in a separately approved milestone.

Gateway embedding uses the fixed OpenAI profile only: `text-embedding-3-large`, dimensions `1536`, cosine, profile version `1`. The OpenAI credential remains Gateway-owned. Control Plane, AI Service, and Chat API do not receive an OpenAI API key.

## KMS and tenant keys

Local/test uses the existing wrapping-key projection helper:

```powershell
corepack pnpm tenant-chat:rag-wrapping-keys
```

Staging and production require separate private bucket/KMS key pairs, IAM workload roles, and the wrapping-only key projection. AWS static access keys are forbidden. Before enabling a deployed tenant, verify the actual S3 SSE-KMS path, KMS IAM policy, Worker identity, Gateway embedding identity, and AI Service environment token in that environment.

## Admin upload example

The Console uses the authenticated tenant-admin route. The API does not take `tenantId` from request body/query/header; the tenant is the existing authorized route/session scope.

```powershell
curl.exe -X POST "http://localhost:3001/admin/v1/tenants/<tenant-id>/rag/documents" `
  -b "gatelm_session=<admin-session-token>" `
  -F "file=@C:\fixtures\employee-handbook.txt" `
  -F "displayName=Employee handbook"
```

Only TXT and text-layer PDF are accepted. Limits are 20 MB per file, 300 PDF pages, 500 documents per tenant, target chunk 600 tokens, overlap 100, maximum 900, top-K 6, minimum cosine score 0.30, and maximum RAG context 6,000 tokens. OCR/scanned PDFs, download links, hybrid search, reranking, query rewriting, and Application Chat RAG are out of scope.

## Evaluation and security validation

Default CI/local deterministic evaluation uses only a fixture embedding and no external service:

```powershell
corepack pnpm rag:evaluate
```

It reports Hit@1, Hit@3, Hit@6, MRR, and no-answer false retrieval rate, including cross-tenant, deleted-document, and prompt-injection cases. The real embedding path is deliberately not in the default suite. `corepack pnpm rag:evaluate:openai` is currently a fail-closed staging-runner stub: even with opt-in variables it does not execute an evaluation. A real workload runner and result capture remain release blockers; never put an OpenAI key in this repository or a local fixture.

Use the exact-search benchmark only against a disposable migrated pgvector database. See [exact-search-performance.md](evaluation/exact-search-performance.md).
For the executable security, tenant-isolation, retrieval, and observability coverage, see [validation-matrix.md](validation-matrix.md).

## Observability allowlist

RAG metrics may use bounded `service`, `status`, `provider`, `model`, `failureCode`, and `jobType` dimensions. They must not contain filename/display name, document or chunk IDs, query text, chunk text, vectors, object keys, bucket/KMS data, API keys, or other secrets. Gateway exports private embedding request and input-token counters with this allowlist. Worker and Chat API structured operational errors retain only stable codes; raw source content is never logged.

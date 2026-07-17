# ADR-002: Fixed embedding profile and vector search

Status: **Accepted / M1 runtime validation, M2 database storage, and M4 Gateway private embedding contract applied / retrieval pending**

Date: 2026-07-16

## Context

Embeddings produced by different models, dimensions, or normalization assumptions cannot safely share an index. GateLM's existing OpenAI embedding code is located inside the Semantic Cache domain and defaults to a different cache-oriented profile. Before M2, the repository's `postgres:16` images did not include pgvector.

## Decision

The RAG MVP embedding profile is immutable:

```text
provider: openai
model: text-embedding-3-large
dimensions: 1536
distance: cosine
profileVersion: 1
```

- PostgreSQL stores embeddings as `vector(1536)`.
- Retrieval uses exact cosine distance (`<=>`) and no HNSW/IVFFlat index in MVP.
- PostgreSQL runs from a pgvector-enabled PostgreSQL 16 image pinned by explicit version and immutable digest in integration/CI/staging/production.
- Every `RagDocumentIndex` records provider/model/dimensions/profile version; its chunks inherit that immutable profile through the composite index relation.
- A profile change creates a new profile version, a new BUILDING `RagDocumentIndex` for every affected Document, and a full re-embedding. Mixed profiles are never queried together.
- Gateway validates input count/bytes, response order/count, finite numeric values, and exactly 1536 dimensions.
- Clients send only `profileVersion: 1`; they cannot choose provider, model, dimensions, or distance.

## Provider boundary

The generic OpenAI embeddings HTTP implementation moves from Semantic Cache-specific ownership to a provider adapter behind a neutral interface. This is a code-organization refactor, not permission for the two use cases to share data or cache behavior.

- Semantic Cache keeps its current profile, configuration, index, and public-handler behavior.
- RAG gets a separate private workload-authenticated route and separate `RAG_EMBEDDING_*` configuration.
- The RAG route uses a dedicated workload JWT contract because the existing Chat token is tied to turn/admission/snapshot semantics. Each signing `kid` is bound to exactly one issuer/subject and allowed purpose set; Chat API authorizes query and Control Plane Worker authorizes ingestion without sharing private keys.
- Gateway alone reads the OpenAI key and maps provider errors to safe internal codes.
- Control Plane worker submits chunk batches; Tenant Chat API submits the current query.
- Default tests use a fake adapter or Go `httptest`; they never call OpenAI. Fake adapters are test/explicit-local only; staging/production startup rejects them and registers the actual OpenAI adapter.

## Search contract

- Search is parameterized SQL in Tenant Chat API.
- `tenantId` is a mandatory predicate in SQL on chunks and every joined lifecycle table.
- Search requires READY documents, each joined Document's ACTIVE `RagDocumentIndex`, and the tenant's enabled Knowledge Base.
- Results are ordered by exact cosine distance with a bounded `LIMIT`.
- No application-layer cross-tenant filtering is accepted.
- Raw vector, distance/similarity, internal row IDs, and query text are not returned externally or logged.

### Approved MVP profiles

`chunkingProfileVersion = 1` uses 600 target tokens, 100-token overlap, a 900-token maximum, PDF page preservation, pinned `tiktoken==0.13.0` with `cl100k_base`, and deterministic paragraph/sentence-aware boundaries.

`retrievalProfileVersion = 1` initially uses:

- at most 6 chunks in final context;
- minimum cosine similarity 0.30, where `similarity = 1 - (embedding <=> query)`;
- at most 6,000 RAG-context tokens including source envelopes;
- deterministic removal of the lowest-ranked complete chunks when either limit is exceeded.

These values are server-owned and not client parameters. Evaluation fixtures validate/tune version 1 before launch. After production enablement, changing retrieval values increments `retrievalProfileVersion`; changing 600/100/900 increments `chunkingProfileVersion` and requires re-chunking/re-embedding.

### Embedding usage and cost

- MVP embedding cost is platform operating cost and does not consume employee/tenant chat budget.
- Gateway returns only bounded usage metadata needed for recording; it never returns raw provider bodies.
- The worker/Chat API records an idempotent tenant-scoped `RagEmbeddingUsage` row for ingestion/query operations without input text, vector, filename, or document/chunk/query content.

## Index activation

Per-Document index build and activation are separated:

1. Create a new BUILDING `RagDocumentIndex` version for the Document.
2. Extract/embed/encrypt all expected chunks under that index.
3. Verify counts, dimensions, and document readiness.
4. In one transaction, retire that Document's previous ACTIVE index, activate the new index, and set the Document READY.
5. The partial unique index on `(tenantId, documentId) WHERE status = 'ACTIVE'` prevents concurrent double activation; retrieval sees the old complete version or the new complete version, never a partially built mix.

## Rationale

- Explicit dimensions reduce storage relative to the model's default maximum while preserving the selected model.
- A fixed profile makes migrations, validation, retry/idempotency, and reindex rules deterministic.
- Exact search avoids premature ANN tuning and its recall/maintenance tradeoffs for an MVP corpus.
- Gateway centralizes provider credentials, limits, retries, and redaction.

## Consequences

- PostgreSQL must use a pinned pgvector-capable PostgreSQL 16 image in local, CI, self-host, and production-like deployment paths.
- Prisma requires `Unsupported("vector(1536)")` plus reviewed parameterized raw SQL for search/vector writes.
- The current Semantic Cache embedding file cannot simply be imported as a RAG domain dependency.
- Profile/version changes require per-Document reindexing and an atomic active-index switch for each Document.
- Embeddings remain plaintext derived data in PostgreSQL and backups; access controls and tenant scoping are mandatory.
- OpenAI receives query and chunk text for embedding. This provider data-flow must be covered by the tenant/privacy policy.
- Separate embedding usage storage/operations are required even though the charge is not passed into tenant chat budgets.

## Rejected alternatives

- **Use `text-embedding-3-small`:** conflicts with the selected product profile.
- **Use default 3072 dimensions:** conflicts with the fixed 1536 design and doubles vector storage.
- **Add HNSW immediately:** rejected until corpus size/latency measurements show exact search is inadequate.
- **Reuse Semantic Cache vectors/index:** rejected because corpus, profile, lifecycle, tenant scope, and deletion semantics differ.
- **Encrypt vectors:** rejected because PostgreSQL cannot calculate cosine distance over application-encrypted values.
- **Allow per-request model selection:** rejected because it permits incompatible vectors and unpredictable cost.

## Verification gate

- Fresh and upgrade migrations install/verify `vector` and enforce 1536 dimensions.
- Two-tenant tests place the nearest vector in the wrong tenant and prove SQL never returns it.
- Gateway tests prove fixed model/dimensions, batching limits, response validation, error redaction, and no public route.
- Evaluation fixtures validate 600/100/900 chunking and top-six/0.30/6,000-token retrieval before production enablement.
- Deployment tests verify the PostgreSQL image version/digest and reject fake embedding adapters in staging/production.

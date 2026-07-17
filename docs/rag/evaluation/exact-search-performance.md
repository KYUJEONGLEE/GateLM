# Exact cosine retrieval baseline

Date: 2026-07-17
Environment: local disposable PostgreSQL 16 with pgvector 0.8.5, fresh 42-migration schema, one enabled tenant Knowledge Base, one READY document/index, no HNSW or IVFFlat index.

The benchmark executes the production retrieval SQL shape: tenant predicates, READY/ACTIVE/ENABLED predicates, cosine threshold `0.30`, deterministic tie-break, and `LIMIT 6`. It uses 25 warm query samples at each tenant-local chunk count.

| Tenant chunks | p50 | p95 |
| ---: | ---: | ---: |
| 100 | 7.240 ms | 17.440 ms |
| 1,000 | 40.262 ms | 59.251 ms |
| 5,000 | 185.522 ms | 235.568 ms |

Decision: do not add HNSW in this milestone. The MVP has an explicit exact-search policy and this synthetic one-tenant baseline is not sufficient evidence to choose ANN parameters or accept a recall trade-off. At 5,000 chunks the p95 is already material, so staging must repeat this measurement with the expected tenant corpus distribution and the retrieval latency SLO before enabling large tenants. If that evidence shows sustained SLO misses, propose a separate HNSW ADR/migration/evaluation change; do not silently change the retrieval profile.

Reproduce only against a disposable migrated database:

```powershell
$env:RAG_BENCHMARK_DATABASE_URL = 'postgresql://gatelm:gatelm@localhost:5432/gatelm_rag_benchmark?schema=public'
corepack pnpm rag:benchmark:exact
```

The runner creates tenant-scoped synthetic rows and removes them in `finally`. It does not call OpenAI, S3, KMS, or the AI Service.

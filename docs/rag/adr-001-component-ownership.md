# ADR-001: Tenant Chat RAG component ownership

Status: **Accepted for MVP planning / active contract pending**

Date: 2026-07-16

## Context

GateLM separates the Web Console, Tenant Chat Web/API, Control Plane, Gateway, and AI Service. RAG adds document administration, object storage, asynchronous ingestion, extraction, embeddings, vector retrieval, prompt context, citations, and UI. Giving one service all of those responsibilities would bypass existing authentication, credential, budget, and encryption boundaries.

The repository also contains an `apps/worker` scaffold, but it is not a runnable workspace package. The Control Plane already owns Prisma, tenant administration, lifecycle state, configuration, and deployment migrations.

## Decision

### Control Plane API

Owns:

- tenant-admin document upload/list/delete APIs under `/admin/v1/tenants/:tenantId/rag/...`;
- tenant-admin enable/disable control for the tenant's one Knowledge Base;
- `AdminAuthGuard` authorization and actor attribution;
- the tenant's one Knowledge Base and document lifecycle metadata;
- S3 object-store interface/configuration and original-file upload;
- `RagJob` creation, status reporting, and safe administrative errors.

Does not own:

- PDF/text parsing logic;
- direct OpenAI calls or OpenAI keys;
- chat-time retrieval/context/SSE;
- execution of jobs inside the HTTP API process.

### Control Plane worker

Runs as a separate process built from `apps/control-plane-api`, with a proposed `src/rag-worker.ts` entry point and narrow module.

Owns:

- leasing durable PostgreSQL `RagJob` rows;
- downloading originals from S3;
- coordinating AI extraction and Gateway embeddings;
- resolving tenant encryption keys and encrypting chunks;
- writing chunks/vectors and advancing document/index state;
- idempotent hard deletion from S3 and PostgreSQL;
- bounded retry, lease recovery, and safe operational telemetry.

It reuses Control Plane Prisma/config/storage adapters but has no admin HTTP listener.

The approved worker mechanism is PostgreSQL `RagJob`; Redis/BullMQ and the empty generic worker scaffold are not alternate MVP runtime modes.

### AI Service

Owns a private, authenticated, stateless extraction boundary. The RAG route uses a distinct service token per environment:

- validate bounded `text/plain` and text-layer `application/pdf` input;
- extract, normalize, and chunk text;
- attach deterministic ordinal/page locators;
- reject scanned/image-only or unsupported documents with stable codes.

It does not own S3, tenant authorization, PostgreSQL, keys, embeddings, or persisted state.

### Gateway

Owns:

- the provider-neutral embedding interface and OpenAI adapter;
- the fixed-profile private RAG embedding endpoint;
- OpenAI credentials and provider error redaction;
- existing Tenant Chat LLM execution, safety, routing, budget reservation, usage settlement, and streaming.

The RAG endpoint is private and absent from the public Gateway router. The public Gateway and Application Chat contracts do not gain RAG fields.

### Tenant Chat API

Owns the online RAG path:

- authenticate the employee and derive `tenantId`;
- load the owned conversation and its `knowledgeMode`;
- request a query embedding from Gateway;
- run exact tenant-scoped vector SQL;
- decrypt eligible chunks and build bounded untrusted reference context;
- calculate usage intent from final messages and preserve the existing `off|exact` response-cache selection after current retrieval;
- allocate/validate citation source IDs;
- persist authoritative citation records/tombstones and orchestrate browser SSE.

It never accepts a client Knowledge Base ID.

### Web Console

Owns only the tenant-admin document experience:

- enable/disable the tenant Knowledge Base feature;
- upload TXT/text-layer PDF;
- list documents and safe lifecycle status;
- request deletion;
- show supported-format and failure guidance.

It calls the Control Plane through the existing server-side BFF/session-cookie pattern.

### Tenant Chat Web

Owns:

- selecting/displaying the conversation knowledge mode permitted by the active contract;
- defaulting new conversations to `off` and offering `tenant` only while the Tenant Admin has enabled RAG;
- parsing the strict citation extension on `chat.turn.final` and history responses;
- rendering safe citation labels/locators and unavailable-source states.

It does not retrieve documents or construct citations.

### Environment boundary

- Test and explicitly configured local development may register fake/mock/local test doubles.
- Staging and production register only real S3/KMS, Gateway embedding, and AI Service adapters and fail startup when fake/mock/local endpoints are configured.
- Staging and production have separate private S3 buckets and KMS keys.
- AWS access uses workload IAM roles only; explicit static AWS credentials are rejected.
- AI Service RAG tokens are unique per environment, required at startup, compared in constant time, and never logged.
- The pgvector-enabled PostgreSQL 16 image is pinned by version and immutable digest.

## Rationale

- Admin authorization and document lifecycle remain where tenant-admin scope already exists.
- OpenAI keys remain in Gateway; the worker and Chat API never gain provider credentials.
- AI extraction stays independently testable and stateless.
- Online retrieval stays in Tenant Chat API, where authenticated tenant/conversation context and SSE orchestration already exist.
- The dedicated worker avoids blocking Control Plane HTTP replicas and supports durable job leases/retries.
- A second generic worker application would add a new runtime/package boundary before it provides a concrete benefit.
- Environment fail-fast prevents test doubles or static credentials from becoming accidental production dependencies.

## Consequences

- Control Plane worker deployment/health is a new runtime responsibility.
- Internal service authentication is required for extraction and embedding routes.
- Shared crypto primitives must be extracted without moving Prisma/Nest ownership.
- The Chat API and Control Plane worker both require controlled database access to RAG tables and tenant content-key state.
- Contract changes are needed across private Gateway input and browser SSE, but the public Gateway remains stable.
- Deployment/config validation becomes part of each service's startup contract; staging/production cannot fall back to fake adapters when real dependencies are unavailable.

## Rejected alternatives

- **Put all RAG in Gateway:** rejected because Gateway lacks admin lifecycle, S3, tenant key, and chat citation ownership.
- **Let AI Service read S3 and call OpenAI:** rejected because it creates storage/provider credential duplication and weakens statelessness.
- **Run ingestion in Control Plane API:** rejected because long external calls and retries would compete with admin HTTP traffic and replica lifecycle.
- **Use the empty `apps/worker` scaffold immediately:** rejected for MVP because it has no package/runtime and would duplicate Control Plane data/config adapters.
- **Let Chat API call OpenAI embeddings directly:** rejected because provider credentials and provider policy belong to Gateway.

## Implementation gate

Before source changes, the active contracts must define admin enablement/routes, environment-specific internal authentication, default-off conversation knowledge mode, marked RAG context, stable disabled/unavailable errors, embedding usage, and citation SSE/history availability fields.

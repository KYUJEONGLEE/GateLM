# ADR-003: Tenant-key encryption for RAG chunks and document metadata

Status: **Accepted / M2 encrypted-column shape applied / crypto package contract pending**

Date: 2026-07-16

## Context

Tenant Chat already encrypts titles and messages with AES-256-GCM using per-tenant data keys, versioned key state, wrapping-key rotation, and canonical associated data. RAG chunk plaintext is the same class of tenant content, but existing chat AAD is bound to conversation/message records and cannot authenticate a chunk correctly.

The repository has no importable shared crypto package. Copying crypto and key-state logic into the Control Plane worker would create drift; moving the entire Nest/Prisma service would couple unrelated applications.

## Decision

- RAG chunk plaintext is encrypted before persistence with AES-256-GCM.
- Use a 32-byte tenant data key, cryptographically random 12-byte nonce, and 16-byte authentication tag, matching the established primitive.
- The worker resolves the tenant's active content key and stores `contentKeyVersion` with each chunk.
- Tenant Chat API decrypts with `withKeyVersion`, so active and allowed grace versions remain readable during rotation.
- No plaintext chunk column, search snippet, or raw extraction payload is stored.
- Original filename/display name, content digest, and page count are private document metadata and are encrypted together with the tenant key under a separate metadata AAD. Only normalized extension, MIME type, and byte size are allowed plaintext content metadata.
- Embeddings remain plaintext vectors because exact cosine search requires them.

### `RagChunkAadV1`

Canonical JSON/JCS associated data contains exactly these typed fields:

```json
{
  "schemaVersion": 1,
  "tenantId": "uuid",
  "knowledgeBaseId": "uuid",
  "documentId": "internal-uuid",
  "documentIndexId": "uuid",
  "chunkId": "uuid",
  "contentKind": "rag_chunk",
  "contentKeyVersion": 7
}
```

All values come from server-owned database/job state. A row moved between tenants, documents, indices, or chunk IDs fails authentication.

### `RagDocumentPrivateMetadataAadV1`

Canonical JSON/JCS associated data contains:

```json
{
  "schemaVersion": 1,
  "tenantId": "uuid",
  "knowledgeBaseId": "uuid",
  "documentId": "internal-uuid",
  "contentKind": "rag_document_private_metadata",
  "contentKeyVersion": 7
}
```

The encrypted payload is canonical private metadata containing normalized display name, optional content digest, and optional page count. It is encrypted before `RagDocument` persistence and re-encrypted with a new nonce when digest/page count becomes available. Authorized admin/citation responses decrypt only the required fields in bounded memory. Citation rows do not store a plaintext display-name snapshot.

### Shared package boundary

A compatibility-only milestone creates `packages/tenant-content-crypto` as a real pnpm package. It contains:

- canonical JSON/JCS encoding used by existing chat crypto;
- AES-256-GCM encrypt/decrypt/wrap/unwrap primitives and constants;
- validated versioned wrapping/integrity keyset parsing;
- typed Chat AAD, RAG chunk AAD, and RAG private-document-metadata AAD builders;
- framework-neutral key-material interfaces and zeroization helpers.

It does not contain Nest modules, Prisma queries, environment loading, HTTP, or tenant authorization. Chat API and Control Plane worker keep application-local adapters for tenant key-state lookup and transaction behavior.

The extraction PR must prove byte-for-byte compatibility for existing title/message AAD and ciphertext fixtures. It does not re-encrypt old chat records or change key tables.

## Storage boundaries

- Original file: private S3 with SSE-KMS, opaque server-owned key, Block Public Access.
- Chunk text: application AES-256-GCM in PostgreSQL.
- Embedding: plaintext `vector(1536)`, treated as sensitive derived data.
- Private document metadata: display name, content digest, and page count use application AES-256-GCM in PostgreSQL with `rag_document_private_metadata` AAD; never plaintext at rest in RAG tables/citations. Only extension, MIME type, and byte size remain plaintext.
- Query text and decrypted context: process memory only; no database, cache, log, metric, or trace body.

Staging and production originals use separate private S3 buckets and separate KMS keys per environment. AWS access uses workload IAM roles only; static keys are rejected. Test/explicit-local storage doubles never weaken the application-layer filename/chunk encryption contract.

## Key rotation and deletion

- New chunks always use the tenant's current active content-key version.
- Reads use the row's recorded version under existing active/grace/retired policy.
- Rewrapping a tenant data key after wrapping-key rotation does not rewrite chunks.
- Rotating the tenant content key may use a separate controlled re-encryption job later; it is not coupled to ordinary ingestion.
- Hard document deletion removes original/chunk/private-metadata ciphertext, nonce, tag, vector, and document references. Before deletion, linked citation rows are reduced to metadata-free DELETED tombstones so chat history can render `삭제된 자료`; S3 deletion remains independently idempotent.

## Rationale

- Reusing the established key hierarchy avoids a second tenant secret system.
- Record-specific AAD makes cross-tenant and cross-document substitution detectable.
- A low-level package prevents algorithm/serialization drift without sharing database ownership.
- Keeping vectors searchable is necessary for pgvector exact search.

## Consequences

- Control Plane worker needs least-privilege access to tenant content-key state and wrapping-key configuration.
- Chat API retrieval must group/decrypt by key version efficiently while bounding plaintext lifetime.
- Backups contain ciphertext and plaintext embeddings; both require access controls.
- Lost/retired key material makes affected chunks unreadable; readiness and rotation runbooks must test key availability.
- AAD schema changes require a new schema version and migration/re-encryption plan, never silent reinterpretation.
- Admin/citation listing now requires a key lookup/decrypt step for each distinct tenant/key version and must keep private document metadata out of caches/logs.

## Rejected alternatives

- **Store chunk plaintext:** rejected because tenant source content must not be exposed at rest in the database.
- **Use only PostgreSQL/S3 disk encryption:** rejected because it does not preserve the existing tenant-key application boundary.
- **Reuse message AAD:** rejected because conversation/message identity does not bind RAG records.
- **Duplicate crypto in the worker:** rejected because serialization/rotation drift would eventually break decryption or weaken controls.
- **Move Prisma key service into the shared package:** rejected because it couples application persistence and framework lifecycles.

## Verification gate

- Existing chat crypto fixtures remain byte compatible after extraction.
- Round-trip and tamper tests cover every RAG AAD field.
- Wrong tenant/document/index/chunk/key version fails authentication.
- Private-metadata round-trip/tamper tests cover tenant, Knowledge Base, document, content kind, and key version; no plaintext filename, content digest, or page count appears in database/citation fixtures.
- Rotation tests cover active and grace versions plus rewrap.
- Repository/log scans and integration tests prove no plaintext chunk is persisted or emitted.

# ADR-006: Server-issued and server-verified citations

Status: **Accepted and implemented for the RAG MVP**

Date: 2026-07-16

## Context

The model can emit plausible but nonexistent citations. Raw chunk/index IDs, object keys, vectors, scores, excerpts, and storage or crypto metadata must not become browser-visible citation facts. Citation replay must also remain deterministic after a document is reindexed or deleted.

## Decision

Tenant Chat API is the authority for citation identity, display metadata, and eligibility.

### Source allocation and validation

For each RAG turn, Chat API:

1. selects only chunks that fit the final provider context;
2. assigns request-local IDs `S1`, `S2`, ... in deterministic context order;
3. builds an in-memory map from each ID to the selected tenant-scoped retrieval result;
4. sends the source ID and untrusted source content inside the bounded RAG context;
5. extracts `[S1]`-style markers from the final answer;
6. accepts only IDs present in that turn's source map and removes duplicates in first-use order.

The model never supplies an authoritative document ID, filename, page, line, or chunk ordinal. Fabricated or malformed IDs do not produce citation metadata.

### External shape

The source and citation events expose only:

```json
{
  "sourceId": "S1",
  "documentId": "safe-public-uuid",
  "displayName": "Employee handbook.pdf",
  "pageStart": 12,
  "pageEnd": 12,
  "lineStart": null,
  "lineEnd": null,
  "ordinal": 4,
  "availability": "available"
}
```

`documentId` is `RagDocument.publicId`, not an internal index/chunk/job identifier. `availability` is present for replayed history and is `available | unavailable`.

Never expose the Knowledge Base or index ID, internal chunk ID, bucket/object key/KMS configuration, vector/score, ciphertext/nonce/tag, tenant key data, or source text in citation metadata.

### Encrypted persistence and replay

Validated citations are serialized as a bounded snapshot and encrypted with the same tenant content-key hierarchy as the assistant message, using a distinct message-citation AAD. The assistant row stores ciphertext, nonce, authentication tag, content-key version, and citation schema version. It stores no raw RAG context or chunk text.

The encrypted snapshot contains only the safe public document UUID and display metadata that was actually used for that historical answer. It is conversation data and follows the existing encrypted conversation retention/deletion policy.

History decrypts the snapshot only after tenant authorization. It then performs a tenant-scoped lookup for referenced documents in `READY` state:

- present and `READY`: `availability = available`;
- deleted, deleting, failed, or otherwise unavailable: `availability = unavailable`.

Hard deletion removes the S3 original, document metadata row, indexes, chunks, and vectors. It does not rewrite or delete past encrypted conversations. Tenant Chat Web keeps the historical answer, removes any active document link, and renders the source as unavailable. This is the approved product policy; document hard delete is not retroactive conversation deletion.

### SSE

The additive, backward-compatible event order is:

1. `chat.turn.accepted`;
2. optional `chat.turn.sources` with the safe request-local source map;
3. existing `chat.turn.delta` events;
4. `chat.turn.citations` after final server validation and encrypted assistant persistence;
5. existing `chat.turn.final`.

The strict browser parser deduplicates replayed source/citation events. Unknown IDs are never converted into links. No fake download link is created when no authorized download endpoint exists.

## Prompt-injection boundary

Retrieved text is untrusted data. It is JSON-serialized inside a length-delimited context with fixed instructions that source content cannot alter system/developer instructions or execute commands. Citation validation limits false provenance but does not replace input limits, retrieval isolation, safety processing, or adversarial prompt-injection tests.

## Rationale

- Request-local IDs are sufficient for model attribution and reveal no persistent database identity.
- Server-owned metadata prevents forged filenames, locators, and document IDs.
- Encrypted snapshots preserve historical provenance without retaining chunk text.
- Dynamic availability avoids a cross-service delete-time rewrite of encrypted conversation rows.
- Past answers remain readable while deleted knowledge cannot be retrieved or opened.

## Rejected alternatives

- Trust model-generated citation metadata: rejected because it is forgeable.
- Expose chunk IDs, scores, or excerpts: rejected because they leak internals and source content.
- Re-run retrieval to reconstruct history: rejected because index revisions would rewrite historical provenance.
- Store citation snapshots in plaintext relational rows: rejected because display names and locators can be sensitive.
- Delete old conversations with a source document: rejected by the approved product policy; conversation retention is a separate control.

## Verification gate

- Tests cover valid, duplicate, fabricated, malformed, and not-in-final-context source IDs.
- Two-tenant tests prove tenant B sources never enter tenant A metadata or provider context.
- Citation snapshot ciphertext fails with the wrong tenant key or changed AAD.
- SSE tests cover event order, stream interruption, reconnect, and duplicate events.
- History reload restores the encrypted snapshot and marks deleted/non-READY documents unavailable.
- Response allowlists exclude storage, vector, chunk, index, key, and crypto fields.
- Logs and metrics contain only bounded codes/counts, never answer text, query text, source text, vectors, filenames, or API keys.

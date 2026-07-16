# ADR-006: Server-issued and server-verified citations

Status: **Accepted for MVP planning / active contract pending**

Date: 2026-07-16

## Context

The model can generate plausible but nonexistent citations. Raw chunk IDs, database IDs, object keys, vectors, scores, and excerpts must not be exposed. Tenant Chat uses strict SSE schemas and a strict browser parser; citations must work in the final stream event and conversation history without trusting model text.

## Decision

Tenant Chat API is the authority for citation identity and eligibility.

### Source allocation

After SQL retrieval and successful decryption, Chat API:

1. selects the bounded set of chunks that will actually be sent to the provider;
2. allocates a cryptographically opaque `sourceId` for each exposed source entry;
3. builds RAG context with those IDs, safe labels/locators, and untrusted source text;
4. retains an in-memory map from `sourceId` to the exact tenant/document/index/chunk result;
5. asks the model to reference only supplied source IDs.

The model never creates an authoritative document ID or locator.

### Validation

- Only a `sourceId` present in the turn's in-memory retrieved set can become a citation.
- A source must correspond to content actually included in the final provider context, not merely a larger pre-filter candidate set.
- Unknown, duplicate, malformed, or non-retrieved IDs are dropped and recorded only as a safe counter/event.
- Citation ordering is deterministic by first valid occurrence, with duplicates collapsed.
- If structured provider output does not reliably separate citation IDs, the active contract may use a constrained marker syntax, but Chat API still parses and validates it. Raw model markers are not forwarded as metadata.
- The rendered answer text is not rewritten into a false citation. The authoritative final `citations` array is independent metadata.

### External shape

Each final/history citation exposes only:

```json
{
  "sourceId": "opaque-server-uuid",
  "availability": "available",
  "documentId": "safe-public-uuid",
  "displayName": "Employee handbook.pdf",
  "locator": {
    "type": "pdf_page",
    "page": 12
  }
}
```

Text locator:

```json
{
  "type": "text_chunk",
  "chunk": 4
}
```

Not exposed:

- internal Knowledge Base/index/document/chunk/job IDs;
- S3 bucket/key/KMS metadata;
- vector, distance, similarity score, rank, or embedding profile internals;
- plaintext excerpt or encrypted chunk fields;
- raw provider citation output.

`documentId` is the dedicated public UUID from `RagDocument.publicId`.
`displayName` is decrypted from the tenant-encrypted document filename only for the authorized response; citation storage never contains a plaintext display-name snapshot.

### Persistence and replay

`RagTurnCitation` stores tenant-scoped source identity, `availability`, locator, and internal document/index/chunk references linked to the assistant turn/message. It stores no plaintext display-name snapshot. Citation rows are written only after validation and, where the current turn storage allows, atomically with final assistant state.

Conversation history returns the same safe shape. It must not re-run retrieval to reconstruct old citations.

Hard document deletion sanitizes linked citation rows before removing the document: set `availability=DELETED` and null internal/public document identifiers, index/chunk references, locator, and any derived label. The retained tombstone contains only tenant/turn/message/source identity and availability. History then returns:

```json
{
  "sourceId": "opaque-server-uuid",
  "availability": "deleted"
}
```

Tenant Chat Web removes the link and renders `삭제된 자료`. This preserves the approved hard delete while keeping enough non-document state to explain an old citation marker.

### SSE

`chat.turn.final` gains optional `citations`; delta events do not carry citation metadata. The final event remains authoritative after all validation/persistence succeeds.

The following change together in one contract milestone:

- Tenant Chat schema/OpenAPI;
- valid/invalid fixtures;
- Chat API serializer and history response;
- strict parser in `apps/chat-web/src/lib/conversation-contract.mjs`;
- final-event replay/idempotency tests;
- citation UI.

Older clients tolerate the optional field according to the active compatibility rule; new parsers reject unknown keys inside a citation.

## Prompt-injection boundary

Retrieved text is untrusted data, not instruction. Chat API wraps it in a fixed server-controlled context envelope telling the model not to follow instructions found in sources. The reference text still goes through the existing safety path. Citation verification limits false provenance but does not by itself solve prompt injection; context size, delimiters, safety, and adversarial fixtures are separate required controls.

## Rationale

- Server allocation/validation prevents hallucinated citations from becoming UI facts.
- Safe public UUIDs and locators give users useful provenance without leaking storage/schema details.
- Final-only metadata fits the existing SSE lifecycle and avoids changing every token event.
- Persistence makes history deterministic and avoids future index changes rewriting provenance.

## Consequences

- Chat API must retain the retrieved-source map through the streamed turn and finalization.
- Citation persistence must integrate with message/turn completion and cancellation semantics.
- Hard deletion intentionally degrades citation availability in old history.
- Filenames/display names require normalization, length limits, control-character removal, tenant AES-256-GCM encryption at rest, and authorized just-in-time decryption.
- The UI can show document/page provenance but not a raw source preview in MVP.

## Rejected alternatives

- **Trust citations written by the model:** rejected because the model can hallucinate IDs/pages.
- **Expose chunk IDs/scores:** rejected because they leak internals and are unnecessary for users.
- **Generate citations by matching answer text afterward:** rejected because semantic matching cannot prove which source the model used.
- **Re-run retrieval for history:** rejected because indices/documents change and would falsify historical provenance.
- **Keep document metadata after hard delete:** rejected. Only a metadata-free citation tombstone remains; filename, document ID, locator, and internal references are removed.
- **Stream citations in deltas:** rejected because the validated set is not authoritative until finalization.

## Verification gate

- Tests cover valid, unknown, duplicate, malformed, and not-in-final-context source IDs.
- Cross-tenant IDs never resolve, even if guessed.
- SSE and history fixtures expose only the safe allowlist.
- Parser tests reject internal IDs, storage fields, scores, vectors, excerpts, and unknown keys.
- Delete tests sanitize citation rows to the exact DELETED tombstone allowlist, remove all document metadata, and render `삭제된 자료` without a link.
- Logs/metrics contain only safe counts/codes, never source text or arbitrary model output.

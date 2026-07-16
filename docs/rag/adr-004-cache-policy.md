# ADR-004: RAG conversation and cache policy

Status: **Accepted for MVP planning / active contract pending**

Date: 2026-07-16

## Context

Tenant Chat currently supports an exact response-cache strategy through Gateway, while Gateway's public path also has a separate Semantic Cache. RAG output depends on mutable tenant documents, active index, chunking/embedding profiles, access state, and citations. Reusing a response after a document update/delete could expose stale text or citations.

RAG also must not become the implicit path for all employee conversations.

## Decision

### Conversation selection

`TenantChatConversation` stores `knowledgeMode`:

- `off` (default): unchanged ordinary Tenant Chat.
- `tenant`: use the authenticated tenant's single active Knowledge Base.

Tenant Admin controls whether the tenant Knowledge Base is ENABLED. Employees may select `tenant` per conversation only while enabled; all new conversations default to `off`. The normal turn request does not accept a Knowledge Base ID. Chat API reads the conversation row under authenticated `tenantId` and user ownership. A client may request the mode only through the active conversation contract; server authorization and tenant feature state remain authoritative.

### Cache behavior

For every `knowledgeMode=tenant` turn, including a retrieval no-hit:

- Chat API forces `UsageIntent.cacheStrategy = off` and ignores a client request for `exact`.
- Gateway skips exact response-cache read and write.
- The public Semantic Cache remains unreachable because the private Tenant Chat completion route does not invoke it.
- MVP adds no query-embedding cache, vector-result cache, decrypted-context cache, or final-response cache.
- Final event/cache metadata reports the existing cache-off outcome rather than inventing a RAG cache result.

Mode `off` preserves current cache behavior.

### Final input and routing

Chat API inserts bounded RAG context before it calculates `EstimatedInputTokens` and before Gateway completion. The exact final provider input is therefore covered by admission/budget limits and provider-confirmed settlement.

RAG reference text is marked internally as `purpose: "rag_context"`:

- included in workload signing, size validation, safety evaluation, provider input, token estimate, and usage;
- excluded from the routing classifier so retrieved document prose does not select the model/difficulty category;
- mapped by the provider adapter to an untrusted reference/system block with the marker stripped.

This marker is private server-to-server data, not a public/client message role.

## No-hit and failure policy

- No chunk at cosine similarity 0.30 or above: continue without RAG context, return empty citations, keep cache off.
- Retrieval infrastructure, Gateway embedding, key, or decryption failure: return stable `CHAT_RAG_UNAVAILABLE`; do not silently downgrade to ordinary chat.
- Tenant Knowledge Base disabled: return stable `CHAT_RAG_DISABLED`; the UI disables new RAG selection and existing RAG conversations do not silently change mode.
- Context uses at most six complete chunks and 6,000 tokens. Overflow drops the lowest-ranked complete chunks deterministically and never arbitrary-byte-truncates a chunk.

## Rationale

- Cache invalidation would otherwise need document/index/key/citation versions in every key and still risk deleted-source replay.
- Default-off conversation mode makes employee intent explicit and preserves current chat behavior.
- Server-stored mode prevents per-turn Knowledge Base manipulation.
- Marked context prevents retrieval corpus language from distorting Gateway routing while keeping safety/budget accounting complete.

## Consequences

- RAG turns always pay completion cost/latency; there is no response-cache hit.
- No-hit RAG turns also bypass cache, which is simple and predictable.
- The private message contract/provider adapter/routing tests need a backward-compatible optional purpose marker.
- Updating or deleting a document affects the next retrieval immediately after lifecycle/index state changes, without cache invalidation work.
- Query and ingestion embedding costs are approved platform operating cost for MVP. Safe idempotent `RagEmbeddingUsage` records measure them separately and do not consume employee/tenant chat budget.

## Rejected alternatives

- **RAG for every tenant employee chat:** rejected because ordinary and knowledge-grounded use cases must remain distinct.
- **Client-supplied `knowledgeBaseId`:** rejected because tenant has one KB and client selection weakens isolation.
- **Exact cache keyed by active index ID:** rejected for MVP because citation/deletion/access semantics and context construction add more invalidation dimensions.
- **Semantic Cache for RAG:** rejected because semantic equivalence does not guarantee the same eligible sources/citations.
- **Silent ordinary-chat fallback on retrieval failure:** rejected because it hides degraded grounding.
- **Include RAG text in routing classification:** rejected because reference prose can dominate the user's current intent.

## Verification gate

- Mode-off tests prove no embedding/vector call and unchanged current cache behavior.
- Mode-tenant tests prove forced cache-off even when clients request exact caching.
- No-hit below 0.30, top-six/6,000-token bounding, `CHAT_RAG_UNAVAILABLE`, cancellation, and `CHAT_RAG_DISABLED` behavior have contract fixtures.
- Token estimate tests compare the exact final messages including RAG context.
- Routing tests prove marked context is excluded while safety/provider input includes it.

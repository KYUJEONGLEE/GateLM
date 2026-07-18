# ADR-004: RAG conversation and cache policy

Status: **Accepted / active contract applied**

Date: 2026-07-16

Last revised: 2026-07-18

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

For every `knowledgeMode=tenant` turn:

- Chat API always performs query embedding, current tenant-scoped retrieval, and bounded RAG context construction before Gateway completion.
- Chat API preserves the existing `UsageIntent.cacheStrategy=off|exact` selected by the client. Runtime Snapshot cache policy remains authoritative.
- When `exact` is enabled, Gateway applies the existing tenant-and-user-scoped Exact Response Cache to the complete final Provider input, including the current RAG context and conversation history.
- The cache stores only the encrypted final response metadata already supported by Tenant Chat. RAG context and document plaintext participate only in the HMAC fingerprint material and are not stored as cache values, logs, metrics, or conversation messages.
- A cache hit skips only the completion Provider call. Chat API validates cached `[S<n>]` markers against the source map produced by the current retrieval before persisting citations.
- The public Semantic Cache remains unreachable because the private Tenant Chat completion route does not invoke it. MVP adds no query-embedding cache, vector-result cache, or decrypted-context cache.
- A retrieval no-hit returns the existing deterministic local response without calling Gateway, so it performs neither cache lookup nor Provider completion.

Mode `off` preserves current cache behavior.

### Final input and routing

Chat API inserts bounded RAG context before it calculates `EstimatedInputTokens` and before Gateway completion. The exact final provider input is therefore covered by admission/budget limits and provider-confirmed settlement.

RAG reference text is marked internally as `purpose: "rag_context"`:

- included in workload signing, size validation, safety evaluation, provider input, token estimate, and usage;
- excluded from the routing classifier so retrieved document prose does not select the model/difficulty category;
- mapped by the provider adapter to an untrusted reference/system block with the marker stripped.

This marker is private server-to-server data, not a public/client message role.

## No-hit and failure policy

- No chunk at cosine similarity 0.30 or above: do not call Gateway or fall back to ordinary chat. Persist and return the deterministic product response `등록된 문서에서 관련 근거를 찾지 못했습니다.` through the existing SSE event shape, without citations.
- Retrieval infrastructure, Gateway embedding, key, or decryption failure: return stable `CHAT_RAG_UNAVAILABLE`; do not silently downgrade to ordinary chat.
- Tenant Knowledge Base disabled: return stable `CHAT_RAG_DISABLED`; the UI disables new RAG selection and existing RAG conversations do not silently change mode.
- Context uses at most six complete chunks and 6,000 tokens. Overflow drops the lowest-ranked complete chunks deterministically and never arbitrary-byte-truncates a chunk.

## Rationale

- Retrieval runs before cache lookup, and the exact-cache fingerprint binds the current serialized RAG context, conversation history, model, routing decision, and safety/cache policy. A document update, deletion, or changed retrieval result therefore produces a miss without a separate invalidation channel.
- Tenant-and-user cache namespacing prevents response sharing across tenants or users. Identical effective input may be reused across conversations owned by the same tenant user because conversation identity is not cache material.
- Default-off conversation mode makes employee intent explicit and preserves current chat behavior.
- Server-stored mode prevents per-turn Knowledge Base manipulation.
- Marked context prevents retrieval corpus language from distorting Gateway routing while keeping safety/budget accounting complete.

## Consequences

- RAG turns always pay query-embedding and retrieval cost/latency. Exact cache hits avoid only completion Provider cost/latency.
- Cache-off RAG turns preserve the previous Provider path. Exact cache miss/hit outcomes use the existing Tenant Chat event, ledger, metric, and UI behavior.
- The private message contract/provider adapter/routing tests need a backward-compatible optional purpose marker.
- Updating or deleting a document affects the next retrieval immediately after lifecycle/index state changes; the rebuilt context can no longer match the stale response fingerprint.
- Query and ingestion embedding costs are approved platform operating cost for MVP. Safe idempotent `RagEmbeddingUsage` records measure them separately and do not consume employee/tenant chat budget.

## Rejected alternatives

- **RAG for every tenant employee chat:** rejected because ordinary and knowledge-grounded use cases must remain distinct.
- **Client-supplied `knowledgeBaseId`:** rejected because tenant has one KB and client selection weakens isolation.
- **Exact cache keyed only by active index ID:** rejected because response reuse must bind the complete current Provider input, not a mutable index pointer alone.
- **Semantic Cache for RAG:** rejected because semantic equivalence does not guarantee the same eligible sources/citations.
- **Silent ordinary-chat fallback on retrieval failure:** rejected because it hides degraded grounding.
- **Include RAG text in routing classification:** rejected because reference prose can dominate the user's current intent.

## Verification gate

- Mode-off tests prove no embedding/vector call and unchanged current cache behavior.
- Mode-tenant tests prove that `exact` and `off` are both preserved after retrieval and context construction.
- Exact-cache tests prove same-tenant/same-user reuse, cross-tenant and cross-user isolation, context-change misses, one Provider call across miss then hit, and current-source citation validation.
- No-hit below 0.30, top-six/6,000-token bounding, `CHAT_RAG_UNAVAILABLE`, cancellation, and `CHAT_RAG_DISABLED` behavior have contract fixtures.
- Token estimate tests compare the exact final messages including RAG context.
- Routing tests prove marked context is excluded while safety/provider input includes it.

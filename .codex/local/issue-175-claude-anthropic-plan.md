# Issue 175: Claude Anthropic Messages Provider

Local-only continuity memo. Official source of truth remains `AGENTS.md`,
`docs/README.md`, and v2.0.0 contracts/schemas/fixtures.

Issue: https://github.com/KYUJEONGLEE/GateLM/issues/175
Related: PR #178 merged Gemini through `openai_compatible`.

## Scope

- Branch: `feat/claude-anthropic-messages-provider`
- Native Claude path, not OpenAI-compatible.
- `adapterType=anthropic`
- `requestFormat=anthropic_messages`
- First PR target: non-stream `/v1/chat/completions`.
- Streaming is follow-up because Anthropic SSE events are not OpenAI-compatible chunks.

## Must Preserve

- RuntimeSnapshot lookup key: `tenantId/projectId/applicationId`
- Provider dispatch by `adapterType`, not provider name.
- Provider/Model remain catalog/config data, not enums.
- Mock fallback remains available.
- No DB schema, event, or metrics label change unless explicitly justified.

## Implementation Notes

- Extend Provider Catalog schema/fixture allowlist for `anthropic_messages`.
- Ensure Control Plane/Web do not silently coerce Claude request format to
  `openai_chat_completions`.
- Add Gateway Anthropic adapter under
  `apps/gateway-core/internal/adapters/providers/anthropic`.
- Convert Chat Completions messages to Anthropic Messages request.
- Normalize Anthropic text response and usage into GateLM Chat Completions.
- Keep Claude default-disabled in seed/Web presets until Anthropic API billing
  can run live completion smoke reliably.

## Verification Notes

- Unit/typecheck coverage passed for adapter, Control Plane, and Web paths.
- Live model listing reached Anthropic, but Messages completion is externally
  blocked by account billing/credit state.
- Gateway safely maps the upstream billing/auth rejection to
  `provider_unauthorized` without exposing provider raw error bodies.

## Security

Do not store provider keys, Authorization headers, raw provider error bodies,
raw prompts, raw responses, raw SSE chunks, or actual secrets in docs, fixtures,
logs, metrics, UI, PR text, or `.codex`.

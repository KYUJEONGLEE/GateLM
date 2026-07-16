# GateLM AI Safety Detector Sidecar Contract

## 1. Status

이 문서는 AI Safety Lab의 local detector sidecar draft contract다.

이 계약은 Lab draft이며 기존 v2 Gateway 계약을 override하지 않는다. 제품 API, DB, Event, Metrics 계약으로 승격하려면 별도 계약 변경이 필요하다.

## 2. Endpoint

```text
contractVersion = ai-safety-detector.v1
POST /internal/ai-safety/v1/detect
```

Tenant Chat sanitization and bounded legacy migration can use the additive ordered batch contract:

```text
contractVersion = ai-safety-detector-batch.v1
POST /internal/ai-safety/v1/detect/batch
```

The single and batch routes share model, policy, shadow/enforce, and forbidden-data semantics.

이 endpoint는 Gateway와 같은 trusted runtime boundary 안의 CPU-only local process/container/pod에서 호출하는 후보 경로다. Hosted inference API로 raw prompt를 보내지 않는다.

## 3. Request Semantics

Sidecar request는 redaction 계산을 위해 transient prompt text를 받을 수 있다. 이 값은 민감 입력으로 취급하며 저장, log, error response, fixture, report에 복사하지 않는다.

Top-level request 후보:

```json
{
  "contractVersion": "ai-safety-detector.v1",
  "mode": "enforce",
  "model": {
    "modelId": "openai/privacy-filter",
    "runtime": "cpu_only"
  },
  "input": {
    "promptText": "{SYNTHETIC_PROMPT_TEXT}",
    "locale": "ko-KR"
  },
  "detectorConfig": {
    "detectorSet": "lab-default",
    "returnConfidence": true,
    "detectorPolicies": [
      {"detectorType": "email", "action": "redact"},
      {"detectorType": "api_key", "action": "block"}
    ]
  }
}
```

`promptText` example은 synthetic placeholder만 사용한다. 실제 고객 문장, 실제 이메일, 실제 전화번호, 실제 token, 실제 credential을 문서나 fixture에 넣지 않는다.

The batch request replaces `input` with `inputs`. It accepts 1 through 64 items. `itemIndex` starts at zero, is contiguous, and matches array order. A normal mask-once turn contains only the newly submitted user message; multiple items are reserved for bounded one-time legacy migration or defensive processing of untrusted provenance. Gateway runs local P0 masking for every supplied item in original order with one shared request-scoped entity scope, then sends only those local-redacted transient values. It does not concatenate messages and does not send role, tenant, user, request, or conversation identifiers.
Whitespace-only items retain their local result and are omitted from the sidecar request. Remaining nonblank items are assigned dense `itemIndex` values and sidecar results are mapped back to their original Tenant Chat positions, so one blank migration item cannot disable model checks for later items.
The optional `placeholderCounters` object carries only the greatest already allocated numeric suffix for each allowed uppercase placeholder prefix. It is bounded to `0..1,000,000`, contains no raw entity or raw-to-placeholder map, and seeds one shared sidecar entity scope for the full batch. This keeps model-only detections from reusing identifiers already allocated by trusted history, local P0 masking, or an earlier item in the same batch.

```json
{
  "contractVersion": "ai-safety-detector-batch.v1",
  "mode": "enforce",
  "model": {"modelId": "openai/privacy-filter", "runtime": "cpu_only"},
  "inputs": [
    {"itemIndex": 0, "promptText": "Contact [EMAIL_1].", "locale": "ko-KR"},
    {"itemIndex": 1, "promptText": "Write a synthetic safe note.", "locale": "ko-KR"}
  ],
  "placeholderCounters": {"EMAIL": 1},
  "detectorConfig": {
    "detectorSet": "privacy-filter-default",
    "returnConfidence": false,
    "detectorPolicies": [{"detectorType": "email", "action": "redact"}]
  }
}
```

`mode=shadow`는 sanitized observation과 log-safe redaction만 제공하며 Provider에 전달할 prompt와 최종 action을 변경하지 않는다. `mode=enforce`에서만 Gateway가 sidecar의 redaction/block을 실행 결과에 반영한다. `detectorPolicies`가 있으면 같은 detector type의 sidecar 기본 action보다 우선하며 Tenant Chat RuntimeSnapshot의 `allow|redact|block`을 보존한다.

Long prompts are split into candidate-centered model windows of at most 480 characters; overlapping windows merge only when the merged value remains within that bound. A request is rejected with the sanitized unavailable response before any model call when uncovered model work exceeds 128 candidates or 64 windows across all items/adapters. Gateway treats that non-success response as one batch failure and uses the complete local P0 result set.

## 4. Response Semantics

Sidecar는 `redactedPrompt`까지 만들어 반환한다. Gateway는 sidecar가 준 offset을 재해석하지 않는다.

Success response 후보:

```json
{
  "contractVersion": "ai-safety-detector.v1",
  "model": {
    "modelId": "openai/privacy-filter",
    "runtime": "cpu_only"
  },
  "outcome": "redacted",
  "mode": "enforce",
  "redactedPrompt": "Contact [EMAIL_REDACTED].",
  "logSafePrompt": "Contact [EMAIL_REDACTED].",
  "redactedPromptPreview": "Contact [EMAIL_REDACTED].",
  "detectorSummary": {
    "detectedCount": 1,
    "detectorCategories": ["email"]
  },
  "detections": [
    {
      "detectorType": "email",
      "source": "openai_privacy_filter",
      "confidence": 0.91,
      "action": "redact",
      "mode": "enforce"
    }
  ],
  "executionSummary": {
    "executionMode": "hybrid",
    "modelInvocationCount": 1,
    "acceptedModelDetectionCount": 1
  },
  "latencyMs": 42
}
```

`redactedPrompt` is the Provider-safe policy result and can retain a value explicitly marked `allow`. `logSafePrompt` and `redactedPromptPreview` always redact detected values, including `allow`, and are the only prompt-shaped fields permitted in logs or reports.

`executionSummary` is required on both single and batch success responses. `rules_only` requires `modelInvocationCount=0`; `hybrid` requires at least one actual model adapter invocation. `acceptedModelDetectionCount` counts model detections that survive label/confidence/span normalization and contribute to sanitized final signals. Metrics consume these bounded counts and must not infer model execution from latency, detector category, or source names.

Batch response `results` has exactly the request item count and preserves `itemIndex` order. Any missing, duplicate, reordered, partial, invalid-mode, invalid-version, or invalid-summary response causes Gateway to discard every sidecar item and use the complete local P0 result set. A 750 ms timeout has the same all-local fallback behavior.
Only the batch response's top-level `latencyMs` reports end-to-end batch evaluation time. Individual result items deliberately omit latency because shared micro-batch inference cannot provide truthful per-item timings.
For both routes, response `model.modelId` must exactly match the model ID sent by Gateway and `model.runtime` must be `cpu_only`. Missing or mismatched model identity is an invalid response and triggers the same local-only fallback.
For both routes, `outcome=redacted` requires a nonblank `redactedPrompt`. An empty redaction result is invalid rather than falling through to an unredacted local prompt; single requests use local fallback and batch requests discard the full remote result set.

Outside the policy-governed `redactedPrompt`, the response MUST NOT include:

- raw prompt
- raw detected value
- raw prompt fragment
- raw offset
- raw span
- raw response
- credential material
- provider raw error body

## 5. Confidence Visibility

`detections[].confidence` is allowed in Lab/eval response.

Gateway/API/UI summary should not expose confidence by default. Public or product-facing summaries should use `outcome`, `detectorSummary.detectedCount`, and `detectorSummary.detectorCategories`.

## 6. Error Response

Error responses are sanitized.

```json
{
  "contractVersion": "ai-safety-detector.v1",
  "error": {
    "code": "sidecar_unavailable",
    "message": "AI safety detector sidecar is unavailable.",
    "retryable": true
  }
}
```

Error responses must not echo prompt text, rejected values, stack traces containing input, raw model output, raw headers, or credential material.

## 7. Failure Behavior Candidate

| Failure | Candidate Behavior |
|---|---|
| regex detector failure | fail closed |
| critical detector failure | fail closed |
| ML NER timeout/failure | shadow unavailable, continue with regex result |
| full sidecar unavailable | regex-only fallback |
| invalid sidecar response | sanitized adapter failure |

## 8. Model Label Mapping

Initial `openai/privacy-filter` label mapping:

| Model Label | GateLM Detector Type | Action Candidate |
|---|---|---|
| `private_email` | `email` | `redact` |
| `private_phone` | `phone_number` | `redact` |
| `private_address` | `postal_address` | `redact` |
| `account_number` | `account_number` | `block` |
| `private_date` | `private_date` | `redact` |
| `private_url` | `private_url` | `redact` |
| `secret` | `secret` | `block` |

Pinned `amoeba04/koelectra-small-v3-privacy-ner` label mapping:

| Model Label | GateLM Detector Type | Action Candidate |
|---|---|---|
| `EMA-*` / `email` | `email` | `redact` |
| `PHN-*` / `phone` / `telephone` | `phone_number` | `redact` |
| `RRN-*` | `resident_registration_number` | `block` |

The pinned OpenAI label map also excludes person and organization labels. Current `person_name` and `organization_name` results come from `local_rule` backstops, not either ONNX model. When KoELECTRA is configured as an additional detector, the sidecar keeps the primary `model.modelId` as `openai/privacy-filter` and exposes accepted KoELECTRA contributions through sanitized `detections[].source` and `detectorSummary.detectorCategories`.

## 9. Schema

The response shape is described by:

```text
docs/ai-safety-lab/schemas/detector-sidecar-response.schema.json
docs/ai-safety-lab/schemas/detector-sidecar-batch-request.schema.json
docs/ai-safety-lab/schemas/detector-sidecar-batch-response.schema.json
```

## 10. Batch inference boundary

The sidecar keeps message boundaries during rules, contextual policy, redaction, and response mapping. It flattens only eligible model windows, executes bounded dynamic ONNX micro-batches, then restores each detection to its original item/window before policy evaluation. Current micro-batch size defaults to 4 and is bounded to 1 through 64 by `AI_SERVICE_AI_SAFETY_MICRO_BATCH_SIZE`.

Model candidate routing is detector-type aware. A configured adapter is invoked only when its accepted label map intersects an uncovered typed candidate. The pinned models do not advertise `person_name` or `organization_name`, so name/organization-only prompts remain rules-only. Message concatenation, skipping the new untrusted user message, full-history rescans on every normal turn, unauthenticated metadata-only safety caching, and raw text/value/offset response fields are forbidden. Stored schema v2 messages may skip repeat inspection only when Chat API has authenticated their safety provenance in AES-GCM AAD and signed the exact completion input.

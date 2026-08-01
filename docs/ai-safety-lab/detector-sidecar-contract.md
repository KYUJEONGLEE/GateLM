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
`GATEWAY_AI_SAFETY_OVERLOAD_POLICY=fail_closed`는 검증된 retryable `503 sidecar_unavailable`의 최종 동작을 바꾸므로 `mode=enforce`에서만 허용한다. `shadow + fail_closed` 조합은 시작 시 거부한다.

Long prompts are split into candidate-centered model windows of at most 480 characters; overlapping windows merge only when the merged value remains within that bound. When uncovered model work exceeds 128 candidates or 64 windows across all items/adapters, the sidecar returns the same route-specific retryable `503 sidecar_unavailable` envelope before any model call. Gateway applies the operator policy to the whole request: `local_fallback` uses the complete local P0 result set, while `fail_closed` stops before Provider execution.

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

Each route returns its own contract version in the same envelope: `ai-safety-detector.v1` for single detection and `ai-safety-detector-batch.v1` for batch detection. Active inference is process-local and defaults to `1`. At most `4` additional requests wait for at most `50ms`; a newly arrived request is rejected immediately when the pending bound is full, and an expired wait returns the same HTTP 503, `code=sidecar_unavailable`, `retryable=true` envelope. A `0` pending bound or `0ms` wait preserves immediate rejection. Cancellation removes the waiter, and workers or replicas multiply both process-local bounds.

The fixed 4-vCPU AWS PII deployment profile explicitly overrides the generic
default with active inference `2` and ONNX intra-op threads `2`. The pending
bound `4`, wait `50ms`, inter-op `1`, and spinning-disabled settings remain
unchanged. This profile selection does not change the response schema or the
sanitized overload envelope.

Error responses must not echo prompt text, rejected values, stack traces containing input, raw model output, raw headers, or credential material.

## 7. Failure Behavior Candidate

| Failure | Candidate Behavior |
|---|---|
| regex detector failure | fail closed |
| critical detector failure | fail closed |
| ML NER timeout/failure | shadow unavailable, continue with regex result |
| sidecar timeout, transport failure, or non-503 HTTP failure | complete local P0 fallback |
| validated route-specific retryable `503 sidecar_unavailable`, including work-limit, active/pending capacity full, or wait expired | Gateway `local_fallback` uses complete local P0, while `fail_closed` stops before Provider execution |
| invalid sidecar response, including an invalid 503 envelope | sanitized adapter failure; Gateway uses complete local P0 fallback |

A validated route-specific retryable `503 sidecar_unavailable` remains `outcome=http_error`. `fail_closed` does not execute fallback and therefore must not increment `gatelm_ai_safety_sidecar_fallback_total`; no new metric name or label value is introduced.

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

Current `gatelm/koelectra-small-v3-pii-ner` v0.1.1 label mapping:

| Model Label | GateLM Detector Type | Action Candidate |
|---|---|---|
| `ADDR-*` | `postal_address` | `redact` |
| `EMA-*` | `email` | `redact` |
| `ORG-*` | `organization_name` | `redact` |
| `PER-*` | `person_name` | `redact` |
| `PHN-*` | `phone_number` | `redact` |
| `RRN-*` | `resident_registration_number` | `block` |

The pinned OpenAI and `amoeba04` maps exclude person and organization labels. The current GateLM v0.1.1 model supports both. With `PERSON_NAME_MODEL_ONLY=true`, only the local `person_name` backstop is disabled; mandatory secret rules and other configured local detectors remain active. Sanitized model contributions are exposed through `detections[].source` and `detectorSummary.detectorCategories` without raw text, values, or offsets.

Built-in Python detector regexes, model-candidate/action-context rules, and GateLM model boundary-repair patterns are centralized in `apps/ai-service/app/adapters/safety/pii_rule_registry.py`. Gateway P0 detector definitions are centralized in `apps/gateway-core/internal/domain/masking/pii_rule_registry.go`. Entity canonicalization, placeholder reuse, and role-aware redaction remain domain policy rather than tenant-configurable detector rules. Compatibility imports may keep the former Python module path, but new production code must use the centralized registry.

Tenant-defined rules are not an active API, DB, RuntimeSnapshot, or UI capability. The code-level composition seams do not authorize accepting untrusted regular expressions; validation limits, versioning, audit, rollout, and rollback require a separate approved contract.

## 9. Schema

The response shape is described by:

```text
docs/ai-safety-lab/schemas/detector-sidecar-response.schema.json
docs/ai-safety-lab/schemas/detector-sidecar-batch-request.schema.json
docs/ai-safety-lab/schemas/detector-sidecar-batch-response.schema.json
```

## 10. Batch inference boundary

The sidecar keeps message boundaries during rules, contextual policy, redaction, and response mapping. It flattens only eligible model windows, executes bounded dynamic ONNX micro-batches, then restores each detection to its original item/window before policy evaluation. Current micro-batch size defaults to 4 and is bounded to 1 through 64 by `AI_SERVICE_AI_SAFETY_MICRO_BATCH_SIZE`.

Model candidate routing is detector-type aware. A configured adapter is invoked only when its accepted label map intersects an uncovered typed candidate. GateLM v0.1.1 advertises `person_name` and `organization_name`; the older pinned OpenAI and `amoeba04` maps do not. Message concatenation, skipping the new untrusted user message, full-history rescans on every normal turn, unauthenticated metadata-only safety caching, and raw text/value/offset response fields are forbidden. Stored schema v2 messages may skip repeat inspection only when Chat API has authenticated their safety provenance in AES-GCM AAD and signed the exact completion input.

## 11. Offline PII Shadow comparison

Offline PII Shadow는 위 request body의 `mode=shadow`와 다른 기능이다.
`mode=shadow`는 현재 sidecar 결과를 실시간 요청에 강제하지 않는 정책 모드이고,
offline PII Shadow는 이미 반환된 기준 결과와 별도 후보 ONNX 세션의 결과를
나중에 비교하는 운영 검증 경로다. 두 기능의 이름이 같더라도 lifecycle과
실행 시점이 다르며 서로를 대신하지 않는다.

Gateway는 아래 조건을 모두 만족할 때만 trusted 내부 요청에
`X-GateLM-PII-Shadow-Capture: 1`을 추가한다.

- `GATEWAY_PII_SHADOW_ENABLED=true`
- 인증된 서버 컨텍스트의 tenant가 exact allowlist에 포함됨
- tenant ID와 request ID를 사용한 deterministic SHA-256 bucket이 설정한
  `1..10000` basis points 안에 포함됨

기본 샘플은 `500` basis points, 즉 5%이며 기능은 기본적으로 꺼져 있다.
Gateway는 header 한 비트만 sidecar에 보내고 tenant, user, request, conversation
식별자를 추가로 전달하지 않는다. 일반 client가 이 header를 신뢰 경계 밖에서
직접 주입할 수 있도록 endpoint를 공개해서는 안 된다.

AI Service는 `AI_SERVICE_PII_SHADOW_ENABLED=true`일 때만 header를 처리한다.
실시간 기준 추론이 끝나면 request와 sanitized 기준 결과를 같은 thread에서
즉시 AES-256-GCM으로 암호화해 process-local buffer에 넣는다. 이 단계에서는
후보 추론을 실행하거나 기다리지 않는다. key는 process memory에만 존재하고
재시작 복구를 위한 file, DB, queue, KMS 저장은 하지 않는다.

buffer hard limit은 다음과 같다.

- 최대 5,000건
- 암호문과 nonce 합계 최대 10 MiB
- TTL 최대 12시간
- 크기 초과 항목은 버리고, 가득 차면 가장 오래된 항목부터 제거
- process 종료 또는 재시작 시 모든 항목과 key를 폐기

worker는 기본 `Asia/Seoul` 02:00 이상 05:00 미만에만 동작한다. 기준 PII
runtime은 4-vCPU profile의 active `2`, intra-op `2`, inter-op `1`을 유지하고
후보 세션은 intra-op `1`, inter-op `1`, spinning disabled로 고정한다. worker는
live active request와 waiter가 없음을 확인한 뒤 한 항목씩 시작한다. 이미 시작한
ONNX call은 안전하게 preempt할 수 없으므로 도중에 live request가 들어오면 그
한 건은 끝날 수 있지만, 다음 후보 항목은 live gate가 다시 idle이 될 때까지
시작하지 않는다.

후보 식별자는 local artifact 경로를 log에 넣지 않는다. 설정한 SemVer와
정규화된 public model ID만 aggregate에 기록한다. aggregate에 허용되는 값은
다음으로 제한한다.

- capture, pending, expired, evicted, oversized, decrypt error count
- compared, matched, mismatched, inference error, live-pause count와 agreement percent
- 기준·후보 model invocation과 accepted model detection의 bounded aggregate count
- 기준·후보 latency의 count, p50, p95, p99, max

raw input, redacted text, preview, detection value, span, offset, 개별 결과, tenant,
request ID와 hash는 aggregate log에 남기지 않는다. 현재 구현은 sanitized
structured log만 출력하며 ClickHouse, PostgreSQL, public/internal read API,
Event와 Metrics contract를 추가하지 않는다. durable aggregate 저장과 조회는
별도 계약 승인 후 연결한다.

최초 연결 검증은 기준과 후보 모두 canonical `v0.1.1` artifact를 사용한다.
같은 artifact의 100% 일치는 암호화·queue·재추론·비교 배관을 확인할 뿐, 새
후보 모델의 품질 승격, production 전체 활성화, SLA 또는 DLP 완성을 승인하지
않는다.

# GateLM AI Safety Detector Sidecar Contract

## 1. Status

이 문서는 AI Safety Lab의 local detector sidecar draft contract다.

이 계약은 Lab draft이며 기존 v2 Gateway 계약을 override하지 않는다. 제품 API, DB, Event, Metrics 계약으로 승격하려면 별도 계약 변경이 필요하다.

## 2. Endpoint

```text
contractVersion = ai-safety-detector.v1
POST /internal/ai-safety/v1/detect
```

이 endpoint는 Gateway와 같은 trusted runtime boundary 안의 CPU-only local process/container/pod에서 호출하는 후보 경로다. Hosted inference API로 raw prompt를 보내지 않는다.

## 3. Request Semantics

Sidecar request는 redaction 계산을 위해 transient prompt text를 받을 수 있다. 이 값은 민감 입력으로 취급하며 저장, log, error response, fixture, report에 복사하지 않는다.

Top-level request 후보:

```json
{
  "contractVersion": "ai-safety-detector.v1",
  "mode": "shadow",
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
    "returnConfidence": true
  }
}
```

`promptText` example은 synthetic placeholder만 사용한다. 실제 고객 문장, 실제 이메일, 실제 전화번호, 실제 token, 실제 credential을 문서나 fixture에 넣지 않는다.

## 4. Response Semantics

Sidecar는 `redactedPrompt`까지 만들어 반환한다. Gateway는 sidecar가 준 offset을 재해석하지 않는다.

Success response 후보:

```json
{
  "contractVersion": "ai-safety-detector.v1",
  "outcome": "redacted",
  "mode": "shadow",
  "redactedPrompt": "Contact [EMAIL_REDACTED].",
  "redactedPromptPreview": "Contact [EMAIL_REDACTED].",
  "detectorSummary": {
    "detectedCount": 1,
    "detectorCategories": ["email"]
  },
  "detections": [
    {
      "detectorType": "email",
      "source": "privacy_filter_adapter",
      "confidence": 0.91,
      "action": "redact",
      "mode": "shadow",
      "modelLabel": "private_email",
      "modelId": "openai/privacy-filter",
      "runtime": "cpu_only"
    }
  ],
  "latencyMs": 42
}
```

The response MUST NOT include:

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
| `private_person` | `person_name` | `redact` |
| `private_address` | `postal_address` | `redact` |
| `account_number` | `account_number` | `block` |
| `private_date` | `private_date` | `redact` |
| `private_url` | `private_url` | `redact` |
| `secret` | `secret` | `block` |

Additional `amoeba04/koelectra-small-v3-privacy-ner` label mapping:

| Model Label | GateLM Detector Type | Action Candidate |
|---|---|---|
| `ORG-B` / `ORG-I` | `organization_name` | `redact` |

When KoELECTRA is configured as an additional detector, the sidecar keeps the primary `model.modelId` as `openai/privacy-filter` and exposes KoELECTRA contribution through sanitized `detections[].source` and `detectorSummary.detectorCategories`.

## 9. Schema

The response shape is described by:

```text
docs/ai-safety-lab/schemas/detector-sidecar-response.schema.json
```

# GateLM AI Safety Lab Implementation Plan

## 1. Purpose

이 계획은 첨부된 PII detector 메모에서 뽑은 구현 순서와 확정된 결정사항을 정리한다.

목표는 regex/rule detector와 ML token-classification detector를 같은 형식으로 모으고, raw sensitive value를 저장하지 않는 redaction/block pipeline을 만든 뒤, 정확도와 latency가 충분해지면 pipeline adapter에서 AutoModel 또는 ONNX sidecar로 고도화하는 것이다.

확정된 시작점:

- ML detector는 처음에 `shadow`로 실행한다.
- 첫 ML detector model은 `openai/privacy-filter`다.
- 실행 환경은 CPU-only local sidecar다.
- Sidecar는 `redactedPrompt`까지 만들어서 반환한다.
- Confidence threshold는 계약에 고정하지 않고 evaluation 기준값으로만 둔다.
- 첫 ML 구현은 `transformers.pipeline()` adapter로 시작한다.
- Lab evidence는 처음에 `reports/ai-safety-lab/*` 파일로 남기고 DB/Event 계약은 만들지 않는다.

## 2. Target Flow

```text
prompt
-> RegexDetector.detect()
-> PrivacyFilterAdapter.detect()
-> label normalization
-> overlap merge / dedupe
-> policy evaluator: allow/redact/block
-> redaction engine
-> cache/routing/provider
```

여러 detector 결과를 바로 정책으로 연결하지 않고 공통 detection format으로 정규화한 뒤 결정한다.

## 3. Phase 1. Common Detection Format

모든 detector는 같은 logical result를 반환한다.

```text
detectorType
source
start
end
confidence
```

`start/end/raw span`은 redaction 계산용 memory-only 값이다. DB/API/log/metrics/UI에는 raw span, raw value, raw prompt fragment를 남기지 않는다.

최종 저장/노출 후보는 sanitized summary로 제한한다.

```json
{
  "outcome": "redacted",
  "redactedPromptPreview": "[EMAIL_REDACTED] placeholder preview only",
  "detectorSummary": {
    "detectedCount": 2,
    "detectorCategories": ["email", "person_name"]
  }
}
```

## 4. Phase 2. Regex And ML Adapter

POC/MVP에서는 `transformers.pipeline()` 기반 adapter를 먼저 붙인다.

ML adapter output은 처음에 Gateway production decision을 바꾸지 않는 `shadow` evidence로 취급한다.

Pipeline을 먼저 쓰는 이유:

- tokenizer, model call, token aggregation, span 생성이 거의 준비되어 있다.
- POC에서 빠르게 붙일 수 있다.
- redaction용 span을 만들기 쉽다.

후보 adapter 역할:

```text
HF model output label
-> GateLM detector type
-> normalized Detection
```

초기 label mapping 후보:

| Model Label | Detector Type |
|---|---|
| `private_email` | `email` |
| `private_phone` | `phone_number` |
| `private_person` | `person_name` |
| `private_address` | `postal_address` |
| `account_number` | `account_number` |
| `private_url` | `private_url` |
| `private_date` | `private_date` |
| `secret` | `secret` |

모델마다 label 이름이 다르므로 adapter가 label을 GateLM detector type으로 번역한다.

## 5. Phase 3. Policy Evaluator

Detector는 "무엇을 찾았다"만 말하고, GateLM 정책은 "어떻게 처리할지"를 결정한다.

Request-level action은 아래 우선순위로 결정한다.

```text
block > redact > allow
```

초기 action 후보:

```text
redact:
email
phone_number
postal_address
date_of_birth
person_name
customer_id
employee_id
account_id
ip_address
private_date
private_url

block:
resident_registration_number
api_key
authorization_header
jwt
private_key
provider_api_key
cloud_access_key
github_token
slack_token
database_url
webhook_url
session_cookie
credit_card
bank_account
password_assignment
passport_number
driver_license
account_number
secret
```

## 6. Phase 4. Redaction Engine

Redaction은 뒤에서 앞으로 치환해 offset 변형 문제를 피한다.

초기 placeholder 후보:

```text
[EMAIL_REDACTED]
[PHONE_NUMBER_REDACTED]
[PERSON_NAME_REDACTED]
[ADDRESS_REDACTED]
[DATE_OF_BIRTH_REDACTED]
[CUSTOMER_ID_REDACTED]
[EMPLOYEE_ID_REDACTED]
[ACCOUNT_ID_REDACTED]
[ACCOUNT_NUMBER_REDACTED]
[IP_ADDRESS_REDACTED]
[PRIVATE_DATE_REDACTED]
[PRIVATE_URL_REDACTED]
[API_KEY_REDACTED]
[SECRET_REDACTED]
```

한국어와 특수문자에서 Python과 JavaScript/Go offset 기준이 다를 수 있으므로, sidecar가 `redactedPrompt`까지 만들어 반환한다.

Gateway는 sidecar가 만든 redacted prompt를 memory-only로 받아 policy/cache/provider path로 넘긴다.

## 7. Phase 5. Local Sidecar

Gateway 서버 안에 PyTorch/HF 모델 코드를 직접 넣지 않는다.

Sidecar draft API:

```text
contractVersion = ai-safety-detector.v1
POST /internal/ai-safety/v1/detect
runtime = cpu_only
modelId = openai/privacy-filter
```

후보 구조:

```text
Python PII Detector Sidecar
  - CPU-only local runtime
  - openai/privacy-filter model load
  - prompt PII detection
  - redactedPrompt generation
  - detectorType / confidence / span calculation
```

Gateway 호출 흐름:

```text
Gateway safety stage
-> local PII detector service
-> redactedPrompt + sanitized detection result
-> policy evaluator
-> redaction/block
```

Hosted inference API로 raw prompt를 보내지 않는다. 같은 서버, 컨테이너, pod 근처에서 돌아가는 local process/service로 둔다.

## 8. Phase 6. Confidence And Shadow Promotion

Confidence 기준은 모델 공통 하나로 정하지 않는다. `model + detectorType + action`별로 평가한다.

Threshold는 계약 값이 아니라 `evaluation-plan.md`의 기준 후보로만 둔다.

초기 후보:

```text
>= 0.90 enforce 후보 관찰
0.70 ~ 0.90 shadow/evidence
< 0.70 drop 후보
critical label은 낮은 confidence라도 shadow 기록 후보
```

권장 승격 순서:

```text
1. regex/rule enforce
2. NER PII model shadow
3. confidence / false positive 기준 측정
4. 일부 detectorType만 redact 승격
5. critical 계열만 block 승격
```

## 9. Phase 7. Overlap Merge And Dedupe

여러 detector가 같은 범위를 찾을 수 있다.

초기 충돌 처리 후보:

```text
1. 최종 action은 block > redact > allow 순서로 결정한다.
2. 겹치는 span의 detectorType이 다르면 risk rank와 span coverage를 함께 본다.
3. 같은 action 등급이면 더 긴 span 또는 더 높은 confidence를 우선한다.
4. regex secret detector가 ML detector보다 우선한다.
```

## 10. Phase 8. Failure And Timeout

Sidecar 실패 정책 후보:

```text
regex detector failure -> fail closed
critical detector failure -> fail closed
ML NER timeout/failure -> shadow unavailable, regex 결과로 계속 진행
sidecar 전체 장애 -> regex-only fallback
```

Latency budget 후보:

```text
regex: 필수, 즉시
openai/privacy-filter CPU-only sidecar: 먼저 측정 후 p95 target 설정
전체 safety stage: 800ms ~ 1200ms
```

Parallel ensemble은 정확도에는 좋지만 비용과 지연이 커지므로 POC 후 판단한다.

## 11. Phase 9. Model Runtime Evolution

초기:

```text
pipeline adapter
```

정확도와 latency를 더 제어해야 하는 단계:

```text
AutoModelForTokenClassification
```

운영 최적화 단계:

```text
ONNX Runtime sidecar
```

AutoModel 단계에서는 tokenizer offset mapping, logits to label ids, BIO/BIOES span decoding, subword span merge, confidence 계산, overlap dedupe가 필요하다.

ONNX 단계에서는 export, 검증, quantization, tokenizer/전처리 관리가 추가된다.

## 12. POC Questions

POC에서 확인할 질문:

- HF 한국어 NER 모델을 local에서 돌릴 수 있는가.
- 이메일, 전화번호, 이름을 어느 정도 찾는가.
- latency가 너무 느리지 않은가.
- false positive가 과하지 않은가.
- Gateway detector adapter 구조에 맞게 붙일 수 있는가.

# GateLM AI Safety Lab Contracts

## 1. Status

이 문서는 AI Safety Lab의 PII detector / token-classification / sidecar safety 작업을 위한 Lab draft 계약 틀이다.

아직 기존 `specs/gateway/v2.0.0/contracts.md`보다 우선하는 공식 GateLM 제품 계약이 아니다. API route, DB column, Event field, Metrics label을 새로 확정하려면 기존 공식 계약과 schema/fixture를 먼저 확인한다.

## 2. Non-Override Rule

이 문서는 기존 GateLM 보안 규칙을 낮추지 않는다.

MUST NOT:

- raw prompt를 저장하거나 노출한다.
- raw response를 저장하거나 노출한다.
- raw detected value를 저장하거나 노출한다.
- raw prompt fragment를 저장하거나 노출한다.
- raw offset 또는 span을 DB/API/log/metrics/UI에 남긴다.
- API Key, App Token, Provider Key, Authorization header, actual secret을 평문으로 남긴다.
- Provider 호출 후에만 safety redaction을 적용한다.

## 3. Confirmed Decisions

| Topic | Decision |
|---|---|
| Initial ML detector mode | `shadow` |
| First ML detector model | `openai/privacy-filter` |
| Sidecar runtime | CPU-only local sidecar |
| Sidecar output | `redactedPrompt`까지 반환 |
| First ML adapter | `transformers.pipeline()` |
| Confidence threshold | 계약에 고정하지 않고 evaluation 기준값으로만 관리 |
| Sidecar contract version | `ai-safety-detector.v1` |
| Sidecar endpoint candidate | `POST /internal/ai-safety/v1/detect` |
| Confidence exposure | Lab/eval response 허용, Gateway/API/UI summary 기본 비노출 |
| Evidence storage | `reports/ai-safety-lab/*` 파일 evidence 우선 |

## 4. Safety Pipeline Shape

AI Safety Lab의 기본 detector 흐름은 아래 형태를 따른다.

```text
prompt
-> regex/rule detector
-> ML PII detector adapter
-> label normalization
-> overlap merge / dedupe
-> policy evaluator
-> redaction engine
-> downstream routing/cache/provider path
```

Request-side safety는 downstream routing, cache, provider call, streaming start보다 먼저 완료되어야 한다.

초기 ML detector는 `shadow`로 시작한다. regex/rule detector가 초기 enforcement baseline이며, ML detector의 enforce 승격은 evaluation evidence와 별도 계약 판단 이후에만 한다.

`openai/privacy-filter`는 첫 ML detector model이다. 이 모델도 초기에는 shadow로만 실행한다.

## 5. Detection Shape

Detector 내부 공통 결과는 아래 논리 필드를 가진다.

| Field | Meaning | Storage Rule |
|---|---|---|
| `detectorType` | GateLM 표준 detector category | sanitized label만 저장 가능 |
| `source` | detector 또는 model source | sanitized low-cardinality label만 저장 가능 |
| `confidence` | detector confidence | Lab/eval response에는 허용, Gateway/API/UI summary에는 기본 비노출 |
| `start` | redaction 계산용 시작 위치 | memory-only |
| `end` | redaction 계산용 끝 위치 | memory-only |

`start`, `end`, raw span, model output의 raw `word` 값은 redaction 계산 중에만 사용한다.

## 6. Sanitized Safety Summary

Gateway나 UI/read model에 남길 수 있는 safety summary 후보는 아래처럼 raw value를 포함하지 않는 형태다.

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

`detectorCategories`는 낮은 cardinality의 category label이어야 하며 raw value, raw prompt fragment, raw offset을 포함하지 않는다.

`redactedPromptPreview`는 선택적 sanitized preview다. 실제 고객 문장, raw detected value, raw prompt fragment, credential-looking value를 포함하지 않는다.

## 7. Detector Type Candidates

초기 후보 detector type:

```text
email
phone_number
postal_address
date_of_birth
person_name
organization_name
customer_id
employee_id
account_id
account_number
ip_address
private_date
private_url
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
secret
address
unknown_pii
```

Detector type은 모델별 raw label을 그대로 노출하지 않고 GateLM 표준 label로 정규화한다.

예시 mapping 후보:

| Model / Rule Label | GateLM Detector Type |
|---|---|
| `EMAIL` | `email` |
| `TEL` / `PHONE` | `phone_number` |
| `PER` / `PS_NAME` | `person_name` |
| `LOC` / `ADDRESS` | `postal_address` 또는 `address` |
| `ORG` | `organization_name` |
| `account_number` | `account_number` |
| `private_date` | `private_date` |
| `private_url` | `private_url` |
| `secret` | `secret` |

## 8. OpenAI Privacy Filter Mapping

Initial `openai/privacy-filter` label mapping:

| Model Label | GateLM Detector Type | Default Action Candidate |
|---|---|---|
| `private_email` | `email` | `redact` |
| `private_phone` | `phone_number` | `redact` |
| `private_person` | `person_name` | `redact` |
| `private_address` | `postal_address` | `redact` |
| `account_number` | `account_number` | `block` |
| `private_date` | `private_date` | `redact` |
| `private_url` | `private_url` | `redact` |
| `secret` | `secret` | `block` |

`account_number` remains a separate detector type from `account_id` and uses the `block` action candidate for this Lab track. Low-risk account identifiers can continue to use `account_id` with a redact action.

`secret` from `openai/privacy-filter` maps to `secret`. Existing regex/rule secret detectors remain the enforce baseline for critical block behavior.

Additional `amoeba04/koelectra-small-v3-privacy-ner` label mapping:

| Model Label | GateLM Detector Type | Default Action Candidate |
|---|---|---|
| `ORG-B` / `ORG-I` | `organization_name` | `redact` |

## 9. Request-Level Action

Policy evaluator는 detector 결과를 request-level action으로 접는다.

```text
block > redact > allow
```

기본 action 후보:

### redact

- `email`
- `phone_number`
- `postal_address`
- `date_of_birth`
- `person_name`
- `organization_name`
- `customer_id`
- `employee_id`
- `account_id`
- `ip_address`
- `private_date`
- `private_url`

### block

- `resident_registration_number`
- `api_key`
- `authorization_header`
- `jwt`
- `private_key`
- `provider_api_key`
- `cloud_access_key`
- `github_token`
- `slack_token`
- `database_url`
- `webhook_url`
- `session_cookie`
- `credit_card`
- `bank_account`
- `password_assignment`
- `passport_number`
- `driver_license`
- `account_number`
- `secret`

Critical 계열은 낮은 confidence라도 관찰/evidence에 남길 수 있지만, raw value는 남기지 않는다.

## 10. Redaction Placeholder Candidates

Redaction placeholder 후보:

```text
[EMAIL_REDACTED]
[PHONE_NUMBER_REDACTED]
[PERSON_NAME_REDACTED]
[ORGANIZATION_NAME_REDACTED]
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

Placeholder는 raw value의 prefix/suffix를 포함하지 않는다.

## 11. Local Sidecar Boundary

ML model 실행은 Gateway 내부 dependency로 직접 넣기보다 local sidecar로 분리한다.

Sidecar draft API:

```text
contractVersion = ai-safety-detector.v1
POST /internal/ai-safety/v1/detect
```

Sidecar 원칙:

- CPU-only local process/container/pod 근처에서 실행한다.
- Hugging Face hosted inference API로 raw prompt를 보내지 않는다.
- Gateway는 sidecar의 `redactedPrompt`와 sanitized result만 사용한다.
- sidecar는 raw prompt, raw span, raw detected value를 log/response/error에 남기지 않는다.
- sidecar response는 `redactedPrompt`를 반환하여 Gateway가 runtime별 offset 차이를 해석하지 않게 한다.

Sidecar API의 자세한 request/response shape는 `detector-sidecar-contract.md`에서 별도로 작성한다.

## 12. Confidence And Mode

Confidence threshold는 이 계약에 고정하지 않는다. 기준값은 `evaluation-plan.md`의 평가 후보로만 둔다.

Confidence 기준은 모델 공통 하나로 고정하지 않고 `model + detectorType + action` 조합별로 평가한다.

초기 평가 후보:

| Confidence Band | Candidate Mode |
|---|---|
| `>= 0.90` | enforce 후보 관찰 |
| `0.70 ~ 0.90` | shadow/evidence |
| `< 0.70` | drop 후보 |

이 값은 production policy가 아니라 평가 시작점이다.

## 13. Timeout And Failure

초기 failure policy 후보:

| Failure | Candidate Behavior |
|---|---|
| regex detector failure | fail closed |
| critical detector failure | fail closed |
| ML NER timeout/failure | shadow unavailable, continue with regex result |
| full sidecar unavailable | regex-only fallback |

초기 latency budget 후보:

| Stage | Candidate Budget |
|---|---|
| regex | immediate |
| openai/privacy-filter CPU-only sidecar | measure first, then set p95 target |
| full safety stage | 800 ms ~ 1200 ms |

## 14. Schema Targets

AI Safety Lab schema scope:

```text
schemas/safety-detection.schema.json
schemas/safety-summary.schema.json
schemas/detector-sidecar-response.schema.json
schemas/eval-case.schema.json
schemas/master-eval-case.schema.json
```

이 schema들은 Lab draft 검증용이다. 기존 v2 schema/fixture 계약을 대체하지 않는다.

`master-eval-case.schema.json` is the single master corpus row contract for
synthetic AI Safety Lab evaluation. A master row keeps one `inputTemplate` and
separates target-specific expectations under `expectations.gateway`,
and `expectations.detector`. Runners must read only the expectation block they
evaluate. This keeps Gateway enforce checks and sidecar detector checks aligned
without forcing them to share one final outcome.

The master corpus is the broad shadow evaluation dataset and currently targets
1000 synthetic cases. Normal unit/integration tests should stay on small
representative sidecar responses rather than the full eval corpus.

## 15. Evidence And Metrics

Shadow/evaluation evidence는 처음에 DB/Event 계약을 만들지 않고 파일 report로 둔다.

```text
reports/ai-safety-lab/*
```

Metrics label 후보는 low-cardinality 값만 허용한다.

허용 후보:

```text
detectorType
action
outcome
mode
```

금지:

```text
requestId
traceId
hash
raw error
prompt-related value
raw prompt
raw detected value
credential material
```

## 16. Open Decisions

- model별 label mapping의 기준 파일 위치
- shadow result를 어떤 report shape로 저장할지
- person/address/organization 같은 ML detector를 언제 enforce로 승격할지
- confidence threshold와 latency budget을 어떤 report로 승인할지

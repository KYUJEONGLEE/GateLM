# GateLM AI Safety Lab

이 디렉터리는 v2.0.0 이후 이어갈 AI Safety / Evaluation Lab 작업을 위한 독립 문서 트랙이다.

현재 초점은 request-side PII detector, local detector sidecar, sanitized detector summary, redaction/block policy, 그리고 evaluation evidence다.

이 문서는 기존 `docs/v2.0.0` 계약을 대체하지 않는다. 기존 GateLM 계약과 충돌하는 경우 기존 공식 계약과 보안 규칙을 우선한다.

## 1. Purpose

AI Safety Lab은 아래 질문에 답하기 위한 문서와 근거를 모은다.

- Gateway safety stage에서 PII detector를 어떻게 붙일 것인가.
- Regex/rule detector와 ML NER detector 결과를 어떤 공통 형식으로 정규화할 것인가.
- raw prompt, raw detected value, raw span, raw prompt fragment를 저장하지 않고 어떤 sanitized summary만 남길 것인가.
- Python local sidecar를 어떻게 운영하고, timeout/failure 시 Gateway가 어떻게 행동할 것인가.
- detector 품질, false positive, false negative, latency를 어떤 corpus와 report로 검증할 것인가.

## 2. Confirmed Decisions

| Topic | Decision |
|---|---|
| Document status | `docs/ai-safety-lab`은 Lab draft이며 기존 v2 계약을 override하지 않는다. |
| Initial ML mode | ML detector는 처음에 `shadow`로 시작한다. |
| ML model | `openai/privacy-filter`를 첫 ML detector model로 사용한다. |
| Runtime | CPU-only local sidecar로 실행한다. |
| Sidecar output | Sidecar가 `redactedPrompt`까지 만들어 반환한다. |
| First ML adapter | 첫 구현은 `transformers.pipeline()` adapter로 한다. |
| Confidence thresholds | 계약에는 고정하지 않고 `evaluation-plan.md`의 기준값으로만 둔다. |
| Schema scope | `safety-detection`, `safety-summary`, `detector-sidecar-response`, `eval-case` 4개 schema부터 둔다. |
| Sidecar version | `contractVersion="ai-safety-detector.v1"` |
| Sidecar path candidate | `POST /internal/ai-safety/v1/detect` |
| Confidence visibility | Lab/eval response에는 허용, Gateway/API/UI summary에는 기본 비노출 |
| Preview | `redactedPromptPreview`는 sanitized preview로 둔다. |
| Corpus data | synthetic placeholder 기반만 허용한다. 실제 고객 문장, 실제 이메일/전화번호/토큰은 금지한다. |
| Shadow evidence | 처음엔 DB 계약 없이 `reports/ai-safety-lab/*` 파일 evidence로 둔다. |
| Metrics labels | detector type/action/outcome 같은 low-cardinality 값만 허용한다. requestId, hash, raw error, prompt 관련 값은 label 금지다. |

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

## 3. Directory Map

| Path | Purpose |
|---|---|
| `README.md` | AI Safety Lab 문서 입구와 작업 기준 |
| `contracts.md` | PII detector / safety outcome Lab 계약 틀 |
| `detector-sidecar-contract.md` | local detector sidecar draft contract |
| `implementation-plan.md` | 첨부 PII detector 메모 기반 구현 계획 |
| `evaluation-plan.md` | 기존 safety eval 방식과 새 PII detector 평가 계획 |
| `resource-latency-benchmark.md` | local sidecar 리소스/지연시간 벤치마크 측정 프로토콜과 리포트 템플릿 |
| `fixtures/` | 향후 synthetic safety eval fixture 위치 |
| `schemas/` | AI Safety Lab 전용 JSON Schema 위치 |

Schema scope:

```text
schemas/safety-detection.schema.json
schemas/safety-summary.schema.json
schemas/detector-sidecar-response.schema.json
schemas/eval-case.schema.json
```

## 4. Current Main Path

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

Python/HF/ONNX 모델 코드는 Gateway 서버 안에 직접 넣지 않고 local sidecar로 분리한다.

```text
Gateway safety stage
-> local PII detector service
-> redactedPrompt + sanitized detection result
-> policy evaluator
-> redaction/block
```

## 5. Security Baseline

아래 값은 API response, DB record, fixture, structured log, metric label, UI에 평문으로 남기지 않는다.

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- raw offset
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret

`start/end/raw span`은 redaction 계산을 위한 hot-path memory-only 값으로 취급한다.

## 6. Recommended Work Order

1. `contracts.md`에서 detector type, action, summary, failure 정책의 틀을 확정한다.
2. `detector-sidecar-contract.md`에서 `ai-safety-detector.v1` request/response shape를 관리한다.
3. `evaluation-plan.md`에서 synthetic corpus와 report shape를 정한다.
4. `schemas/`의 4개 schema로 Lab draft output을 검증한다.
5. `implementation-plan.md` 순서대로 regex baseline, ML sidecar shadow, enforce promotion을 진행한다.

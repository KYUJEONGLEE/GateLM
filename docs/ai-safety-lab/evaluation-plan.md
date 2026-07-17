# GateLM AI Safety Lab Evaluation Plan

## 1. Summary

이 문서는 AI Safety Lab의 PII detector, redaction/block policy, local sidecar 후보를 평가하는 계획이다.

기존 v1 safety eval 방식과 같은 방향을 따른다.

- synthetic corpus를 사용한다.
- detector output과 expected decision을 비교한다.
- redaction/block이 provider/cache보다 먼저 적용되는지 확인한다.
- report에는 raw prompt, raw response, raw secret, raw detected value를 복사하지 않는다.
- 결과는 demo-baseline 또는 lab evidence로 설명하고 production-grade DLP coverage로 주장하지 않는다.

확정된 평가 기준:

- ML detector는 처음에 `shadow`로 평가한다.
- 첫 ML detector model은 `openai/privacy-filter`다.
- 실행 환경은 CPU-only local sidecar다.
- Sidecar response는 `redactedPrompt`를 포함한다.
- Confidence threshold는 계약이 아니라 이 문서의 평가 기준값으로만 둔다.
- Confidence는 Lab/eval response에는 허용하지만 Gateway/API/UI summary에는 기본 비노출로 본다.
- `redactedPromptPreview`는 sanitized preview로 둔다.
- Shadow evidence는 `reports/ai-safety-lab/*` 파일에 둔다.

## 2. Source Documents

| Document | Used For |
|---|---|
| `docs/v1.0.0/fixtures/safety-eval-corpus.jsonl` | synthetic corpus 구조와 expected safety decision 형식 |
| `docs/v1.0.0/schemas/safety-eval-corpus.schema.json` | eval case field shape |
| `docs/v1.0.0/checks/rule-quality-report.md` | report structure, quality claim boundary, raw value handling |
| `docs/v1.0.0/remote-safety-engine-contract.md` | optional shadow/evaluation service behavior |
| `docs/v2.0.0/acceptance-test-matrix.md` | safety redact/block acceptance와 provider/cache bypass expectation |
| `docs/policies/pii-masking-policy.md` | detector/action/redaction/storage security 기준 |
| `docs/ai-safety-lab/schemas/*.schema.json` | Lab draft schema validation |
| 첨부 PII detector 메모 | ML sidecar, confidence, latency, POC 질문 |

이 문서는 위 문서의 보안 기준을 낮추지 않는다.

## 3. Evaluation Scope

평가 대상:

- Regex/rule detector baseline.
- ML token-classification adapter output.
- Label normalization.
- Overlap merge / dedupe.
- Policy evaluator action.
- Redaction placeholder output.
- Local sidecar timeout/failure behavior.
- Sanitized detector summary.

평가 제외:

- Production-grade full DLP coverage.
- 모든 국가별 식별자 format coverage.
- OCR, file upload, image/audio input scanning.
- Provider response-side safety scan.
- Raw prompt/response storage opt-in.
- Hosted inference API로 raw prompt를 보내는 방식.

## 4. Evaluation Modes

| Mode | Meaning | Claim Level |
|---|---|---|
| `detector_output` | detector와 policy output을 fixture expectation과 비교 | detector/action 품질 근거 |
| `sidecar_shadow` | local sidecar를 shadow로 호출하고 Gateway main decision은 바꾸지 않음 | sidecar 품질/latency 근거 |
| `gateway_safety_output` | Gateway path에서 safety block/redact/cache/provider effect를 확인 | runtime behavior 근거 |

`detector_output`만 있는 동안 provider/cache bypass는 직접 증명하지 않고 계약과 expectation으로만 설명한다. `gateway_safety_output`이 있으면 runtime evidence로 승격할 수 있다.

Initial ML evidence는 `sidecar_shadow` 또는 `detector_output` 모드로 시작한다.

## 5. Corpus Shape

기존 v1 safety eval corpus 구조는 호환용 runner에서 유지한다.

```text
caseId
inputTemplate
placeholderBindings
expectedSafetyDecision
expectedGatewayEffects
tags
```

`inputTemplate`에는 실제 개인정보나 secret을 넣지 않고 synthetic placeholder만 둔다.

실제 고객 문장, 실제 이메일, 실제 전화번호, 실제 토큰, 실제 credential은 corpus에 넣지 않는다.

예상 safety decision 필드:

```text
action
detectedTypes
detectedCount
redactedPromptPreview
blockReason
securityPolicyHash 또는 policyVersion
```

`redactedPromptPreview`는 placeholder만 포함하는 sanitized preview다.

예상 Gateway effect 필드:

```text
providerCalled
cacheLookup
terminalStatus
httpStatus
errorCode
```

AI Safety Lab 전용 schema는 `docs/ai-safety-lab/schemas/eval-case.schema.json`에 둔다.

새 통합 평가셋은 single master corpus 방식을 따른다.

```text
docs/ai-safety-lab/fixtures/master-safety-eval-corpus.jsonl
docs/ai-safety-lab/schemas/master-eval-case.schema.json
```

Master corpus 한 줄은 하나의 synthetic `inputTemplate`을 공유하고, target별 기대값을 분리한다.

```text
caseId
locale
inputTemplate
placeholderBindings
expectations.gateway
expectations.detector
tags
```

`expectations.gateway`는 Gateway enforce 계약 확인에만 사용한다. 예: safety outcome,
provider/cache/streaming 여부, terminalStatus, httpStatus, errorCode.

`expectations.detector`는 ai-service detector/sidecar 결과 확인에만 사용한다. 예: detector
outcome, mode, detectedTypes, detectedCount, blockReason.

Runner는 평가 목적에 맞는 expectation block만 읽는다. 같은 input case를 쓰더라도 Gateway
enforce path와 detector shadow path의 최종 outcome이 다를 수 있다.

The master corpus target size is 1000 synthetic cases for shadow evaluation. Unit
tests may validate the full corpus shape and distribution, but normal
Gateway/ai-service contract tests should keep small representative sidecar
responses instead of turning the eval corpus into hot-path or CI payload.

## 6. Required Case Groups

| Group | Purpose |
|---|---|
| safe none | 민감정보가 없는 요청이 allow되는지 확인 |
| basic redaction | email, phone_number 같은 redaction category 확인 |
| name/address/organization shadow | person_name, postal_address, organization_name 같은 ML category의 false positive 관찰 |
| critical block | api_key, authorization_header, jwt, resident_registration_number block 확인 |
| repeated detection | 같은 detector type이 여러 번 등장할 때 count 확인 |
| overlap conflict | 같은 span 또는 겹친 span에서 action 우선순위 확인 |
| label mapping | model raw label이 GateLM detector type으로 정규화되는지 확인 |
| confidence threshold | confidence band별 drop/shadow/enforce 후보 확인 |
| privacy-filter mapping | `openai/privacy-filter` model label이 GateLM detector type/action으로 매핑되는지 확인 |
| cpu-only latency | CPU-only local sidecar에서 p50/p95 latency를 확인 |
| sidecar timeout | ML timeout 시 regex-only 또는 block 후보 확인 |
| sidecar unavailable | sidecar 전체 장애 시 mode별 fallback 확인 |
| latency budget | safety stage latency가 후보 budget 안에 들어오는지 확인 |
| forbidden output | report/log/API response에 raw value가 없는지 확인 |

## 7. POC Questions

첨부 메모 기준 POC 질문:

- HF 한국어 NER 모델을 local에서 실행할 수 있는가.
- 이메일, 전화번호, 이름을 어느 정도 찾는가.
- latency가 너무 느리지 않은가.
- false positive가 과하지 않은가.
- Gateway detector adapter 구조에 맞게 붙일 수 있는가.

## 8. Metrics

Report는 최소 아래 summary를 제공한다.

| Metric | Meaning |
|---|---|
| totalCases | 전체 eval case 수 |
| passedCases | 통과 case 수 |
| failedCases | 실패 case 수 |
| passRate | 통과율 |
| falsePositiveCases | 오탐 case 수 |
| falseNegativeCases | 미탐 case 수 |
| actionMismatchCases | expected action과 actual action 불일치 |
| gatewayEffectMismatchCases | expected provider/cache/status effect 불일치 |
| countMismatchCases | detectedCount 불일치 |
| p50LatencyMs | detector 또는 sidecar latency p50 |
| p95LatencyMs | detector 또는 sidecar latency p95 |
| confidenceDistribution | Lab/eval 전용 confidence band 분포 |
| cpuOnlyP95LatencyMs | CPU-only local sidecar p95 latency |

Detector type별 요약:

```text
detectorType
expectedAction
includedCases
passedCases
precision
recall
falsePositive
falseNegative
countMismatch
```

## 9. Action Expectations

`redacted` 동작:

- redacted representation만 downstream으로 보낸다.
- raw sensitive value가 cache/provider/log/report에 남지 않는다.
- 더 강한 detector가 함께 없으면 request는 계속 진행할 수 있다.

`blocked` 동작:

- provider call 전에 멈춘다.
- cache lookup 또는 cache write를 하지 않는다.
- streaming을 시작하지 않는다.
- blocked request는 시스템 장애가 아니라 policy result로 해석한다.

## 10. Latency Expectations

초기 latency 후보:

| Stage | Candidate Budget |
|---|---:|
| regex | immediate |
| openai/privacy-filter CPU-only sidecar | measure first, then set p95 target |
| full safety stage | 800 ms ~ 1200 ms |

Parallel ensemble은 별도 scenario로 측정한다. 정확도가 좋아져도 latency budget을 넘으면 enforce 승격 후보에서 제외할 수 있다.

## 11. OpenAI Privacy Filter Mapping

Initial `openai/privacy-filter` label mapping:

| Model Label | GateLM Detector Type | Expected Action Candidate |
|---|---|---|
| `private_email` | `email` | `redacted` |
| `private_phone` | `phone_number` | `redacted` |
| `private_address` | `postal_address` | `redacted` |
| `account_number` | `account_number` | `blocked` |
| `private_date` | `private_date` | `redacted` |
| `private_url` | `private_url` | `redacted` |
| `secret` | `secret` | `blocked` |

For the pinned `amoeba04/koelectra-small-v3-privacy-ner` bundle, accepted labels are email, phone number, and resident registration number. Person-name and organization-name evaluation rows are rule-backstop evidence, not model evidence.

Because `openai/privacy-filter` starts in `shadow`, blocked action candidates from this model do not prove provider/cache bypass. Provider/cache bypass remains a regex/rule enforce or Gateway integration evidence claim.

## 12. Confidence Threshold Candidates

Confidence threshold는 계약이 아니라 평가 기준 후보로만 사용한다.

| Confidence Band | Candidate Evaluation Use |
|---|---|
| `>= 0.90` | enforce 후보 관찰 |
| `0.70 ~ 0.90` | shadow/evidence |
| `< 0.70` | drop 후보 |

모델 score는 모델마다 의미가 다르므로 `model + detectorType + action`별로 별도 해석한다.

## 13. Sidecar Failure Expectations

| Failure | Expected Eval Check |
|---|---|
| regex detector failure | fail-closed 후보가 명확한가 |
| critical detector failure | fail-closed 후보가 명확한가 |
| ML NER timeout/failure | shadow unavailable로 기록하고 regex result로 계속 가능한가 |
| full sidecar unavailable | regex-only fallback이 명확한가 |
| invalid sidecar response | raw error body 없이 sanitized failure로 처리되는가 |

## 14. Report Raw Value Rules

Report에 포함할 수 있는 것:

- Case ID.
- Detector type.
- 기대 action과 실제 action.
- 통과/실패 결과.
- 집계 지표.
- Latency summary.
- Confidence summary.
- Report metadata.
- Documentation path.

Report에 포함하면 안 되는 것:

- Source prompt template 또는 전체 prompt.
- Raw response.
- Raw secret, credential, token, authorization value.
- Raw detected sensitive value.
- Raw prompt fragment.
- Raw offset/span.
- Sample hash value.
- Full fixture result body, except sanitized contract fixture snippets that contain only caseId, labels, enum values, counts, and `{INPUT_PROMPT}` placeholders.

근거가 필요하면 case payload를 복사하지 말고 report path를 연결한 뒤 안전한 집계 field만 요약한다.

## 15. Evidence Outputs

향후 report 후보:

```text
reports/ai-safety-lab/detector-output-report.json
reports/ai-safety-lab/detector-output-report.md
reports/ai-safety-lab/sidecar-shadow-report.json
reports/ai-safety-lab/sidecar-shadow-report.md
reports/ai-safety-lab/gateway-safety-output-report.json
reports/ai-safety-lab/gateway-safety-output-report.md
reports/ai-safety-lab/resource-latency-benchmark.json
reports/ai-safety-lab/resource-latency-benchmark.md
```

이 report들은 raw prompt, raw response, raw secret, raw detected value를 포함하지 않는다.

## 16. Metrics Label Guard

Lab 또는 future metrics label 후보는 low-cardinality 값만 허용한다.

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

## 17. Release Claim Boundary

AI Safety Lab report가 주장할 수 있는 것:

- synthetic corpus 기준 detector/action 품질.
- 특정 detector type의 redaction/block expectation 충족 여부.
- local sidecar latency와 failure behavior.
- Gateway safety ordering evidence가 있는 경우 provider/cache bypass 여부.

AI Safety Lab report가 주장하면 안 되는 것:

- 모든 개인정보/secret format에 대한 완전 탐지.
- production-grade DLP coverage.
- live customer traffic에서의 정확도 보장.
- raw prompt 저장 없이 모든 debugging이 가능하다는 단정.

## 18. Verification Checklist

```text
[ ] Corpus는 synthetic placeholder만 사용한다.
[ ] Fixture에 실제 개인정보 또는 secret이 없다.
[ ] Report에 raw prompt/raw response/raw detected value가 없다.
[ ] Detector output은 GateLM detector type으로 정규화된다.
[ ] Redaction 결과는 placeholder만 포함한다.
[ ] Block case는 provider/cache/streaming bypass expectation을 가진다.
[ ] Sidecar timeout/failure scenario가 있다.
[ ] Latency summary가 있다.
[ ] Confidence summary는 Lab/eval report에만 있다.
[ ] False positive / false negative / action mismatch가 분리된다.
[ ] Metrics label 후보에 high-cardinality/raw/prompt-related 값이 없다.
[ ] Claim boundary가 report에 명시된다.
```

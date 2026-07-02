# GateLM 카테고리 평가셋 계약

## 1. 상태

이 문서는 카테고리 분류기 평가 데이터의 첫 번째 계약을 정의한다.

이 문서는 Advanced Routing을 위한 evidence 계약이다. v2.0.0 Gateway hot-path 계약, RuntimeConfig 계약, Provider 계약, Request Log 계약, Metrics 계약, 금지 데이터 규칙은 변경하지 않는다.

이 문서가 `docs/v2.0.0/contracts.md`와 충돌하면 `docs/v2.0.0/contracts.md`를 우선한다.

## 2. 목표

현재 GateLM은 가벼운 룰 기반 분류기로 프롬프트를 분류한다. 이후 분류 품질을 높이려면 먼저 안전한 평가셋이 필요하다.

이 평가셋은 아래 질문에 답할 수 있어야 한다.

```text
Given a redacted prompt, what category should the classifier return?
```

이 PR은 평가셋의 형식만 고정한다. 실시간 샘플 수집, LLM judge 호출, 모델 학습, 런타임 라우팅 변경은 포함하지 않는다.

## 3. 카테고리 분류 체계

첫 평가셋은 현재의 low-cardinality 라우팅 카테고리를 사용한다.

| Category | 의미 | 라우팅 의도 |
|---|---|---|
| `general` | 일반 대화, 요약, 설명, 아직 분류되지 않은 업무 요청 | 기본 라우팅 또는 길이 기반 라우팅 |
| `code` | 프로그래밍, 디버깅, stack trace, 리팩터링, 구현 도움 | 고품질 모델 라우팅 후보 |
| `translation` | 언어 간 번역 또는 문장 재작성 | 균형형 모델 라우팅 후보 |
| `support_refund` | 환불, 결제, 취소, 반품, 고객 지원 | 저비용 모델 라우팅 후보 |
| `unknown` | 비어 있거나, 유효하지 않거나, 분류가 불가능한 입력 | 안전한 fallback |

새 카테고리가 `RoutingDecisionKey` 또는 cache key material에 영향을 주려면 먼저 계약을 갱신해야 한다.

## 4. 평가셋 레코드 형식

평가셋의 각 행은 하나의 JSON object다. 저장 형식은 JSONL을 권장한다.

필수 필드:

| Field | Type | 의미 |
|---|---|---|
| `schemaVersion` | string | 반드시 `gatelm.category-evaluation-record.v1`이어야 한다 |
| `datasetVersion` | string | 평가셋 릴리즈 식별자. 예: `category_eval_2026_07_02_v1` |
| `sampleId` | string | 안정적인 synthetic 또는 generated sample id. raw prompt text를 인코딩하면 안 된다 |
| `redactedPrompt` | string | 평가에 사용하는 safety-masked prompt text. 최대 65536자 |
| `expectedCategory` | string | 승인된 카테고리 분류 체계 값 중 하나 |
| `labelSource` | string | label이 만들어진 방식 |
| `consentType` | string | 이 sample을 사용할 수 있는 근거 |
| `source` | string | sample이 온 출처 |
| `language` | string | low-cardinality 언어 bucket |
| `redactionVersion` | string | sample 저장 전에 사용한 redaction 또는 masking policy version |
| `createdAt` | string | ISO-8601 timestamp |

선택 필드:

| Field | Type | 의미 |
|---|---|---|
| `labelConfidence` | number | `0.0`부터 `1.0`까지. 주로 pseudo-label 또는 reviewer confidence에 사용 |
| `reviewerNote` | string | 짧고 안전한 메모. raw prompt fragment 또는 secret을 포함하면 안 된다 |

## 5. 허용 값

`labelSource`:

- `human_review`
- `synthetic_fixture`
- `llm_judge_candidate`

`consentType`:

- `synthetic`
- `operator_opt_in`
- `customer_opt_in`

`source`:

- `synthetic_fixture`
- `gateway_redacted_sample`
- `manual_seed`

`language`:

- `en`
- `ko`
- `mixed`
- `unknown`

조합 제약:

| source | consentType | labelSource |
|---|---|---|
| `synthetic_fixture` | `synthetic` | `synthetic_fixture` |
| `gateway_redacted_sample` | `operator_opt_in` 또는 `customer_opt_in` | `human_review` 또는 `llm_judge_candidate` |
| `manual_seed` | 허용 값 중 하나 | 허용 값 중 하나 |

`manual_seed`는 사람이 만든 synthetic seed와 opt-in 샘플 수동 정리본이 모두 들어올 수 있으므로 PR1에서는 강하게 묶지 않는다.

## 6. 금지 데이터

평가셋 레코드, fixture, review note, script, report에는 아래 값이 포함되면 안 된다.

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret
- secret-shaped fixture value

평가셋에는 redacted prompt text만 포함할 수 있다. `[EMAIL_REDACTED]`, `[SECRET_REDACTED]` 같은 redaction placeholder는 허용한다.

이 평가셋 계약에는 `rawPromptHash` 또는 유사 필드를 저장하지 않는다. raw prompt의 hash도 민감한 linkage material이 될 수 있으며, 분류기 평가에는 필요하지 않다.

## 7. 평가 규칙

첫 번째 평가 runner는 JSONL에서 레코드를 읽고 아래 값을 비교해야 한다.

```text
expectedCategory == actualCategory
```

최소 report 필드:

| Field | 의미 |
|---|---|
| `datasetVersion` | 평가한 dataset |
| `classifierName` | 예: `rule_based_category_classifier` |
| `classifierVersion` | code 또는 policy version |
| `totalSamples` | 평가한 sample 개수 |
| `accuracy` | 전체 exact-match accuracy |
| `byCategory` | category별 correct/total/accuracy |
| `confusionMatrix` | expected category와 actual category의 count |

Report는 raw prompt text를 출력하면 안 된다. 실패 예시는 `sampleId`, `expectedCategory`, `actualCategory`만 보여줄 수 있다.

계약과 fixture를 바꾸면 아래 검증을 실행해야 한다.

```powershell
corepack pnpm run verify:v2.1-category-eval
corepack pnpm run verify:v2-docs
```

## 8. PR 분리

| PR | 범위 |
|---|---|
| PR1 | 평가셋 계약, schema, 안전한 fixture |
| PR2 | redacted/opt-in sample capture와 export path |
| PR3 | 분류기 평가 runner와 report |

LLM classifier, LLM judge, fine-tuning, lightweight classifier training은 PR3 evidence가 생긴 뒤에 진행한다.

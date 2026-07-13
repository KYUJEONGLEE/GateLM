# GateLM Category Evaluation Dataset Contract

> [!NOTE]
> **문서 상태: Versioned offline evidence contract.** 현재 문서 진입점은 [`docs/current/README.md`](../current/README.md)다. 이 계약은 synthetic/redacted routing evaluation 범위이며 Gateway hot path 계약을 새로 정의하지 않는다.

## 1. 상태

이 문서는 v2.1 룰 기반 라우팅 평가를 위한 offline evidence 계약이다.

이 문서는 category-only offline evidence record를 정의한다. Difficulty 정답 label은 별도 [`difficulty-evaluation-dataset-contract.md`](difficulty-evaluation-dataset-contract.md)와 `difficulty-evaluation-record`에서 관리하며 category record에 `expectedDifficulty`를 추가하지 않는다. Gateway hot path와 RuntimeSnapshot routing의 현재 의미는 [`../routing/contracts.md`](../routing/contracts.md)를 우선한다.

## 2. 제품 경계

GateLM은 고객 프롬프트를 자동 수집해서 라우팅 모델 학습에 사용하지 않는다.

이번 평가셋은 아래 데이터만 허용한다.

- synthetic fixture
- 사람이 별도로 만든 internal seed
- runtime hot path 밖에서 안전하게 정리한 redacted sample

금지한다.

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- API Key, App Token, Provider Key
- Authorization header
- provider raw error body
- 실제 secret처럼 보이는 값
- Gateway 요청 경로 안에서 LLM judge 호출
- 고객 프롬프트 자동 sampling/export

## 3. Category Taxonomy

평가셋은 low-cardinality 업무 카테고리를 사용한다. Category는 분류 결과이며 provider, model, tier 선택 의미를 포함하지 않는다.

| Category | 의미 |
|---|---|
| `general` | 일반 설명, 안내, 짧은 질의 |
| `code` | 코드 분석, 디버깅, 구현 질문 |
| `translation` | 번역, 문장 변환 |
| `summarization` | 회의록, 문서, 긴 글 요약 |
| `reasoning` | 비교, 계획, 복잡한 의사결정 |

정보 추출/JSON 구조화, 환불/고객지원, 비어 있거나 분류 불가능한 입력, 새 taxonomy에 없는 업무는 모두 `general`로 label한다. `extraction_json`, `support_refund`, `unknown`은 active category 값이 아니다.

## 4. Schema Version과 v2 Hard Cutover

현재 canonical record 계약은 [`schemas/category-evaluation-record.schema.json`](schemas/category-evaluation-record.schema.json)의 `gatelm.category-evaluation-record.v2`다. v2 record에는 `expectedTier`가 없으며, 추가 필드로 넣어도 검증에서 거부한다.

[`schemas/category-evaluation-record.v1.schema.json`](schemas/category-evaluation-record.v1.schema.json)은 provenance 확인용 non-active historical snapshot으로만 보존한다. active verifier/evaluator는 v1 record를 accept하지 않고, 새 fixture/generator는 v2만 생성한다. v1의 `expectedTier`는 현재 평가 의미로 해석하지 않는다.

## 5. v2 Record Format

평가셋은 JSONL을 권장한다. 각 줄은 하나의 JSON object다.

필수 필드:

| Field | Type | 설명 |
|---|---|---|
| `schemaVersion` | string | `gatelm.category-evaluation-record.v2` |
| `datasetVersion` | string | 평가셋 버전 |
| `sampleId` | string | 안전한 synthetic/generated id |
| `redactedPrompt` | string | 평가에 사용할 안전한 prompt text. 완전 마스킹된 경우 빈 문자열 가능 |
| `expectedCategory` | string | 정답 category |
| `labelSource` | string | label 생성 방식 |
| `consentType` | string | offline dataset 포함 근거 |
| `source` | string | sample 출처 |
| `language` | string | low-cardinality language bucket |
| `redactionVersion` | string | redaction/masking policy version |
| `createdAt` | string | ISO-8601 timestamp |

선택 필드:

| Field | Type | 설명 |
|---|---|---|
| `labelConfidence` | number | label confidence, 0.0부터 1.0까지 |
| `reviewerNote` | string | 안전한 짧은 메모. raw prompt fragment 금지 |

## 6. 허용 값

`labelSource`:

- `human_review`
- `synthetic_fixture`

`consentType`:

- `synthetic`
- `internal_manual_review`

`source`:

- `synthetic_fixture`
- `manual_seed`

`language`:

- `en`
- `ko`
- `mixed`
- `unknown`

여기서 language bucket `unknown`은 유지한다. 삭제된 category label `unknown`과 다른 필드다.

조합 제약:

| source | consentType | labelSource |
|---|---|---|
| `synthetic_fixture` | `synthetic` | `synthetic_fixture` |
| `manual_seed` | `synthetic` 또는 `internal_manual_review` | `synthetic_fixture` 또는 `human_review` |

## 7. Evaluation Report

평가 runner는 category 분류 evidence만 출력한다.

| Field | 의미 |
|---|---|
| `totalSamples`, `correctSamples`, `incorrectSamples` | 평가 sample 집계 |
| `accuracy` | category exact-match accuracy |
| `errorRate` | category exact-match error rate |
| `byCategory` | category별 correct/incorrect/total/accuracy/incorrectRate |
| `confusionMatrix` | expected category와 actual category count |
| `latency` | category classifier avg/p50/p95/max microseconds |
| `failures` | 실패 sample의 sampleId, 허용된 redactedPrompt, expected/actual category |
| `samples` | sampleId, 허용된 redactedPrompt, expected/actual category, category 진단 |
| `samples[].categoryDiagnostics` | category score, margin, confidence, ambiguity 같은 분류 진단 |

Evaluate report에는 tier 정확도, tier 분포, provider/model 선택, routing reason, 비용 추정을 넣지 않는다. Probe report도 category 분포, category classifier latency, sample별 category 진단만 다룬다.

Report에 raw prompt, raw response, raw detected value, raw prompt fragment 또는 secret을 출력하면 안 된다. 허용된 synthetic fixture 또는 안전하게 정리한 `redactedPrompt`를 사람이 진단 문맥으로 확인할 수 있지만, 이를 고객 raw prompt 수집 근거로 사용하지 않는다.

## 8. Fixture Provenance

각 canonical fixture는 생성 또는 검토 방식을 재현할 수 있도록 generator, seed/version 또는 manual review 근거 중 적용 가능한 provenance를 유지해야 한다.

현재 challenge/ambiguous fixture에는 checked-in generator가 있지만 primary realistic fixture의 동등한 generator/provenance는 확인되지 않았다. 이 공백은 [`../current/documentation-gaps.md`](../current/documentation-gaps.md)에 기록하며, 존재하지 않는 생성 절차를 이 계약으로 추정하지 않는다.

## 9. 검증

계약, schema, fixture를 바꾸면 아래 검증을 실행한다.

```powershell
corepack pnpm run verify:v2.1-category-eval
corepack pnpm run v2.1:routing:evaluate
corepack pnpm run v2.1:routing:test
corepack pnpm run verify:v2-docs
```

## 10. Category-only 계약 변경 범위

이번 변경은 아래를 한 번에 묶는다.

- canonical record schema를 v2 category-only 형식으로 승격
- active category enum을 `general`, `code`, `translation`, `summarization`, `reasoning`으로 고정
- 삭제 category label과 누락 label을 `general`로 병합
- v1 schema는 non-active historical snapshot으로만 보존하고 evaluator 입력으로 거부
- category 정확도와 오답률 계산
- category confusion matrix와 분류 진단 출력
- category classifier latency 평균/p50/p95/max 측정
- 성능 테스트 시나리오 문서

아래는 별도 후속 작업이다.

- 고객 데이터 기반 자동 수집
- 모델 학습/fine-tuning
- LLM judge

active RuntimeConfig/RuntimeSnapshot 및 category × difficulty 정책 구현은 이 offline evidence 범위와 분리하며 [`../routing/contracts.md`](../routing/contracts.md)를 따른다.

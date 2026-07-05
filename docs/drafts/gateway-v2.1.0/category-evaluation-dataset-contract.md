# GateLM Category Evaluation Dataset Contract

## 1. 상태

이 문서는 v2.1 룰 기반 라우팅 평가를 위한 offline evidence 계약이다.

이 문서는 `specs/gateway/v2.0.0/contracts.md`의 Gateway hot path, RuntimeSnapshot, Provider, Request Log, Metrics, DB, API, Security-sensitive field 계약을 변경하지 않는다.

충돌이 있으면 `specs/gateway/v2.0.0/contracts.md`를 우선한다.

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

평가셋은 low-cardinality 업무 카테고리를 사용한다.

| Category | 의미 | 기본 routing 의도 |
|---|---|---|
| `general` | 일반 설명, 안내, 짧은 질의 | 짧으면 `low_cost`, 길면 `balanced` |
| `code` | 코드 분석, 디버깅, 구현 질문 | `high_quality` |
| `translation` | 번역, 문장 변환 | `balanced` |
| `summarization` | 회의록, 문서, 긴 글 요약 | `balanced` |
| `extraction_json` | 정보 추출, JSON 변환, 구조화 출력 | `balanced` |
| `support_refund` | 환불, 취소, 반품, 결제 고객지원 | `low_cost` |
| `reasoning` | 비교, 계획, 복잡한 의사결정 | `high_quality` |
| `unknown` | 비어 있거나 분류 불가능한 입력 | `balanced` |

## 4. Tier Taxonomy

`expectedTier`는 evaluation label이다. RuntimeConfig나 RuntimeSnapshot 필드가 아니다.

| Tier | 의미 |
|---|---|
| `low_cost` | 비용 절감을 우선하는 저가 모델 후보 |
| `balanced` | 기본 품질과 비용 균형 모델 후보 |
| `high_quality` | 코드/추론처럼 품질 우선 모델 후보 |

## 5. Record Format

평가셋은 JSONL을 권장한다. 각 줄은 하나의 JSON object다.

필수 필드:

| Field | Type | 설명 |
|---|---|---|
| `schemaVersion` | string | `gatelm.category-evaluation-record.v1` |
| `datasetVersion` | string | 평가셋 버전 |
| `sampleId` | string | 안전한 synthetic/generated id |
| `redactedPrompt` | string | 평가에 사용할 안전한 prompt text. 완전 마스킹된 경우 빈 문자열 가능 |
| `expectedCategory` | string | 정답 category |
| `expectedTier` | string | 정답 routing tier |
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

조합 제약:

| source | consentType | labelSource |
|---|---|---|
| `synthetic_fixture` | `synthetic` | `synthetic_fixture` |
| `manual_seed` | `synthetic` 또는 `internal_manual_review` | `synthetic_fixture` 또는 `human_review` |

## 7. Evaluation Report

평가 runner는 아래 항목을 출력한다.

| Field | 의미 |
|---|---|
| `totalSamples` | 평가 sample 수 |
| `accuracy` | category exact-match accuracy |
| `errorRate` | category exact-match error rate |
| `tierAccuracy` | tier exact-match accuracy |
| `tierErrorRate` | tier exact-match error rate |
| `byCategory` | category별 correct/incorrect/total/accuracy/incorrectRate |
| `byTier` | tier별 correct/incorrect/total/accuracy/incorrectRate |
| `confusionMatrix` | expected category와 actual category count |
| `latency` | routing decision avg/p50/p95/max microseconds |
| `costEstimate` | high_quality baseline 대비 상대 비용 절감 추정 |
| `failures` | sampleId와 expected/actual label만 포함 |

Report는 prompt text를 출력하면 안 된다.

## 8. 검증

계약, schema, fixture를 바꾸면 아래 검증을 실행한다.

```powershell
corepack pnpm run verify:v2.1-category-eval
corepack pnpm run v2.1:routing:evaluate
corepack pnpm run v2.1:routing:test
corepack pnpm run verify:v2-docs
```

## 9. 이번 PR 범위

이번 PR은 아래를 한 번에 묶는다.

- 평가셋 계약 보강
- `expectedTier` fixture 추가
- category/tier 정확도 계산
- category/tier 오답률 계산
- routing latency 평균/p50/p95/max 측정
- 비용 절감 추정 report
- 성능 테스트 시나리오 문서

아래는 별도 후속 작업이다.

- 고객 데이터 기반 자동 수집
- 모델 학습/fine-tuning
- LLM judge
- Gateway hot path 변경
- RuntimeConfig/RuntimeSnapshot 계약 변경

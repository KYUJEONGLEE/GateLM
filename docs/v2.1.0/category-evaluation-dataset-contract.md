# GateLM 카테고리 평가셋 계약

## 1. 상태

이 문서는 카테고리 분류기 평가를 위한 offline evidence 계약이다.

이 문서는 v2.0.0 Gateway hot path, RuntimeSnapshot, Provider, Request Log, Metrics, DB, API, Security-sensitive field 계약을 변경하지 않는다.

이 문서가 `docs/v2.0.0/contracts.md`와 충돌하면 `docs/v2.0.0/contracts.md`를 우선한다.

## 2. 제품 경계

GateLM은 고객 프롬프트를 자동으로 수집해서 분류기 학습에 사용하지 않는다.

운영 Gateway는 요청 처리, 인증, 정책 검사, 라우팅, 캐시, Provider 호출, 로그 저장만 담당한다.

분류기 학습이나 개선은 별도 offline workflow로 분리한다. 이때도 사람이 준비한 안전한 평가셋만 사용한다.

이 계약에서 허용하는 데이터는 아래뿐이다.

- synthetic 예시
- 팀이 수동으로 만든 internal seed 예시
- runtime hot path 밖에서 이미 안전하게 정리된 redacted text

이 계약에서 금지하는 것은 아래와 같다.

- raw prompt capture
- raw response capture
- 사용자 프롬프트 자동 sampling
- Gateway-to-training export
- Gateway 경로 안의 LLM judge 호출
- 고객 프롬프트 기본 학습

## 3. 카테고리 분류 체계

평가셋은 상용 LLM 라우팅에서 자주 쓰이는 low-cardinality 업무 카테고리를 사용한다.

이 목록은 평가셋과 분류기 검증을 위한 taxonomy다. Runtime Gateway가 모든 카테고리를 즉시 별도 라우팅한다는 뜻은 아니다.

`unknown`은 업무 카테고리가 아니라 비어 있거나 분류 불가능한 입력을 위한 안전 fallback이다.

| Category | 의미 | 라우팅 의도 |
|---|---|---|
| `general` | 일반 대화, 간단한 설명, 아직 별도 업무로 분류되지 않은 요청 | 기본 라우팅 또는 길이 기반 라우팅 |
| `code` | 프로그래밍, 디버깅, stack trace, 리팩터링, 구현 도움 | 고품질 code-capable 모델 후보 |
| `translation` | 번역 또는 문장 재작성 | 균형형 또는 low-latency 모델 후보 |
| `summarization` | 문서, 회의록, 긴 글 요약 | long-context 또는 요약 최적화 모델 후보 |
| `extraction_json` | 정보 추출, JSON 변환, 구조화 출력 | JSON mode 또는 구조화 출력 강한 모델 후보 |
| `support_refund` | 환불, 결제, 취소, 반품, 고객 지원 | 저비용 또는 고객지원 정책 모델 후보 |
| `reasoning` | 복잡한 분석, 비교, 계획, 의사결정 | 고품질 reasoning 모델 후보 |
| `safety_sensitive` | 개인정보, credential, secret, 보안 위험 관련 요청 | 차단, safety-first 라우팅, 또는 검토 후보 |
| `unknown` | 비어 있거나, 유효하지 않거나, 분류 불가능한 입력 | 안전한 fallback |

새 카테고리가 `RoutingDecisionKey` 또는 cache key material에 영향을 주려면 먼저 routing/cache 계약을 갱신해야 한다.

## 4. 평가셋 레코드 형식

평가셋의 각 행은 하나의 JSON object다. 저장 형식은 JSONL을 권장한다.

필수 필드:

| Field | Type | 의미 |
|---|---|---|
| `schemaVersion` | string | 반드시 `gatelm.category-evaluation-record.v1`이어야 한다 |
| `datasetVersion` | string | 평가셋 릴리즈 식별자. 예: `category_eval_2026_07_02_v1` |
| `sampleId` | string | 안정적인 synthetic/generated id. prompt text나 secret을 인코딩하면 안 된다 |
| `redactedPrompt` | string | 평가에 사용하는 안전한 prompt text. raw prompt와 secret은 금지한다 |
| `expectedCategory` | string | 승인된 카테고리 값 중 하나 |
| `labelSource` | string | label이 만들어진 방식 |
| `consentType` | string | 이 sample을 offline dataset에 넣을 수 있는 근거 |
| `source` | string | sample의 출처 |
| `language` | string | low-cardinality 언어 bucket |
| `redactionVersion` | string | dataset 포함 전 사용한 redaction/masking policy version |
| `createdAt` | string | ISO-8601 timestamp |

선택 필드:

| Field | Type | 의미 |
|---|---|---|
| `labelConfidence` | number | reviewer 또는 pseudo-label confidence. `0.0`부터 `1.0`까지 |
| `reviewerNote` | string | 짧고 안전한 메모. raw prompt fragment, secret, provider error를 포함하면 안 된다 |

## 5. 허용 값

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

`manual_seed`는 팀이 별도로 준비한 offline sample을 뜻한다. 고객 프롬프트 자동 capture를 의미하면 안 된다.

## 6. 금지 데이터

평가셋 레코드, fixture, script, review note, report에는 아래 값이 포함되면 안 된다.

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
- 실제 사용자 요청과 연결될 수 있는 requestId 또는 traceId

이 계약은 의도적으로 `rawPromptHash`를 정의하지 않는다. raw prompt hash도 민감한 linkage material이 될 수 있고, 분류기 평가에는 필요하지 않다.

## 7. 평가 규칙

첫 평가 runner는 JSONL에서 레코드를 읽고 아래 값을 비교한다.

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

Report는 prompt text를 출력하면 안 된다. 실패 예시는 `sampleId`, `expectedCategory`, `actualCategory`만 보여줄 수 있다.

## 8. 검증

계약, schema, fixture를 바꾸면 아래 검증을 실행한다.

```powershell
corepack pnpm run verify:v2.1-category-eval
corepack pnpm run verify:v2-docs
```

## 9. PR 범위

| PR | 범위 |
|---|---|
| PR1 | 평가셋 계약, schema, 안전한 fixture, category taxonomy |
| PR2 | category taxonomy 확장과 offline 평가 준비만 포함 |
| PR3 | 분류기 평가 runner와 report |

LLM classifier, fine-tuning, lightweight classifier training, 고객 데이터 기반 개선은 별도 작업으로 분리해야 하며 runtime Gateway 경로 안에 숨겨 넣으면 안 된다.

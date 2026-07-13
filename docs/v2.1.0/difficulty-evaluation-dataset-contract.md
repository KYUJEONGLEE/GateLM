# GateLM Difficulty Evaluation Dataset Contract

> [!NOTE]
> **문서 상태: Versioned offline evidence contract.** 현재 문서 진입점은 [`docs/current/README.md`](../current/README.md)다. 이 계약은 synthetic/redacted difficulty evaluation 범위이며 Gateway hot path 계약을 새로 정의하지 않는다.

## 1. 상태와 분리 원칙

이 문서는 v2.1 룰 기반 라우팅의 난이도 분류를 검증하기 위한 독립 offline evidence 계약이다.

기존 [`category-evaluation-dataset-contract.md`](category-evaluation-dataset-contract.md)와 `category-evaluation-record`는 category-only 계약이다. Category record에 `expectedDifficulty`를 추가하거나 difficulty record를 category fixture에 섞지 않는다. 두 계약은 별도 schema, fixture, verifier를 사용한다.

Gateway hot path와 RuntimeSnapshot의 category × difficulty 정책은 [`../routing/contracts.md`](../routing/contracts.md)를 우선한다.

## 2. 데이터 경계

허용하는 데이터는 다음과 같다.

- synthetic fixture
- 사람이 별도로 만든 internal seed
- runtime hot path 밖에서 안전하게 정리한 redacted sample

다음 값과 동작은 금지한다.

- raw prompt, raw response, raw detected value, raw prompt fragment
- API Key, App Token, Provider Key, Authorization header, provider raw error body, 실제 secret
- 고객 프롬프트 자동 sampling/export
- Gateway 요청 경로 안에서 LLM judge 호출

## 3. Difficulty Taxonomy

| Difficulty | 의미 |
|---|---|
| `simple` | 단일 단계 또는 제한된 문맥으로 처리할 수 있는 요청 |
| `complex` | 다단계 분석, 여러 제약, 긴 문맥 또는 복합 판단이 필요한 요청 |

이 값은 offline 정답 label이다. Provider, model, 비용 tier 또는 RuntimeSnapshot 선택을 직접 지정하지 않는다.

## 4. Record Format

Canonical schema는 [`schemas/difficulty-evaluation-record.schema.json`](schemas/difficulty-evaluation-record.schema.json)의 `gatelm.difficulty-evaluation-record.v1`이다. JSONL 한 줄은 하나의 record다.

평가 의미를 구성하는 최소 필수 필드는 다음 네 개다.

| Field | Type | 설명 |
|---|---|---|
| `redactedPrompt` | string | 안전하게 마스킹된 평가 입력. 완전 마스킹된 경우 빈 문자열 가능 |
| `expectedCategory` | string | difficulty 결과를 분석할 때 사용하는 active category 문맥 |
| `expectedDifficulty` | string | `simple` 또는 `complex` 정답 label |
| `language` | string | low-cardinality language bucket |

Provenance와 재현성을 위해 schema는 다음 필드도 필수로 요구한다.

| Field | Type | 설명 |
|---|---|---|
| `schemaVersion` | string | `gatelm.difficulty-evaluation-record.v1` |
| `datasetVersion` | string | difficulty dataset 버전 |
| `sampleId` | string | prompt 내용을 포함하지 않는 안전한 식별자 |
| `labelSource` | string | label 생성 방식 |
| `consentType` | string | offline dataset 포함 근거 |
| `source` | string | sample 출처 |
| `redactionVersion` | string | redaction/masking policy 버전 |
| `createdAt` | string | ISO-8601 timestamp |

`labelConfidence`와 안전한 짧은 `reviewerNote`는 선택 필드다. Schema는 `additionalProperties: false`이며 category 평가 report 필드나 임의 metadata를 허용하지 않는다.

## 5. 허용 값과 조합

`expectedCategory`는 `general`, `code`, `translation`, `summarization`, `reasoning` 중 하나다. 이는 difficulty를 category별로 분석하기 위한 문맥이며 category 정답률 계약을 합치는 의미가 아니다.

`language`는 `en`, `ko`, `mixed`, `unknown` 중 하나다.

Provenance enum과 조합은 category evaluation 계약과 같은 안전한 offline data 경계를 사용한다.

- `labelSource`: `human_review`, `synthetic_fixture`
- `consentType`: `synthetic`, `internal_manual_review`
- `source`: `synthetic_fixture`, `manual_seed`
- `source=synthetic_fixture`이면 `consentType=synthetic`, `labelSource=synthetic_fixture`

## 6. Fixture Provenance

[`fixtures/difficulty-evaluation-dataset.fixture.jsonl`](fixtures/difficulty-evaluation-dataset.fixture.jsonl)은 2026-07-13에 작성한 synthetic fixture다. 다섯 active category 각각에 `simple`, `complex` 한 건씩을 두어 총 10개 record로 구성한다. 실제 고객 prompt를 사용하지 않는다.

## 7. Evaluation Report

Difficulty 평가는 다음 명령으로 실행한다.

```powershell
corepack pnpm run v2.1:routing:evaluate:difficulty
```

Report의 `accuracy`와 `errorRate`는 difficulty exact-match 기준이다. Category accuracy 계약을 합치지 않는다. 대신 각 sample의 `expectedCategory`, `actualCategory`, `categoryMatched`를 함께 제공하여 category 오분류가 difficulty 결과에 미친 영향을 구분한다.

`byCategoryDifficulty`는 expected category와 expected difficulty 조합별로 `correct`, `incorrect`, `total`, `accuracy`, `incorrectRate`를 집계한다. 각 셀의 correct/incorrect는 difficulty label 일치 여부를 뜻한다.

`directionalErrors`는 다음 분모를 명시적으로 포함한다.

- `simpleToComplexRate = simpleToComplexCount / simpleExpectedSamples`
- `complexToSimpleRate = complexToSimpleCount / complexExpectedSamples`

`classificationLatency`의 단위는 microseconds이며 category, difficulty, 두 분류를 연속 실행한 total의 avg/p50/p95/max를 각각 제공한다. 이 시간에는 fixture parsing, 파일 I/O, report 직렬화를 포함하지 않는다.

실패와 sample 진단에는 sampleId, 허용된 redactedPrompt, expected/actual category와 difficulty 같은 low-cardinality 결과만 포함한다. Category diagnostics, provider/model/tier, raw prompt, raw response 또는 error detail을 추가하지 않는다.

## 8. 검증

Difficulty 계약, schema 또는 fixture를 변경하면 다음을 실행한다.

```powershell
corepack pnpm run verify:v2.1-difficulty-eval
corepack pnpm run verify:v2.1-category-eval
corepack pnpm run verify:v2-docs
corepack pnpm run v2.1:routing:evaluate:difficulty
```

Difficulty verifier는 schema identity, 필수 필드, `simple | complex` enum, 추가 필드 금지, provenance 조합과 secret 형태 문자열을 검사한다. Category verifier는 category fixture에 `expectedDifficulty`가 섞이면 실패해야 한다.

## 9. 범위 밖

- 고객 데이터 자동 수집 또는 모델 학습
- difficulty classifier 정확도 기준이나 release gate 선언
- provider/model/tier 선택 평가
- Gateway API, DB, Event, Metrics 계약 변경
- RuntimeConfig/RuntimeSnapshot 정책 변경

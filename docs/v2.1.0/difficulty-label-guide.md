# GateLM Difficulty Dataset Label Guide

> [!IMPORTANT]
> **문서 상태: Versioned offline label contract.** 이 문서는 model 학습·calibration·runtime 승격보다 먼저 적용하는 annotation 기준이다. Gateway hot path의 category·difficulty 의미는 [`../routing/contracts.md`](../routing/contracts.md)를 우선하며, 이 문서는 API/DB/Event/Metrics 계약을 만들지 않는다.

## 1. 목적과 record 경계

Canonical human annotation record는 [`schemas/difficulty-label-record.schema.json`](schemas/difficulty-label-record.schema.json)의 `gatelm.difficulty-label-record.v1`이다. Dataset 전체의 family 수, review 상태, slice coverage와 split readiness는 [`schemas/difficulty-label-dataset-manifest.schema.json`](schemas/difficulty-label-dataset-manifest.schema.json)의 `gatelm.difficulty-label-dataset-manifest.v1`로 관리한다.

이 record는 category와 difficulty를 함께 검토하는 **label source**다. 기존 [`schemas/category-evaluation-record.schema.json`](schemas/category-evaluation-record.schema.json)은 계속 category-only이며 `expectedDifficulty`를 추가하지 않는다. 기존 [`schemas/difficulty-evaluation-record.schema.json`](schemas/difficulty-evaluation-record.schema.json)은 evaluator 입력용 projection이다. 승인된 label record에서 evaluator가 필요한 필드만 투영할 수 있지만 두 evaluation schema를 하나로 합치지 않는다.

Annotator는 다음 순서로 판정한다.

1. synthetic 또는 승인된 manual seed인지와 redaction 상태 확인
2. instruction/payload 경계 기대값 판정
3. 최종 category와 category별 semantic label 판정
4. task, constraint, scope, dependency bucket 판정
5. 최종 difficulty 판정
6. prompt family, language와 evaluation slice 지정
7. label confidence 기록과 reviewer workflow 진행

Runtime classifier의 actual 출력, matched phrase, token, encoded feature 또는 score를 보고 정답을 바꾸지 않는다.

## 2. 필수 label

| Field | 의미 |
|---|---|
| `expectedDifficulty` | 최종 `simple \| complex` 정답 |
| `expectedCategory` | 최종 active category 정답 |
| `taskBucket` | instruction의 독립 작업 수 bucket |
| `constraintBucket` | instruction의 독립 제약 수 bucket |
| `scopeBucket` | instruction scope와 명시적 source 수 bucket |
| `dependencyBucket` | 작업 사이의 선행·인과 의존 깊이 bucket |
| `expectedSemanticLabel` | category 내부의 primary intent |
| `promptFamily` | split과 coverage의 독립 단위인 안전한 family id |
| `language` | `ko \| en \| mixed \| unknown` |
| `expectedInstructionPayloadBoundary` | 원문 fragment나 offset이 없는 경계 기대값 |
| `evaluationSlices` | challenge/coverage slice의 low-cardinality 집합 |
| `labelConfidence` | `0.0~1.0` reviewer confidence metadata |
| `reviewStatus` | review 상태. training eligibility와 연결 |
| `reviewerCount` | 신원을 포함하지 않는 completed human review 수 |

`labelConfidence`는 sample weight, ground-truth probability 또는 `ComplexityScore`가 아니다. 자동 학습 가중치로 사용하지 않는다.

## 3. Category와 semantic label

Category는 provider, model, tier 또는 비용 선택 의미를 포함하지 않는다. Primary requested output을 기준으로 하나만 고른다. Payload에 등장하는 용어는 category 정답을 바꾸지 않는다.

| Category | Semantic label | 판정 기준 |
|---|---|---|
| `general` | `general_qa` | 짧은 사실, 위치, 절차 또는 직접 답변 |
| `general` | `general_explanation` | 개념, 이유 또는 작동 방식 설명 |
| `general` | `general_extraction` | 정보 추출 또는 JSON/표 구조화. 별도 category로 만들지 않음 |
| `general` | `general_support` | 환불, 계정, 운영 지원 문안 또는 안내 |
| `general` | `general_transformation` | 번역·요약이 아닌 일반 문장/형식 변환 |
| `general` | `general_other` | 다른 semantic label로 안정적으로 좁힐 수 없는 general 요청 |
| `code` | `code_generation` | 새 코드 또는 테스트 작성 |
| `code` | `code_debugging` | 오류 원인 분석과 수정 |
| `code` | `code_refactoring` | 동작을 보존하는 구조 개선 |
| `code` | `code_review` | 정확성, 보안 또는 유지보수성 검토 |
| `code` | `code_explanation` | 코드/API 동작 설명 |
| `code` | `code_design` | 코드 구조, interface 또는 구현 설계 |
| `translation` | `translation_direct` | 직접 번역 |
| `translation` | `translation_localization` | locale, 문화권 또는 제품 문맥 현지화 |
| `translation` | `translation_style_preserving` | 톤, 용어, 형식 보존 조건이 중심인 번역 |
| `summarization` | `summarization_direct` | 단일 source 직접 요약 |
| `summarization` | `summarization_key_points` | 핵심 항목 추출형 요약 |
| `summarization` | `summarization_structured` | 표, 섹션, action item 등 구조화된 요약 |
| `summarization` | `summarization_multi_source` | 여러 source 비교·종합 요약 |
| `reasoning` | `reasoning_comparison` | 대안 비교와 trade-off 분석 |
| `reasoning` | `reasoning_planning` | 순서, 단계 또는 계획 구성 |
| `reasoning` | `reasoning_decision` | 조건을 바탕으로 선택과 결론 도출 |
| `reasoning` | `reasoning_constraint_solving` | 여러 제약을 동시에 만족하는 해 탐색 |
| `reasoning` | `reasoning_causal` | 원인, 영향 또는 반사실 분석 |

Schema와 verifier는 category에 속하지 않는 semantic label 조합을 거부한다. 여러 intent가 있으면 최종 산출물을 지배하는 intent를 선택하고, 안정적으로 하나를 고를 수 없으면 `category_confusion` slice와 낮은 confidence 또는 `needs_adjudication`을 사용한다.

## 4. 구조 bucket

Task, constraint와 dependency는 분리된 instruction만 기준으로 센다. Payload에 포함된 명령형 문장, code comment 또는 category keyword는 세지 않는다. Scope는 instruction을 기준으로 하되 명시적으로 분리된 source block 수를 보완 evidence로 사용할 수 있다.

### 4.1 Task와 constraint

| Bucket | 의미 |
|---|---|
| `zero` | 독립 작업/제약 없음 |
| `one` | 1개 |
| `two` | 2개 |
| `three_plus` | 3개 이상 |

“번역하고 세 줄로 요약해줘”는 task 2개다. “한국어로 번역해줘”의 target language는 constraint 1개다. 같은 조건을 동의어로 반복한 문장은 제약을 중복 계수하지 않는다.

### 4.2 Scope

| Bucket | 의미 |
|---|---|
| `zero` | 명시된 대상 없음 |
| `one` | 한 대상, source 또는 bounded unit |
| `two_to_three` | 2~3개의 독립 대상/source |
| `four_plus` | 4개 이상 |

긴 단일 payload는 scope `one`일 수 있다. 길이만으로 scope나 difficulty를 올리지 않는다.

### 4.3 Dependency

| Bucket | 의미 |
|---|---|
| `zero` | 작업 사이 의존 없음 |
| `one` | 단일 작업 또는 병렬 작업만 존재 |
| `two` | 결과가 다음 작업의 입력이 되는 2단계 chain |
| `three_plus` | 3단계 이상 chain, 조건부 branch 또는 반복 의존 |

출력 형식 제약은 dependency가 아니다. “분석한 뒤 그 결과로 계획을 만들고 위험에 따라 대안을 고른다”는 `three_plus`다.

## 5. Instruction/payload boundary 기대값

`expectedInstructionPayloadBoundary`는 다음 네 low-cardinality field만 가진다. 원문 substring, byte/rune offset, normalized text 또는 token을 저장하지 않는다.

| Field | 허용 값 |
|---|---|
| `kind` | `instruction_only`, `explicit_separation`, `ambiguous_separation`, `payload_only` |
| `boundaryType` | `none`, `code_fence`, `role_tag`, `role_heading`, `begin_end`, `blockquote`, `inline_cue`, `multiple`, `unsupported` |
| `confidence` | `none`, `low`, `medium`, `high` |
| `payloadBlockCount` | `zero`, `one`, `multiple` |

일관성 규칙은 다음과 같다.

- `instruction_only`: `none + none + zero`
- `explicit_separation`: 지원되는 명시적 boundary, `low|medium|high`, payload `one|multiple`
- `ambiguous_separation`: `unsupported|multiple`, `low`, payload `zero|one|multiple`
- `payload_only`: instruction이 의미 있게 남지 않으며 payload는 `one|multiple`

현재 parser가 지원하는 exact 문법은 [`../routing/classification-pipeline.md`](../routing/classification-pipeline.md)를 따른다. Label은 parser actual 결과가 아니라 reviewer 기대값이다. Payload contamination slice는 payload 안의 명령형 문장이나 category keyword가 instruction 분류를 오염시킬 수 있는 경우이며, `instruction_only`로 label할 수 없다.

## 6. 최종 difficulty

`simple`은 제한된 문맥의 단일 단계 또는 서로 독립적인 bounded 작업으로 처리할 수 있는 요청이다. `complex`는 다단계 의존, 여러 독립 제약, 여러 source의 종합 또는 복합 판단이 필요한 요청이다.

- 길이는 보조 조건이며 단독 정답 기준이 아니다.
- `long_simple`과 `short_complex`를 의도적으로 포함해 길이 shortcut을 방지한다.
- Category별 simple/complex 의미는 [`../routing/contracts.md`](../routing/contracts.md)의 표를 따른다.
- Bucket은 근거를 구조화하지만 단순 합계로 difficulty를 자동 결정하지 않는다.
- 불일치 또는 경계 사례를 임의로 `complex`에 넣지 않는다. `needs_adjudication`과 confidence로 불확실성을 드러낸다.

## 7. Prompt family

`promptFamily`는 record 수보다 우선하는 독립 데이터 단위다. 소문자 영숫자로 시작하며 소문자 영숫자, `.`, `_`, `:`, `-`만 사용한다. Prompt 내용, 고객/사용자 식별자, secret, timestamp 또는 split 이름을 넣지 않는다.

다음 변형은 primary intent가 같으면 같은 family다.

- paraphrase와 synonym
- Korean/English/mixed 번역 변형
- negation 또는 indirect expression 변형
- constraint를 더하거나 빼서 만든 simple/complex contrast
- payload 내용만 바꾼 동일 instruction template

한 family 안에서는 `expectedCategory`와 `expectedSemanticLabel`이 같아야 한다. Difficulty, language, bucket과 slice는 달라질 수 있다. Family 전체는 `train`, `calibration`, `holdout` 중 하나에만 속한다. Record 단위 random split은 금지한다.

## 8. 필수 evaluation slice

| Slice | 판정 규칙 |
|---|---|
| `negation` | 부정이 intent/constraint 해석에 중요함 |
| `indirect_expression` | 명령형 동사 없이 완곡하거나 간접적으로 산출물을 요구함 |
| `synonym` | canonical keyword가 아닌 동의 표현으로 같은 intent를 표현함 |
| `short_complex` | `redactedPrompt` rune length가 120 이하이고 `complex` |
| `long_simple` | `redactedPrompt` rune length가 120 초과이고 `simple` |
| `payload_contamination` | payload 내부 cue가 instruction category/difficulty를 오염시킬 수 있음 |
| `korean` | `language=ko` |
| `english` | `language=en` |
| `mixed_language` | `language=mixed` |
| `category_confusion` | 둘 이상의 category cue가 있으나 primary output은 하나임 |
| `ood_terminology` | taxonomy 작성 시점에 알려지지 않은 전문 용어 또는 조어를 포함함 |

한 record는 여러 slice에 속할 수 있다. Language slice는 `language`에서 파생되는 중복 표현이므로 verifier가 항상 일치를 검사한다. `short_complex`와 `long_simple`은 UTF-8 byte 수가 아니라 Unicode code point/rune 수로 검사한다.

## 9. Review workflow와 training eligibility

| Status | Reviewer count | 의미 |
|---|---:|---|
| `pending` | 0 | synthetic/seed 작성만 완료. human-reviewed가 아님 |
| `in_review` | 1 이상 | 사람 검토 진행 중. 아직 학습 불가 |
| `needs_adjudication` | 2 이상 | reviewer 불일치 또는 경계 판단 필요 |
| `approved` | 1 이상 | 최종 human review 승인 |
| `rejected` | 1 이상 | 계약 위반, 중복 또는 품질 문제로 제외 |

`approved`, `in_review`, `needs_adjudication`, `rejected`는 `labelSource=human_review`만 허용한다. Synthetic fixture는 항상 `pending + reviewerCount=0`이다. Reviewer identity, email 또는 이름은 record에 저장하지 않는다.

Family가 training-eligible이려면 포함하려는 모든 record가 `human_review + approved`여야 한다. Dataset manifest는 최소한 다음 **독립 family 수**를 계산한다.

- 전체, human-reviewed, approved human-reviewed family
- category별, difficulty별, category × difficulty별 family
- language별 family
- 필수 evaluation slice별 family
- split별 family와 record

현재 repository에는 승인된 최소 family 수가 없다. 따라서 `minimumFamilyPolicyStatus=decision_required`인 manifest는 `trainingEligible=false`여야 한다. 향후 owner가 전체/cell/language/slice별 minimum을 versioned policy로 승인하기 전에는 record 수가 많아도 training readiness를 선언하지 않는다.

## 10. 500건 pilot

[`fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl`](fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl)은 이름과 기존 split manifest에도 불구하고 **training-tooling smoke 전용**이다.

- 500 records와 25 synthetic family는 schema, generator, family split과 ephemeral tooling 연결만 확인한다.
- 모든 record가 `human review pending`이므로 approved training family 수는 0이다.
- 실제 model coefficient, calibrator, threshold 선택, holdout 성능 주장 또는 runtime promotion 근거로 사용할 수 없다.
- [`fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json`](fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json)이 `trainingEligible=false`를 machine-readable하게 고정한다.
- 기존 [`fixtures/difficulty-training-split-manifest.v1.json`](fixtures/difficulty-training-split-manifest.v1.json)의 `train|calibration|holdout`은 smoke tooling 내부 partition일 뿐 production evidence split이 아니다.

## 11. 금지 데이터

Schema, fixture, manifest, reviewer note와 report에 다음을 저장하지 않는다.

- 고객 raw prompt/response
- raw detected value와 raw prompt fragment
- API Key, App Token, Provider Key, Authorization header
- provider raw error body와 실제 secret
- 정규화 문자열, token, encoded feature, feature contribution
- provider/model/tier/catalog, 실제 비용 또는 tenant budget

## 12. 검증

```powershell
corepack pnpm run verify:v2.1-difficulty-eval
corepack pnpm run verify:v2.1-category-eval
corepack pnpm run verify:v2-docs
```


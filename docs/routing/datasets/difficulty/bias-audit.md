# Routing difficulty 데이터 편향 감사

기준일은 2026-07-21이며 대상은 `initial-routing-difficulty-15000.jsonl`이다. 이 문서는 재균형·길이 편향·의미 중복 검사의 현재 증거와 남은 사용 제한을 기록한다. 모든 라벨은 아직 사람 승인 전이므로 `training_eligible=false`다.

## 결론

- 언어 비율은 한국어 12,000개, 영어 2,250개, 한영 혼합 750개로 80:15:5를 유지한다.
- 라벨은 Simple 7,500개, Complex 7,500개다.
- 23개 작업 유형은 424~900개, 23개 서비스 도메인은 363~1,609개다.
- 모든 작업 유형과 서비스 도메인에서 Simple/Complex 비율이 각각 35~65% 안에 든다.
- 공개 7,000개의 상위 5개 작업 유형은 3,806개(54.37%)로 55% 상한을 충족한다.
- 긴 Prompt는 Simple/Complex 각각 860개이며 길이 단독 ROC-AUC는 0.5587로 0.60 상한을 충족한다.
- pinned `intfloat/multilingual-e5-small` 전수 검사에서 임계값 0.985 이상의 실제 의미 중복 후보는 0쌍이다.

따라서 이번 작업 범위였던 작업·도메인 편중 조정과 embedding 기반 의미 중복 검사·제거는 완료됐다. 다만 규칙 보조 라벨의 독립 LLM 재판정, 사람 adjudication, 직접 사람 작성 비율 부족, 승인된 실제 사용자 Prompt 부재는 별도 blocker로 남는다.

## 작업 유형·도메인 재균형

생성기는 통합 15,000개를 선택할 때 다음 제약을 강제한다.

| 항목 | 강제 범위 | 현재 결과 |
|---|---:|---:|
| 작업 유형별 레코드 | 400~900 | 424~900 |
| 서비스 도메인별 레코드 | 300~1,875 | 363~1,609 |
| 유형·도메인별 각 라벨 비율 | 35~65% | 모두 충족 |
| 공개 상위 5개 작업 유형 | 최대 3,850개(55%) | 3,806개(54.37%) |
| 단일 공개 source | 최대 3,150개(45%) | 3,100개(44.29%) |

`domainFor()`는 미분류 Prompt를 일괄 `corporate_operations`로 보내지 않는다. 먼저 명시적 도메인 표현을 적용하고, 남은 Prompt는 작업 의미에 따라 `software_development`, `data_analysis`, `document_management`, `research`, `business_reporting` 등으로 배정한다. 공개 후보가 부족한 셀은 다른 의미로 재분류하지 않고, 기존 8,000개와 공개 후보를 함께 고려한 제한 선택으로 보충한다.

현재 작업 유형별 수량은 다음과 같다.

| 작업 유형 | 수량 | 작업 유형 | 수량 |
|---|---:|---|---:|
| business report | 444 | code explanation | 465 |
| code generation | 900 | code modification | 438 |
| code review | 429 | comparison/evaluation | 824 |
| data analysis | 606 | debugging | 545 |
| document writing | 900 | fact explanation | 900 |
| file processing | 470 | general query | 900 |
| internal document query | 471 | JSON conversion | 477 |
| math problem | 900 | multi-document comparison | 424 |
| planning | 900 | RAG query | 435 |
| search | 580 | structured data processing | 900 |
| summarization | 642 | table conversion | 900 |
| translation | 550 |  |  |

## 길이 편향

공개 후보의 `difficultyScore()`는 문자 수, 문장 수, 코드 길이, 문서 길이를 직접 사용하지 않는다. 길이 bucket은 `short < 160`, `medium < 800`, `long >= 800` 문자로 통일한다.

| 길이 bucket | Simple | Complex |
|---|---:|---:|
| short | 4,184 | 2,842 |
| medium | 2,456 | 3,798 |
| long | 860 | 860 |

KLUE는 context 없이 질문 필드만 142개 사용하고 KLUE 유래 `rag_query`는 0개다. KLUE 길이 단독 ROC-AUC는 0.4850이다.

## Embedding 의미 중복 감사

전체 감사 산출물은 [`data/initial-routing-difficulty-15000.semantic-dedup.json`](data/initial-routing-difficulty-15000.semantic-dedup.json)이다.

| 항목 | 값 |
|---|---|
| encoder | `intfloat/multilingual-e5-small` |
| revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| ONNX | pinned dynamic QInt8, SHA-256 검증 |
| 입력 | `query: ` prefix, 최대 128 token |
| 표현 | native 384D masked-mean 후 L2 정규화 |
| 유사도·임계값 | cosine, 0.985 |
| 보정 reference | 동일 `group_id` 변형 positive / 동일 라벨·작업·도메인의 다른 group deterministic negative |
| 보정 정밀도 | 1.0(최소 요구 0.95) |
| 실제 중복 후보 | 0쌍 |
| split 충돌 cluster | 0개 |
| 원문·embedding 저장 | 없음 |

임계값 이상 교차 group 관측쌍은 517쌍이지만 모두 라벨 또는 서비스 도메인이 다른 의도적 대조쌍이다. 실제 제거 후보는 `동일 라벨 + 동일 작업 유형 + 동일 서비스 도메인` 조건을 함께 만족하는 쌍으로 정의했다. 이 조건은 같은 형태의 업무가 서로 다른 도메인에서 요청되는 데이터나 Simple/Complex 경계 대조군을 오탐으로 삭제하지 않기 위한 것이다.

remediation은 공개 Prompt 원문을 수정하지 않고 열위 후보를 제외한 뒤 동일 제약으로 보충한다. 합성 레코드는 언어·라벨·작업·도메인 메타데이터를 유지하면서 실제 업무 의미가 다른 대체 템플릿으로 교체한다. 제외·대체 목록은 `scripts/routing_difficulty_model/dataset/semantic-dedup-remediation.v1.json`에 고정돼 있다.

## 사람 작성 provenance와 남은 blocker

공개 7,000개 중 사람 원문 기원은 6,873개(98.19%)이며 최종 Prompt를 직접 사람이 작성했다고 확인할 수 있는 데이터는 2,674개(38.20%)다. 직접 사람 작성 60% 목표 4,200개까지 1,526개 부족하고, 익명 접근·재배포가 승인된 실제 서비스 사용자 Prompt는 0개다.

남은 training blocker는 다음 네 가지다.

- 규칙 보조 라벨의 독립 LLM 재판정 미완료
- 사람 adjudication 미완료
- 직접 사람 작성 공개 Prompt 60% 미달
- 추가 승인 없는 익명 실제 사용자 source 부재

## 재현·검증

```powershell
corepack pnpm run routing:difficulty:generate-enterprise-8000
corepack pnpm run routing:difficulty:generate-public-7000
corepack pnpm run verify:routing-difficulty-enterprise-8000
corepack pnpm run verify:routing-difficulty-public-7000
corepack pnpm run verify:routing-difficulty-semantic-dedup
```

E5 전수 감사는 로컬에 준비된 pinned 모델과 전용 Python 환경에서 `semantic-dedup.py`를 실행한다. 일반 검증은 저장된 감사의 데이터 SHA-256, encoder identity, 보정 정밀도, 후보·cluster 수를 빠르게 확인한다.

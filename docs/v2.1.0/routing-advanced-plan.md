# GateLM v2.1 Routing Advanced Plan

> [!NOTE]
> **문서 상태: Versioned offline evaluation plan.** 현재 문서 진입점은 [`docs/current/README.md`](../current/README.md)다. 코드 존재와 production maturity를 구분한다.

> [!IMPORTANT]
> 일반 Gateway hot path의 현재 category × difficulty 정책은 [`../routing/contracts.md`](../routing/contracts.md)가 정의한다. 이 문서는 category classifier offline evidence 계획만 설명하며 runtime policy 계약이 아니다.

> [!IMPORTANT]
> 현재 모델 데이터는 운영 고객 데이터가 아니라 synthetic offline evidence다. 향후 opt-in 데이터 확보, prompt 관리, 반복 재학습·shadow·canary·rollback의 전체 수명주기는 [`difficulty-continuous-improvement-plan.md`](difficulty-continuous-improvement-plan.md)를 따른다. 해당 계획은 아직 고객 prompt 수집이나 새 제품 surface를 승인하지 않는다.

## 목표

v2.1 라우팅 고도화의 1차 목표는 외부 모델을 추가 호출하지 않고, 룰 기반 category 분류의 품질과 판단 시간을 측정 가능한 형태로 만드는 것이다.

Category classifier는 정확히 다섯 category의 결과와 진단만 산출한다. Category 결과 자체에 provider, model, tier 선택 의미를 부여하지 않는다. runtime에서는 별도의 category-aware difficulty classifier와 active 5 × 2 route matrix가 이 결과를 소비한다.

## 왜 평가 기반부터 하는가

Category 룰은 감으로 추가하지 않고, 정답이 있는 synthetic/redacted 평가셋과 아래 evidence로 판단해야 한다.

| 지표 | 의미 |
|---|---|
| category accuracy | 프롬프트 업무 유형을 맞혔는가 |
| category error rate | 프롬프트 업무 유형을 틀린 비율은 얼마인가 |
| confusion matrix | 어떤 expected category가 어떤 actual category로 혼동됐는가 |
| classifier latency avg/p50/p95/max | category 판단이 충분히 빠른가 |
| category diagnostics | 점수, margin, confidence, ambiguity가 룰 보강 근거를 제공하는가 |
| failures | 어떤 sample이 왜 틀렸는가 |

## 이번 PR 범위

이 offline evidence 범위는 category-only 평가 기반을 다룬다.

포함한다.

- synthetic/redacted 평가셋의 `expectedCategory` label
- canonical `gatelm.category-evaluation-record.v2` category-only schema
- 정확히 `general`, `code`, `translation`, `summarization`, `reasoning`인 active taxonomy
- v1 record 입력 거부와 non-active historical snapshot 보존
- category 정확도와 오답률 계산
- category confusion matrix와 sample별 분류 진단
- category classifier latency 평균/p50/p95/max 계산
- raw prompt를 노출하지 않는 failure report
- 멘토 공유용 성능 테스트 시나리오 문서

포함하지 않는다.

- 사용자 프롬프트 자동 수집
- LLM judge 호출
- fine-tuning 또는 classifier 학습
- RuntimeConfig/RuntimeSnapshot 및 Gateway routing 구현. 이 범위는 [`../routing/contracts.md`](../routing/contracts.md)를 따른다.
- provider health overlay 또는 circuit breaker

## 실행 방법

자동으로 평가셋을 돌리고 report 파일을 저장한다.

```powershell
corepack pnpm run v2.1:routing:test
```

위 명령은 아래 파일을 생성한다.

```text
reports/routing-eval/routing-eval-<yyyyMMdd-HHmmss>.json
reports/routing-eval/latest.json
```

기본 평가셋을 터미널 출력으로 확인한다.

```powershell
corepack pnpm run v2.1:routing:evaluate
```

리포트를 파일로 남긴다.

```powershell
corepack pnpm run v2.1:routing:evaluate -- -output reports/routing-eval/report.json
```

최소 정확도 gate를 건다.

```powershell
corepack pnpm run v2.1:routing:evaluate -- -min-accuracy 0.8
```

latency 측정 반복 횟수를 조정한다.

```powershell
corepack pnpm run v2.1:routing:evaluate -- -latency-iterations 100
```

## 리포트 해석

리포트에는 raw prompt, raw response, secret, requestId, traceId를 남기지 않는다.

실패 케이스와 sample 진단은 아래 식별자, 허용된 평가 문맥, category 정보만 사용한다.

- sampleId
- synthetic/redactedPrompt
- expectedCategory
- actualCategory
- categoryDiagnostics

`categoryDiagnostics`는 low-cardinality category 점수, margin, confidence, ambiguity만 포함하고 prompt fragment나 error detail을 포함하지 않는다. Report의 평가 문맥은 허용된 synthetic fixture 또는 안전한 `redactedPrompt`로 제한하며 고객 raw prompt를 사용하지 않는다.

## 다음 단계

평가셋과 리포트가 준비된 뒤의 단기 category rule 개선은 아래 순서로 진행한다.

1. 평가셋을 늘린다.
2. 실패 sample을 보고 룰을 수동으로 보강한다.
3. confusion matrix와 category diagnostics로 과대·과소 분류 원인을 확인한다.
4. 같은 평가셋으로 accuracy와 classifier latency가 개선됐는지 비교한다.
5. 실제 성능 테스트 시나리오에서 Gateway 전체 latency와 category-classifier latency를 분리해 본다.

중장기 model 개선은 같은 평가셋에 정답을 맞추는 반복으로 끝내지 않는다. 운영 분포를 반영한 데이터 확보, family/time-disjoint split, blind evaluation, untouched promotion holdout, request shadow, 제한적 canary와 rollback을 매 dataset version마다 반복한다. 구체적인 데이터 동의·redaction, 합성/리뷰 prompt provenance와 gated batch retraining 절차는 [`difficulty-continuous-improvement-plan.md`](difficulty-continuous-improvement-plan.md)에 정의한다.

## 주의사항

- 라우팅은 safety/masking 책임을 가져오지 않는다.
- 고객 프롬프트는 자동 수집하지 않는다.
- 평가셋은 synthetic 또는 사람이 별도로 준비한 안전한 redacted sample만 사용한다.
- category label과 진단은 평가용 evidence이며, 그대로 API/DB 필드로 승격하지 않는다.
- 라우팅 룰 상세는 관리자 UI에 노출하지 않는다.

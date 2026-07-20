# Semantic Cache Limited Enforce Readiness

이 문서는 `SemanticCacheShadowEvalReport` 기반으로 Semantic Cache의 제한적 enforce 가능성을 판단하는 기준을 정리한다.

이번 기준은 production 전체 rollout 선언이 아니다. 목적은 shadow evaluation 결과가 충분히 안전한지 확인한 뒤, `general` category에 한정된 controlled canary를 검토할 수 있는지 판정하는 것이다.

## 목표

- 기존 `SemanticCacheShadowEvalReport` field를 유지한다.
- readiness 판단은 순수 domain evaluator가 담당한다.
- command layer는 evaluator 결과를 출력하고 `--gate`에서 통과/실패만 처리한다.
- DB, API, Event, Metrics, dashboard UI 계약은 추가하지 않는다.
- `semantic_cache_policy_ko_v1.json`의 threshold와 기본 env 동작은 변경하지 않는다.

## Readiness Gate

limited enforce ready 조건은 아래를 모두 만족해야 한다.

- `criticalFalsePositiveCandidateCount == 0`
- `falsePositiveCandidateCount == 0`
- `returnedFromSemanticCacheCount == 0`
- `safeToEnforceCandidateCategories == ["general"]`
- `general` category의 `falsePositive == 0`
- `account_access`, `support_refund`, `code`, `translation`, `unknown`은 enforce 후보에서 제외

`safeToEnforceCandidateCategories`가 비어 있거나 `general` 외 category가 포함되면 ready가 아니다.

## Threshold-Only Risk와 Policy-Guard Risk

readiness output은 두 지표를 분리한다.

| 구분 | 의미 | readiness 실패 조건 여부 |
|---|---|---|
| `thresholdOnlyRiskSummary` | similarity threshold만 봤을 때의 false positive 위험 | 단독으로는 실패 조건이 아님 |
| `policyGuardRiskSummary` | `SemanticCacheHitPolicy.Evaluate` 이후 최종 `wouldHit` 기준 위험 | 실패 조건에 사용 |

이 구분이 필요한 이유는 `account_access`, `support_refund`처럼 문장 similarity는 높지만 같은 답을 재사용하면 안 되는 케이스가 있기 때문이다. threshold-only false positive가 존재해도, `canonicalIntent`, `requiredSlots`, `hardNegative` guard 이후 `falsePositiveCandidateCount == 0`이면 제한적 `general` canary 후보는 될 수 있다.

반대로 policy guard 이후에도 `falsePositiveCandidateCount > 0`이면 limited enforce ready가 아니다.

## Command

기본 report 출력:

```powershell
go run ./apps/gateway-core/cmd/semantic-cache-shadow-eval
```

readiness gate 확인:

```powershell
go run ./apps/gateway-core/cmd/semantic-cache-shadow-eval --gate
```

`--gate`는 domain evaluator 결과인 `readyForLimitedEnforce`가 `false`이면 non-zero로 종료한다. command layer에는 별도 readiness business logic을 두지 않는다.

## General-Only Controlled Canary 예시

아래 설정은 production 전체 적용 예시가 아니다. demo/control tenant와 application에 한정한 canary 예시다.

```env
SEMANTIC_CACHE_ENABLED=true
SEMANTIC_CACHE_MODE=enforce
SEMANTIC_CACHE_ALLOWED_CATEGORIES=general
SEMANTIC_CACHE_ALLOWED_TENANT_IDS=tenant_demo
SEMANTIC_CACHE_ALLOWED_APPLICATION_IDS=app_demo
SEMANTIC_CACHE_THRESHOLD_GENERAL=0.92
```

주의:

- 기본값을 바꾸지 않는다.
- `semantic_cache_policy_ko_v1.json`의 `general.categoryThreshold=0.50`은 이번 단계에서 유지한다.
- `SEMANTIC_CACHE_THRESHOLD_GENERAL=0.92`는 canary 실행 시의 추천 env 예시다.
- `account_access`와 `support_refund`는 false positive가 0이어도 이번 gate에서는 enforce 후보가 아니다.

## Shadow Readiness와 Enforce Canary의 차이

`returnedFromSemanticCacheCount == 0` 조건은 shadow readiness gate에만 적용된다. enforce canary runtime에서는 제한된 `general` hit에 대해 semantic cache 반환이 발생할 수 있다.

즉, shadow readiness는 “아직 실제 반환하지 않는 상태에서 false positive 후보가 없는지”를 보는 단계이고, enforce canary는 “허용된 tenant/application/category 안에서만 실제 반환이 안전하게 일어나는지”를 보는 단계다.

따라서 shadow gate 기준을 enforce canary runtime 검증에 그대로 적용하면 안 된다.

## Controlled Canary Runbook

canary 전제 조건:

1. `go run ./apps/gateway-core/cmd/semantic-cache-shadow-eval --gate`가 통과해야 한다.
2. report의 `safeToEnforceCandidateCategories`가 정확히 `["general"]`이어야 한다.
3. report output과 runtime metadata에서 forbidden marker guard가 통과해야 한다.
4. `semantic_cache_policy_ko_v1.json` threshold와 기본 env/default는 변경하지 않는다.

canary 대상:

- demo/control tenant
- demo/control application
- `general` category only
- OpenAI API 필수 아님. runtime 테스트는 fake embedding provider 또는 기존 test harness로 통과해야 한다.

관찰할 safe metadata:

- `semanticCacheMode`
- `semanticCacheEnabled`
- `semanticCacheDecisionReason`
- `semanticSimilarity`
- `semanticCacheThreshold`
- `semanticCanonicalIntent`
- `semanticRequiredSlotsHash`
- `semanticCandidateFound`
- `semanticCandidateHash`
- `semanticReturnedFromCache`

즉시 중단 조건:

- non-general category에서 `semanticReturnedFromCache=true` 발생
- tenant/application scope 밖에서 `semanticReturnedFromCache=true` 발생
- forbidden marker가 log, metadata, response metadata에 노출
- hard negative에서 `semanticReturnedFromCache=true` 발생
- `requiredSlotsHash` mismatch에서 `semanticReturnedFromCache=true` 발생

rollback 방법:

```env
SEMANTIC_CACHE_MODE=shadow
```

또는 더 보수적으로 아래 중 하나를 사용한다.

```env
SEMANTIC_CACHE_MODE=off
SEMANTIC_CACHE_ENABLED=false
```

## 금지 데이터

아래 값은 cache entry, log, detail, metric label, report output에 평문 저장하거나 출력하지 않는다.

- raw prompt
- raw response
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret

`SemanticCacheEvalReportOutputContainsForbiddenMarker`는 report 출력 전에 forbidden marker가 섞였는지 확인하는 guard로 사용한다.

## 아직 Production-Ready가 아닌 이유

- 현재 readiness는 91개 한국어 evaluation case와 shadow aggregate 기준이다.
- production traffic 전체 분포를 대표한다고 보장할 수 없다.
- `account_access`, `support_refund`는 답변 재사용 위험이 높아 canary 후보에서 제외했다.
- StorePolicy, tenant별 runtime policy, 운영 dashboard, 장기 관측 기준은 아직 별도 후속 작업이다.

## 후속 작업

1. shadow traffic 기반 report를 더 많이 수집한다.
2. `general` category canary를 demo/control tenant에서만 제한적으로 검증한다.
3. false positive 후보가 나오면 eval dataset과 `semantic_cache_policy_ko_v1.json`을 함께 보강한다.
4. `account_access`, `support_refund`는 별도 readiness 기준과 더 큰 평가셋을 만든 뒤 검토한다.

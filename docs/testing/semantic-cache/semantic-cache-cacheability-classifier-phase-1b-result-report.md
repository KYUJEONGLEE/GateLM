# Semantic Cache Cacheability Classifier Phase 1B Result Report

## 완료한 작업

- exact cache miss 이후 semantic lookup 이전에 cacheability classifier gate를 연결했다.
- Semantic Cache mode off, exact cache hit, category/rollout/boundary/input cheap deny 조건에서는 classifier 호출 전에 skip되도록 유지했다.
- classifier result를 request context에 저장했다.
  - label
  - confidence
  - reasonCode
  - modelVersion
  - evaluated/pass 여부
- lookup에서 생성된 semantic embedding query vector를 request context에 저장하고 store 단계에서 재사용하도록 했다.
- classifier disabled/no-op/error/timeout/invalid/low-confidence/dynamic/unknown 결과는 semantic lookup/store를 no-op 처리하고 provider execution은 계속 진행하도록 했다.
- store eligibility에서 lookup 단계 classifier result를 다시 확인하도록 했다.
- `cacheable_policy`는 기존 request context의 `RuntimeCachePolicy.CachePolicyHash`가 semantic boundary에 포함된 경우에만 후보로 통과시키고, 없으면 fail-closed 처리했다.
- classifier gate를 통과한 요청은 기존 intent rule materialization miss만으로 embedding lookup 자체가 막히지 않도록 `SemanticCacheLookupRequest.CacheabilityGatePassed`를 추가했다.
  - intent policy 파일 자체가 없는 경우는 기존 no-op 동작을 유지한다.
- Phase 2/Phase 3 작업은 진행하지 않았다.

## 변경한 주요 파일

- `apps/gateway-core/internal/http/handlers/chat_completions_handler.go`
- `apps/gateway-core/internal/http/handlers/chat_completions_semantic_cache_test.go`
- `apps/gateway-core/internal/domain/cache/semantic_service.go`
- `apps/gateway-core/internal/domain/cache/semantic_cache_test.go`
- `apps/gateway-core/internal/pipeline/context.go`
- `apps/gateway-core/internal/app/router.go`
- `apps/gateway-core/internal/domain/cache/cacheability_classifier.go`

## 실행한 테스트

```powershell
go test ./internal/domain/cache
go test ./internal/http/handlers
go test ./internal/app
go test ./...
git diff --check
corepack pnpm run verify:v2-docs
corepack pnpm run verify:v2-final
```

## 테스트 결과

- `go test ./internal/domain/cache`: 통과
- `go test ./internal/http/handlers`: 통과
- `go test ./internal/app`: 통과
- `go test ./...` in `apps/gateway-core`: 통과
- `git diff --check`: 통과
- `corepack pnpm run verify:v2-docs`: 통과
- `corepack pnpm run verify:v2-final`: 실패
  - `@gatelm/control-plane-api` typecheck 실패: Prisma generated client에 `budgetLimitMode`, `budgetLimitUsd`, `budgetLimitPercent`, `totalBudgetUsd`, `Team`, `ProjectTeamAssignment` 등이 없는 상태에서 서비스 코드가 해당 필드를 참조한다.
  - `@gatelm/control-plane-api` tests 실패: 위 TypeScript compile error로 `applications.service.spec.ts`, `projects.service.spec.ts` suite가 실행 전 실패했다.
  - `@gatelm/web` typecheck 실패: `echarts/charts`, `echarts/components`, `echarts/core`, `echarts/renderers` module/type declaration을 찾지 못했다.
  - gateway-core Go tests는 `verify:v2-final` 내부에서도 통과했다.

## 실패하거나 보류한 항목

- `corepack pnpm run verify:v2-final`은 기존 workspace의 control-plane Prisma generated type 불일치와 web `echarts` dependency/type resolution 문제로 실패했다.
- FastText 학습, FastText serving, sidecar, runtime demo evidence는 Phase 1B 범위가 아니므로 진행하지 않았다.
- Public API, DB schema, persisted Event schema, Dashboard Metrics contract는 변경하지 않았다.
- 기존 intent/rule materialization은 삭제하지 않았고, classifier gate 이후의 secondary validation 역할로 남겼다.

## 다음 Phase/Sub-Phase에서 이어받아야 할 내용

- Phase 2에서 synthetic training data와 FastText 준비를 진행하기 전, Phase 1A/1B 코드와 결과 보고서를 기준으로 dataset label 기준을 맞춰야 한다.
- FastText classifier 연동 시에도 `CacheabilityClassifier` interface 뒤에 구현을 붙이고, 기본 production config는 disabled/no-op 원칙을 유지해야 한다.
- `cacheable_policy` 확대가 필요하면 새 public field를 만들지 말고 기존 RuntimeSnapshot 또는 RuntimeCachePolicy boundary material로 검증 가능해야 한다.
- Phase 3 runtime/demo evidence에서는 classifier skip 시 embedding provider가 호출되지 않는 evidence와, lookup/store 사이 embedding 중복 호출이 없는 evidence를 포함해야 한다.

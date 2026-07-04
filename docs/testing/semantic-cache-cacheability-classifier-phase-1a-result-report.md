# Semantic Cache Cacheability Classifier Phase 1A Result Report

## 완료한 작업

- `CacheabilityClassifier` 내부 interface를 추가했다.
- classifier result contract를 내부 domain type으로 추가했다.
  - label: `cacheable_static`, `cacheable_policy`, `dynamic_user_state`, `unsafe_or_unknown`
  - confidence: `0.0` 이상 `1.0` 이하
  - `reasonCode`, `modelVersion`
- invalid label, invalid confidence, empty result를 contract error로 다룰 수 있도록 validation을 추가했다.
- classifier config를 추가했다.
  - `SEMANTIC_CACHE_CLASSIFIER_ENABLED=false`
  - `SEMANTIC_CACHE_CLASSIFIER_TYPE=stub`
  - `SEMANTIC_CACHE_CLASSIFIER_MIN_CONFIDENCE=0.90`
  - `SEMANTIC_CACHE_CLASSIFIER_TIMEOUT_MS=30`
- production/default 설정에서는 disabled/no-op으로 동작하도록 factory와 config 기본값을 준비했다.
- deterministic stub classifier를 추가했다.
  - 명시적으로 enabled이고 type이 `stub`일 때만 factory가 stub classifier를 반환한다.
  - disabled 또는 `noop` type이면 fail-closed no-op classifier를 반환한다.
- `.env.example`에 Phase 1A classifier env 기본값을 추가했다.

## 변경한 주요 파일

- `apps/gateway-core/internal/domain/cache/cacheability_classifier.go`
- `apps/gateway-core/internal/domain/cache/cacheability_classifier_test.go`
- `apps/gateway-core/internal/config/config.go`
- `apps/gateway-core/internal/config/semantic_cache_config_test.go`
- `.env.example`

## 실행한 테스트

```powershell
go test ./internal/domain/cache
go test ./internal/config
go test ./...
git diff --check
corepack pnpm run verify:v2-docs
corepack pnpm run verify:v2-final
```

## 테스트 결과

- `go test ./internal/domain/cache`: 통과
- `go test ./internal/config`: 통과
- `go test ./...` in `apps/gateway-core`: 통과
- `git diff --check`: 통과
- `corepack pnpm run verify:v2-docs`: 통과
- `corepack pnpm run verify:v2-final`: 실패
  - `@gatelm/control-plane-api` typecheck 실패: Prisma generated client에 `budgetLimitMode`, `budgetLimitUsd`, `budgetLimitPercent`, `totalBudgetUsd`, `Team`, `ProjectTeamAssignment` 등이 없는 상태에서 서비스 코드가 해당 필드를 참조한다.
  - `@gatelm/control-plane-api` tests 실패: 위 TypeScript compile error로 `applications.service.spec.ts`, `projects.service.spec.ts` suite가 실행 전 실패했다.
  - `@gatelm/web` typecheck 실패: `echarts/charts`, `echarts/components`, `echarts/core`, `echarts/renderers` module/type declaration을 찾지 못했다.
  - 위 실패는 이번 Phase 1A에서 수정한 gateway-core classifier/config 파일과 직접 관련 없는 기존 workspace 상태로 판단했다.

## 실패하거나 보류한 항목

- `corepack pnpm run verify:v2-final`은 기존 workspace 상태로 인해 실패했다.
- Phase 1A 범위를 지키기 위해 Gateway request path에는 classifier를 연결하지 않았다.
- Semantic Cache lookup/store path와 embedding provider 호출 흐름은 변경하지 않았다.
- FastText 학습, FastText serving, sidecar, runtime integration은 진행하지 않았다.
- Public API, DB schema, persisted Event schema, Dashboard Metrics contract는 변경하지 않았다.

## 다음 Phase/Sub-Phase에서 이어받아야 할 내용

- Phase 1B에서 exact cache miss 이후 semantic lookup 이전에 classifier gate를 연결한다.
- Phase 1B에서 disabled/error/timeout/invalid/low-confidence 결과를 Semantic Cache no-op으로 처리한다.
- Phase 1B에서 classifier gate skip 시 embedding provider가 호출되지 않도록 보장한다.
- Phase 1B에서 lookup 단계 classifier result를 request context에 저장하고 store 단계에서 재사용한다.
- Phase 1B에서 store eligibility가 classifier result와 기존 store policy를 함께 확인하도록 연결한다.
- `cacheable_policy`는 기존 request context 또는 RuntimeSnapshot에서 확인 가능한 policy/version/hash가 semantic boundary에 있을 때만 store 후보로 다뤄야 한다.

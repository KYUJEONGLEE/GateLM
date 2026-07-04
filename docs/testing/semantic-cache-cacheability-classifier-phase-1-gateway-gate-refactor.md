# Semantic Cache Cacheability Classifier Phase 1: Gateway Gate Refactor

이 문서는 Semantic Cache cacheability classifier gate 설계의 Phase 1 실행 범위를 정의한다.

긴 설계 내용과 Phase 1 범위가 충돌하면 Phase 1 범위를 우선한다. 전체 방향과 공통 제약은 [Semantic Cache Cacheability Classifier Gate Plan](semantic-cache-cacheability-classifier-gate-plan.md)을 따른다.

## Required Reading

작업 시작 전에 반드시 [Semantic Cache Cacheability Classifier Gate Plan](semantic-cache-cacheability-classifier-gate-plan.md)을 먼저 읽는다.

Phase 1A는 이전 Phase 결과 보고서를 요구하지 않는다.

Phase 1B 구현 전에는 Phase 1A 결과 보고서를 읽고, Phase 1A의 실제 결과와 known gap을 반영해 계획을 조정한다.

```text
docs/testing/semantic-cache-cacheability-classifier-phase-1a-result-report.md
```

## Required Completion Report

Phase 1A 완료 시 아래 결과 보고서 파일을 생성한다.

```text
docs/testing/semantic-cache-cacheability-classifier-phase-1a-result-report.md
```

Phase 1B 완료 시 아래 결과 보고서 파일을 생성한다.

```text
docs/testing/semantic-cache-cacheability-classifier-phase-1b-result-report.md
```

보고서는 Summary, Files Changed, Behavior Changes, Tests Run, Acceptance Status, Known Gaps, Next Phase Handoff를 포함한다.

## Phase 1A Scope

- `CacheabilityClassifier` interface 추가
- classifier result type, label, confidence contract 추가
- classifier config 추가
- deterministic local/stub classifier 추가
- classifier disabled/no-op 기본 동작 테스트 추가

## Phase 1A Non-Scope

- Gateway request path에 classifier gate 연결
- Semantic Cache lookup/store path 변경
- Embedding provider 호출 흐름 변경
- FastText 실제 모델 학습/서빙 연동
- FastText sidecar 구현
- Public API 변경
- DB schema 변경
- persisted Event schema 변경
- Dashboard Metrics contract 변경

## Phase 1A Acceptance

- `CacheabilityClassifier` interface와 result/label/confidence contract가 domain 내부 type으로 추가된다.
- Classifier config가 추가되고 기본값은 disabled/no-op이다.
- Deterministic local/stub classifier가 test/demo 용도로 명시적으로 enable될 수 있다.
- deterministic local/stub classifier는 test/demo에서 명시적으로 enable된 경우에만 cacheable label을 반환한다.
- production/default 설정에서는 disabled/no-op으로 동작해야 한다.
- Disabled/no-op 상태에서 Semantic Cache classifier가 request execution을 막지 않는다.
- Invalid label, invalid confidence, empty result를 classifier error로 다룰 수 있는 contract가 준비된다.
- Public API, DB schema, persisted Event, Dashboard Metrics contract가 변경되지 않는다.

## Phase 1B Scope

- exact cache miss 이후 semantic lookup 이전에 classifier gate 연결
- classifier disabled/error/timeout/invalid/low-confidence 시 Semantic Cache no-op 처리
- classifier gate skip 시 embedding provider가 호출되지 않도록 보장
- lookup 단계 classifier result를 request context에 저장하고 store 단계에서 재사용
- store eligibility에서 classifier result와 기존 store policy를 함께 확인
- 관련 Go 테스트 추가

## Phase 1B Non-Scope

- FastText 실제 모델 학습/서빙 연동
- FastText sidecar 구현
- synthetic dataset 생성 자동화
- Public API 변경
- DB schema 변경
- persisted Event schema 변경
- Dashboard Metrics contract 변경
- 기존 intent/rule materialization 삭제
- vector store 변경

## Phase 1B Acceptance

- Classifier disabled 상태에서도 기존 요청 경로가 정상 동작한다.
- Exact cache hit이면 classifier와 embedding provider가 호출되지 않는다.
- Semantic Cache off, stream request, unsupported route, 해당 시점에 이미 blocked로 판정된 request는 classifier 호출 전에 skip된다.
- `cacheable_static`/`cacheable_policy` 요청은 semantic lookup/store 후보가 된다.
- `dynamic_user_state`/`unsafe_or_unknown`/low confidence/error/disabled 요청은 embedding 호출 없이 no-op 된다.
- Classifier gate를 통과한 요청이 기존 intent/rule materialization 실패 때문에 embedding lookup 자체를 skip하지 않는다.
- Provider error/fallback/safety blocked/forbidden payload면 semantic store가 발생하지 않는다.
- Lookup 단계에서 classifier가 skip/error/low-confidence였던 요청은 provider success 이후에도 semantic store가 발생하지 않는다.
- `mode=shadow`에서는 classifier가 cacheable이고 semantic candidate가 있어도 provider bypass하지 않는다.
- `mode=enforce`에서만 기존 hit policy를 통과한 semantic cached response가 반환된다.
- `cacheable_policy` label은 기존 request context 또는 RuntimeSnapshot에서 이미 확인 가능한 policy/version/hash가 semantic cache boundary에 포함되어 있을 때만 store 후보가 된다.
- 정책 버전 또는 policy hash를 기존 경로에서 확인할 수 없는 `cacheable_policy` 요청은 fail-closed 된다.
- 동일 요청에서 semantic lookup/store 때문에 embedding provider가 중복 호출되지 않는다.
- 기존 exact cache와 actual cacheHitRate 분리 정책이 유지된다.

## Verification

- Phase 1A/1B 범위에 맞는 관련 Go 테스트를 추가/수정한다.
- `git diff --check`
- 영향 범위에 따라 `go test ./...` 또는 gateway-core 관련 Go 테스트를 실행한다.

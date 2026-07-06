# Semantic Cache Cacheability Classifier Phase 3: Runtime Integration And Demo Evidence

이 문서는 Semantic Cache cacheability classifier gate 설계의 Phase 3 실행 범위를 정의한다.

전체 방향과 공통 제약은 [Semantic Cache Cacheability Classifier Gate Plan](semantic-cache-cacheability-classifier-gate-plan.md)을 따른다.

## Required Reading

작업 시작 전에 반드시 [Semantic Cache Cacheability Classifier Gate Plan](semantic-cache-cacheability-classifier-gate-plan.md)을 먼저 읽는다.

Phase 3 구현 전에 Phase 1A/1B/2 결과 보고서를 읽고, 이전 Phase의 실제 결과와 known gap을 반영해 계획을 조정한다.

```text
docs/testing/semantic-cache-cacheability-classifier-phase-1a-result-report.md
docs/testing/semantic-cache-cacheability-classifier-phase-1b-result-report.md
docs/testing/semantic-cache-cacheability-classifier-phase-2-result-report.md
```

이전 Phase 결과 보고서가 없으면 Phase 3 구현을 시작하지 않는다.

## Required Completion Report

Phase 3 완료 시 아래 결과 보고서 파일을 생성한다.

```text
docs/testing/semantic-cache-cacheability-classifier-phase-3-result-report.md
```

보고서는 완료한 작업, 변경한 주요 파일, 실행한 테스트, 테스트 결과, 실패하거나 보류한 항목, 다음 Phase/Sub-Phase에서 이어받아야 할 내용을 포함한다.

## Scope

- FastText sidecar 또는 local model classifier 연동
- env로 `stub`/`fasttext` 전환
- timeout/error/invalid response 처리
- gateway classifier adapter 구현
- Go adapter에서 FastText sidecar 또는 local model classifier를 호출하는 runtime path 구성
- demo 문장 pair 검증
- shadow/enforce 동작 검증
- embedding 중복 호출 방지 최종 확인

## Non-Scope

- Classifier가 직접 hit을 결정하지 않는다.
- Gateway runtime request path에서 Python 학습/평가 스크립트를 매 요청마다 실행하지 않는다.
- Semantic Cache evidence를 normal API/UI surface에 노출하지 않는다.
- Actual cacheHitRate에 shadow hit이나 semantic candidate evidence를 섞지 않는다.

## Acceptance

- FastText classifier가 enabled일 때 cacheable paraphrase가 Semantic Cache lookup 경로에 진입한다.
- Dynamic/user-specific request는 Semantic Cache와 embedding 호출이 skip된다.
- Classifier timeout/error/invalid response는 request execution/provider call을 막지 않는다.
- `mode=shadow`에서는 provider bypass가 발생하지 않는다.
- `mode=enforce`에서만 기존 hit policy 통과 시 cached response가 반환된다.
- Actual cacheHitRate는 실제 provider bypass가 발생한 cache response만 포함한다.

## Verification

- Go integration test
- Demo pair manual verification
- Gateway logs 또는 test-only metadata로 classifier decision과 embedding call count 확인
- 기존 smoke 또는 관련 Go 테스트 확인

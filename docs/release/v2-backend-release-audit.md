# GateLM v2 백엔드 릴리즈 감사

감사 일시: 2026-07-02 KST

이 문서는 출시를 돕기 위한 문서가 아니라, 출시해도 되는 상태인지 막기 위한 검수 문서다. 증거가 없는 항목은 완료로 보지 않는다.

## 최종 판정

Status: PASS

판정 범위: v2 백엔드 핵심 E2E, Request Log/Detail/Dashboard 연결, mock 기반 k6 smoke, release evidence gate, final verification.

사유: 최신 실행 증거 기준으로 실제 OpenAI Provider E2E, 동일 requestId 기반 Request Log Consistency, mock-provider 기반 k6 smoke, required release evidence gate, `verify:v2-final`이 모두 통과했다. Gateway는 published RuntimeSnapshot을 소비했고, actual provider 성공 요청은 Request Detail/Dashboard까지 연결됐다. mock k6 smoke는 cache/safety/provider timeout/provider error fallback 흐름을 Gateway 요청 경로에서 검증했고 threshold를 만족했다.

주의: 이 PASS는 아래 Evidence에 기록된 실행 범위에 한정된다. 현재 pnpm script 실행 환경은 Node `v24.14.0`으로 프로젝트 기준 `>=22 <23`과 다르며, 실행 중 engine warning이 발생했다. 또한 이번 최종 갱신 시점에 `pnpm install --frozen-lockfile` 성공을 새로 확인하지 않았다. 이 두 항목은 환경 재현성 리스크로 별도 관리한다.

## 최신 Evidence 요약

| 영역 | Status | Evidence | Problem / Gap |
|---|---|---|---|
| 공백/패치 검사 | PASS | 명령어: `git diff --check`; exit code 0. | 없음. |
| v2 문서 검증 | PASS | 명령어: `corepack pnpm run verify:v2-docs`; 출력: `v2 document verification passed.` | 런타임 검증은 아니며 문서/schema guardrail 증거다. |
| 최종 검증 | PASS | 명령어: `corepack pnpm run verify:v2-final`; 출력: `v2 final hardening passed.` Control Plane Jest `9 suites / 79 tests` PASS, web typecheck PASS, Gateway `go test ./...` PASS. | Node engine warning 있음: current Node `v24.14.0`, wanted `>=22 <23`. |
| Actual OpenAI Provider E2E | PASS | 명령어: `corepack pnpm v2:provider:openai:e2e`; report: `reports/e2e/v2-provider-e2e-20260702-113403.json`; requestId: `request_v201_provider_e2e_20260702-113403`; `provider.outcome=success`, `fallback.outcome=not_needed`; gateway `http://localhost:8080`; OpenAI base `https://api.openai.com/v1`; actual seed `True`. | fallback은 이 요청에서 필요하지 않았다. fallback success는 k6 mock smoke에서 별도 검증했다. |
| Request Log Consistency | PASS | 명령어: `corepack pnpm v2:request-log:consistency -RequestId request_v201_provider_e2e_20260702-113403`; report: `reports/e2e/v2-request-log-consistency-20260702-113559.json`; `terminalStatus=success`, `provider.outcome=success`, `cache.outcome=miss`, `runtimeSnapshotId=83f7a68c-be22-40ae-bb6a-3455f7bdbbbe`. | 이 증거는 Provider E2E 최신 requestId에 대한 정합성 검증이다. |
| k6 mock smoke | PASS | 명령어: `corepack pnpm v2:k6:mock-smoke`; summary: `reports/e2e/v2-k6-smoke-v201_mock_smoke_20260702_113004-summary.json`; `checks=1`, `http_req_failed=0`; setup data keys: `runId, metricsBefore, providerFailureModels, providerFailureScenariosEnabled, providerMode`; prompt field 없음. | 실제 OpenAI가 아니라 mock-provider 기반 smoke다. 실제 OpenAI main path는 Provider E2E에서 별도 검증했다. |
| Release evidence gate | PASS | 명령어: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/v2-release-evidence.ps1 -RequireProviderE2E -RequireRequestLogConsistency -RequireK6Smoke`; manifest: `reports/e2e/v2-release-evidence-manifest-20260702-113604.json`; evidence files: 3. | manifest required set은 Provider E2E, Request Log Consistency, k6 smoke다. |
| Control Plane | PASS | `verify:v2-final` 내부에서 control-plane typecheck와 Jest 전체 suite가 통과했다. 이전 별도 검증에서도 `GET http://localhost:3001/healthz`가 `{"status":"ok"}`를 반환했다. | 이번 문서 갱신 직전에 `/healthz`를 별도 재호출하지는 않았다. |
| Gateway Go package tests | PASS | `verify:v2-final` 내부 Gateway `go test ./...` PASS. 별도 mock provider adapter test도 통과했다. | 없음. |
| Web typecheck | PASS | `verify:v2-final` 내부 `@gatelm/web` typecheck PASS. | Web demo 화면 E2E는 이 문서의 PASS 범위에 포함하지 않는다. |
| Node/pnpm 기준 | PARTIAL | pnpm version은 `9.15.0`으로 기준과 일치한다. 모든 pnpm script는 실행 완료됐다. | 실행 중 engine warning 발생: wanted Node `>=22 <23`, current Node `v24.14.0`. Node runtime 기준은 완전히 깨끗한 PASS가 아니다. |
| 설치 재현성 | PARTIAL | 현재 workspace의 설치 상태로 모든 최신 검증 명령은 통과했다. | `pnpm install --frozen-lockfile` 최신 성공 증거는 없다. 이전 감사 시도에서는 sandbox/network/permission 문제로 실패했다. |

## Release Evidence Manifest

최신 required manifest:

```text
reports/e2e/v2-release-evidence-manifest-20260702-113604.json
```

Manifest 포함 evidence:

| Scenario | Evidence file | Request ID / Result |
|---|---|---|
| provider_e2e | `reports/e2e/v2-provider-e2e-20260702-113403.json` | `request_v201_provider_e2e_20260702-113403`, provider success |
| request_log_consistency | `reports/e2e/v2-request-log-consistency-20260702-113559.json` | `request_v201_provider_e2e_20260702-113403`, terminal success |
| k6_smoke | `reports/e2e/v2-k6-smoke-v201_mock_smoke_20260702_113004-summary.json` | checks succeeded, HTTP failures 0 |

## 릴리즈 수준 Acceptance

| Requirement | Status | Evidence | Problem / Gap |
|---|---|---|---|
| Gateway가 published RuntimeSnapshot만 소비한다 | PASS | Provider E2E 및 Request Log Consistency에서 `runtimeSnapshotId=83f7a68c-be22-40ae-bb6a-3455f7bdbbbe`, `runtimeState=snapshot_active`가 확인됐다. | 없음. |
| Actual Provider main path가 Gateway를 통해 성공한다 | PASS | `corepack pnpm v2:provider:openai:e2e`; `provider.outcome=success`, `fallback.outcome=not_needed`, gateway `http://localhost:8080`, OpenAI base `https://api.openai.com/v1`. | 없음. |
| Request Detail이 실제 requestId 기반으로 조회된다 | PASS | `corepack pnpm v2:request-log:consistency -RequestId request_v201_provider_e2e_20260702-113403`; report에서 동일 requestId의 `terminalStatus=success`와 provider/cache/runtime outcome을 확인했다. | 없음. |
| 로그가 실제 요청 흐름에 남는다 | PASS | Request Log Consistency report: `terminalStatus=success`, `provider.outcome=success`, `logging` outcome이 manifest에 포함됐다. | 없음. |
| Dashboard/API가 실제 로그 기반 결과를 소비한다 | PASS | Provider E2E report에서 `dashboardStatus=200`이 확인됐고, release evidence gate가 provider E2E report를 PASS evidence로 수집했다. | 세부 UI 화면 E2E는 별도 범위다. |
| Cache hit이 provider call을 bypass한다 | PASS | k6 mock smoke summary `reports/e2e/v2-k6-smoke-v201_mock_smoke_20260702_113004-summary.json`; cache hit 관련 checks가 실패 없이 통과했고, `http_req_failed=0`. | mock-provider 기반 smoke다. |
| Safety gate가 provider call 전 차단한다 | PASS | k6 mock smoke summary에서 safety block/redaction checks가 실패 없이 통과했다. | mock-provider 기반 smoke다. |
| Provider timeout/error fallback이 terminal success semantics를 지킨다 | PASS | k6 mock smoke summary에서 provider timeout/provider error mock fallback checks가 실패 없이 통과했다. | 실제 OpenAI 장애 주입이 아니라 mock-provider failure control 기반이다. |
| k6 evidence가 v2 smoke를 커버한다 | PASS | `corepack pnpm v2:k6:mock-smoke`; latest summary `checks=1`, `http_req_failed=0`. | k6는 mock smoke로 분리됐다. 실제 OpenAI provider main path는 별도 E2E에서 검증한다. |
| Release evidence가 sanitized artifact로 수집된다 | PASS | required release evidence gate PASS; manifest `reports/e2e/v2-release-evidence-manifest-20260702-113604.json`; k6 summary setup data에 prompt field 없음. | 전체 DB/UI dump에 대한 별도 raw secret scan은 이 문서 범위 밖이다. |

## 잔여 리스크와 주의 사항

1. Node runtime 기준 불일치가 있다.  
   Evidence: pnpm script 실행 중 `Unsupported engine: wanted {"node":">=22 <23"} current {"node":"v24.14.0","pnpm":"9.15.0"}` 경고 발생. 테스트는 통과했지만, CI/공식 로컬 기준 Node 22로 재실행하면 더 깨끗하다.

2. `pnpm install --frozen-lockfile` 최신 성공 증거가 없다.  
   Evidence: 이번 최종 갱신에서 install 명령을 재실행하지 않았다. 이전 감사 시도에서는 sandbox/network/permission 문제로 실패했다. 릴리즈 패키징 전에는 깨끗한 환경에서 별도 확인이 필요하다.

3. Web demo 화면 E2E는 이 PASS 범위에 포함하지 않는다.  
   Evidence: 이번 최신 PASS 묶음은 backend E2E/evidence gates 중심이다. Web typecheck는 PASS지만 사용자-facing 화면 플로우는 별도 E2E 증거가 필요하다.

4. Actual OpenAI fallback 장애 주입은 실행하지 않았다.  
   Evidence: actual Provider E2E는 `fallback.outcome=not_needed`였다. fallback success는 mock-provider failure control을 사용하는 k6 smoke로 검증했다.

## 최종 실행 명령

아래 명령들은 최신 감사에서 PASS evidence로 인정한다.

```powershell
git diff --check
corepack pnpm run verify:v2-docs
corepack pnpm run verify:v2-final
corepack pnpm v2:provider:openai:e2e
corepack pnpm v2:request-log:consistency -RequestId request_v201_provider_e2e_20260702-113403
corepack pnpm v2:k6:mock-smoke
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/v2-release-evidence.ps1 -RequireProviderE2E -RequireRequestLogConsistency -RequireK6Smoke
```

## 결론

최신 증거 기준으로 v2 백엔드 핵심 릴리즈 경로는 PASS다. 다만 이 문서는 증거가 있는 범위만 PASS로 인정한다. Node 버전 경고, install 재현성, Web demo E2E, actual OpenAI 장애 주입 fallback은 별도 후속 검증 항목으로 남긴다.

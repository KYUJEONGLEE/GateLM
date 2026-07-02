# GateLM v2.0.0 Demo Scenario And Evidence

이 문서는 v2.0.0 발표/시연에서 구현된 동작을 증명하기 위한 실행 순서다.
데모는 기능 설명이 아니라, 같은 요청 흐름이 Gateway, Request Detail, Dashboard, Metrics에서 일관되게 보이는지 확인하는 데 집중한다.

## 1. 데모 목표

```text
RuntimeConfig publish
-> RuntimeSnapshot active
-> Gateway request
-> budget / safety / cache / routing
-> Actual Provider or Mock fallback
-> Request Detail / Dashboard / Metrics evidence
```

## 2. 보안 규칙

- raw prompt/raw response를 문서나 fixture에 저장하지 않는다.
- OpenAI API Key, Gateway API Key, App Token, Provider Key, Authorization header를 문서/스크립트 출력/report에 남기지 않는다.
- 스크립트 report에는 requestId, HTTP status, sanitized outcome/header, 확인 URL만 남긴다.
- audience free input은 core demo에서 열지 않는다.
- 실제 Provider key는 로컬 shell env나 배포 secret으로만 주입한다.

## 3. 사전 준비

로컬 기본값:

```powershell
$env:DATABASE_URL="postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public"
$env:REDIS_URL="redis://localhost:6379"
$env:CONTROL_PLANE_PORT="3001"
$env:CONTROL_PLANE_ADMIN_AUTH_MODE="demo_admin_placeholder"
```

실제 Provider main path를 보여줄 때만 추가:

```powershell
$env:GATELM_DEMO_PROVIDER_MODE="actual"
$env:GATEWAY_CONTROL_PLANE_BASE_URL="http://localhost:3001"
```

`OPENAI_API_KEY`는 로컬 shell 또는 배포 secret에만 설정한다.
값은 커밋, 문서, report, 채팅 로그에 남기지 않는다.

## 4. 실행 순서

1. Docker Postgres/Redis/Mock Provider 실행
2. Control Plane 실행
3. seed 실행
4. Gateway 실행
5. Web 실행
6. demo evidence probe 실행
7. Request Detail에서 requestId별 outcome 확인
8. Dashboard에서 freshness/query budget/outcome aggregate 확인
9. k6 baseline으로 mixed evidence 확인

## 5. 핵심 시나리오

| No | Scenario | 기대 증거 |
|---|---|---|
| 1 | safe request | `terminalStatus=success`, `provider.outcome=success` |
| 2 | exact cache hit | 두 번째 동일 요청에서 `cache.outcome=hit`, `provider.outcome=not_called` |
| 3 | redaction | `safety.outcome=redacted`, provider call 계속 |
| 4 | safety block | `terminalStatus=blocked`, `provider.outcome=not_called`, `cache.outcome=bypassed` |
| 5 | provider success | Actual Provider 사용 시 selected provider/model 확인 |
| 6 | provider error + Mock fallback | primary provider 실패 후 `fallback.outcome=success` |
| 7 | streaming thin slice | `streaming.outcome=completed`, token-level log 없음 |
| 8 | dashboard evidence | freshness/query budget/budget scope/provider latency가 표시됨 |

## 6. Evidence Probe

```powershell
pwsh scripts/dev/v2-demo-evidence.ps1
```

선택 옵션:

```powershell
pwsh scripts/dev/v2-demo-evidence.ps1 -GatewayBaseUrl http://localhost:8080 -RunK6
```

스크립트는 아래 report를 만든다.

```text
reports/demo/v2-demo-evidence-<timestamp>.json
```

report에는 secret이나 raw response를 저장하지 않는다.

## 7. 발표자가 보여줄 화면

| 화면 | 보여줄 것 |
|---|---|
| Policy Editor | RuntimeConfig가 publish 가능한 정책이라는 점 |
| Request Detail | terminal status, domain outcomes, RuntimeSnapshot provenance |
| Dashboard | freshness, query budget, budget scope, provider/cache/fallback aggregate |
| Metrics/k6 | forbidden label이 없고 provider/cache/log metric이 증가하는 점 |

## 8. 완료 기준

- Gateway health check가 통과한다.
- safe/cache/redaction/block/streaming scenario requestId가 생성된다.
- Request Detail에서 requestId별 outcome을 확인할 수 있다.
- Dashboard가 최신 request aggregate를 보여준다.
- k6 mixed demo traffic이 통과하거나, 실패 시 어느 dependency가 실패했는지 report에 남는다.

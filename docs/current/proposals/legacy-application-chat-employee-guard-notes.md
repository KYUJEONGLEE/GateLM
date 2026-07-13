# Legacy Application Chat Employee Guard Notes

| Field | Value |
|---|---|
| Status | Reference only, not an active contract |
| Applies to | Existing Project/Application-based Application Chat compatibility |
| Does not apply to | Proposed Tenant Chat product |
| Last reviewed | 2026-07-12 |

이 문서는 기존 Application Chat의 현재 연결 범위를 기록하는 참고 자료다. 신규 Tenant Chat의 identity, quota, ledger, JWT, history 또는 Gateway private path를 정의하지 않는다.

## 1. Frozen Scope

기존 Application Chat에는 새로운 제품 기능을 추가하지 않는다. 다음 호환성만 유지한다.

- Application 개발 서버 port `3002`
- Project와 Application profile 기반 Gateway 연결
- Project Gateway API Key와 기존 App Token 호환 경로
- 기존 대화와 요청 로그 조회 경로
- 기존 Project employee policy 적용 경로

## 2. Existing Runtime Shape

```text
runtime identity: tenantId + projectId + applicationId
trusted actor input: authenticated GateLM userId when a session exists
canonical employee identity: scoped employeeId
budget ownership: Project budget
employee guard: Project budget 안의 employee Rate Limit, daily token, monthly cost limit
quota result: high_quality route 제한, balanced 또는 low_cost route 유지
```

## 3. Compatibility Invariants

- 브라우저가 제공한 Tenant, User, Employee 또는 budget scope를 권한 근거로 신뢰하지 않는다.
- Project와 Application scope는 Gateway credential로 확정한다.
- employee policy가 적용되면 Gateway는 scoped employeeId를 canonical identity로 사용한다.
- 개인 Rate Limit은 Project와 Employee를 함께 포함한 bucket을 사용한다.
- 일일 토큰 또는 월간 비용 초과는 `high_quality` route를 제한한다.
- 직원별 Provider 또는 Model 선택 정책은 사용하지 않는다.
- PostgreSQL invocation log는 기존 사용량 조회의 durable source다.
- Redis employee counter는 기존 Gateway enforcement를 위한 파생 상태다.
- raw prompt, raw response, credential, Provider raw error를 log, metric 또는 UI에 노출하지 않는다.
- metric label에 Tenant, User, Employee 또는 Request ID를 넣지 않는다.

## 4. Regression Baseline

다음 검증이 통과하면 기존 Application Chat 호환성이 유지된 것으로 본다.

1. `http://localhost:3002`가 기존 port에서 HTTP 응답을 반환한다.
2. 기존 Project profile이 runtime-ready Gateway credential을 찾을 수 있다.
3. Project Gateway 요청이 기존 `/v1/chat/completions` 경로를 사용한다.
4. employee Rate Limit이 employee scope bucket을 선택한다.
5. employee daily token 또는 monthly cost exceed가 high-quality restriction을 만든다.
6. Project employee policy가 없으면 기존 Project runtime policy를 유지한다.

## 5. Explicit Separation From Tenant Chat

Tenant Chat은 이 문서의 다음 요소를 재사용한다고 가정하면 안 된다.

- Project/Application runtime identity
- scoped employeeId usage identity
- Project API Key 또는 App Token 요청 경로
- Project budget 내부 employee guard
- p0 terminal log 기반 usage source
- employee Redis key namespace
- low-cost downgrade quota behavior

Tenant Chat의 최종 설계는 Chat 팀이 제공하는 별도 계약을 기준으로 한다.

## 6. Change Rule

이 문서의 범위를 넘어 기존 Application Chat에 기능을 추가하려면 신규 Tenant Chat과 중복되지 않는지 먼저 확인한다. 단순 호환성 수정은 허용하지만 신규 identity, quota 또는 history 기능은 이 경로에 추가하지 않는다.

## 7. Point-in-time Smoke Evidence

2026-07-12 로컬 개발 환경에서 다음을 확인했다.

| Check | Result | Interpretation |
|---|---|---|
| `GET http://localhost:3002` | HTTP 200 | 기존 port와 Application surface 정상 |
| 익명 Chat API 요청 | HTTP 400, Control Plane admin session required | 최신 auth hardening에 따라 익명 smoke는 유효한 성공 시나리오가 아님 |
| Application container의 기존 Project key로 Gateway 요청 | Gateway 인증과 routing 성공 후 HTTP 502 `provider_timeout` | Project 연결은 유효하며 외부 Provider 성공은 당시 환경에서 확인되지 않음 |
| Gateway employee policy regression | 통과 | employee Rate Limit, daily token, monthly cost routing guard 유지 |

이 결과는 특정 시점의 환경 evidence이며 Provider live 성공을 계약으로 선언하지 않는다. 이후 smoke에서는 유효한 session 또는 별도 테스트 credential과 deterministic Mock Provider profile을 사용해야 한다.

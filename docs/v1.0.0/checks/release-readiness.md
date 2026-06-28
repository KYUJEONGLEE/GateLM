# GateLM v1.0.0 Release Readiness

이 문서는 v1.0.0 release 직전에 팀이 공유해야 할 완료 상태, 한계, 후속 작업만 짧게 정리한다.

## 1. Release Position

v1.0.0은 실제 Provider 확장 버전이 아니라, 제품처럼 설명 가능한 B2B LLM Gateway baseline이다.

Release 후보 기준:

- Main path는 Customer Demo App -> Gateway -> Log / Detail / Dashboard / Metrics다.
- Provider path는 Mock Provider가 기준이며, 실제 Provider는 후속 작업이다.
- Safety path는 Go rule-based redaction/block이 기준이다.
- AI Service / RemoteSafetyEngine은 optional shadow/evaluation path다.
- Data path는 PostgreSQL request log, PostgreSQL fixed-window rate limit, Redis exact cache다.
- Evidence는 local stack smoke, k6 baseline report, safety rule quality report다.

## 2. Release Evidence

| Evidence | Status | Source |
|---|---|---|
| Gateway local stack smoke | Ready | `scripts/dev/v1-local-stack-smoke.sh`, `scripts/dev/v1-local-stack-smoke.ps1` |
| k6 release evidence | Ready | `docs/v1.0.0/checks/k6-baseline-report.md` |
| Safety rule quality | Ready for demo baseline | `docs/v1.0.0/checks/rule-quality-report.md` |
| Demo scenario | Defined | `docs/v1.0.0/demo-scenario.md` |
| RemoteSafetyEngine contract | Defined as optional | `docs/v1.0.0/remote-safety-engine-contract.md` |

각 owner가 자신의 demo path가 이 문서들과 맞는지 확인하면 `v1.0.0-rc.1` 태그를 만들 수 있다.

## 3. Must Share With Other Roles

아래 내용은 final demo freeze 전에 다른 역할과 Codex에 공유해야 한다.

- Mock Provider가 v1.0.0 main Provider path다. OpenAI/Gemini/Claude 작업은 release 이후 v1.x 또는 v2 작업으로 시작한다.
- RemoteSafetyEngine/FastAPI는 optional shadow/evaluation이다. Python service가 꺼져 있어도 Gateway smoke와 `/readyz`는 통과해야 한다.
- k6 report는 release evidence다. 성능 개선의 기준선으로 쓰기에는 아직 부족하다.
- raw prompt, raw response, API Key, App Token, Provider Key, Authorization header, raw detected sensitive value는 기본 저장/노출 금지다.
- 향후 raw prompt/response capture가 필요하면 별도 opt-in 계약, retention, access control, encryption 결정을 먼저 해야 한다.
- P0 legacy field cleanup은 cross-role review 이후로 미룬다. release-blocking fix에서 공유 field를 rename/remove하지 않는다.
- PostgreSQL counter pruning adapter는 있지만 production 실행 방식은 아직 정하지 않았다.

## 4. Owner Checks

| Owner | Release 전 확인 |
|---|---|
| 김규민 | Demo App은 Gateway만 호출하고, Log/Detail/Dashboard는 raw prompt, raw response, credential을 보여주지 않는다. |
| 재혁님 | Project/Application/Provider/API Key/App Token/Runtime Config demo 상태가 v1 fixture/contract와 맞는다. |
| 이지섭 | `dev` 기준 Gateway local stack smoke가 통과하고, release fix가 API/DB/Event/Metrics 계약을 늘리지 않는다. |
| 이윤지 | Safety Lab 결과를 demo-baseline evidence로 설명하며, production-grade DLP coverage로 주장하지 않는다. |
| 이규정 | k6 결과를 release evidence로 설명하고, Dashboard/metrics 해석이 PostgreSQL logs와 `/metrics`에 맞는다. |

## 5. Known Limits

아래 항목은 v1.0.0 release blocker가 아니다.

- 실제 Provider 연결은 required release path가 아니다.
- Streaming은 지원하지 않는다.
- Semantic cache는 지원하지 않는다.
- Redis/distributed rate limit은 지원하지 않는다.
- Redpanda/ClickHouse analytics pipeline은 v1.0.0 범위가 아니다.
- Prometheus/Grafana scraping 구성은 baseline에 포함하지 않는다.
- k6는 아직 long-running, scenario-separated, stable-environment performance baseline이 아니다.
- Rule-based safety는 full production DLP coverage를 주장하지 않는다.
- RemoteSafetyEngine 결과는 후속 계약이 필드를 추가하기 전까지 Invocation Log에 저장하지 않는다.

## 6. Recommended Next Tags

권장 release 순서:

```text
v1.0.0-rc.1
-> final team demo check
-> v1.0.0
```

`v1.0.0` 이후에는 실제 Provider 연동, 더 강한 performance baseline, live RuntimeConfigProvider, contract-aligned cleanup을 별도 PR로 시작한다.

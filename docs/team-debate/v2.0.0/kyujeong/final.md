# Final Draft - 이규정

> Observability, Data Platform & Performance 관점의 v2.0.0 최종 토론 정리입니다.
> 공식 계약 문서가 아니며, API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.
> 합의된 내용만 이후 `docs/v2.0.0/contracts.md` 또는 `docs/v2.0.0/implementation-plan.md`로 승격해야 합니다.

## 1. 최종 입장

지섭님이 제안한 "조직 기반 LLMOps Gateway MVP" 방향에 동의합니다.
v2.0.0은 고급 기술을 한 번에 붙이는 버전이 아니라, v1.x에서 검증한 실제 Provider, RuntimeSnapshot, streaming thin slice, safety evidence, performance evidence를 모아 운영자가 조직의 LLM traffic을 설명하고 통제할 수 있는 목표 지점이어야 합니다.

Observability의 v2 핵심은 더 많이 저장하거나 더 많은 차트를 만드는 것이 아닙니다.
핵심은 아래 문장을 증명하는 것입니다.

```text
요청은 Gateway를 통과했고,
정책은 안전하게 적용됐고,
그 결과는 원문과 secret 없이도 설명 가능하게 남았다.
```

## 2. v2.0.0 제품 방향에 대한 합의로 보이는 지점

| 주제 | 현재 수렴 방향 |
| -- | -- |
| v2.0.0 의미 | 조직 기반 LLMOps Gateway MVP |
| v1.x 의미 | v2로 가는 release train |
| Runtime policy | static snapshot + thin live publish부터 검증 |
| Provider | 실제 Provider 1종 + 모델 2개 이상 + Mock fallback |
| Observability | 운영 evidence, request detail, dashboard aggregate, query profile 중심 |
| Safety | detector 확장보다 판단 가능성, corpus, shadow/evidence 중심 |
| Web Console | Demo와 Admin Dashboard 분리, 화면별 read model 필요 |
| 성능 | k6 scenario + DB query profile 먼저, 데이터 플랫폼은 측정 후 판단 |
| Semantic Cache | v2 core가 아니라 evidence track |
| raw prompt/response | v2.0.0 기본값은 저장/표시 금지 유지 |

## 3. 이규정 역할의 v2.0.0 main path

| Main path | 설명 |
| -- | -- |
| Organization Dashboard aggregate | 조직/Application/budget scope 기준 traffic, cost, safety, cache, routing, provider outcome 집계 |
| Request Log / Detail v2 read model | RuntimeSnapshot provenance, safety/cache/routing/budget/provider/streaming outcome을 원문 없이 설명 |
| Runtime publish evidence | publish 성공/실패, invalid publish 차단, last known safe 유지 여부를 sanitized evidence로 연결 |
| k6 scenario baseline 강화 | safe/cache/redaction/block/rate limit/provider error/failover/streaming 후보를 시나리오별로 분리 측정 |
| Dashboard query profile | 화면별 aggregate grain, freshness expectation, query budget을 함께 측정 |
| Demo evidence pack | 발표에서 cache saving, provider bypass, failover, policy outcome, p95/p99, query profile을 보여줄 근거 |

## 4. v1.x에서 먼저 처리할 것

1. k6 baseline을 시나리오별로 분리합니다.
2. Dashboard/Request Log/Detail 주요 query profile을 수집합니다.
3. RuntimeSnapshot provenance를 request detail과 연결하는 thin slice를 검증합니다.
4. 실제 Provider 1종과 Mock fallback의 관측 evidence를 만듭니다.
5. publish/reload 실패 시 last known safe 유지 여부를 설명할 sanitized evidence를 준비합니다.
6. raw prompt/response 없이도 demo와 debugging이 가능한 redacted evidence 구조를 확인합니다.

## 5. v2.0.0까지 남길 것

- 조직/팀/사용자/Application 또는 budget scope 기준 집계 모델
- RuntimeSnapshot lifecycle과 request provenance 연결
- failover outcome과 provider error/timeout의 dashboard/detail 표현
- streaming final state와 lifecycle evidence의 최소 범위
- Semantic Cache evidence panel 또는 lab report
- PostgreSQL partition/TimescaleDB/outbox/ClickHouse 검토 기준
- 화면별 freshness expectation과 query budget 기준

## 6. 팀 결정이 필요한 항목

| 결정할 것 | 이규정 추천 |
| -- | -- |
| scope 모델 | `tenant/project/application`은 유지하고 `budgetScopeType/budgetScopeId` 후보로 팀/예산 관제 표현 |
| RuntimeSnapshot provenance | request detail과 dashboard aggregate가 snapshot/version/hash 계열 provenance를 소비할 수 있게 함 |
| request outcome taxonomy | terminal status는 유지하고 cache/safety/routing/budget/provider/streaming outcome은 domain별로 분리 |
| Dashboard aggregate grain | 모든 dimension 조합을 열지 말고 Overview/Cost/Safety/Cache/Routing 우선 grain 제한 |
| 성능 개선 경로 | PostgreSQL + k6 + query profile 먼저, 측정 후 partition/TimescaleDB/outbox/ClickHouse 검토 |
| raw prompt/response | v2.0.0 main path에서는 기본 금지 유지 |
| Semantic Cache | Exact Cache와 같은 hit rate에 섞지 말고 evidence/candidate로 분리 |
| publish/reload failure | invalid publish 차단과 last known safe 유지 여부를 관측 가능하게 함 |
| Dashboard freshness | 화면별 polling/manual refresh 기준과 query budget을 함께 결정 |

## 7. 발표에서 보여줄 evidence

| Evidence | 보여주는 메시지 |
| -- | -- |
| Organization Dashboard | 회사 전체 LLM traffic이 GateLM으로 모인다 |
| Scope cost drilldown | 어떤 Application 또는 budget scope가 비용을 만드는지 보인다 |
| RuntimeSnapshot-linked Request Detail | 정책 변경이 실제 요청 결과와 연결된다 |
| Safety aggregate + corpus report | block/redaction 숫자를 신뢰할 수 있는 근거가 있다 |
| Exact Cache saving | provider call을 줄여 비용과 latency를 절감했다 |
| Provider fallback outcome | provider 장애가 발생해도 복구 경로와 evidence가 있다 |
| k6 scenario report | 성능 주장을 시나리오별 p95/p99로 뒷받침한다 |
| Query profile before/after | 데이터 플랫폼 선택을 측정 기반으로 설명한다 |

## 8. 명시적으로 하지 않을 것

- raw prompt 저장을 v2.0.0 기본 기능으로 넣지 않습니다.
- raw response 저장을 v2.0.0 기본 기능으로 넣지 않습니다.
- Semantic Cache를 검증된 Exact Cache와 같은 main cache hit로 집계하지 않습니다.
- ClickHouse, Redpanda, Envoy 같은 기술을 병목 측정 전 v2 필수로 확정하지 않습니다.
- RemoteSafetyEngine shadow result를 Gateway enforced decision처럼 표시하지 않습니다.
- dashboard metric label이나 log field 이름을 team-debate 문서에서 확정하지 않습니다.

## 9. 한 줄 결론

v2.0.0의 Observability는 "많이 저장했다"가 아니라 "안전하게 관찰했고, 반복 측정했고, 운영자가 설명할 수 있는 evidence를 남겼다"로 평가되어야 합니다.

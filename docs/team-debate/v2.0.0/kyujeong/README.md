# GateLM v2.0.0 방향 의견 - 이규정

> Observability, Data Platform & Performance 관점의 토론 메모다.
> 공식 계약이 아니라 `docs/team-debate/v2.0.0/jiseob/jiseob-v2-direction-proposal.md`에 대한 의견이며, 합의된 내용만 이후 v2 공식 문서로 승격해야 한다.
> 이 문서는 API, DB, Event, Metrics, security-sensitive field를 확정하지 않는다.

## 2026-06-29 1차 의견

### 요약

지섭님이 제안한 v2.0.0 방향인 "조직 기반 LLMOps Gateway MVP"에 동의한다.
관측성/데이터/성능 관점에서 v2의 핵심은 더 많은 차트를 만드는 것이 아니라, 여러 직원/팀/Application 요청이 Gateway를 지나며 생기는 정책 결정, 비용, 보안 이벤트, cache 절감, routing 결과를 운영자가 신뢰할 수 있는 증거로 설명하는 것이다.

다만 v2에서 성능 개선을 기술 이름 중심으로 밀어붙이면 위험하다.
PostgreSQL partition, TimescaleDB, outbox, Redpanda, ClickHouse 같은 선택지는 병목 측정 뒤에 단계적으로 검토해야 한다.
v2.0.0 main path는 조직 기반 read model, request traceability, query profile, k6 scenario 분리를 먼저 고정하는 쪽이 안전하다.

## 지섭 제안에 대한 의견

### 동의하는 부분

| 항목 | 의견 |
| -- | -- |
| v2.0.0을 조직 기반 LLMOps Gateway MVP로 보는 점 | 동의한다. v1은 단일 demo flow의 baseline이고, v2는 조직 단위 운영 맥락이 보여야 한다. |
| v1.x를 v2로 가는 release train으로 보는 점 | 동의한다. 관측성도 v1.x에서 측정 기준을 쌓아야 v2에서 설득력이 생긴다. |
| Redpanda/ClickHouse/Envoy를 v2 필수로 두지 않는 점 | 강하게 동의한다. 측정 없는 기술 도입은 발표에서는 커 보이지만 구현 신뢰도를 낮춘다. |
| `teamId`를 core identity로 성급히 넣지 않는 점 | 동의한다. 기존 tenant/project/application identity를 흔들지 않고 budget scope/read model로 표현하는 편이 안전하다. |
| 청중 참여형 데모를 preset 중심으로 시작하는 점 | 동의한다. 자유 입력은 safety, cost, latency, 발표 안정성 리스크가 크다. |

### 보완하고 싶은 부분

#### 1. v2 Observability는 새 화면이 아니라 설명 가능한 운영 증거여야 한다

v1에 이미 Request Log, Detail, Dashboard, Metrics, k6 baseline이 있다.
따라서 v2에서 "관측성 추가"라고 말하면 v1과 겹친다.

v2에서 관측성이 해야 할 일은 아래처럼 바뀌어야 한다.

```text
v1: requestId로 한 요청을 추적한다
v2: 조직/팀/Application/정책 버전 단위로 왜 그런 운영 결과가 났는지 설명한다
```

예를 들어 Dashboard는 단순히 total request를 보여주는 것이 아니라 아래 질문에 답해야 한다.

| 질문 | 필요한 evidence |
| -- | -- |
| 어떤 budget scope가 비용을 만들었나? | scope별 token/cost/cache saving aggregate |
| 어떤 RuntimeSnapshot이 block/cache/routing 결과를 만들었나? | request detail과 runtime snapshot metadata 연결 |
| provider 장애가 사용자 경험에 어떤 영향을 줬나? | provider error, failover attempt/result, fallback latency |
| cache가 비용과 latency를 얼마나 줄였나? | exact/semantic 후보별 hit, saved cost, provider bypass count |
| 청중 참여 traffic에서 병목은 어디인가? | k6 scenario별 p50/p95/p99, DB query profile, log write duration |

#### 2. RuntimeSnapshot과 Request Log 연결이 v2의 관측성 중심이어야 한다

v2에서 정책이 운영자가 제어하는 대상이라면, 모든 주요 결과는 RuntimeSnapshot과 연결되어야 한다.
단, 지금 이 문서에서 필드를 확정하지는 않는다.

관측성 관점에서 필요한 최소 개념은 아래다.

| 개념 | 이유 |
| -- | -- |
| runtime snapshot provenance | 정책 변경 전후 요청 결과 비교 |
| safety/routing/cache/budget policy provenance | allow/mask/block/route/cache/budget 결과 설명 |
| request terminal outcome | success, blocked, rate limited, failover success/error 등 운영 상태 구분 |
| scope aggregate | tenant/project/application/budget scope 기준 dashboard 집계 |
| measurement timestamp 기준 | streaming/async log가 들어와도 집계 일관성 유지 |

#### 3. 성능 개선은 k6 + query profile + 운영 병목 지도부터 시작해야 한다

v2 성능 트랙은 "대규모 트래픽 처리"라는 말보다 먼저 아래 순서를 가져야 한다.

```text
1. v1 k6 baseline을 scenario별로 분리한다
2. Dashboard/Log query profile을 측정한다
3. 현재 PostgreSQL index/aggregation 병목을 정리한다
4. 개선 전후 p95/p99와 query duration을 비교한다
5. 그래도 병목이면 partition/TimescaleDB/outbox를 검토한다
6. Redpanda/ClickHouse는 측정된 한계 이후 후보로 둔다
```

즉 v2.0.0의 성능 메시지는 "고급 데이터 플랫폼을 붙였다"가 아니라 "병목을 측정했고, 현재 단계에서 가장 작은 변경으로 개선했다"여야 한다.

#### 4. Semantic Cache는 v2 core가 아니라 evidence track이 맞다

Semantic Cache는 매력적이지만 v2 main path에 바로 넣기에는 위험이 있다.
이유는 세 가지다.

- similarity threshold에 따라 false hit가 생길 수 있다.
- raw prompt 저장 금지 원칙과 충돌하지 않도록 cache key/material 설계가 필요하다.
- semantic cache hit를 비용 절감으로 계산하려면 품질/안전 근거가 필요하다.

따라서 v2에서는 `Semantic Cache Evidence`로 두고, 발표에서는 아래 정도가 안전하다.

```text
exact cache는 v1 main path
semantic cache는 v2 evidence track
semantic cache는 candidate, similarity, policy gate, bypass reason을 설명하는 실험 결과로 제시
```

#### 5. 대규모 트래픽은 v2.0.0 완성 기능보다 v2.x scale track으로 보는 편이 좋다

대규모 트래픽은 단일 기능이 아니라 architecture track이다.
Redis rate limit, async log, outbox, ClickHouse, queue, backpressure, multi-instance gateway가 한꺼번에 얽힌다.

v2.0.0에서는 아래 정도를 목표로 잡고, v2.x에서 scale track을 확장하는 편이 좋다.

```text
v2.0.0: traffic simulator + k6 scenario + query profile + 병목 개선 evidence
v2.x: partition/outbox/async worker/analytics store 검토
v3: production scale readiness
```

## 내 역할의 v2.0.0 main path 작업

| 작업 | 설명 | 의존 |
| -- | -- | -- |
| Organization Dashboard aggregate | 조직/프로젝트/Application/budget scope 단위 사용량, 비용, policy outcome, cache saving 집계 | Gateway terminal log, RuntimeSnapshot metadata |
| Request Log / Detail v2 read model | RuntimeSnapshot, budget, failover, streaming terminal state를 설명 가능한 detail로 제공 | Gateway, Control Plane, Web |
| k6 scenario baseline 강화 | safe/cache/redaction/block/rate limit/provider error/failover/streaming 후보를 분리 측정 | Gateway stable endpoints |
| Dashboard query profile | 주요 dashboard/log/detail query의 latency와 index 영향 측정 | PostgreSQL schema, seed/fixture |
| Metrics contract 후보 정리 | v2에서 추가될 수 있는 metric family/label 후보와 금지 label 정리 | Gateway, Web |
| Demo evidence pack | 발표용 수치: cache saved cost, provider bypass, p95, policy outcomes, failover outcome | 전체 팀 |

## 다른 역할이 늦어도 병렬로 할 수 있는 shadow/evidence 작업

| 작업 | 병렬 가능한 이유 | 산출물 |
| -- | -- | -- |
| fixture 기반 v2 aggregate 설계 | live Gateway 완성 전에도 read model 후보를 만들 수 있다 | dashboard fixture/read model draft |
| k6 script scenario 분리 | Gateway endpoint shape가 크게 변하지 않는 범위에서 선행 가능 | scenario별 baseline script |
| PostgreSQL query profile 실험 | 현재 v1 log schema와 synthetic data로 먼저 측정 가능 | query profile report |
| partition/TimescaleDB 검토 | 실제 도입 전 문서/소규모 실험으로 비교 가능 | decision memo |
| semantic cache observability 모델 | semantic cache 구현 없이도 필요한 evidence field 후보를 정리 가능 | cache evidence note |
| traffic simulator 관측 기준 | Web simulator가 늦어도 로그/metrics에서 필요한 결과 정의 가능 | simulator evidence checklist |

## 내가 소비해야 하는 계약

| 계약 | 생산 역할 | 내가 필요한 이유 |
| -- | -- | -- |
| Gateway terminal outcome contract | Gateway | 로그/대시보드 집계의 원천 |
| RuntimeSnapshot publish/provenance contract | Control Plane | 정책 버전과 요청 결과 연결 |
| Provider/failover outcome contract | Gateway | failover success/error와 latency 집계 |
| Streaming lifecycle/terminal state contract | Gateway/Web | streaming 요청의 완료/중단/timeout 집계 |
| Scope model contract | Control Plane/Gateway | tenant/project/application/budget scope별 aggregate |
| Web Console read model 요구 | Web | dashboard/detail API shape와 UX 우선순위 조율 |
| Safety decision contract | Safety/Gateway | safety outcome count와 false positive/negative evidence 연결 |

## 내가 생산해야 하는 계약

| 계약 | 소비 역할 | 설명 |
| -- | -- | -- |
| v2 Invocation Log read model 후보 | Web, Gateway | request list/detail에 필요한 운영 필드 후보 |
| Dashboard aggregate 후보 | Web, 발표자 | organization/scope/status/cache/routing/cost aggregate 후보 |
| Metrics label policy 후보 | Gateway, 전체 팀 | 허용/금지 label, high cardinality 방지 |
| k6 scenario definition | Gateway, Web, 전체 팀 | 성능 baseline 시나리오와 성공 기준 |
| Query profile report | Control Plane, Gateway, Web | DB 병목과 개선 우선순위 근거 |
| Data platform decision memo | 전체 팀 | PostgreSQL/TimescaleDB/outbox/ClickHouse 도입 판단 기준 |

## v1.x에서 먼저 처리할 것

| 항목 | 이유 |
| -- | -- |
| k6 scenario 분리 | v2 성능 개선의 기준선이 필요하다. |
| Dashboard/Log query profile | 병목 측정 없이 DB 고도화를 말하면 위험하다. |
| RuntimeSnapshot metadata 최소 연결 | v2 정책 운영 메시지의 핵심이다. |
| 실제 Provider 1종 + Mock fallback 관측 | provider error/fallback evidence를 만들기 위해 필요하다. |
| request log/detail v1 contract cleanup | v2 read model 확장 전에 v1 필드 의미를 안정화해야 한다. |
| fixture/live parity | 발표 안정성과 회귀 검증을 동시에 확보한다. |

## v2.0.0까지 남길 것

| 항목 | 이유 |
| -- | -- |
| 조직/범위별 dashboard aggregate | v2 제품 메시지의 중심이다. |
| Budget scope 기반 비용/사용량 관제 | 조직 기반 LLMOps를 설명하는 핵심이다. |
| Failover outcome 관측 | v1은 provider error를 기록, v2는 복구 결과를 설명해야 한다. |
| Streaming 결과 관측 | streaming thin slice 이후 terminal/lifecycle 상태를 정리해야 한다. |
| Semantic Cache evidence | core 기능이 아니라 실험/근거 트랙으로 제시한다. |
| Scale track decision memo | v2.0.0 이후 데이터 플랫폼 고도화 판단 근거로 남긴다. |

## 데모나 발표에서 보여줄 evidence

| Evidence | 보여주는 메시지 |
| -- | -- |
| Organization Dashboard | 회사 전체 LLM traffic이 GateLM으로 모인다. |
| Scope cost drilldown | 어떤 팀/Application이 비용을 만드는지 보인다. |
| RuntimeSnapshot-linked Request Detail | 정책 변경이 실제 요청 결과와 연결된다. |
| Cache saving panel | provider call을 줄여 비용과 latency를 절감했다. |
| Failover outcome panel | provider 장애가 발생해도 Gateway가 복구 경로를 가진다. |
| k6 scenario report | 성능 주장을 숫자로 뒷받침한다. |
| Query profile before/after | 데이터 플랫폼 선택을 측정 기반으로 설명한다. |

## 다른 역할 의견에 대한 2026-06-29 초기 반응

### 김규민 의견에 대한 반응

규민님이 제안한 Web Console IA 분리는 관측성 관점에서도 필요하다.
특히 `Dashboard / Management / Analytics / Demo / Settings`를 나누면 운영 aggregate와 demo traffic generator가 섞이지 않는다.

동의하는 보완점은 아래다.

- Web Console은 canonical cost나 policy outcome을 계산하지 않아야 한다.
- RuntimeSnapshot version/hash/published metadata는 request detail과 연결되어야 한다.
- team은 UI에 보일 수 있지만 Gateway core identity로 고정된다고 가정하면 안 된다.
- streaming은 UI 상태와 log terminal state를 같이 설계해야 한다.
- 청중 참여형 demo는 preset 중심으로 시작해야 한다.

관측성 쪽 추가 의견은 하나다.
Web Console IA가 결정되면, 각 화면에서 필요한 aggregate grain과 drilldown key를 별도 표로 확정해야 한다.
이 결정이 늦어지면 Observability가 너무 넓은 read model을 만들게 되고, query profile도 초점이 흐려진다.

## 현재 결론

지섭님 방향은 타당하고, v2.0.0은 조직 기반 LLMOps Gateway MVP로 잡는 것이 좋다.
이규정 역할의 핵심은 더 많은 저장소와 차트를 붙이는 것이 아니라, 정책/비용/보안/cache/routing/failover 결과를 측정 가능한 운영 evidence로 연결하는 것이다.

성능 고도화는 PostgreSQL 기반 query profile과 k6 scenario baseline을 먼저 강화하고, 측정된 병목을 근거로 partition, TimescaleDB, outbox, ClickHouse 같은 선택지를 순서대로 검토해야 한다.

## 2026-06-29 1차 pull 반영 - 규민님 have-to-decision에 대한 추가 의견

규민님 `have-to-decision.md`에서 새로 분리된 결정 항목들에 대체로 동의한다.
관측성 관점에서 특히 중요한 보완점은 아래 세 가지다.

### 1. 직원 Chat UI도 Application boundary를 유지해야 집계가 안전하다

직원 Chat UI가 v2 demo의 중심이 되더라도 Observability는 별도 identity 체계를 새로 발명하지 않는 편이 안전하다.
Internal Chat Application 같은 형태로 Application boundary를 유지하면, 기존 request log, runtime policy, budget aggregate, k6 scenario가 같은 축으로 이어진다.

다만 UI 표시명과 canonical field는 분리해야 한다.
`applicationType=internal_chat` 같은 표현은 Web read model 후보로 둘 수 있지만, 공식 필드명은 Gateway/Control Plane 계약 전까지 확정하지 않는 편이 좋다.

### 2. Dashboard polling은 v2.0.0 main path로 충분하다

Realtime dashboard는 발표 체감이 좋지만, v2.0.0에서 SSE/WebSocket까지 필수로 잡으면 Observability와 Web의 범위가 커진다.
지금 단계에서는 짧은 interval polling을 기준으로 두고, polling interval이 DB query와 Gateway traffic에 주는 영향을 k6/query profile로 같이 측정하는 것이 좋다.

안전한 기본값은 아래다.

```text
manual refresh 지원
-> demo mode에서 polling on
-> query profile로 interval 조정
-> SSE/WebSocket은 v2.x 후보
```

### 3. Web Console IA가 정해지면 aggregate grain도 같이 잠가야 한다

`Dashboard / Management / Analytics / Demo / Settings` 분리에는 동의한다.
다만 Observability가 실질적으로 구현하려면 각 화면이 요구하는 aggregate grain을 같이 정해야 한다.

예를 들어 Dashboard Overview는 조직 수준, Cost 화면은 budget scope 수준, Analytics는 request/detail drilldown 수준처럼 grain을 제한해야 한다.
모든 dimension 조합을 API로 열면 v2.0.0에서 query와 index 설계가 과도해질 수 있다.

따라서 Web Console IA 결정과 함께 `screen -> aggregate grain -> required filters -> freshness expectation` 표를 만드는 것을 제안한다.

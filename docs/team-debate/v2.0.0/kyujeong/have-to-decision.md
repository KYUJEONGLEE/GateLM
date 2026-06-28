# Have-To Decisions - 이규정

> 공식 계약이 아니라 팀 결정이 필요한 항목을 모으는 토론 메모입니다.
> Codex가 임의로 결정하면 위험한 항목만 적습니다.
> 합의된 내용은 나중에 공식 `docs/v2.0.0/*` 문서로 옮깁니다.

## 빠른 결정 요약

| No | 결정할 것 | 추천안 | 영향 범위 | 우선순위 | 상태 |
| -- | -- | -- | -- | -- | -- |
| 1 | v2 scope aggregate 기준 | `tenant/project/application`은 유지하고 `budgetScopeType/budgetScopeId`를 별도 관제 축으로 둔다 | Gateway, Control Plane, Web, Observability | P0 | 추천안 있음 |
| 2 | RuntimeSnapshot provenance 최소 단위 | request detail과 dashboard aggregate가 snapshot/version/hash 계열 provenance를 소비할 수 있게 한다 | Control Plane, Gateway, Web, Observability | P0 | 추천안 있음 |
| 3 | v2 request outcome taxonomy | v1 status를 유지하되 failover/streaming/budget 결과를 어떤 방식으로 표현할지 별도 합의한다 | Gateway, Web, Observability | P0 | 미결정 |
| 4 | Dashboard aggregate grain | organization overview, scope drilldown, model/provider, policy outcome, cache saving grain을 먼저 합의한다 | Web, Observability, Gateway | P0 | 미결정 |
| 5 | 성능 개선 경로 | k6 scenario + query profile 후 PostgreSQL partition/TimescaleDB/outbox를 검토한다 | Observability, Gateway, Control Plane | P1 | 추천안 있음 |
| 6 | raw prompt/response 저장 opt-in | 기본 금지, v2.0.0 main path에서는 원문 저장 없이 evidence를 만든다 | 전체 역할, Security | P0 | 추천안 있음 |
| 7 | Semantic Cache evidence 범위 | v2 core가 아니라 evidence track으로 두고 similarity/cache decision 관측 기준만 먼저 정한다 | Gateway, Safety, Observability, Web | P1 | 추천안 있음 |

## 1. v2 scope aggregate 기준

### 왜 결정해야 하나?

조직 기반 LLMOps MVP를 보여주려면 비용, 보안 이벤트, cache saving, routing 결과를 어떤 scope로 집계할지 정해야 한다.
이 기준이 없으면 Dashboard, Request Log, k6 결과가 서로 다른 축으로 말하게 된다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | 기존 `tenant/project/application`만 유지 | v1 계약과 안정적으로 이어진다 | 팀/부서 단위 비용 관제가 약하다 |
| B | `teamId`를 core identity에 추가 | 조직 기반 메시지가 직관적이다 | GatewayContext, DB, log, API 전체 영향이 크다 |
| C | core identity는 유지하고 `budgetScopeType/budgetScopeId`를 관제 축으로 둔다 | 팀/부서 비용 관제를 표현하면서 core identity 변경을 줄인다 | scope read model 계약이 필요하다 |

### 추천안

C안을 추천한다.
`tenant/project/application`은 canonical identity로 유지하고, 비용/관제는 `budgetScopeType/budgetScopeId` 개념으로 분리한다.

### 결정 전까지 안전한 기본값

v1 identity를 유지하고, fixture/read model에서는 scope 후보를 nullable 또는 presentation-only로 둔다.

### 영향을 받는 역할

Gateway, Control Plane, Web, Observability.

## 2. RuntimeSnapshot provenance 최소 단위

### 왜 결정해야 하나?

v2의 핵심 메시지가 정책 운영이라면, 요청 결과가 어떤 정책 버전에서 나왔는지 설명해야 한다.
RuntimeSnapshot provenance가 없으면 정책 변경 전후 비교와 audit UX가 약해진다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v1의 configHash/securityPolicyHash/routingPolicyHash만 유지 | 변경 폭이 작다 | v2에서 운영자가 이해하기 어렵다 |
| B | RuntimeSnapshot ID/version/published metadata를 추가 | 정책 변경과 request detail 연결이 좋아진다 | 계약 합의가 필요하다 |
| C | full config diff까지 log/detail에 저장 | 설명력은 높다 | raw/sensitive config 노출과 저장량 리스크가 크다 |

### 추천안

B안을 추천한다.
단, full config를 request log에 저장하지 않고 snapshot provenance만 연결한다.

### 결정 전까지 안전한 기본값

v1 hash 필드를 유지하고, UI/fixture에서는 snapshot metadata를 후보로만 표기한다.

### 영향을 받는 역할

Control Plane, Gateway, Web, Observability.

## 3. v2 request outcome taxonomy

### 왜 결정해야 하나?

v2는 failover, streaming, budget guard, semantic cache evidence가 들어올 수 있다.
이 결과를 기존 status/errorCode/cacheStatus만으로 표현할지, 별도 outcome group을 둘지 결정해야 한다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v1 status만 확장 | 단순하다 | status가 너무 많은 의미를 떠안는다 |
| B | terminal status는 유지하고 domain별 outcome group을 둔다 | 집계와 detail 설명이 명확하다 | read model이 늘어난다 |
| C | event stream 중심으로 모두 재설계 | 장기 확장성은 좋다 | v2.0.0에는 과하다 |

### 추천안

B안을 추천한다.
terminal status는 안정적으로 유지하고, failover/streaming/budget/cache evidence는 별도 group으로 둔다.

### 결정 전까지 안전한 기본값

v1 status를 유지하고 새로운 의미는 metadata 후보로만 문서화한다.

### 영향을 받는 역할

Gateway, Web, Observability, Safety.

## 4. Dashboard aggregate grain

### 왜 결정해야 하나?

Web Console이 보여줄 화면 구조와 Observability가 제공할 aggregate가 맞아야 한다.
화면별 grain을 정하지 않으면 불필요한 query/read model이 늘어난다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v1 overview만 확장 | 빠르다 | 조직 기반 메시지가 약하다 |
| B | Overview + scope drilldown + provider/model + policy outcome grain을 둔다 | v2 메시지와 맞다 | query profile과 index 전략 필요 |
| C | 모든 dimension 조합을 지원 | 유연하다 | 구현/성능 리스크가 크다 |

### 추천안

B안을 추천한다.
모든 조합을 열지 말고 데모와 운영 메시지에 필요한 grain부터 제한한다.

### 결정 전까지 안전한 기본값

v1 overview를 유지하고, scope drilldown은 fixture/evidence로 먼저 실험한다.

### 영향을 받는 역할

Web, Observability, Gateway, Control Plane.

## 5. 성능 개선 경로

### 왜 결정해야 하나?

v2에서 대규모 트래픽을 말하려면 어떤 병목을 어떤 순서로 개선할지 합의해야 한다.
기술 이름을 먼저 정하면 구현 범위가 불필요하게 커진다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | PostgreSQL 기반으로 query/index/profile 먼저 개선 | 가장 작고 측정 가능하다 | 초대규모 메시지는 약하다 |
| B | TimescaleDB/partition을 v2에서 검토 | time-series log에 자연스럽다 | 운영/마이그레이션 검토가 필요하다 |
| C | Redpanda/ClickHouse를 v2 필수로 도입 | 고급 아키텍처 메시지가 강하다 | 측정 전 도입이면 과설계 위험이 크다 |

### 추천안

A를 먼저 하고, 측정 결과에 따라 B를 검토한다.
C는 PostgreSQL 한계가 측정된 뒤 v2.x 후보로 둔다.

### 결정 전까지 안전한 기본값

현재 PostgreSQL 로그/집계를 기준으로 k6 scenario와 query profile을 강화한다.

### 영향을 받는 역할

Observability, Gateway, Control Plane, Web.

## 6. raw prompt/response 저장 opt-in

### 왜 결정해야 하나?

관측성과 평가를 강화하고 싶어도 raw prompt/response 저장은 보안, 개인정보, 접근제어, retention, encryption을 모두 건드린다.
암묵적으로 허용하면 v1의 신뢰 기준을 깨뜨릴 수 있다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v2.0.0에서도 기본 금지 | 안전하고 v1 원칙과 맞다 | 디버깅/평가 UX가 제한된다 |
| B | opt-in 저장 허용 | 제품 기능은 강해진다 | 보안 계약이 크게 필요하다 |
| C | redacted sample만 제한 저장 | 일부 분석 가능 | redaction 품질과 residual risk 관리 필요 |

### 추천안

A를 기본으로 하고, C는 evidence track에서만 검토한다.
B는 v2.0.0 main path에서 제외하는 편이 안전하다.

### 결정 전까지 안전한 기본값

raw prompt/response, credential, Authorization header, 실제 secret은 계속 저장/표시하지 않는다.

### 영향을 받는 역할

전체 역할, 특히 Gateway, Safety, Observability, Web.

## 7. Semantic Cache evidence 범위

### 왜 결정해야 하나?

Semantic Cache는 비용 절감 메시지가 강하지만 false hit, similarity threshold, 안전 정책, raw prompt 저장 금지와 연결된다.
main path로 넣기 전에 evidence 범위를 합의해야 한다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| A | v2.0.0 main path에 포함 | 기술적으로 눈에 띈다 | 품질/보안/성능 리스크가 크다 |
| B | v2 evidence track으로 분리 | 실험과 제품 범위를 구분한다 | 데모 임팩트는 낮아질 수 있다 |
| C | v2 이후로 완전히 보류 | v2 집중도가 높다 | cache 고도화 메시지가 약해진다 |

### 추천안

B안을 추천한다.
Semantic Cache는 `candidate`, `similarity`, `policy gate`, `used/bypassed reason`, `saved cost estimate` 정도의 관측 기준을 먼저 검토한다.

### 결정 전까지 안전한 기본값

v2 core는 exact cache policy와 cache saving evidence를 강화하고, semantic cache는 별도 실험 문서로 둔다.

### 영향을 받는 역할

Gateway, Safety, Observability, Web.
---

## Codex 추가 결정 후보 - 2026-06-29

> 아래 항목은 관측성 관점의 추가 결정 후보입니다. 이름과 필드는 공식 계약이 아니라 회의용 라벨입니다.

| No | 결정할 것 | 추천안 | 영향 범위 | 우선순위 | 상태 |
| -- | -- | -- | -- | -- | -- |
| O-1 | request detail에 원문을 저장하지 않고도 설명 가능한가 | raw 저장 없이 redacted preview/hash/aggregate 중심 | Gateway, Safety, Web, 발표 | P0 | 결정 필요 |
| O-2 | dashboard aggregate의 최소 slice | 조직, Application, 정책 버전, provider outcome 후보를 회의에서 확정 | Web, Gateway, DB | P0 | 결정 필요 |
| O-3 | 성능 개선의 증거 기준 | k6 p95/p99와 DB query profile을 v2 evidence로 사용 | Observability, Backend | P0 | 결정 필요 |
| O-4 | partition/TimescaleDB 검토 시점 | v2.0.0 필수 제외, 측정 후 병목이면 후속 후보 | DB, Infra, 발표 | P1 | 보류 |

### 결정 전까지 안전한 기본값

- 원문 저장 없이 request outcome, 비용/토큰, latency, 정책 provenance 후보, error/failover outcome만 관측한다.
- 새 데이터 플랫폼 도입 전에는 현재 PostgreSQL 기반 측정과 인덱스/쿼리 개선을 우선한다.
- 발표 evidence는 "무엇을 측정했고 무엇이 병목이었는지"를 설명하는 자료로 구성한다.

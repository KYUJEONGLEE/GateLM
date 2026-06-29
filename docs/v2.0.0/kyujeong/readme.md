# 이규정 v2.0.0 계약/의존성 정리

> Observability, Data Platform, Performance 관점의 계약 freeze 준비 초안입니다.
> 이 문서는 공식 계약이 아니며, API/DB/Event/Metrics/Schema 필드를 확정하지 않습니다.

## 1. 내 역할의 v2 main path

내 역할의 main path는 Gateway가 남긴 실행 결과를 원본 의미를 잃지 않고 저장, 조회, 집계, 성능 검증으로 연결하는 것입니다.

```text
Gateway request evidence
-> Request Log / Request Detail
-> terminal status + domain outcome 저장
-> Dashboard read model / metrics 집계
-> freshness / query budget 노출
-> k6 Gateway baseline + Dashboard query profile
```

핵심 원칙:

- Observability는 Gateway outcome을 직접 추론하지 않고 Gateway가 제공한 evidence를 소비합니다.
- terminal status는 사용자 관점의 최종 결과로 작게 유지하고, cache/provider/fallback/safety 같은 이유는 domain outcome 후보로 분리합니다.
- Dashboard는 무제한 ad-hoc analytics가 아니라 정해진 grain, freshness, query budget을 가진 운영 화면으로 둡니다.
- v2.0.0은 PostgreSQL 기반 query/index 최적화를 우선하고, ClickHouse/Event pipeline은 core가 아니라 v2.x 이후 후보로 둡니다.
- raw prompt, raw response, secret, Authorization header, Provider Key 평문은 log/detail/fixture/metrics label에 넣지 않습니다.

## 2. 내가 다른 역할에게 받아야 하는 계약

| 역할 | 받아야 하는 계약 |
| -- | -- |
| 지섭 / Gateway | terminal status 후보, domain outcome 후보, stage별 `not_called/not_checked/not_used` 의미, requestId/traceId mapping |
| 재혁님 / Control Plane | RuntimeSnapshot provenance 최소 세트, publish/reload/last known safe 상태 후보, active snapshot binding 기준 |
| 윤지 / Safety | safety outcome 후보, redacted preview/hash 허용 범위, detector summary grain, synthetic fixture 기준 |
| 규민 / Product Experience | Dashboard/Request Detail에서 보여야 하는 운영 화면 grain, demo preset traffic, Employee Chat 표시 수준 |
| 전체 | P0 legacy field cleanup inventory와 기존 log/detail/metric 필드의 유지/폐기 판단 |

## 3. 내가 다른 역할에게 제공해야 하는 계약

| 제공 계약 후보 | 소비 역할 |
| -- | -- |
| Request Log / Detail 최소 read model 후보 | Web, Gateway, Control Plane, Safety |
| Dashboard aggregate grain 후보 | Web, Gateway |
| freshness/query budget metadata 후보 | Web, Gateway |
| k6 baseline scenario와 성공/실패 해석 기준 | Gateway, Web, Control Plane |
| `/metrics` label 허용/금지 기준 | Gateway |
| PostgreSQL query/index/profile 기준 | Gateway, Web |
| legacy field cleanup 관측성 영향 판단 | 전체 |

중요한 제공 원칙:

- Metrics label에는 tenant/project/application/provider/model 같은 낮은 cardinality 후보만 검토하고, prompt/hash/error detail 같은 고위험 값은 넣지 않습니다.
- Request Detail에는 재현과 추적에 필요한 provenance만 남기고 full RuntimeSnapshot이나 policy body를 복사하지 않습니다.
- Dashboard read model은 exact cache, safety, fallback, budget scope를 분리해 보여주되 공식 field 확정 전에는 후보 이름으로만 둡니다.

## 4. 내가 막히는 dependency

- Gateway가 terminal status/domain outcome을 확정하지 않으면 log/detail/dashboard가 추론 기반이 됩니다.
- RuntimeSnapshot provenance 최소 세트가 없으면 요청이 어떤 정책으로 처리됐는지 설명할 수 없습니다.
- `budgetScopeType/budgetScopeId` resolve 규칙이 없으면 비용/쿼터/대시보드 귀속 grain이 흔들립니다.
- P0 legacy field cleanup inventory가 없으면 v1 로그 필드와 v2 후보 필드가 섞일 수 있습니다.
- Employee Chat 호출 방식이 없으면 employee/admin/developer surface별 노출 범위와 request ownership을 확정하기 어렵습니다.
- Actual Provider/Mock fallback outcome 계약이 없으면 성공/장애/대체 성공을 dashboard에서 분리하기 어렵습니다.
- Streaming thin slice lifecycle이 없으면 cancelled/failed/success 집계 기준이 흔들립니다.

## 5. 내가 늦어지면 막히는 다른 역할

- 규민: Dashboard Overview, Request Detail, Demo 화면에서 무엇을 어떤 grain으로 보여줄지 늦어집니다.
- 지섭: Gateway가 어떤 outcome/metrics를 남겨야 하는지 모호해져 smoke와 k6 기준이 늦어집니다.
- 재혁님: RuntimeSnapshot publish/reload evidence가 Request Detail에 어떻게 보이는지 연결하기 어렵습니다.
- 윤지: safety block/redaction 결과가 Dashboard와 evaluation evidence로 어떻게 집계되는지 늦어집니다.
- 전체: v2.0.0 contracts.md와 최소 JSON Schema/fixture에서 log/detail/metrics 후보를 freeze하기 어렵습니다.

## 6. 계약 확정 전에도 병렬로 할 수 있는 shadow/evidence 작업

- 현재 v1 Request Log/Detail/metrics 필드 inventory 작성
- P0 legacy field cleanup 후보 중 raw/high-cardinality/중복 provenance 위험 표시
- synthetic traffic 기반 dashboard query profile 초안 작성
- k6 scenario 후보를 v2 terminal/domain outcome 후보에 매핑
- PostgreSQL index/query shape 후보 측정
- freshness metadata sample과 stale 상태 fixture 후보 작성
- Exact Cache와 Semantic Cache evidence track이 섞이지 않는 dashboard 표현 초안 작성
- raw prompt 없이 redacted preview/hash만 있는 Request Detail fixture 후보 작성

## 7. P0로 먼저 확정해야 하는 항목

1. P0 legacy field cleanup inventory와 삭제/유지/rename 후보
2. terminal status와 domain outcome의 최소 구조
3. Request Log / Detail에 저장할 provenance 최소 세트
4. RuntimeSnapshot provenance 최소 세트와 full snapshot 복사 금지 원칙
5. `budgetScopeType/budgetScopeId`의 dashboard/cost/quota 귀속 기준
6. Dashboard aggregate grain과 기본 time range 제한
7. freshness/query budget metadata 후보
8. `/metrics` label 허용 목록과 raw/high-cardinality 금지 목록
9. k6 baseline scenario와 정책 결과 vs 시스템 실패 해석 기준
10. Streaming thin slice의 `cancelled/failed/success` 집계 기준

## 8. 아직 공식 API/DB/Event/Metrics/Schema 필드로 확정하면 안 되는 후보 용어

아래 용어는 계약 후보이며, `docs/v2.0.0/contracts.md` 확정 전에는 API/DB/Event/Metrics/JSON Schema 필드로 고정하지 않습니다.

```text
terminalStatus
domainOutcome
runtimeSnapshotId
runtimeSnapshotVersion
runtimeState
gatewayInstanceId
budgetScopeType
budgetScopeId
lastIngestedAt
lastAggregatedAt
source
isStale
queryBudget
aggregateGrain
providerOutcome
fallbackOutcome
cacheOutcome
safetyOutcome
savedCostMicroUsd
gatewayInternalLatencyMs
providerLatencyMs
dashboardQueryDurationMs
```

주의 후보:

- `cache_hit`을 terminal status로 유지할지 여부는 공식 계약 전까지 확정하지 않습니다.
- `teamId`를 비용/쿼터 귀속 필드로 직접 쓰지 않고, 조직 엔티티 후보로만 둡니다.
- `department`는 v2.0.0 공식 budget scope로 고정하지 않습니다.
- Semantic Cache 관련 `wouldHaveHit`, `candidateSimilarity`, `evaluationPassRate`는 evidence track 후보이며 실제 cache hit/cost metric으로 섞지 않습니다.

## 9. 첫 구현 PR로 쪼갤 수 있는 단위

1. P0 legacy log/detail/metrics field inventory와 cleanup 판단표
2. terminal status/domain outcome fixture 초안
3. Request Log / Detail 최소 read model fixture 초안
4. RuntimeSnapshot provenance가 포함된 Request Detail fixture 초안
5. Dashboard Overview/Cost/Safety/Cache/Provider grain 후보 문서화
6. freshness/query budget metadata fixture 초안
7. k6 v2 baseline scenario 초안과 정책 결과/시스템 실패 해석표
8. PostgreSQL query profile과 index 후보 측정 PR
9. Semantic Cache evidence metric을 core cache metric과 분리하는 문서/fixture

## 추가 검토 필요

- Dashboard API/read model을 기존 endpoint 확장으로 갈지, v2 전용 read model 후보로 분리할지
- Request Detail에 `policyVersion`, `contentHash`, `securityPolicyHash`, `routingPolicyHash` 중 무엇을 최소 provenance로 남길지
- auth 실패를 terminal status `blocked` 계열로 볼지, 별도 status 없이 httpStatus/errorCode와 auth outcome으로 설명할지
- Employee Chat browser direct vs Web BFF/server-side 선택에 따른 request ownership과 metrics grain
- Dashboard polling 기본값과 stale 기준

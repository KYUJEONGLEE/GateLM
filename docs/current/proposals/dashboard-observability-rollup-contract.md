# Dashboard Observability Rollup Contract Proposal

| Field | Value |
|---|---|
| Status | Implemented in feature branch behind rollout controls |
| Applies to | Project/Application and Tenant Chat Dashboard rollup writer, Policy Impact reader, Request Log TTFT |
| Does not apply to | Billing ledger or quota enforcement period semantics |
| Last reviewed | 2026-07-21 |

## 1. Goal

Dashboard 조회 비용과 재집계 트랜잭션 크기가 raw invocation row 수에 비례해 계속 증가하지 않도록 PostgreSQL에 replacement `minute` 집계와 mergeable `hour`, `day`, `month` 집계를 둔다. 동시에 streaming 응답 시작 속도인 TTFT와 전체 응답 시간을 서로 다른 지표로 제공한다.

이 변경은 raw Request Log를 없애지 않는다. Request Log 목록과 상세는 계속 raw log를 사용하고, Dashboard의 긴 기간 집계만 rollup과 짧은 raw tail을 조합한다.

## 2. Evidence Boundary

`openai_100u_1rps_closed_30s_20260713T180515Z.md`와 `openai_100u_2rps_30s_20260713T174906Z.md`는 각각 3,000건과 6,000건의 terminal log가 짧은 부하에서 모두 기록되었음을 보여준다. 두 실험은 `streaming=false`, `maxTokens=1`, 30초 실행이므로 다음을 증명하지 않는다.

- streaming TTFT 정확성
- 하루 또는 한 달 raw log 누적 후 Dashboard 조회 비용
- rollup 재처리와 late correction 정확성
- 장시간 지속 처리량

따라서 이 보고서의 요청 수를 일·월 데이터량으로 단순 환산한 값은 용량 계획 입력일 뿐, 지속 부하 검증 결과로 사용하지 않는다.

2026-07-20 운영 `300 RPS × 10분` 시험은 180,001개 요청 로그가 성공해도 hour Rollup과 Dashboard raw fallback이 공유 PostgreSQL을 포화시킬 수 있음을 보여줬다. 2026-07-21 격리 로컬 DB의 180,000건 A/B는 minute replacement와 bounded raw tail의 구현 효과를 비교한 evidence다. 로컬 결과를 운영 EC2의 end-to-end 용량으로 확대 해석하지 않는다.

## 3. Time And Surface Contract

- 모든 Dashboard 집계 구간은 UTC half-open interval `[from, to)`를 사용한다.
- Project/Application invocation의 집계 시각은 Gateway가 요청을 수신한 `created_at`이다.
- Tenant Chat invocation의 집계 시각은 현재 active 계약의 `completed_at`이다.
- `minute`, `hour`, `day`, `month` bucket은 UTC 경계로 정렬한다.
- tenant-local billing 또는 quota 월 경계는 이 Dashboard 집계와 별도이며 변경하지 않는다.
- `surface`는 `project_application` 또는 `tenant_chat`이다.
- `all`은 additive count, token, micro-USD만 합친다. 서로 다른 측정 계약의 percentile은 합치지 않는다.

## 4. TTFT Contract

`ttft_ms`는 Gateway handler가 요청을 받은 시점부터 첫 non-empty `choices[].delta.content`를 client writer에 쓰고 flush한 직후까지의 시간이다.

- streaming 요청만 측정 대상이다.
- role-only, usage-only, empty content chunk는 첫 token으로 보지 않는다.
- non-streaming 요청과 첫 content 전에 종료된 streaming 요청은 `null`이다.
- 미관측 값을 `0`으로 저장하거나 응답하지 않는다.
- synthetic cache streaming과 live Provider streaming은 같은 의미를 사용한다.
- 기존 `gatelm_stream_time_to_first_token_seconds` histogram도 같은 시작·종료 의미를 사용한다.
- TTFT는 raw prompt, response, credential 또는 Provider raw error를 포함하지 않는다.

Dashboard는 Project/Application TTFT를 다음과 같이 additive optional field로 제공한다.

```json
{
  "performance": {
    "gatewayTtft": {
      "scope": "project_application",
      "averageMs": 125.4,
      "p50Ms": 100,
      "p95Ms": 500,
      "p99Ms": 1000,
      "eligibleStreamRequests": 40,
      "observedRequests": 38,
      "coverageRate": 0.95
    }
  }
}
```

Tenant Chat에는 현재 TTFT source 계약이 없으므로 `tenant_chat` surface에는 이 값을 만들지 않는다. `all` surface에서는 Project/Application 값과 `scope`를 그대로 보존하며 Tenant Chat latency를 TTFT로 재사용하지 않는다.

## 5. Mergeable Rollup Contract

논리 테이블은 다음 역할로 분리한다.

- `dashboard_rollup_totals`: tenant, surface, scope, grain, bucket별 additive totals와 latency 합계·표본 수·histogram
- `dashboard_rollup_dimensions`: status, cache, safety, fallback, budget, route, provider/model처럼 bounded breakdown
- `dashboard_rollup_dirty_buckets`: 다시 계산해야 할 tenant/surface/grain/bucket queue
- `dashboard_rollup_bucket_states`: 빈 bucket을 포함한 ready/failed 상태와 source/aggregation freshness
- `dashboard_rollup_source_cursors`: append/update source scan cursor

`minute`은 원본을 읽는 최소 replacement 단위다. `hour`는 최대 60개의 ready minute 결과를, `day`는 ready hour 결과를, `month`는 ready day 결과를 병합한다. 활성 minute mode에서 상위 bucket은 원본 invocation table을 다시 읽지 않는다.

성공률, cache hit rate, TTFT coverage는 최종 비율이 아니라 분자와 분모를 저장한다. 평균은 `sum / sample_count`로 계산한다. p50/p95/p99를 bucket마다 저장해서 평균내지 않고, 같은 `histogram_version`의 고정 bucket count를 합쳐 다시 계산한다.

Histogram v1 upper bounds in milliseconds:

```text
25, 50, 100, 200, 300, 500, 750, 1000, 1500,
2000, 3000, 5000, 7500, 10000, 15000, 30000, 60000, +Inf
```

서로 다른 histogram version은 합치지 않는다. version이 다르거나 coverage가 확인되지 않으면 해당 범위를 raw fallback하거나 `partial`/`unavailable`로 응답한다. Histogram percentile은 고정 bucket의 상한값으로 계산하는 근사치이며 exact raw percentile을 평균내지 않는다. percentile이 마지막 `+Inf` bucket에 도달하면 `60000ms`로 낮춰 표시하지 않고 `null`로 응답한다.

Tenant Chat의 `activeUsers=count(distinct user_id)`는 high-cardinality 사용자 membership을 공통 Dashboard rollup에 저장하지 않는다. 이번 reader 전환은 `project_application`에 한정하며 Tenant Chat reader와 activeUsers는 기존 tenant-scoped bounded raw query를 유지한다. Tenant Chat rollup은 이 PR에서 shadow build 및 정합성 검증까지만 수행한다.

## 6. Rebuild And Correction

- Gateway source는 `(ingested_at, request_id)`, Tenant Chat source는 `(updated_at, request_id)` cursor로 변경을 발견한다.
- cursor는 기본 60초 safety lag 뒤까지만 전진하고, 최근 15분을 주기적으로 겹쳐 재조회한다. 이는 일반적인 짧은 writer transaction을 대상으로 하며 15분을 넘겨 늦게 commit되는 source transaction은 별도 reconciliation 대상이다.
- `caught_up_at`은 worker가 판정한 wall-clock이고 `caught_up_through`는 source timestamp 기준 inclusive watermark다. coverage는 반드시 `caught_up_through`를 사용한다.
- dirty bucket worker는 `FOR UPDATE SKIP LOCKED`와 transaction을 사용한다.
- 실패한 bucket은 attempts와 backoff를 기록해 다른 bucket을 막지 않으며, claim을 잃은 replica가 성공한 ready state를 error로 덮어쓰지 않는다.
- 집계값에 blind increment하지 않고 해당 minute bucket을 source에서 전부 다시 계산해 replacement한다.
- minute 완료 후 parent hour, hour 완료 후 parent day, day 완료 후 parent month를 dirty로 표시한다.
- minute는 source cursor가 해당 minute 끝까지 전진한 뒤에만 처리한다. 활성 minute mode의 parent는 source cursor가 parent 끝까지 전진했고 같은 범위에 미처리 child dirty bucket이 없을 때만 처리한다.
- Tenant Chat row가 보정되어 bucket이 이동하면 이전 bucket과 새 bucket을 모두 dirty로 표시한다.
- 동일 bucket을 여러 번 처리해도 결과가 같아야 한다.
- tenant filter는 모든 scan, delete, insert, coverage query의 첫 scope 조건이다.

## 7. Query Routing And Bounded Fallback

- 1시간 이하: bounded raw query
- 24시간: ready hour rollup + 열린 hour raw tail
- 1주: ready day rollup + 양 끝 hour/raw edge
- MTD: 완료된 day + 현재 day의 hour/raw tail
- 완료된 과거 월: month rollup

Policy Impact reader는 완료된 minute Rollup, 분 경계 앞의 작은 raw edge, 설정된 최대 raw tail을 합친다. 기본 tail 상한은 2분이며 허용 범위는 1~5분이다. source cursor가 그보다 더 늦어 coverage gap이 생기면 전체 기간 raw aggregation으로 돌아가지 않고 제공 가능한 결과를 `partial/stale`로 표시한다. 기존 응답이 1초 또는 7초 bucket을 요구하는 5분 이하 조회는 minute 결과로 같은 시계열을 복원할 수 없으므로 기존 bounded raw reader를 사용한다.

선택한 grain의 모든 expected UTC bucket에 ready state가 있고 같은 범위에 dirty bucket이 없을 때만 rollup을 사용한다. source watermark 이후의 미처리 row가 있으면 raw로 fallback하고, state가 없는 bucket은 `(tenant_id, created_at)` indexed existence probe로 실제 empty임을 확인한다. Console이 제공하는 최대 31일 범위에서는 rollout/backfill 중 compatibility raw fallback을 허용하며, 그보다 긴 임의 외부 조회는 이 PR의 성능 보장 범위가 아니다.

## 8. Freshness And Polling

응답은 최소 다음을 구분한다.

- `lastIngestedAt`: source가 마지막으로 관측된 시각
- `lastAggregatedAt`: 선택한 rollup이 마지막으로 완성된 시각
- `source`: `postgresql_request_log`, `postgresql_rollup`, 또는 `postgresql_hybrid`
- `isStale`와 `queryBudget.status`: `ok`, `partial`, `stale`, `too_broad`, `unavailable`

여러 surface를 합칠 때 freshness는 가장 오래된 source를 보수적으로 사용하고 query status는 가장 나쁜 상태를 선택한다. Web polling은 같은 rollup을 3초마다 반복 조회하지 않으며 기본 30초 이상으로 맞춘다. 실제 HTTP 성공·실패를 확인할 수 있는 Cost over time fetch는 첫 실패 후 60초, 반복 실패 후 120초로 backoff한다. `router.refresh()` 기반 Overview 갱신은 응답 성공 여부를 직접 판정할 수 없으므로 가짜 실패 상태를 만들지 않고, visibility·transition pending·30초 최소 간격으로 중복 갱신만 막는다. 1초 주기의 Live Requests raw polling은 rollup 조회가 아니며 이 계약의 범위 밖이다.

## 9. Security And Rollout

- rollup에는 raw prompt, raw response, authorization, API Key, App Token, Provider credential 또는 raw Provider error를 저장하지 않는다.
- tenant, project, application filter는 raw와 rollup 모두 동일하게 적용한다.
- Gateway observability read route는 별도 `X-GateLM-Observability-Token`으로 보호하고, Web server-only BFF만 해당 secret을 전송한다. 기존 Control Plane token, API Key, App Token은 재사용하지 않는다.
- Web tenant layout과 polling BFF는 route/query `tenantId`가 현재 사용자의 active tenant-admin membership 또는 project-admin assignment에 속하는지 먼저 검사한다.
- rollup writer는 Gateway request hot path 밖의 Control Plane background service가 소유한다.
- background writer는 `legacy | shadow | minute` build mode로 점진 활성화한다. 기본값은 `legacy`다.
- `shadow`는 기존 hour source rebuild를 유지하면서 minute 결과를 함께 만들어 정합성과 처리시간을 비교한다. shadow minute completion은 기존 hour parent를 덮어쓰지 않는다.
- `minute`는 source에서 minute만 만들고 parent chain을 child merge로 전환한다.
- `shadow → minute` 전환 시에는 원본이 존재하는 minute만 백필해서는 안 된다. 기존 legacy hour row가 있지만 대응하는 minute가 없는 closed hour도 `db/maintenance/enqueue_dashboard_parent_rollup_rebuild.sql`로 한 시간씩 다시 큐잉해 먼저 비운다. 그렇지 않으면 stale hour가 day/month에 다시 합산될 수 있다.
- Policy Impact reader는 `raw | rollup` read mode를 사용하며 기본값은 `raw`다.
- schema migration을 먼저 적용하고 shadow parity 검증 후 builder, 마지막으로 reader를 전환한다.
- 기존 대용량 P0 log에는 `(ingested_at, request_id)`, `(tenant_id, created_at)` index를 `CREATE INDEX CONCURRENTLY`로 추가한다. 배포 시 추가 I/O와 디스크 사용량을 관찰한다.
- Request Log raw retention, billing ledger, quota enforcement는 이 변경으로 삭제하거나 대체하지 않는다.

## 10. Acceptance

1. Gateway request-start 기준 TTFT와 client first-content 관측이 허용 오차 안에서 일치한다.
2. non-streaming 또는 미관측 TTFT는 API와 UI에서 `null`/`—`이며 `0ms`로 표시되지 않는다.
3. raw, rollup, hybrid 결과의 additive totals와 histogram percentile이 정의된 근사 범위 안에서 일치한다.
4. 동일 dirty bucket 재처리와 Tenant Chat late correction 후 중복 집계가 없다.
5. 다른 Tenant의 totals, dimensions, dirty state가 노출되거나 수정되지 않는다.
6. 3,000/6,000건 fixture가 아니라 실제 API→terminal log→rollup→Dashboard 흐름으로 검증한다.
7. 긴 범위 Dashboard의 query plan과 응답 시간이 raw-only 기준보다 개선됨을 별도 evidence로 남긴다.
8. 5분 이하의 sub-minute 시계열은 raw와 동일하게 유지되고, Rollup lag가 raw-tail 상한을 넘으면 full-range raw query 없이 `partial/stale`가 반환된다.
9. `legacy → shadow → minute` 전환과 `raw → rollup` reader 전환을 독립적으로 rollback할 수 있다.
10. 전환 범위에서 raw, minute, hour, day의 additive total이 같고, source가 없는 legacy parent bucket이 제거된다.

## 11. Performance Evidence

- [운영 300 RPS × 10분 이후 Dashboard Rollup DB 포화 보고서](../../../reports/perf/production-krafton-300rps-10m-dashboard-rollup-incident-20260720.ko.md)
- [Dashboard Minute Rollup 180,000건 로컬 A/B 보고서](../../../reports/perf/dashboard-minute-rollup-benchmark-20260721.ko.md)

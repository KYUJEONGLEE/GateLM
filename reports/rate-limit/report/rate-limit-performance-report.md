# Rate Limit 성능 측정 리포트: PostgreSQL vs Redis

작성일: 2026-07-04
마지막 갱신: 2026-07-05

## 목적과 결론

이 문서는 PostgreSQL fixed-window rate limiter의 성능 한계를 측정하고, Redis fixed-window 및 Redis token bucket 결과와 비교해 Redis 도입 근거를 정리한다. 멘토 코멘트의 핵심은 추측이 아니라 "서버 응답이 느려지고 DB query가 느려지는 사건"을 숫자로 남기는 것이었다.

결론은 아래와 같다.

| 질문 | 답 |
|---|---|
| PostgreSQL fixed-window가 병목이 되는가? | 그렇다. current 기준 200 RPS부터 decision avg와 DB update mean이 커지고, 300 RPS부터 dropped iteration이 발생했다. |
| 병목 원인은 provider인가? | 주된 원인은 provider가 아니라 rate-limit decision과 PostgreSQL counter update path 쪽이다. 다만 일부 Gateway latency에는 provider/mock timeout이 섞였다. |
| Redis fixed-window는 개선됐는가? | 그렇다. PostgreSQL이 무너진 300/500 RPS에서 Redis fixed-window decision avg는 약 1ms 수준으로 유지됐다. |
| Redis만으로 boundary burst가 해결되는가? | 아니다. Redis fixed-window도 경계 전후 120건을 모두 허용했다. |
| token bucket은 무엇을 개선했는가? | 저장소 병목이 아니라 fixed-window boundary burst를 완화했다. clean boundary rerun에서 Redis fixed-window는 120건을 모두 허용했고, Redis token bucket은 64건만 허용하고 56건을 429로 차단했다. |

## Evidence Confidence

| 주장 | 현재 근거 수준 | 판단 |
|---|---|---|
| PostgreSQL fixed-window는 고정 RPS에서 병목이 된다 | 높음 | 200 RPS부터 decision avg와 DB update mean이 증가하고, 300/500 RPS에서 dropped iteration이 발생했다. |
| Redis fixed-window는 PostgreSQL 저장소 병목을 줄인다 | 높음 | 같은 fixed-window 알고리즘에서 Redis decision avg가 300/500 RPS에서도 약 1ms 수준으로 유지됐다. |
| fixed-window는 boundary burst를 허용한다 | 중간 이상 | PostgreSQL/Redis fixed-window 모두 boundary 전후 120 allowed가 관찰됐다. latency는 provider/mock 영향이 커서 근거로 쓰지 않는다. |
| Redis token bucket이 boundary burst를 완화한다 | 높음 | run별 Redis key prefix로 격리한 clean rerun에서 fixed-window는 120 allowed / 0 limited, token bucket은 64 allowed / 56 limited였다. |
| lock wait이 직접 관찰됐다 | 낮음 | `pg_locks`는 after snapshot이라 peak lock wait을 증명하지 못한다. 현재는 DB-backed counter update path 병목으로 표현한다. |

## 측정 해석 기준

전체 Gateway latency는 사용자 체감 지표지만 rate limiter 자체의 성능 지표는 아니다. 같은 p95라도 요청이 provider까지 갔는지, exact cache를 맞았는지, 429로 빠르게 끝났는지에 따라 의미가 달라진다.

| 지표 | 역할 | 해석 기준 |
|---|---|---|
| Rate Limit decision duration | 핵심 지표 | limiter가 허용/차단을 판단하는 데 걸린 시간이다. 저장소 병목 판단에 우선 사용한다. |
| PostgreSQL `pg_stat_statements` | 핵심 근거 | counter insert/update calls, mean, max로 DB-backed counter update path 비용을 본다. |
| allowed / limited decision | 핵심 분리축 | 200/429보다 먼저 봐야 한다. provider 실패가 있으면 allowed와 최종 200이 달라질 수 있다. |
| k6 Gateway latency | 보조 지표 | terminal status, provider/cache 영향이 섞인 사용자 체감 latency다. |
| provider request count | 보호 검증 | 429가 provider 호출 전에 차단됐는지 확인하는 보조 지표다. exact cache/fallback 때문에 200과 1:1 대응하지 않는다. |

`duration_seconds_sum`은 개별 요청 1건의 latency가 아니라 같은 label에 쌓인 누적합이다. 평균은 반드시 `sum / count`로 계산한다.

## 테스트 조건과 주의

| 항목 | 값 |
|---|---|
| Gateway | local `:8080`, `RuntimeSnapshot=demo` |
| Provider | Docker mock provider |
| Rate limit | application scope, `60 reqs / 60 sec` |
| PostgreSQL | Docker Compose `postgres:16`, `pg_stat_statements` |
| Redis | Docker Compose `redis:7-alpine` |
| Raw artifact | `reports/perf/rate-limit/*` |

주의:

- E1/E2는 `PromptMode=shared`라 exact cache 영향이 섞였다.
- E1u/E2u는 이를 보정하기 위해 `PromptMode=unique`로 재측정했다.
- E1u는 Rate Limit off 상태에서 모든 요청이 provider/mock 경로로 가므로 provider-bound baseline이다. 빠른 Gateway baseline으로 쓰지 않는다.
- E3~E7은 `PromptMode=unique`로 exact cache 영향을 줄인 탐색 실험이다.
- RPS 고정 테스트는 provider/cache 노이즈를 줄이기 위해 `PromptMode=shared`를 기준으로 읽는다. Redis fixed-window matrix는 2026-07-05에 run별 Redis key prefix와 aligned single window 조건으로 전체 재측정했다.
- fixed-window RPS matrix는 window 경계를 넘으면 allowed 수가 60이 아니라 120으로 늘 수 있다. 새 k6 스크립트는 matrix 시작 전에 현재 window에 충분한 시간이 남았는지 확인하고, 부족하면 다음 window 직후까지 기다린다.
- Gateway latency는 위 조건 차이를 고려해 읽고, Redis 도입 근거는 decision duration과 DB/Redis 비교를 우선한다.
- E5는 warmup으로 quota를 먼저 채우는 과정이 metrics에 함께 집계됐다. already-limited 본 부하만의 순수 결과가 아니다.
- E7은 spike/recovery phase별 metrics가 저장되지 않았다. recovery 성능의 강한 근거가 아니라 aggregate 탐색 결과로만 해석한다.
- 기존 Redis token bucket boundary burst run은 Redis keyspace와 provider 실패가 섞여 있었다. 이후 run별 Redis key prefix로 격리해 clean boundary rerun을 수행했고, 해당 결과를 최종 boundary 근거로 사용한다.

## PostgreSQL Fixed-Window 탐색 실험

아래 E1~E7은 최종 비교라기보다 PostgreSQL fixed-window의 병목 신호를 찾기 위한 탐색 실험이다.

| ID | 시나리오 의미 | 현실적인 비교 목적 |
|---|---|---|
| E1 | Rate Limit off + shared baseline | Rate Limit을 끈 상태에서 cache-warmed Gateway가 어느 정도까지 빠르게 처리되는지 확인한다. E2와 짝을 이룬다. |
| E1u | Rate Limit off + unique 보정 baseline | cache hit 없이 모든 요청이 provider/mock 경로로 들어가면 latency가 어떻게 변하는지 확인한다. E2u와 짝을 이룬다. |
| E2 | PostgreSQL fixed-window low + shared | E1과 같은 shared 조건에서 Rate Limit을 켜면 처리량, latency, 429 분포가 어떻게 달라지는지 비교한다. |
| E2u | E2의 unique 보정 | E1u와 같은 unique 조건에서 Rate Limit이 초과 요청을 provider 전에 차단해 downstream 부하를 줄이는지 확인한다. |
| E3 | medium concurrency | E2u보다 동시 요청을 늘렸을 때 PostgreSQL counter update 비용이 병목 신호로 드러나는지 확인한다. |
| E4 | high concurrency | 더 높은 동시성에서 Gateway, DB, provider/mock 경로 중 어디부터 불안정해지는지 확인한다. |
| E5 | already-limited traffic | quota가 이미 찬 뒤에도 초과 요청 처리에 DB 비용이 계속 발생하는지 확인한다. |
| E6 | window boundary burst | fixed-window 알고리즘이 window 경계 전후 burst를 허용하는지 확인한다. |
| E7 | recovery after spike | spike 이후 window 단위 허용/차단이 어떻게 반복되는지 aggregate로 확인한다. phase별 recovery 검증은 별도 재측정이 필요하다. |

`실행 조건`의 시간은 `k6-summary.json`의 request rate 기준으로 읽은 대략값이다. E6은 window boundary 대기 시간이 포함되고, E7은 spike/recovery 두 phase가 이어진다.

| ID | Prompt | 실행 조건 | Chat 요청 | 200 | 429 | failed | 처리량 | Gateway p50 | Gateway p95 | Gateway p99 | decision avg | 해석 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| E1 | shared | constant-vus 5 VUs, 약 10s | 12,114 | 12,114 | 0 | 0 | 1,204 req/s | 3.25ms | 5.87ms | 9.02ms | 0.00ms | exact cache가 강하게 섞인 cache-warmed baseline |
| E1u | unique | constant-vus 5 VUs, 약 12s | 59 | 59 | 0 | 0 | 4.9 req/s | 754.74ms | 3,755.63ms | 3,757.71ms | 0.00ms | exact cache 제거 후 provider/mock 경로가 병목 |
| E2 | shared | constant-vus 5 VUs, 약 10s | 2,402 | 60 | 2,342 | 0 | 239 req/s | 19.67ms | 26.51ms | 31.44ms | 18.46ms | cache-warmed 상태의 low limiter 비용 |
| E2u | unique | constant-vus 5 VUs, 약 10s | 357 | 60 | 297 | 0 | 35 req/s | 25.21ms | 754.95ms | 755.52ms | 16.83ms | 최초 60건은 provider, 이후 297건은 429 |
| E3 | unique | constant-vus 20 VUs, 약 20s | 3,397 | 60 | 3,337 | 0 | 168 req/s | 72.32ms | 117.55ms | 3,105.88ms | 70.18ms | medium부터 decision duration 증가 |
| E4 | unique | constant-vus 50 VUs, 약 20s | 4,425 | 38 | 4,365 | 22 | 219 req/s | 145.35ms | 236.91ms | 2,446.53ms | 145.03ms | provider/fallback 502가 22건 섞임 |
| E5 | unique | constant-vus 20 VUs, 약 21s | 4,730 | 60 | 4,670 | 0 | 224 req/s | 79.81ms | 141.36ms | 169.92ms | 83.22ms | warmup 포함. 이미 제한된 요청도 decision 비용 발생 |
| E6 | unique | per-vu-iterations 60 VUs x 1, 약 67s | 120 | 120 | 0 | 0 | 경계성 테스트 | 4,337.57ms | 9,096.21ms | 9,460.96ms | 82.67ms | fixed-window 경계 전후 120건 허용 |
| E7 | unique | spike 50 VUs 30s + recovery 5 VUs 30s, 약 70s | 14,493 | 95 | 14,373 | 25 | 207 req/s | 24.36ms | 182.64ms | 221.65ms | 57.01ms | spike 후 window 단위 허용/차단 반복 |

E1 shared와 E3~E7 unique는 p95/p99를 직접 배수 비교하지 않는다. E1u는 exact cache를 제거했지만 provider-bound가 되었으므로 "limiter 없는 빠른 기준선"으로도 부적합하다. E5의 200/allowed는 warmup이 섞였고, E7은 phase별 recovery 수치를 복원할 수 없다. 이 표는 탐색 실험으로 보고, 저장소 병목 판단은 아래 RPS 고정 테스트를 우선한다.

## PostgreSQL Gateway Metrics

| ID | decisions | sum | total avg | allowed | allowed avg | limited | limited avg |
|---|---:|---:|---:|---:|---:|---:|---:|
| E1 | 12,114 | 0.002s | 0.00ms | 12,114 | 0.00ms | 0 | - |
| E1u | 59 | 0.000s | 0.00ms | 59 | 0.00ms | 0 | - |
| E2 | 2,402 | 44.352s | 18.46ms | 60 | 10.05ms | 2,342 | 18.68ms |
| E2u | 357 | 6.009s | 16.83ms | 60 | 7.85ms | 297 | 18.65ms |
| E3 | 3,397 | 238.396s | 70.18ms | 60 | 14.37ms | 3,337 | 71.18ms |
| E4 | 4,425 | 641.775s | 145.03ms | 60 | 151.98ms | 4,365 | 144.94ms |
| E5 | 4,730 | 393.652s | 83.22ms | 60 | 4.88ms | 4,670 | 84.23ms |
| E6 | 120 | 9.920s | 82.67ms | 120 | 82.67ms | 0 | - |
| E7 | 14,493 | 826.203s | 57.01ms | 120 | 53.37ms | 14,373 | 57.04ms |

E1/E1u의 `allowed`는 실제 quota 허용이 아니라 `status=rate_limit_disabled` label이다. E2u에서는 357건 중 60건만 provider로 갔고 297건은 429로 provider 전에 차단됐다.

## PostgreSQL DB 관찰

| ID | decisions | allowed | limited | update calls | update mean | update max | over-limit select calls | select mean |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| E2 | 2,402 | 60 | 2,342 | 2,402 | 12.99ms | 43.90ms | 2,342 | 0.03ms |
| E2u | 357 | 60 | 297 | 357 | 9.48ms | 27.34ms | 297 | 0.05ms |
| E3 | 3,397 | 60 | 3,337 | 3,397 | 49.93ms | 154.66ms | 3,337 | 0.03ms |
| E4 | 4,425 | 60 | 4,365 | 4,425 | 55.08ms | 334.11ms | 4,365 | 0.03ms |
| E5 | 4,730 | 60 | 4,670 | 4,730 | 58.08ms | 160.26ms | 4,670 | 0.03ms |
| E6 | 120 | 120 | 0 | 120 | 12.38ms | 117.31ms | 0 | - |
| E7 | 14,493 | 120 | 14,373 | 14,493 | 26.00ms | 144.80ms | 14,373 | 0.03ms |

핵심은 insert/update calls가 allowed 요청 수가 아니라 rate limit decision 수와 거의 같다는 점이다. quota가 이미 찬 뒤에도 매 요청마다 같은 counter row에 대해 insert/update 시도가 발생하고, 증가하지 못한 요청은 over-limit select로 현재 count를 읽은 뒤 429가 된다.

`pg_locks after snapshot`은 실행 후 순간 관찰이므로 lock 경합의 지속 시간이나 peak를 보여주지 못한다. lock wait을 결론으로 쓰려면 실행 중 sampling이나 Prometheus/Grafana 수집이 필요하다.

## RPS 고정 테스트: PostgreSQL Current vs Tuned v1

아래 테스트는 `constant-arrival-rate`로 목표 RPS를 고정했다. 각 실행은 20초 동안 같은 fixed window 안에서 수행했고, Rate Limit 설정은 동일하게 `60 reqs / 60 sec`다.

| 목표 RPS | 버전 | 실제 RPS | dropped | 200 | 429 | failed | p50 | p95 | p99 | decision avg | DB update mean | 판정 |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 50 | current | 49.90 | 0 | 60 | 940 | 0 | 4.04ms | 7.58ms | 26.07ms | 3.44ms | 0.09ms | 안정 |
| 50 | tuned v1 | 49.89 | 0 | 60 | 940 | 0 | 5.41ms | 14.09ms | 95.25ms | 5.36ms | 0.19ms | 개선 없음 |
| 100 | current | 99.73 | 0 | 60 | 1,941 | 0 | 7.26ms | 22.01ms | 100.28ms | 7.67ms | 1.17ms | tail 증가 시작 |
| 100 | tuned v1 | 99.74 | 0 | 60 | 1,941 | 0 | 7.05ms | 102.74ms | 459.84ms | 16.79ms | 5.20ms | 악화 |
| 150 | current | 148.43 | 0 | 60 | 2,940 | 0 | 5.79ms | 45.75ms | 137.58ms | 8.59ms | 3.19ms | 안정권 마지막 |
| 150 | tuned v1 | 149.44 | 0 | 60 | 2,941 | 0 | 7.49ms | 24.75ms | 133.88ms | 8.13ms | 1.43ms | 일부 개선 |
| 200 | current | 198.40 | 0 | 60 | 3,941 | 0 | 11.45ms | 123.94ms | 191.63ms | 33.69ms | 22.24ms | knee point |
| 200 | tuned v1 | 197.62 | 0 | 60 | 3,941 | 0 | 83.02ms | 318.62ms | 424.58ms | 96.48ms | 50.21ms | 악화 |
| 300 | current | 282.72 | 176 | 55 | 5,764 | 5 | 762.13ms | 1,053.04ms | 1,118.13ms | 637.78ms | 48.78ms | 포화 |
| 300 | tuned v1 | 291.91 | 56 | 60 | 5,885 | 0 | 118.98ms | 678.33ms | 722.89ms | 211.37ms | 46.97ms | 개선됐지만 포화 |
| 500 | current | 365.94 | 2,409 | 60 | 7,532 | 0 | 1,312.29ms | 1,544.62ms | 1,563.13ms | 1,243.40ms | 38.32ms | 붕괴 |
| 500 | tuned v1 | 337.23 | 2,905 | 60 | 7,038 | 0 | 1,375.90ms | 1,706.81ms | 1,842.04ms | 1,352.68ms | 40.22ms | 붕괴 |

`dropped`는 k6가 목표 RPS를 맞추기 위해 새 요청을 시작하려 했지만, 사용 가능한 VU가 부족해 요청을 시작하지 못한 횟수다. current 기준 200 RPS 부근에서 latency와 DB update mean이 급증했고, 300 RPS 이상에서는 목표 유입량 유지에 실패했다.

tuned v1은 `updated_at` 매 요청 갱신 제거, prune 기준 변경, `updated_at` 보조 인덱스 제거를 시도한 실험이다. 일부 구간은 개선됐지만 100/200/500 RPS에서는 악화됐다. 따라서 간단한 PostgreSQL 튜닝으로 DB-backed fixed-window 한계를 해결했다고 볼 수 없다. 해당 tuned 코드는 제품 변경으로 채택하지 않고 로컬 archive 브랜치에만 보존한다.

## Redis Fixed-Window 비교

Redis fixed-window는 알고리즘은 유지하고 저장소만 PostgreSQL에서 Redis로 바꾼 비교다. 따라서 이 비교에서 좋아지면 PostgreSQL DB-backed counter update path가 병목이었다는 근거가 강해진다.

| RPS | Postgres decision avg | Redis decision avg | Postgres p95 / p99 | Redis p95 / p99 | Postgres dropped | Redis dropped |
|---:|---:|---:|---:|---:|---:|---:|
| 50 | 3.44ms | 4.01ms | 7.58 / 26.07ms | 73.52 / 632.22ms | 0 | 0 |
| 100 | 7.67ms | 0.86ms | 22.01 / 100.28ms | 9.36 / 124.41ms | 0 | 0 |
| 150 | 8.59ms | 1.21ms | 45.75 / 137.58ms | 17.84 / 379.80ms | 0 | 0 |
| 200 | 33.69ms | 0.89ms | 123.94 / 191.63ms | 8.00 / 39.97ms | 0 | 0 |
| 300 | 637.78ms | 2.31ms | 1053.04 / 1118.13ms | 11.94 / 277.66ms | 176 | 0 |
| 500 | 1243.40ms | 2.14ms | 1544.62 / 1563.13ms | 43.21 / 337.62ms | 2409 | 0 |

PostgreSQL fixed-window는 300/500 RPS에서 decision avg가 637.78ms, 1243.40ms까지 증가했다. Redis fixed-window는 같은 구간에서 2ms대 수준을 유지했고 dropped도 0건이었다. Redis fixed-window의 p95/p99는 allowed provider/cache 구간과 로컬 실행환경 영향이 섞인 Gateway 전체 latency이므로 rate-limit decision avg와 분리해서 해석한다.

Redis fixed-window 상세:

| RPS | allowed decision | limited decision | 200 | 429 | failed | p50 | p95 | p99 | decision avg |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 60 | 940 | 60 | 940 | 0 | 8.63ms | 73.52ms | 632.22ms | 4.01ms |
| 100 | 60 | 1940 | 60 | 1940 | 0 | 6.30ms | 9.36ms | 124.41ms | 0.86ms |
| 150 | 60 | 2980 | 60 | 2980 | 0 | 4.38ms | 17.84ms | 379.80ms | 1.21ms |
| 200 | 60 | 3940 | 60 | 3940 | 0 | 5.23ms | 8.00ms | 39.97ms | 0.89ms |
| 300 | 60 | 5941 | 60 | 5941 | 0 | 6.14ms | 11.94ms | 277.66ms | 2.31ms |
| 500 | 60 | 9941 | 60 | 9941 | 0 | 6.54ms | 43.21ms | 337.62ms | 2.14ms |

fixed-window는 60초 window 안에서 60개까지만 허용하므로 높은 RPS에서는 대부분 429가 되는 것이 정상이다. clean rerun에서는 50~500 RPS 전 구간에서 dropped와 failed가 0건이었다. 50 RPS의 p95/p99가 큰 이유는 allowed 60건이 전체 1,000건 중 6%라 provider/cache 초기 구간이 p95에 포함되기 때문이다. 따라서 Redis 저장소 성능 판단은 Gateway p95/p99보다 decision avg와 dropped를 우선한다.

### 별첨: Redis Fixed-Window Unique Prompt 참고 결과

아래 결과는 같은 Redis fixed-window clean 조건에서 `PromptMode=unique`만 바꾼 참고 실험이다. unique prompt는 exact cache 영향을 줄여 allowed 60건이 provider/mock 경로를 타게 하므로 Gateway end-to-end tail latency를 관찰하는 데에는 유용하다. 다만 rate-limit 저장소 성능 비교의 1차 근거로 쓰지는 않는다. 저장소 비교는 cache/provider 전 단계에서 매 요청마다 수행되는 decision avg와 dropped를 우선한다.

| RPS | actual decision RPS | decisions | 200 | 429 | failed | dropped | provider calls | p50 | p95 | p99 | decision avg |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 48.75 | 975 | 60 | 915 | 0 | 26 | 60 | 5.24ms | 1,618.91ms | 6,616.32ms | 1.79ms |
| 100 | 99.65 | 1,993 | 60 | 1,933 | 0 | 8 | 60 | 2.64ms | 8.69ms | 5,863.89ms | 0.24ms |
| 150 | 149.75 | 2,995 | 60 | 2,935 | 0 | 6 | 60 | 3.24ms | 32.05ms | 4,453.74ms | 2.26ms |
| 200 | 200.05 | 4,001 | 60 | 3,941 | 0 | 0 | 60 | 5.03ms | 10.26ms | 3,063.01ms | 0.80ms |
| 300 | 292.00 | 5,840 | 60 | 5,780 | 0 | 161 | 60 | 5.07ms | 41.42ms | 1,511.83ms | 9.82ms |
| 500 | 500.00 | 10,000 | 60 | 9,940 | 0 | 0 | 60 | 4.75ms | 16.13ms | 715.44ms | 5.09ms |

unique 결과에서 `provider calls=60`으로 고정되는 것은 over-limit 요청이 provider/cache 전에 429로 차단됐다는 의미다. p99가 초 단위로 튀는 것은 Redis limiter가 느리다는 뜻이 아니라, 허용된 provider/mock 요청의 tail latency가 Gateway 전체 latency 분포에 섞였다는 의미로 해석한다. 150 RPS는 첫 실행이 `readyz 503`으로 setup 단계에서 중단되어 retry run을 사용했다.

## Redis Token Bucket 비교

Redis token bucket은 저장소 병목 해결이 아니라 fixed-window 알고리즘의 boundary burst 한계를 줄이는 실험이다. `60 reqs / 60 sec`를 `capacity=60`, `refill=1 token/sec`로 해석했다. 아래 표는 Redis fixed-window clean matrix와 같은 조건인 `PromptMode=shared`, `ExactCacheTtlSeconds=600`, run별 Redis key prefix, fresh Gateway, `constant-arrival-rate`, 20초 기준으로 다시 측정했다.

| RPS | decisions | allowed decision | limited decision | 200 | 429 | failed | dropped | provider calls | p50 | p95 | p99 | decision avg |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 1,001 | 79 | 922 | 79 | 922 | 0 | 0 | 14 | 6.92ms | 19.55ms | 620.91ms | 1.42ms |
| 100 | 2,000 | 79 | 1,921 | 79 | 1,921 | 0 | 0 | 18 | 4.33ms | 19.45ms | 512.73ms | 1.40ms |
| 150 | 3,001 | 79 | 2,922 | 79 | 2,922 | 0 | 0 | 17 | 2.44ms | 6.03ms | 153.25ms | 0.50ms |
| 200 | 4,001 | 79 | 3,922 | 79 | 3,922 | 0 | 0 | 27 | 4.61ms | 7.02ms | 19.79ms | 0.66ms |
| 300 | 6,000 | 79 | 5,921 | 79 | 5,921 | 0 | 0 | 38 | 5.88ms | 21.82ms | 583.98ms | 5.07ms |
| 500 | 9,990 | 79 | 9,911 | 79 | 9,911 | 0 | 11 | 45 | 8.21ms | 121.98ms | 932.09ms | 10.50ms |

20초 테스트에서는 초기 60개에 약 19개 refill이 더해져 allowed decision이 79개로 나온다. 이는 fixed-window처럼 "같은 window 안에서 60개만 허용"하는 동작이 아니라, 시간 경과에 따라 조금씩 허용량이 회복되는 동작이다. 200 RPS의 낮은 p99는 주변 RPS보다 좋은 성능을 의미하는 것이 아니라, 느린 provider/cache 경로 요청이 p99 경계 안에 충분히 반영되지 않은 low outlier로 해석한다. 500 RPS는 failed는 없지만 dropped 11건이 있어 로컬 k6/Gateway 실행 여유가 줄어든 구간으로 본다.

token bucket은 Redis fixed-window보다 항상 빠르다고 해석하면 안 된다. 300/500 RPS에서 decision avg가 5.07ms/10.50ms까지 올라가므로, token bucket의 근거는 저장소 성능 개선이 아니라 boundary burst 완화다. 그래도 같은 RPS 구간의 PostgreSQL fixed-window decision avg인 637.78ms/1,243.40ms와 비교하면 PostgreSQL counter update 병목과는 다른 수준으로 유지된다.

## Boundary Burst 비교

| Scenario | 경계 전 200 | 경계 전 429 | 경계 후 200 | 경계 후 429 | allowed decision | limited decision | failed | Gateway p95 | decision avg | 근거 수준 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| PostgreSQL fixed-window | 미수집 | 미수집 | 미수집 | 미수집 | 120 | 0 | 0 | 9,096.21ms | 82.67ms | fixed-window burst 확인 |
| Redis fixed-window clean | 60 | 0 | 60 | 0 | 120 | 0 | 0 | 8,291.31ms | 30.83ms | fixed-window burst 확인 |
| Redis token bucket clean | 60 | 0 | 4 | 56 | 64 | 56 | 0 | 3,573.67ms | 41.84ms | boundary burst 완화 확인 |

clean run은 `GATEWAY_RATE_LIMIT_REDIS_KEY_PREFIX=gatelm:rate_limit:perf:<runId>`로 Redis namespace를 격리했다. 각 run의 prefix key는 실행 전 0개, 실행 후 1개로 확인됐다.

PostgreSQL fixed-window는 당시 phase별 200/429를 별도로 수집하지 않아 `미수집`으로 표시했다. aggregate 기준으로는 120건 모두 허용되고 429는 0건이었다. fixed-window는 저장소가 PostgreSQL이든 Redis든 window 경계 전후 요청을 모두 허용한다. Redis token bucket은 같은 120건 burst에서 경계 전 60건은 허용했지만, 경계 직후 60건 중 4건만 허용하고 56건을 429로 차단했다. boundary burst의 Gateway p95/p99는 mock provider 처리 지연이 섞이므로, 이 시나리오는 latency보다 before/after allowed/limited decision으로 판단한다.

## 최종 해석

현재 PostgreSQL fixed-window는 provider로 통과 가능한 평균 트래픽이 `1 RPS`인 설정에서도 inbound decision RPS가 커지면 같은 scope/window counter에 매 요청 atomic update를 시도한다. 이 구조 때문에 200 RPS 부근에서 knee point가 나타나고, 300 RPS 이상에서는 목표 유입량 유지 실패와 긴 tail latency가 발생했다.

Redis fixed-window는 동일한 알고리즘에서 저장소만 바꾼 비교이고, PostgreSQL이 무너진 구간에서도 decision avg를 약 1ms 수준으로 유지했다. 이 결과는 PostgreSQL DB-backed counter update path가 주요 병목이었다는 근거로 충분하다.

다만 Redis fixed-window도 fixed-window 알고리즘의 경계 burst 문제는 그대로 가진다. boundary burst 완화는 Redis 도입만의 효과가 아니라 token bucket 같은 알고리즘 변경의 효과로 분리해서 설명해야 한다. clean boundary rerun 기준 Redis token bucket은 fixed-window가 120건을 모두 허용한 burst에서 64건만 허용하고 56건을 차단했다. 따라서 Redis fixed-window는 저장소 병목 해결 근거, Redis token bucket은 알고리즘 한계 완화 근거로 나누어 설명하는 것이 가장 타당하다.

## 남은 한계

- Gateway latency는 terminal status, provider/mock timeout, exact cache, fallback 영향이 섞인다.
- `pg_locks`는 after snapshot이라 lock wait의 peak를 증명하지 못한다.
- 과거 Redis fixed-window와 token bucket 일부 실행에는 provider/mock 실패가 섞였다. RPS matrix와 boundary 결론은 clean rerun을 우선한다.
- token bucket 500 RPS 첫 clean 실행은 시작 직후 connection refused가 섞여 제외했고, canonical 표에는 retry run을 사용했다.
- E5는 warmup이 metrics에 함께 집계되어 already-limited 본 부하만 분리되지 않는다.
- E7은 spike/recovery phase별 metrics가 보존되지 않아 aggregate로만 해석 가능하다.
- boundary clean rerun에서도 Gateway latency는 mock provider 단일 처리 지연 영향을 받는다. 따라서 latency가 아니라 before/after decision count를 핵심 근거로 쓴다.
- raw artifact는 `reports/perf/rate-limit/`에만 있고 Git에는 커밋하지 않는다.
- 제품화 전에는 Prometheus/Grafana로 Redis operation latency와 Gateway decision duration을 장시간 관찰해 운영 지표를 보강한다.

## Raw Artifact

- PostgreSQL 탐색 실험: `reports/perf/rate-limit/rate-limit-postgres-*-20260704`
- PostgreSQL RPS matrix: `reports/perf/rate-limit/rate-limit-postgres-rps-*-20260704`
- PostgreSQL tuned v1: `reports/perf/rate-limit/rate-limit-postgres-tuned-rps-*-20260704`
- Redis fixed-window legacy: `reports/perf/rate-limit/rate-limit-redis-fixed-window-shared-*-20260704`
- Redis fixed-window clean matrix: `reports/perf/rate-limit/rate-limit-redis-fixed-window-shared-clean-rps-*-20260705`
- Redis fixed-window unique clean appendix: `reports/perf/rate-limit/rate-limit-redis-fixed-window-unique-clean-rps-*-20260705`, `reports/perf/rate-limit/rate-limit-redis-fixed-window-unique-clean-rps-150-retry-20260705`
- Redis token bucket legacy: `reports/perf/rate-limit/rate-limit-redis-token-bucket-*-20260704`
- Redis token bucket clean matrix: `reports/perf/rate-limit/rate-limit-redis-token-bucket-shared-clean-rps-*-20260705`, `reports/perf/rate-limit/rate-limit-redis-token-bucket-shared-clean-rps-*-retry-20260705`
- Redis clean rerun: `reports/perf/rate-limit/rate-limit-redis-*-clean-20260705`, `reports/perf/rate-limit/rate-limit-redis-*-lowlatency-20260705`

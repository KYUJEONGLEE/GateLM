# Dashboard Minute Rollup 성능 비교 보고서

## 1. 결론

운영 `300 RPS × 10분` 시험에서는 Gateway 요청 로그 180,001건이 성공적으로 저장됐지만, Dashboard의 원본 로그 조회와 한 시간 전체를 다시 계산하는 Rollup worker가 같은 PostgreSQL을 경쟁해 Data 호스트가 포화됐다.

이를 해결하기 위해 집계 단위를 `hour` 원본 재조회에서 `minute` 원본 재조회로 줄이고, `hour → day → month`는 하위 Rollup만 병합하도록 변경했다. Analytics Policy Impact 조회도 완료된 1분 Rollup과 최대 2분의 raw tail만 합치며, Rollup 지연이 2분을 넘으면 전체 원본 로그로 되돌아가지 않고 `partial/stale`로 표시한다.

2026-07-21 로컬 격리 PostgreSQL에서 운영 부하와 같은 크기인 180,000건을 비교한 결과는 다음과 같다.

- 원본 기반 Analytics 조회 p95: `1,217.847ms`
- 1분 Rollup 기반 Analytics 조회 p95: `5.248ms`
- 조회 p95 감소: `99.569%`, 약 `232.059배`
- 한 번의 재집계가 점유하는 최대 시간: `15.561초 → 1.067초`
- 최대 재집계 구간 감소: `93.14%`, 약 `14.58배`
- 요청 수·비용·절감액·캐시 hit·복잡도 라우팅·모델 집계: 모두 일치

추가로 2026-07-21 AWS 운영 복제 환경의 실제 로그 70,252건을 같은 reader 구현으로 비교했다. Raw p95는 `6,221.145ms`, Rollup p95는 `2.048ms`로 `99.967%` 감소했고, 요청 수와 Policy Impact 전체 결과의 exact parity가 통과했다. 이 값은 운영과 같은 `m7i.large` Data 인스턴스의 복제 DB에서 측정했지만, 실제 운영 트래픽이 동시에 흐르는 production end-to-end 결과는 아니다.

같은 날 운영에는 배포 SHA `b274dca9624a56488fbbb38853e43edd88d82be9`를 기준으로 단계적 전환을 완료했다. 닫힌 분 기준 `project_application 301,820건`, `tenant_chat 791건`이 Raw와 Minute에서 일치했고, 닫힌 시간·일도 `Raw = Minute = Hour = Day`를 확인했다. 이후 writer를 `minute`, 두 Gateway의 Policy Impact reader를 `rollup`으로 전환했으며 NLB의 8080/8081 대상 네 개가 모두 healthy이고 Web/Chat 공개 경계가 HTTP 200을 유지했다. 다만 이 운영 검증은 전환 정합성과 가용성 확인이며, 300 RPS 재시험의 Dashboard p95 개선 배수를 뜻하지 않는다.

## 2. 문제와 원인

### 문제 상황

2026-07-20 운영 Krafton Mock 부하 시험은 300 RPS를 10분 동안 처리해 180,001개의 성공 로그를 남겼다. 그러나 요청이 끝난 뒤 PostgreSQL 컨테이너 CPU가 약 190~199%에 머물렀고 Dashboard와 Analytics가 느려졌다.

### 원인 분리

1. Dashboard를 닫고 장기 raw 조회를 정리하자 PostgreSQL CPU가 약 200%에서 100%로 감소했다.
2. 남은 활성 쿼리는 Control Plane Rollup worker가 `p0_llm_invocation_logs`를 읽고 Rollup 테이블을 다시 쓰는 작업이었다.
3. worker를 일시 중지하자 CPU가 `100.24% → 0.07% → 0.06% → 0.29%`로 회복됐다.
4. 실행계획을 `MATERIALIZED`로 개선한 뒤에도 180,008건이 들어 있는 한 시간 bucket 재계산은 운영에서 `37.353초`가 걸렸다.

즉, 단순히 SQL 한 번을 빠르게 만드는 것으로는 충분하지 않았다. 한 시간에 로그가 많이 쌓일수록 재처리 트랜잭션이 계속 커지는 구조와, Rollup이 늦으면 Dashboard가 같은 전체 원본을 다시 읽는 구조가 핵심 문제였다.

## 3. 해결 방식

### 3.1 작은 1분 replacement bucket

blind increment 대신 기존 정합성 원칙을 유지했다. 늦게 저장되거나 수정된 로그가 발견되면 해당 1분 구간을 원본에서 완전히 다시 계산한 뒤 기존 1분 결과를 교체한다.

이 방식은 요청마다 counter를 즉시 증가시키는 방식보다 쓰기 비용은 있지만 다음을 보장하기 쉽다.

- 동일 bucket을 여러 번 처리해도 같은 결과
- 늦게 도착한 로그와 정정된 로그 반영
- 중복 discovery에 의한 이중 합산 방지
- source log와 Rollup의 exact parity 비교 가능

### 3.2 상위 bucket은 원본이 아니라 하위 Rollup 병합

```text
월별 원본 로그 partition
→ 변경된 1분만 원본에서 replacement rebuild
→ 60개 minute를 hour로 병합
→ hour를 day로 병합
→ day를 month로 병합
→ Dashboard / Analytics 조회
```

따라서 10분 동안 18만 건이 들어와도 상위 hour 병합은 원본 18만 건이 아니라 최대 60개의 minute 집계 행을 읽는다.

### 3.3 단계적 전환 모드

| 모드 | 동작 | 용도 |
|---|---|---|
| `legacy` | 기존 hour 원본 재집계 | 배포 직후 기본값과 즉시 rollback |
| `shadow` | 기존 hour 결과를 유지하면서 minute 결과도 작성 | raw/hour/minute 정합성 비교 |
| `minute` | minute를 원본에서 만들고 상위 grain은 하위 Rollup 병합 | 검증 후 활성 경로 |

schema migration과 코드 배포만으로 동작을 즉시 바꾸지 않는다. 기본값은 `legacy`이며 DEV와 운영에서 각각 shadow parity가 확인된 뒤 명시적으로 전환한다.

### 3.4 전체 raw fallback 제거

Analytics Policy Impact reader는 다음 순서로 조회한다.

1. 완료된 1분 Rollup 구간
2. 분 경계보다 앞선 작은 raw edge
3. 최대 2분의 최신 raw tail

Rollup 지연이 2분을 초과하면 빠진 전체 구간을 raw scan하지 않는다. 제공 가능한 범위만 반환하고 freshness를 `partial/stale`로 표시해 DB 장애가 Dashboard 조회로 증폭되는 것을 막는다. 단, 기존 API가 1초 또는 7초 해상도를 제공하는 5분 이하 조회는 1분 Rollup으로 복원할 수 없으므로 기존 bounded raw 조회를 유지한다.

## 4. 비교 방법

| 항목 | 조건 |
|---|---|
| 실행일 | 2026-07-21 |
| 코드 기준 | `origin/dev` `c83921c89` + 월 파티셔닝 `7be8975b6` + Minute Rollup `c5a7246d1` |
| DB | 격리 Docker `pgvector/pgvector:0.8.5-pg16-trixie` |
| 호스트 | Windows, AMD Ryzen AI 7 350 8C/16T, RAM 31.1GB |
| 데이터 | 단일 tenant/project/application, 180,000건 |
| 발생 분포 | 300건/초, 10분, UTC `[00:00, 00:10)` |
| payload 특성 | 로그당 약 3.2KB synthetic metadata padding |
| Provider/Model | `mock` / `mock-fast` |
| 기존 방식 | 한 hour bucket을 원본 180,000건에서 replacement rebuild |
| 개선 방식 | 10개 minute bucket을 각각 replacement rebuild 후 hour 병합 |
| 조회 비교 | 동일 Policy Impact 요청, warm-up 후 각 5회 |
| 재현 명령 | `scripts/dev/dashboard-minute-rollup-benchmark.ps1 -SyntheticRows 180000 -RequestsPerSecond 300` |

동시에 k6, Dashboard polling, 로그 writer를 실행하지 않은 격리 비교다. 따라서 아래 수치는 구현 방식 자체의 차이를 보여주지만 운영 end-to-end 용량을 의미하지 않는다.

## 5. 성능 비교표

### 5.1 동일 로컬 환경 A/B

| 비교 항목 | 기존 hour 원본 방식 | minute + parent merge | 변화 |
|---|---:|---:|---:|
| 처리 원본 로그 | 180,000건 | minute당 18,000건 × 10 | 작업 상한을 1분으로 제한 |
| 전체 source rebuild 시간 | 15,560.547ms | 8,667.148ms | 44.30% 감소, 1.80배 |
| 단일 재집계 최대 점유 시간 | 15,560.547ms | 1,067.260ms | 93.14% 감소, 14.58배 |
| 단일 재집계 p95 | 해당 hour 1회 15,560.547ms | 1,067.260ms | 작은 트랜잭션으로 분할 |
| hour parent 병합 | 해당 없음 | 19.510ms | 원본 대신 minute 결과 병합 |
| Analytics 조회 p50 | 919.517ms | 3.680ms | 약 249.87배 |
| Analytics 조회 p95 | 1,217.847ms | 5.248ms | 99.569% 감소, 232.059배 |
| Analytics 조회 max | 1,217.847ms | 5.248ms | 약 232.06배 |
| 집계 결과 정합성 | 기준값 | 모두 일치 | PASS |

전체 minute source rebuild 시간은 10개 bucket을 순차 실행한 합이다. 실제 지속 처리에서는 닫힌 minute가 순차적으로 처리되므로 기술적으로 중요한 값은 전체 합뿐 아니라 단일 트랜잭션 최대 시간이 15.56초에서 1.07초로 제한됐다는 점이다.

### 5.2 검증한 정합성

| 지표 | Raw | Minute Rollup | 결과 |
|---|---:|---:|---|
| Request count | 180,000 | 180,000 | PASS |
| Cost | 동일 | 동일 | PASS |
| Saved cost | 동일 | 동일 | PASS |
| Exact cache hit | 동일 | 동일 | PASS |
| Complex routing count | 동일 | 동일 | PASS |
| Provider/Model count | 동일 | 동일 | PASS |

### 5.3 운영 기존 관측과의 관계

| 환경 | 180k급 hour rebuild | 의미 |
|---|---:|---|
| 운영 m7i.large, 기존 개선 SQL | 180,008건 / 37.353초 | 실제 운영 backlog 단독 복구 관측 |
| 로컬 격리 DB, 기존 hour 방식 | 180,000건 / 15.561초 | 이번 A/B의 로컬 기준선 |
| 로컬 격리 DB, minute 방식 | minute 최대 18,000건 / 1.067초 | 이번 A/B의 개선 결과 |

운영과 로컬은 CPU, DB cache, 디스크, 동시 부하가 다르므로 `37.353초`와 `1.067초`를 직접 나눠 운영 개선 배수로 주장하지 않는다. 개선 배수는 같은 로컬 실행의 기존/개선 결과만 사용한다.

### 5.4 AWS 운영 복제 환경 A/B

운영 DB의 복제본을 사용하는 별도 Data EC2(`m7i.large`)에서 동일한 Go Policy Impact reader를 `raw`와 `rollup` 모드로 각각 5회 실행했다. 대상 tenant/project의 실제 로그는 70,252건이며 조회 기간은 UTC `2026-07-19 05:00–16:00`이다. 측정 중 실제 운영 요청은 복제 환경으로 들어오지 않았다.

| 비교 항목 | Raw reader | Rollup reader | 변화 |
|---|---:|---:|---:|
| 표본 수 | 5회 | 5회 | 동일 |
| 조회 p50 | 5,934.689ms | 1.961ms | 약 3,026배 |
| 조회 p95 | 6,221.145ms | 2.048ms | 99.967% 감소, 3,037.606배 |
| 조회 max | 6,221.145ms | 2.048ms | 약 3,037.61배 |
| Request count | 70,252 | 70,252 | PASS |
| 전체 Policy Impact 결과 | 기준값 | 기준값과 동일 | PASS |

기존 HTTP endpoint도 같은 70,252건에서 10회 모두 `13.229–14.841초`가 걸렸다. 다만 당시 Gateway image는 아직 Rollup reader로 교체하지 않았으므로 이 HTTP 수치와 위 direct reader 수치를 나눠 end-to-end 개선 배수로 사용하지 않는다.

Minute 백필은 원본과 `70,252 = 70,252`로 일치했지만 첫 Parent 병합 결과는 Hour/Day가 `88,256건`이었다. 기존 Legacy `06:00` Hour row 18,004건이 대응하는 raw/minute row 없이 남았고, 원본이 있는 minute만 큐에 넣는 백필로는 이 고아 row가 지워지지 않았기 때문이다.

이를 해결하기 위해 Minute 전환 후 기존 Hour state/row까지 포함해 한 시간씩 Parent rebuild를 명시적으로 큐잉하도록 보완했다. 해당 Hour는 먼저 기존 row를 삭제한 뒤 child Minute만 병합하고 Day/Month를 연쇄 재생성한다. 재검증 결과는 다음과 같다.

| 집계 단계 | 보완 전 | 보완 후 | 결과 |
|---|---:|---:|---|
| Raw | 70,252 | 70,252 | 기준값 |
| Minute | 70,252 | 70,252 | PASS |
| Hour | 88,256 | 70,252 | stale 18,004건 제거 |
| Day | 88,256 | 70,252 | PASS |
| Closed Hour/Day dirty queue | 0 | 0 | PASS |

백필 중 16,813–27,005건이 집중된 시간대에는 PostgreSQL 컨테이너 CPU가 약 `99.7–100.4%`까지 올라갔다. 따라서 운영에서는 전체 기간을 한 번에 큐잉하지 않고 승인된 UTC 1시간 단위로 처리하며 CPU와 dirty queue를 관찰해야 한다. 처리 완료 후 복제 환경의 즉시 표본은 PostgreSQL `12.61%`, Control Plane `0.70%`였다.

### 5.5 운영 Shadow 백필과 실제 전환

운영에서는 전체 기간을 한꺼번에 재집계하지 않았다. `shadow` 모드에서 UTC 한 시간씩 Minute bucket을 큐에 넣고, 해당 범위의 queue가 0이 된 뒤 다음 시간으로 이동했다. 밀집 구간은 20초 간격·한 bucket씩 처리해 쿼리 사이에 DB가 회복할 시간을 확보했다.

| 운영 원본 구간 | 생성한 Minute bucket | 의도적으로 제한한 경과시간 | PostgreSQL 최대 CPU |
|---:|---:|---:|---:|
| P0 37,886건 | 7개 | 78.703초 | 118.56% |
| P0 82,123건 + Tenant Chat 14건 | 14개 | 286.518초 | 119.93% |
| P0 180,008건 + Tenant Chat 6건 | 17개 | 387.160초 | 198.32% |

경과시간에는 bucket 사이의 의도적인 20초 대기가 포함되므로 순수 계산 성능으로 해석하지 않는다. 중요한 관측은 Minute 방식도 2 vCPU PostgreSQL을 순간적으로 포화시킬 수 있지만, 긴 hour 트랜잭션과 달리 각 작은 작업 사이에 CPU가 약 `0.05–0.22%`까지 회복했다는 점이다. 즉 CPU peak를 제거한 것이 아니라 점유 시간을 제한하고 회복 지점을 만든 개선이다.

| 운영 전환 검증 | 결과 |
|---|---:|
| 닫힌 Minute, project_application | Raw 301,820 = Rollup 301,820 |
| 닫힌 Minute, tenant_chat | Raw 791 = Rollup 791 |
| 닫힌 Hour, 두 surface | Raw = Minute = Hour, PASS |
| 닫힌 Day, 두 surface | Raw = Minute = Hour = Day, PASS |
| 날짜·tenant·surface별 불일치 | 0건 |
| 기존 Parent 42시간 재생성 | 103.946초, 최대 CPU 표본 67.42% |
| 운영 writer | `minute`, 60초 간격, batch 1 |
| Gateway reader | 2대 모두 `rollup`, raw tail 최대 120초 |
| NLB / 공개 경계 | 8080·8081 모두 healthy, Web·Chat HTTP 200 |

전환 후 새 Tenant Chat 로그가 유입된 상태에서도 다음 60초 writer 주기 뒤 닫힌 Minute가 `Raw 795 = Rollup 795`로 자동 수렴했다. 마지막 queue의 `hour 1건`, `day 1건`, `month 3건`은 닫히지 않은 현재 시간·일·월의 parent이며 closed bucket 누락이 아니다. 전환 직후 공개 Web/Chat 응답은 각각 약 0.05초였지만, 이는 인증된 Dashboard/Analytics p95 측정값이 아니므로 성능 개선 배수로 사용하지 않는다.

## 6. 기술적 챌린지 스토리

### 문제

300 RPS 요청 자체는 성공했지만, 비동기 로그 집계와 Dashboard 조회가 요청량을 따라가지 못해 부하 종료 후에도 공유 PostgreSQL과 제품 화면을 마비시켰다.

### 시도와 한계

Dashboard 조회와 worker를 분리해 CPU 점유 주체를 특정했고, JSON 반복 평가를 `MATERIALIZED` CTE로 줄여 실패하던 hour bucket을 60초 안에 완료시켰다. 그러나 hour 전체 재계산은 데이터가 늘수록 트랜잭션도 계속 커지고, Rollup이 늦을 때 전체 raw fallback이 같은 DB 부하를 다시 만들 수 있었다. 이후 Minute 결과만 맞으면 충분하다고 가정한 첫 전환 리허설에서도, source가 없는 Legacy Hour row가 상위 집계에 남아 `70,252 → 88,256건`으로 중복되는 한계가 드러났다.

### 추가 개선

정합성을 유지하는 replacement rebuild 범위를 1분으로 줄이고 상위 bucket은 하위 Rollup만 병합했다. reader는 완료 Rollup과 최대 2분 raw tail만 조합하고, 더 큰 coverage gap은 전체 scan 대신 명시적인 partial 상태로 반환하도록 했다. `legacy → shadow → minute` 모드로 배포 효과와 코드 효과를 분리할 수 있게 했다. 전환 시에는 기존 Parent row가 있는 closed hour도 한 시간씩 강제로 재빌드해 stale row를 먼저 제거하도록 추가 보완했다.

### 정량 결과

동일 18만 건 로컬 A/B에서 단일 재집계 최대 시간이 `15.561초 → 1.067초`, Analytics 조회 p95가 `1,217.847ms → 5.248ms`로 감소했다. AWS 운영 복제 70,252건 A/B에서도 reader p95가 `6,221.145ms → 2.048ms`로 감소했고, Parent 전환 보완 후 `Raw = Minute = Hour = Day = 70,252` exact parity를 확인했다. 실제 운영에서는 301,820건의 Gateway 로그와 791건의 Tenant Chat 로그에 대해 닫힌 grain의 exact parity를 통과한 뒤 writer와 두 reader를 전환했다.

## 7. 아직 증명하지 않은 것

- 전환된 실제 production에서 같은 300 RPS × 10분을 다시 실행한 결과
- 요청 적재, Rollup worker, Dashboard/Analytics 동시 조회 상태의 PostgreSQL CPU와 I/O
- 인증된 Dashboard/Analytics endpoint의 전환 전후 p50·p95·p99
- late correction과 bucket 이동이 많은 데이터의 장시간 soak
- 여러 Control Plane worker가 동시에 minute queue를 처리할 때의 처리량
- 장기간 보관 데이터에 월 파티셔닝과 retention을 함께 적용한 효과
- 모델 종류가 50개를 넘는 high-cardinality breakdown의 운영 분포

## 8. 운영 적용 상태와 다음 검증

1. 완료: additive migration 배포 후 기존 `legacy/raw` 모드에서 health 확인
2. 완료: Control Plane만 `shadow`로 전환하고 minute dirty queue와 error 관찰
3. 완료: tenant·surface별 raw/hour/minute 정합성 비교
4. 완료: 한 시간 단위 이하로 제한한 backfill과 cursor catch-up, closed minute dirty bucket 0 확인
5. 완료: Control Plane을 `minute`으로 전환하고 parent hour/day parity 확인
6. 완료: Gateway Policy Impact reader를 두 대 모두 `rollup`으로 순차 전환
7. 남음: 50 RPS smoke 후 단계적으로 100/200/300 RPS × 10분 재시험
8. 남음: 성공률, DB CPU, active query, cursor lag, dirty queue, 인증된 Dashboard p95, 부하 종료 후 회복 시간을 함께 기록
9. rollback: 이상 시 reader를 `raw`, builder를 `legacy`로 되돌리고 기존 Rollup과 원본 로그 보존

운영 재시험이 끝나기 전 발표에서는 “동일 데이터 A/B에서 구조 개선 효과를 측정했고, 운영 30만 건의 정합성 검증 후 단계적으로 활성화했다”고 표현한다. “운영 300 RPS에서 Dashboard 병목이 완전히 해결됐다”는 표현은 아직 사용하지 않는다.

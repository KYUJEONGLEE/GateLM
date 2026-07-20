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

이 결과는 동일한 로컬 DB와 데이터셋에서 수행한 A/B 결과다. 아직 운영 EC2의 Dashboard 동시 접속, 지속적인 로그 적재, worker catch-up, PostgreSQL CPU 회복까지 재시험한 결과는 아니다.

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

## 6. 기술적 챌린지 스토리

### 문제

300 RPS 요청 자체는 성공했지만, 비동기 로그 집계와 Dashboard 조회가 요청량을 따라가지 못해 부하 종료 후에도 공유 PostgreSQL과 제품 화면을 마비시켰다.

### 시도와 한계

Dashboard 조회와 worker를 분리해 CPU 점유 주체를 특정했고, JSON 반복 평가를 `MATERIALIZED` CTE로 줄여 실패하던 hour bucket을 60초 안에 완료시켰다. 그러나 hour 전체 재계산은 데이터가 늘수록 트랜잭션도 계속 커지고, Rollup이 늦을 때 전체 raw fallback이 같은 DB 부하를 다시 만들 수 있었다.

### 추가 개선

정합성을 유지하는 replacement rebuild 범위를 1분으로 줄이고 상위 bucket은 하위 Rollup만 병합했다. reader는 완료 Rollup과 최대 2분 raw tail만 조합하고, 더 큰 coverage gap은 전체 scan 대신 명시적인 partial 상태로 반환하도록 했다. `legacy → shadow → minute` 모드로 배포 효과와 코드 효과를 분리할 수 있게 했다.

### 정량 결과

동일 18만 건 로컬 A/B에서 단일 재집계 최대 시간이 `15.561초 → 1.067초`, Analytics 조회 p95가 `1,217.847ms → 5.248ms`로 감소했다. 여섯 개 핵심 집계 지표의 exact parity도 확인했다.

## 7. 아직 증명하지 않은 것

- 운영 EC2에서 minute mode를 켠 뒤 같은 300 RPS × 10분을 재실행한 결과
- 요청 적재, Rollup worker, Dashboard/Analytics 동시 조회 상태의 PostgreSQL CPU와 I/O
- Tenant Chat까지 합친 전체 tenant 범위의 대량 parity
- late correction과 bucket 이동이 많은 데이터의 장시간 soak
- 여러 Control Plane worker가 동시에 minute queue를 처리할 때의 처리량
- 장기간 보관 데이터에 월 파티셔닝과 retention을 함께 적용한 효과
- 모델 종류가 50개를 넘는 high-cardinality breakdown의 운영 분포

## 8. 운영 적용 완료 기준

1. additive migration 배포 후 기존 `legacy/raw` 모드에서 health 확인
2. Control Plane만 `shadow`로 전환하고 minute dirty queue와 error를 관찰
3. tenant별 raw/hour/minute 정합성 비교
4. 한 시간 단위 이하로 제한한 backfill과 cursor catch-up, dirty bucket 0 확인
5. Control Plane을 `minute`으로 전환한 뒤 parent hour/day/month parity 확인
6. Gateway Policy Impact reader를 `rollup`으로 canary 전환
7. 50 RPS smoke 후 단계적으로 100/200/300 RPS × 10분 재시험
8. 요청 성공률뿐 아니라 DB CPU, active query, cursor lag, dirty queue, Dashboard p95, 부하 종료 후 회복 시간을 함께 기록
9. 이상 시 reader를 `raw`, builder를 `legacy`로 되돌리고 기존 Rollup과 원본 로그를 보존

운영 재시험이 끝나기 전 발표에서는 “로컬 동일 데이터셋에서 구조 개선 효과와 exact parity를 확인했다”고 표현한다. “운영 300 RPS에서 Dashboard까지 해결됐다”는 표현은 사용하지 않는다.

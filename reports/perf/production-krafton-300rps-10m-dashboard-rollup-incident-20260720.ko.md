# 운영 300 RPS × 10분 이후 Dashboard Rollup DB 포화 보고서

## 1. 결론

Krafton 전용 Mock Application에 `300 RPS`를 약 10분간 전달한 뒤, 요청 경로와 Dashboard 후처리 경로가 서로 다른 한계를 가진다는 문제가 확인됐다.

- 요청 로그 기준으로 `180,001건`이 모두 `success / HTTP 200 / provider=mock / model=mock-balanced / cache=miss`로 기록됐다.
- 그러나 부하가 끝난 뒤에도 Data 호스트의 PostgreSQL이 최대 두 vCPU를 사실상 모두 사용했고, Dashboard 화면도 느려졌다.
- 원인은 단순히 Gateway가 요청을 처리하지 못한 것이 아니었다. 실패한 hour Rollup 재시도와 Dashboard의 1초 주기 다중 조회가 같은 원본 로그 테이블을 동시에 읽으면서 공유 PostgreSQL을 포화시켰다.
- Dashboard를 닫고 Gateway의 장기 조회를 정리하자 PostgreSQL CPU가 약 `200%`에서 `100%`로 감소했다. 남은 Rollup 작업을 일시 중지하자 `100.24%`에서 `0.07% → 0.06% → 0.29%`로 내려갔다.
- 복구 뒤 Control Plane, 두 Gateway, private NLB, 공개 Web과 Chat의 상태를 다시 확인했다.

따라서 이 시험은 “300 RPS 요청 경로가 Mock 조건에서 10분 동안 로그를 남겼다”는 근거다. Dashboard 집계까지 포함한 운영 end-to-end 용량이 300 RPS라고 주장할 근거는 아니다.

## 2. 시험 조건과 요청 경로

- 실행 시각: 2026-07-20 21:37:21~21:47:21 KST
- 목표 부하: `300 RPS`
- 지속 시간: 약 `10분`
- 경로: 전용 Loadgen → private NLB `:8080` → Gateway 2대 → 운영 Data/AI/PII 구성 → private Mock Provider
- Gateway 이미지 태그: `gatelm/gateway-core:production-distributed-23c6e6d847de`
- Control Plane 이미지 태그: `gatelm/control-plane-api:production-distributed-23c6e6d847de`
- Data 호스트: `m7i.large`, 2 vCPU
- Mock Provider 지연: 고정 `100ms`
- 대상: 운영 사용자 설정과 분리된 Krafton 전용 Mock Project/Application

Mock Provider를 사용했기 때문에 OpenAI 등 외부 LLM Provider 호출 비용은 발생하지 않았다. EC2, NLB, PostgreSQL 저장 공간과 같은 AWS 인프라 비용은 발생한다.

고정 100ms Mock 결과는 실제 Provider의 분산, rate limit, 긴 tail latency를 재현하지 않는다. 이 시험의 목적은 운영 내부 경로와 후처리 파이프라인의 용량을 확인하는 것이다.

## 3. 요청 경로에서 확인한 결과

DB에 기록된 해당 부하 구간의 결과는 다음과 같다.

| 항목 | 결과 |
|---|---:|
| 요청 로그 | 180,001건 |
| 성공 / HTTP 200 | 180,001건 |
| Provider / Model | `mock` / `mock-balanced` |
| Cache | `miss` |
| 평균 지연시간 | 169.6ms |
| p50 | 169ms |
| p95 | 205ms |
| p99 | 245ms |
| 최대 | 467ms |

이 지연시간은 PostgreSQL에 기록된 Gateway 요청 로그 기준이다. 이번 10분 실행의 k6 summary 파일은 보존되지 않았으므로 k6 클라이언트 관점의 dropped iteration, HTTP 실패율, p95·p99로 대체해서 표현하면 안 된다.

## 4. 장애 현상

부하 종료 후 다음 현상이 지속됐다.

- Data EC2 CPU가 거의 100%에서 내려오지 않음
- PostgreSQL 컨테이너 CPU가 약 `190~199%`
- Dashboard 진입 시 화면 지연 또는 오류
- `p0_llm_invocation_logs`에 약 `296,498행`
- 해당 relation 총 크기 약 `1.55GB`
  - base table 약 `214MB`
  - index 약 `145MB`
  - 나머지 대부분은 TOAST 영역

한 시점에는 활성 DB 쿼리가 약 40개였고, Gateway 두 호스트에서 들어온 로그·집계 SELECT가 18개까지 겹쳤다. 일부 쿼리는 수백 초 동안 종료되지 않았다.

동시에 Dashboard Rollup 상태는 정상적으로 따라오지 못했다.

- `project_application` cursor: 약 `2026-07-20 10:55:06 UTC`
- 마지막 discovery 확인 시각: 약 `2026-07-20 13:24 UTC`
- 실패한 dirty hour bucket: `2026-07-20 10:00:00 UTC`
- 재시도 횟수: 최대 45회 관측
- 상태: error

앞선 400 RPS 시험 종료 직후에도 같은 bucket의 `ROLLUP_REBUILD_FAILED`와 12회 재시도가 확인됐다. 즉 10분 시험이 처음 오류를 만든 것으로 단정할 수는 없다. 이미 실패한 Rollup backlog가 있는 상태에서 180,001건의 로그가 추가되고 Dashboard 조회가 겹치면서 DB 포화가 더 크게 드러났다.

## 5. 원인 분석

문제 흐름은 다음과 같다.

```text
고속 요청으로 원본 로그 증가
→ hour Rollup rebuild 실패 및 cursor 지연
→ 완전한 Rollup coverage를 확보하지 못함
→ Dashboard가 1초마다 snapshot 요청
→ snapshot 한 번이 overview·cost·live requests·month-to-date 조회로 분기
→ Gateway가 부족한 구간을 p0_llm_invocation_logs에서 직접 집계
→ Rollup 재시도와 Dashboard raw 조회가 같은 PostgreSQL CPU·I/O를 경쟁
→ Dashboard 지연과 Data 호스트 포화
```

코드와 운영 쿼리에서 확인한 근거는 다음과 같다.

1. Web의 Dashboard snapshot poll 간격은 `1,000ms`다.
2. snapshot route는 overview, cost, live requests, month-to-date 등 여러 조회를 병렬 실행한다.
3. Gateway는 Rollup coverage가 완전하지 않으면 Rollup 결과를 사용하지 않고 원본 로그 집계 경로로 돌아간다.
4. Rollup bucket rebuild transaction timeout은 60초다.
5. 실패한 bucket은 최대 300초의 exponential backoff로 다시 시도한다.
6. 활성 Rollup 쿼리의 relation lock을 확인한 결과:
   - `p0_llm_invocation_logs`: `AccessShareLock`
   - `dashboard_rollup_bucket_states`, `dashboard_rollup_dimensions`, `dashboard_rollup_totals`, `employee_usage_rollups`: `RowExclusiveLock`

따라서 요청 처리량, 원본 로그 적재 처리량, Dashboard 집계 처리량을 하나의 “성공 RPS”로 묶으면 병목을 놓치게 된다.

### 실패 버킷 쿼리 프로파일

Rollup을 끈 상태에서 실패 버킷을 읽기 전용·단일 DB worker·최대 15~20초 조건으로 분리 측정했다. 이 버킷은 Krafton 부하가 아니라 이전 `GateLM Production Performance Mock` 테넌트의 `2026-07-20 10:00 UTC` hour bucket이었다. 따라서 worker를 기존 설정 그대로 켜면 이 버킷을 먼저 재시도한 뒤, 아직 discovery되지 않은 Krafton 180,001건을 추가로 처리해야 하는 상태였다.

| 항목 | 측정값 |
|---|---:|
| 실패 버킷 원본 로그 | 37,886건 |
| 분당 최대 로그 | 11,999건 |
| 행별 metadata 크기 | 평균 3,518B / 최대 3,545B |
| 기존 실행계획의 light 차원 집계 | 13,209.823ms |
| 기존 차원 확장 결과 | 303,088행 |
| 기존 차원 정렬 임시 디스크 | 72,680kB |
| `MATERIALIZED` 적용 light 차원 집계 | 3,289.948ms |
| `MATERIALIZED` 적용 실제 histogram 차원 집계 | 5,341.990ms |

기존 쿼리는 source row를 8개 dimension으로 확장하는 동안 큰 JSON 표현식을 반복 평가하고, 30만 건이 넘는 중간 결과를 external merge sort했다. `filtered` CTE를 materialize해 JSON 파싱을 source row당 한 번으로 제한하자 light 비교 시간이 약 `75.1%` 감소했고, 실제 histogram을 포함한 읽기 전용 집계도 20초 제한 안에서 완료됐다. 결과값의 의미나 table schema를 바꾸지 않은 실행계획 최적화다.

이 수치는 우선 37,886건 버킷의 읽기 전용 프로파일이었다. 이후 패치를 운영에 배포하고 Rollup worker는 비활성화한 채 단일 버킷 실행으로 82,123건과 180,008건 hour bucket도 별도로 검증했다. 이는 단일 집계가 60초 제한 안에 완료된다는 근거이며, Dashboard 동시 조회 조건까지 안전하다는 증거는 아니다.

### 배포 후 제한된 backlog 복구 검증

`filtered AS MATERIALIZED` 패치는 main SHA `d2a06ab3d9922028c21ac3155d172a628cd03e2c`로 배포했고 공개 인증 경계와 인증 Tenant Chat 실행 스모크를 통과했다. 상시 Rollup은 계속 끈 상태에서 discovery backlog를 읽기 전용으로 계산했다.

| 항목 | 결과 |
|---|---:|
| 미발견 원본 로그 | 274,083건 |
| 압축된 hour / day / month bucket | 3 / 2 / 2 |
| 기존 실패 37,886건 hour bucket | 7.857초, `error → ready` |
| 82,123건 hour bucket | 17.105초, 성공 |
| 180,008건 hour bucket | 36.852초, 성공 |
| 82,123건 처리 후 PostgreSQL | CPU 2.03%, 활성 쿼리 0건 |
| 180,008건 처리 후 PostgreSQL | CPU 4.11%, 활성 쿼리 0건 |

원본 274,083행은 수정하거나 삭제하지 않았다. cursor/dirty queue 상태를 SHA-256과 함께 별도 백업한 뒤, 같은 트랜잭션을 먼저 `ROLLBACK`으로 예행연습했다. 실제 반영에서는 로그를 tenant·UTC hour/day/month 기준 7개 dirty bucket으로 압축하고 source cursor만 마지막 수집 지점으로 이동했다. 각 bucket은 `DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE=1`인 일회성 Control Plane process로 하나씩 실행했다.

이 과정에서 source timestamp 정밀도 결함도 확인했다. PostgreSQL `timestamptz`의 `2026-07-20 12:47:21.705353+00`가 Node `Date`를 거치면서 `...21.705+00`로 잘렸고, 마지막 2개 로그가 매 실행마다 다시 discovery됐다. 그 결과 이미 완료한 180,008건 hour bucket이 다시 dirty queue에 들어갈 수 있었다. cursor와 source timestamp를 DB 문자열로 전달하고 SQL 내부에서만 `timestamptz`로 캐스팅하도록 수정했으며, Project/Application과 Tenant Chat 양쪽 경로에 마이크로초 회귀 테스트를 추가했다.

정밀도 패치는 main SHA `6e28c03235fb9ba86a352ebecf11635168d140f0`로 배포됐다. 새 코드의 첫 일회성 실행은 구버전이 잘라 둔 tail 2건과 배포 스모크에서 새로 생긴 Tenant Chat 로그 1건을 발견했다. 이때 Project/Application cursor는 원본과 동일한 `2026-07-20 12:47:21.705353+00`까지 이동했다. 다음 실행부터 `discovered=0`으로 수렴했고, 이후 모든 수동 복구 실행에서도 같은 값이 유지됐다.

정밀도 결함 때문에 한 번 다시 enqueue된 180,008건 hour bucket은 37.353초에 완료됐다. 직후 PostgreSQL CPU는 0.19%, active query는 0건이었다. 남은 상위 bucket 6개는 각각 0.403~0.431초에 처리됐고, 마지막 실행은 `aggregated=0 / discovered=0`이었다. 최종 dirty bucket은 0개이며 모든 기록된 bucket state는 `ready`다.

## 6. 진단 과정

### 시도 1: Dashboard를 닫고 조회 부하 분리

Dashboard를 닫은 뒤 Gateway 호스트에서 들어오는 원본 로그 조회가 0건으로 내려갔다. 장기 실행 중이던 Gateway SELECT 중 정확히 식별된 1개는 `pg_cancel_backend`로 취소했고 나머지는 자연 종료했다.

결과:

- PostgreSQL 컨테이너 CPU: 약 `200% → 100%`
- Gateway 원본 로그 조회: `18개 → 0개`

이 결과로 포화의 약 절반은 Dashboard 조회 경로가 증폭한 부하임을 분리했다. 다만 CPU 한 코어는 계속 점유됐다.

### 시도 2: 남은 쿼리의 relation lock 확인

남은 활성 쿼리는 Control Plane 컨테이너가 있는 `172.18.0.1`에서 시작됐고, 원본 로그를 읽으면서 Rollup 테이블들을 쓰고 있었다. 쿼리 fingerprint가 바뀌어도 같은 relation 조합을 반복해서 잠갔다.

결과:

- 남은 약 `100%` CPU의 주체를 Dashboard Rollup worker로 특정
- cursor가 거의 진행하지 못한 채 같은 dirty bucket을 재시도하고 있음을 확인

### 시도 3: Rollup worker만 일시 중지

다음 순서로 운영 영향을 최소화했다.

1. 운영 Compose label에서 실제 config와 env-file 경로를 확인
2. `.env.production-distributed.base`를 별도 파일로 백업하고 SHA-256 일치 확인
3. `DASHBOARD_ROLLUP_ENABLED=false` 한 줄만 변경
4. relation lock 조건으로 Rollup backend를 1개만 식별하고 취소
5. PostgreSQL과 Redis는 유지한 채 `control-plane-api`만 강제 재생성
6. 새 컨테이너 환경값과 health check 확인

취소 SQL은 원본 로그를 읽고 Rollup table에 쓰기 lock을 가진 로컬 Control Plane backend가 정확히 1개일 때만 동작하도록 제한했다. 실제 결과는 `candidate=1 / canceled=1`이었다.

## 7. 복구 결과

### PostgreSQL과 Control Plane

| 시점 | PostgreSQL CPU | Control Plane CPU | 활성 전체 / Rollup / Gateway raw 조회 |
|---|---:|---:|---:|
| 조치 직전 | 100.24% | 0.19% | Rollup 1개 확인 |
| 조치 직후 | 0.07% | 0.14% | 0 / 0 / 0 |
| 15초 후 | 0.06% | 0.14% | 0 / 0 / 0 |
| 45초 후 | 0.29% | 0.14% | 0 / 0 / 0 |
| 추가 확인 | 0.06% | 0.14% | Rollup 관련 query 없음 |

- Control Plane: `running / healthy / restart count 0`
- Rollup 설정: `DASHBOARD_ROLLUP_ENABLED=false`
- 운영 env 백업:
  - `/home/ubuntu/gatelm-production-orchestration/.env.production-distributed.base.pre-rollup-disable-20260720T133722Z.bak`
  - SHA-256: `dbfc9507adb5aae83ab36bdd8baf5274ab2e1877735d481a3bae8a9d2d8f8000`

### 정밀도 패치 배포와 상시 worker 재가동

backlog와 중복 enqueue를 모두 비운 뒤 환경 파일을 다시 백업하고 Control Plane만 재생성했다. 기존 1초 주기와 bucket batch 8을 그대로 복원하지 않고 다음 값으로 제한했다.

| 설정 | 운영값 |
|---|---:|
| `DASHBOARD_ROLLUP_ENABLED` | `true` |
| `DASHBOARD_ROLLUP_INTERVAL_MS` | `60000` |
| `DASHBOARD_ROLLUP_DISCOVERY_BATCH_SIZE` | `500` |
| `DASHBOARD_ROLLUP_BUCKET_BATCH_SIZE` | `1` |
| `DASHBOARD_ROLLUP_DISCOVERY_LAG_MS` | `60000` |
| `DASHBOARD_ROLLUP_RECONCILIATION_INTERVAL_MS` | `3600000` |
| `DASHBOARD_ROLLUP_RECONCILIATION_LOOKBACK_MS` | `900000` |

- 재가동 전 환경 백업: `/home/ubuntu/gatelm-production-orchestration/.production-distributed-state/rollup-reenable-20260720T1705Z/env-before`
- 백업 SHA-256: `a1b6507e4f7ac0d71e8d9a93a0f3bbe58901499c0bb02f5f56246fc839eec328`
- 재가동 직후: dirty bucket 0, PostgreSQL CPU 4.55%, active query 0건
- 첫 60초 자동 주기 이후: dirty bucket 0, PostgreSQL CPU 0.08%, active query 0건
- Control Plane: `running / healthy`, 이미지 `production-distributed-6e28c03235fb`

### 요청 경로

- private NLB `/readyz`: `ready`
- 필수 의존성: Control Plane, Mock Provider, PostgreSQL, PostgreSQL log, Redis 모두 `ok`
- NLB target group `:8080`: Gateway 2대 모두 `healthy`
- NLB target group `:8081`: Gateway 2대 모두 `healthy`
- 두 Gateway 컨테이너: `running / healthy / restart count 0`
- 공개 Web: HTTP `200`, 약 `62.8ms`
- 공개 Chat: HTTP `200`, 약 `51.3ms`

Data 호스트에서 private NLB로 직접 보낸 진단 요청은 timeout이었지만, 실제 허용된 Loadgen 경로에서는 성공했다. NLB target 상태와 두 Gateway의 컨테이너 health도 별도로 확인했으므로 서비스 장애로 판정하지 않았다.

## 8. 현재 운영 상태와 주의사항

정밀도 패치와 backlog 복구를 마친 뒤 Rollup worker는 보수적인 설정으로 다시 활성화됐다.

- dirty bucket은 0개이며 source cursor는 반복 실행에서 `discovered=0`으로 수렴했다.
- Control Plane, 공개 Web·Chat, 무인증 Gateway·Chat 경계가 재가동 뒤 정상임을 확인했다.
- 기존 Rollup env와 재가동 직전 env 백업은 Data 호스트에 보존했다.
- 전용 Loadgen EC2는 사용자의 요청대로 실행 상태를 유지했지만, 활성 k6 프로세스는 없다.
- 현재 설정은 장애 재발 가능성을 낮춘 운영 완화책이다. Dashboard의 1초 polling, raw full-range fallback, hour 전체 재계산 구조는 아직 남아 있으므로 같은 조건의 300 RPS end-to-end 재시험 없이 무제한 용량을 주장하면 안 된다.

## 9. 영구 개선안

다음 개선은 별도 코드·계약 검토와 재시험이 필요하다.

1. 적재 시 Dashboard에 필요한 tenant, provider, model, status, cache, latency 구간을 정규화해 3.5KB metadata JSON을 집계 때마다 다시 파싱하지 않는다.
2. 원본 로그를 작은 batch로 소비해 minute aggregate를 증분 갱신하고, hour/day/month는 minute 결과를 병합한다. 늦게 들어오거나 정정된 로그도 해당 minute만 다시 계산한다.
3. Rollup이 지연됐을 때 전체 기간 raw 집계로 돌아가지 않고 마지막 정상 aggregate, 제한된 최신 tail, freshness·stale·partial 상태를 반환한다.
4. live requests와 느린 aggregate snapshot을 분리하고 5~30초 cache와 동일 요청 coalescing을 적용한다.
5. Dashboard poll을 1초 고정에서 더 긴 주기 또는 화면 visibility 기반 adaptive polling으로 변경한다.
6. Dashboard와 Rollup 쿼리에 statement timeout, 동시 실행 상한, tenant별 공정성, DB 자원 budget을 둔다.
7. 실패한 bucket의 실제 오류 분류, 처리 행 수, 실행 시간을 저장하고 자동 재시도 횟수에 상한을 둔다.
8. 원본 로그를 시간 기준 partition으로 나누고 보존 기간·archive 정책을 적용한다. 대량 synthetic 로그는 운영 데이터와 분리한다.
9. 성능 시험 완료 조건에 아래 항목을 추가한다.
   - k6 요청 종료
   - 비동기 로그 queue drain
   - DB 로그 건수 일치
   - Rollup cursor catch-up
   - dirty bucket 0
   - Dashboard snapshot p95와 DB CPU 회복

단기 복구 패치는 `filtered AS MATERIALIZED`로 동일 source row의 큰 JSON을 차원별로 반복 해석하지 않게 한다. 장기적으로는 source cursor를 작은 batch로 소비해 minute aggregate를 증분 갱신하고, 지연·정정 데이터만 작은 minute bucket으로 재계산해야 한다. Dashboard는 완전한 Rollup이 없더라도 전체 기간 raw scan으로 돌아가지 않고 마지막 정상 aggregate와 제한된 최신 tail, freshness 상태를 반환해야 한다.

## 10. 기술적 챌린지 정리

### 문제

Gateway 요청은 성공했지만, 동일한 로그를 사용하는 Dashboard 집계·조회 파이프라인이 부하를 따라가지 못해 서비스 화면과 공유 DB를 포화시켰다.

### 시도

Dashboard 조회, Gateway 장기 SELECT, Rollup worker를 단계별로 분리했고, DB session·relation lock·cursor·dirty bucket을 함께 관측해 CPU 점유 주체를 좁혔다.

### 해결

원본 env를 검증 가능한 형태로 백업한 뒤 실패한 Rollup worker만 일시 중지하고, 정확히 한 개의 Rollup transaction만 취소했다. 반복 JSON 평가를 막는 `MATERIALIZED` 쿼리와 마이크로초 cursor 보존 패치를 배포한 뒤 274,083행 backlog를 bucket 단위로 복구했다. dirty queue가 0이고 반복 discovery가 0인 상태에서 Control Plane만 보수적인 Rollup 설정으로 재가동했다.

### 정량 결과

PostgreSQL CPU는 `100.24%`에서 45초 후 `0.29%`로 감소했다. 가장 큰 180,008행 hour bucket은 37.353초에 완료됐고 직후 CPU는 0.19%, active query는 0건이었다. 최종 `aggregated=0 / discovered=0`, dirty bucket 0을 확인했으며 상시 worker의 첫 60초 주기 이후 CPU는 0.08%였다. 공개 Web·Chat과 인증 경계도 정상 상태를 유지했다.

### 한계

현재 패치는 측정된 backlog를 안전하게 처리하고 cursor 재발견을 막았지만 무제한 규모를 보장하지 않는다. hour 전체 재계산, 1초 polling fan-out, raw full-range fallback, 큰 JSON 파싱, 공유 DB query budget 부재는 남아 있다. minute 증분 집계와 bounded fallback 구조를 구현한 뒤 동일한 10분 시험으로 Dashboard까지 다시 검증해야 한다.

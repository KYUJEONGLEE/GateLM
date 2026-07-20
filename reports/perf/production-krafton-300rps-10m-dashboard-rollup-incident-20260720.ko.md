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

다만 이 수치는 37,886건 버킷의 단독 집계 결과다. Krafton 180,001건 hour bucket과 dashboard 동시 조회 조건을 통과했다는 증거는 아니며, 배포 후 낮은 Rollup 동시성으로 backlog를 순차 처리하면서 별도로 확인해야 한다.

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

이번 조치는 장애 확산을 막기 위한 임시 containment다. 영구 해결은 아니다.

- Rollup worker는 현재 비활성화돼 있어 새 집계 bucket을 만들지 않는다.
- Rollup coverage가 불완전한 상태에서 Dashboard를 다시 열면 1초 주기의 raw 조회가 재발할 수 있다.
- 코드 수정과 재배포가 끝나기 전까지 운영 Dashboard를 장시간 열어 두거나 새 부하 시험을 실행하면 안 된다.
- 기존 Rollup env 백업은 복구 검증이 끝난 상태로 Data 호스트에 보존했다.
- 전용 Loadgen EC2는 사용자의 요청대로 실행 상태를 유지했지만, 활성 k6 프로세스는 없다.

## 9. 영구 개선안

다음 개선은 별도 코드·계약 검토와 재시험이 필요하다.

1. live requests와 느린 aggregate snapshot을 분리한다.
2. Rollup이 지연됐을 때 전체 기간 raw 집계 대신 마지막 정상 Rollup과 freshness 상태를 반환한다.
3. Dashboard poll을 1초 고정에서 더 긴 주기 또는 화면 visibility 기반 adaptive polling으로 변경한다.
4. Dashboard raw query에 statement timeout과 동시 실행 상한을 둔다.
5. Rollup backfill을 더 작은 시간 구간으로 나누고, 실패한 bucket의 실제 DB error와 처리 행 수를 보존한다.
6. 대량 synthetic 로그에는 보존 기간, partition 또는 운영 데이터와 분리된 성능 DB를 적용한다.
7. 성능 시험 완료 조건에 아래 항목을 추가한다.
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

원본 env를 검증 가능한 형태로 백업한 뒤 실패한 Rollup worker만 일시 중지하고, 정확히 한 개의 Rollup transaction만 취소했다. Control Plane만 재생성해 요청 경로와 데이터 저장소는 유지했다.

### 정량 결과

PostgreSQL CPU는 `100.24%`에서 45초 후 `0.29%`로 감소했고 Rollup·Gateway raw query는 모두 0건이 됐다. 공개 Web·Chat과 두 Gateway의 NLB health는 정상 상태를 유지했다.

### 한계

현재는 집계를 중단한 임시 복구다. Dashboard를 안전하게 다시 사용하려면 raw fallback 범위, polling 주기, query budget, Rollup backfill 전략을 코드 수준에서 개선하고 동일한 10분 시험으로 재검증해야 한다.

# PostgreSQL 월 단위 Request Log 파티션 전환 Smoke 보고서

## 1. 목적

`p0_llm_invocation_logs`를 UTC `created_at` 기준 월 단위 range partition으로
전환할 수 있는지 검증한다. 단순 DDL 성공이 아니라 다음 조건을 함께 확인한다.

- 기존 로그와 신규 파티션 로그의 전체 행 정합성
- `request_id` 전역 중복 방지
- 월 경계 요청 라우팅
- 범위 조회의 partition pruning
- 전환 후 기존 AWS 반복 migration 호환성
- 운영 장애 당시와 유사한 18만 건 규모에서의 전환 시간

## 2. 검증 환경

| 항목 | 값 |
|---|---|
| 기준 브랜치 | `feat/postgres-monthly-log-partitions` |
| 기준 base | `origin/dev` `c83921c89` |
| 검증일 | 2026-07-21 |
| PostgreSQL | PostgreSQL 16, `pgvector/pgvector:0.8.5-pg16-trixie` |
| 컨테이너 런타임 | Docker 29.2.1 |
| migration 경로 | 운영용 `deploy/aws-triage/migrations` |
| 검증 스크립트 | `scripts/dev/p0-monthly-partitioning-smoke.ps1` |

이 결과는 로컬 임시 PostgreSQL 컨테이너에서 얻었다. 운영 EC2, 운영 EBS,
운영 동시 트래픽 결과가 아니다.

## 3. 데이터셋

- 월 경계 fixture 2건: 2026년 6월 말, 2026년 7월 초
- 합성 로그 180,000건: 2026년 7월
- 각 합성 metadata에는 약 3.6KB의 비압축성 난수 padding 사용
- 전환 직전 총 로그: 180,002건
- 전환 후 신규 9월 로그 1건 추가
- 동일한 `request_id`를 다른 ID와 8월 timestamp로 다시 삽입해 중복 방지 확인

raw prompt, raw response, credential, 개인정보는 합성 데이터에 포함하지 않았다.

## 4. 수행 흐름

1. Prisma migration과 운영용 Gateway SQL 적용
2. 기존 unpartitioned 로그 180,002건 생성
3. Stage A 실행
   - `p0_llm_invocation_log_keys` 생성 및 backfill
   - legacy insert key-capture trigger 설치
   - 반복 migration 완료 marker 기록
4. Stage B 실행
   - retained month별 shadow partition 생성
   - legacy 변경 mirror trigger 설치
   - 전체 로그 복사와 JSON 전체 행 비교
   - 짧은 최종 lock 안에서 delta 및 key parity 재검증
   - legacy heap을 backup 이름으로 보존하고 relation 이름 교체
   - partitioned parent에 전역 request-key claim trigger 설치
5. 월 경계 신규·중복 삽입
6. 기존 운영용 migration 재실행
7. 7월 범위 `EXPLAIN`으로 pruning 확인

## 5. 결과

| 지표 | 결과 |
|---|---:|
| Stage A 실행시간 | 2.988초 |
| Stage B 전체 실행시간 | 31.020초 |
| 전환 전 legacy 로그 | 180,002건 |
| 전환 직후 보존된 legacy backup | 180,002건 |
| 신규 9월 로그 포함 partitioned 로그 | 180,003건 |
| global key registry | 180,003건 |
| 동일 `request_id`의 월 경계 중복 | 최종 1건 |
| 생성된 자식 relation | 5개 |
| 운영용 migration 재실행 | 성공 |

자식 relation은 2026년 6월, 7월, 8월, 9월과 default partition이다.
9월 신규 로그는 `p0_llm_invocation_logs_y202609`로 라우팅됐다.

7월 범위 실행계획에는 다음 자식만 남았다.

```text
Parallel Seq Scan on p0_llm_invocation_logs_y202607
```

6월, 8월, default partition은 해당 실행계획에서 제거됐다.

## 6. 해석

이번 결과는 다음을 증명한다.

- 현재 schema를 월 단위 native partition으로 변환할 수 있다.
- 별도 global key registry로 기존 `request_id` 전역 멱등성을 보존할 수 있다.
- 기존 운영 bootstrap과 Rollup index migration을 파티션 전환 후 다시 실행할 수 있다.
- `created_at` 범위가 있는 조회에서 불필요한 월 partition을 pruning한다.

하지만 월 파티셔닝만으로 현재 약 2.9초인 정책 영향 분석 API가 크게 빨라졌다고
주장할 수는 없다. 테스트의 180,000건이 모두 7월에 있으므로 7월 조회는 해당
partition의 180,000건을 여전히 계산한다. JSON 정책 집계 자체의 비용은 Rollup 또는
정규화된 정책 read model로 별도 해결해야 한다.

## 7. 아직 증명하지 못한 항목

- 운영 EC2와 EBS에서의 Stage A/Stage B 실행시간
- 실제 Gateway 두 대가 쓰는 동안 mirror trigger가 유실 없이 동작하는지
- 전환 중 write p95/p99와 PostgreSQL CPU·WAL 증가량
- shadow와 legacy backup이 공존하는 동안의 실제 디스크 증폭
- 전환 후 운영 Dashboard·Analytics HTTP latency 변화
- 새 로그가 들어온 이후의 DB-level rollback 절차
- default partition에 이미 row가 들어간 경우의 복구 절차

따라서 이 결과는 로컬 구조·정합성 smoke evidence이며 production-ready 또는
무중단 운영 전환 완료 증거가 아니다.

## 8. 운영 적용 전 다음 검증

1. Stage A만 먼저 배포하고 두 Gateway의 writer SHA와 log-write 오류율 확인
2. 운영 dump 복제본에서 실제 row 수·table size로 Stage B rehearsal
3. rehearsal 중 동시 Mock write를 유지하고 누락·중복·write latency 측정
4. 전환 직전 DB backup과 disk free-space 기준 확정
5. application rollback이 Stage A 이전 writer로 내려가지 않도록 배포 하한선 설정
6. 운영 전환 후 Request Log, Dashboard Rollup, Analytics, 비용 원장 smoke 수행

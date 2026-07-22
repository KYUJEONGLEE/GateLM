# Tenant Chat 개인별 Token Quota 트랜잭션 경합 개선 보고서

기준일: 2026-07-21
검증 브랜치: `codex/quota-contention-probe`
최종 제품 코드 상태: `b4bbb1d4` (`pgx.Batch` 후보 revert 포함)

최종 판정: **PostgreSQL을 정합성 원본으로 유지하면서 중복된 Tenant cost advisory lock을 제거해 동일 Tenant 시나리오의 처리량을 49.5% 개선했다. 다만 Begin p95는 악화됐고 cost period 행 직렬화가 남았으므로, 처리량 개선으로만 채택한다.**

## 1. 먼저 분리해야 하는 세 가지 제한

초기 논의에서는 서로 다른 기능이 모두 Rate Limit으로 불렸다. 실제 구현과 목적은 다음처럼 구분해야 한다.

| 개념 | 예시 | 목적 | 정합성 원본 |
|---|---|---|---|
| Request Rate Limit | 사용자당 1분에 60회 | 순간 요청 폭주 방지 | 짧은 수명의 Redis counter |
| Provider Token Rate Limit | Tenant·Provider당 1분에 12만 토큰 | Provider 처리량 보호 | 짧은 수명의 Redis weighted counter |
| Personal Token Usage Quota | 직원당 주간 100만 토큰 | 개인별 누적 비용 통제 | PostgreSQL reservation·period·ledger |

기존 Project/Application Rate Limit을 PostgreSQL fixed window에서 Redis token bucket과 Lua로 개선한 작업은 첫 번째 문제에 해당한다. 이 문서의 주제는 Tenant Chat의 세 번째 문제이며, 기존 Redis/Lua 작업을 개인별 Quota 개선으로 다시 포장하지 않는다.

## 2. 왜 개인별 Quota를 Redis counter로 옮기지 않았는가

Request Rate Limit은 일정 시간이 지나면 버려도 되는 순간 카운터다. 반면 개인별 Token Quota는 Provider 호출 전 예약과 호출 후 실제 사용량 정산을 연결해야 한다.

Tenant Chat의 한 요청은 다음 상태를 남긴다.

```text
예상 토큰·비용 예약
-> Provider attempt 기록
-> 실제 토큰·비용 확정 또는 미확정 처리
-> reservation/period/ledger/outbox를 같은 transaction에서 정산
-> 중복 요청은 같은 ledger version으로 replay
```

이 경로에서는 다음 조건이 필요하다.

- 사용자 월간, 직원 주간, Tenant 비용 한도를 동시에 넘지 않아야 한다.
- fallback은 최초 예약에 추가 노출량을 더해 다시 검사해야 한다.
- Provider 결과를 알 수 없는 경우 예약량을 임의로 반환하지 않고 unconfirmed 상태로 남겨야 한다.
- 재시도나 중복 receipt가 같은 사용량을 두 번 정산하면 안 된다.
- 비용 기록은 이후 감사와 복구에 사용할 수 있어야 한다.

따라서 PostgreSQL reservation과 ledger를 정합성 원본으로 유지했다. Redis를 추가하더라도 이 내구성과 원자성 문제는 사라지지 않으며, 이중 쓰기와 복구 규칙이 새로 필요하다.

## 3. 문제와 가설

Tenant Chat에 개인별 누적 토큰 Quota가 들어오면서 한 요청은 사용자 period뿐 아니라 직원 주간 period와 Tenant cost period까지 갱신하게 됐다. 여기서 “사용자 row가 많아져 메모리를 많이 사용한다”는 가설을 먼저 결론으로 삼지 않았다.

실제 PostgreSQL 경로를 측정한 결과, 같은 Tenant의 서로 다른 직원 요청도 하나의 `tenant_chat_tenant_cost_periods` 행을 공유했다. 당시 transaction은 이 행의 `FOR UPDATE` 외에도 `tenant-chat-cost:<tenantID>` advisory lock을 먼저 획득했다.

가설은 다음과 같았다.

> Tenant 비용 정합성은 이미 cost period 행 잠금으로 직렬화된다. transaction 초반의 Tenant cost advisory lock은 정합성을 더 강화하지 않고, 잠금 대기 구간만 넓히는 중복 lock일 수 있다.

## 4. 측정 방법

실제 `BeginExecution -> FinalizeConfirmed` PostgreSQL 흐름을 호출하는 전용 probe를 사용했다. 장시간 probe는 명시적인 환경변수 없이는 skip되며, 전용 로컬 DB 이외의 `TEST_DATABASE_URL`은 거부한다.

| 항목 | 조건 |
|---|---|
| PostgreSQL | 16.14 |
| Go | 1.26.4 |
| OS | Windows |
| workload pool | 16 connections |
| observer pool | 별도 pool |
| 작업 수 | 시나리오·동시성별 1,000회 |
| 반복 | 3회 |
| 동시성 | 1, 4, 8, 16, 32 |
| lock sampling | 25ms |

각 actor는 period 최초 생성 비용을 제외하기 위해 사전 warm-up했다. 비교 시나리오는 다음과 같다.

| 시나리오 | 구성 | 확인하려는 것 |
|---|---|---|
| A | 1 Tenant, 동일 사용자 | 사용자·직원 단위 직렬화 |
| B | 1 Tenant, 서로 다른 직원 16명 | Tenant 공유 cost 행 경합 |
| C | Tenant 16개, 각 직원 1명 | 공유 Tenant 행이 없는 대조군 |

수집 지표는 Begin·정산 p50/p95/p99, 처리량, connection 획득 대기, advisory·non-advisory DB lock 대기, wait event, 오류와 정합성 위반이다.

## 5. 성능 최적화 전에 확인한 정합성

probe 구현 중 fallback 추가 예약이 직원 주간 한도를 검사하지 않는 버그가 재현됐다. 주간 한도 300에서 primary가 200을 예약한 뒤 fallback 200을 추가로 예약할 수 있는 경계였다.

`9329e593`에서 fallback 전에 최초 reservation에 고정된 직원 주간 period를 `FOR UPDATE`로 잠그고, 현재 `confirmed + unconfirmed + reserved + 추가 노출`을 검사하도록 수정했다. 초과 시 기존 `ErrEmployeeWeeklyTokenQuotaHardLimit`을 반환하며 fallback Provider는 호출하지 않는다.

최적화 전후 probe는 다음을 모두 확인했다.

| 검증 | 결과 |
|---|---|
| 사용자 월간 hard stop | 초과 승인 0건 |
| 직원 주간 hard stop | 초과 승인 0건 |
| Tenant 비용 hard stop | 초과 승인 0건 |
| 동일 정산 16회 동시 replay | settlement ledger 1건, confirmed 중복 0건 |
| fallback 주간 한도 우회 | 0건 |
| 혼합 reservation·settlement·receipt·reconciliation | deadlock과 합계 불일치 0건 |

`중복 정산 0건`은 성능 개선 기능이 아니라, 최적화가 기존 정합성을 훼손하지 않았다는 회귀 방지 결과다.

## 6. 채택한 변경: 중복 Tenant cost advisory lock 제거

`4b1d2fa3`에서 다음 경로의 `tenant-chat-cost:<tenantID>` advisory lock만 제거했다.

- 최초 예약
- fallback top-up
- confirmed 정산
- released·unconfirmed terminal 정산

사용자와 직원 주간 advisory lock은 유지했다. Tenant cost period의 `FOR UPDATE`, transaction 범위, reservation·ledger·outbox 순서도 유지했다. 최초 period가 없으면 기존 `INSERT ... ON CONFLICT DO NOTHING` 후 같은 행에 수렴한다.

즉 정합성 모델을 Redis로 교체한 것이 아니라, PostgreSQL 내부에서 같은 공유 자원을 두 번 잠그던 구조를 하나로 줄였다.

## 7. 채택 결과

수정 전 instrumented baseline은 `710166c9`, 수정 후 제품 코드는 `4b1d2fa3`이다. 원시 보고서 식별자는 각각 `20260720-211031`, `20260720-214416`이다.

### 동일 Tenant·직원 16명, 동시성 8

| 반복 | 수정 전 | 수정 후 | 변화 |
|---:|---:|---:|---:|
| 1 | 36.97 ops/s | 49.03 ops/s | +32.6% |
| 2 | 34.37 ops/s | 56.36 ops/s | +64.0% |
| 3 | 38.73 ops/s | 55.26 ops/s | +42.7% |

처리량 중앙값은 `36.97 -> 55.26 ops/s`, **49.5% 증가**했다. 세 반복 모두 같은 방향으로 재현됐다.

대조군 C의 동시성 8 처리량 중앙값은 `127.47 -> 132.35 ops/s`, 3.8% 증가했다. 따라서 B의 증가는 전체 환경이 일괄적으로 빨라진 결과만으로 설명되지 않는다.

첫 전체 실행에서 C의 동시성 32 회귀가 10%를 넘어서 같은 환경의 대조를 다시 수행했다. 이 대조에서 B는 `35.41 -> 49.41 ops/s`, 39.5% 증가했고 C는 `145.16 -> 134.02 ops/s`, 7.7% 감소해 회귀 허용 범위 10% 안에 들었다.

### 숨기지 않는 한계

B의 동시성 8 Begin p95 중앙값은 `154.33 -> 388.36ms`로 151.6% 악화됐다. 정산 p95는 `164.75 -> 151.59ms`로 8.0% 감소했다.

advisory 대기는 사라졌지만 전체 DB lock 대기는 남았고, wait event는 `transactionid`와 `tuple`로 이동했다. 중복 advisory lock을 제거하면서 더 많은 transaction이 실제 Tenant cost 행까지 진입해 처리량은 늘었지만, 대기열의 tail latency는 악화된 것으로 해석한다.

따라서 이 변경은 **처리량 개선**으로 채택하며 p95 개선으로 발표하지 않는다.

## 8. 채택하지 않은 변경: `pgx.Batch`

다음 가설은 잠금을 보유한 동안 발생하는 여러 client-server 왕복이 cost 행 임계 구역을 길게 만든다는 것이었다. `24187a6f`에서 최초 예약의 쓰기를 `pgx.Batch`로 묶고 focused B/C probe를 실행했다.

| 지표, 동시성 8 | 기준선 | 후보 | 변화 |
|---|---:|---:|---:|
| B Begin p95 | 406.14ms | 266.18ms | -34.5% |
| B 처리량 | 50.89 ops/s | 67.66 ops/s | +33.0% |
| C Begin p95 | 42.39ms | 30.68ms | -27.6% |
| C 처리량 | 133.24 ops/s | 162.71 ops/s | +22.1% |

B의 Begin p95는 세 반복에서 각각 43.2%, 33.5%, 35.6% 감소했고 모든 정합성 검증도 통과했다. 그러나 일반 대조군 C도 크게 개선됐으며, 핵심 residual-contention 지표인 B/C Begin p95 비율은 `9.58 -> 8.68`에 그쳤다. 사전에 정한 목표 `4.0 이하`를 충족하지 못했다.

따라서 batch는 일반 DB 왕복 비용은 줄였지만 Tenant 직렬화 병목을 충분히 해결하지 못한 것으로 판정했다. 전체 성능 매트릭스를 실행하지 않고 `b4bbb1d4`에서 revert했다.

이 결과는 실패를 숨긴 기록이 아니다. 측정 전에 채택 기준을 정하고, 수치가 일부 좋아도 해결하려던 병목이 남으면 제품 변경을 채택하지 않은 판단 근거다.

## 9. 결론과 주장 범위

이번 작업의 핵심은 Redis 자료구조를 적용했다는 것이 아니다.

1. 개인별 Token Quota에 필요한 내구성과 정합성 때문에 PostgreSQL을 원본으로 유지했다.
2. 실제 동시 부하에서 같은 Tenant의 cost accounting 경합을 재현했다.
3. PostgreSQL 행 잠금과 중복되는 advisory lock을 식별하고 제거했다.
4. 동일 Tenant 동시성 8 처리량을 49.5% 개선하면서 한도 초과, 중복 정산, deadlock을 0건으로 유지했다.
5. 남은 row-lock tail latency와 채택하지 않은 batch 실험까지 기록했다.

이 수치는 전용 로컬 PostgreSQL probe의 완료 작업 수다. 운영 HTTP RPS, 실제 Provider 용량, SLA 또는 무제한 확장성을 의미하지 않는다. 또한 Redis Hash나 Lua를 개인별 Token Quota에 적용해 메모리·시간 복잡도를 개선했다는 근거로 사용하면 안 된다.

## 10. 근거

### 구현과 테스트

- [재실행 가능한 contention probe](../../apps/gateway-core/internal/adapters/tenantchat/usage/postgres/reservation_store_contention_probe_test.go)
- [로컬 전용 실행기](../../scripts/dev/tenant-chat-quota-contention-probe.ps1)
- [Tenant cost period 잠금](../../apps/gateway-core/internal/adapters/tenantchat/usage/postgres/periods.go)
- [reservation·ledger·outbox 원자적 기록](../../apps/gateway-core/internal/adapters/tenantchat/usage/postgres/persist.go)
- [settlement period 잠금 순서](../../apps/gateway-core/internal/adapters/tenantchat/usage/postgres/settlement_store.go)
- [동시 period·혼합 경로·fallback 통합 테스트](../../apps/gateway-core/internal/adapters/tenantchat/usage/postgres/reservation_store_integration_test.go)

### 커밋

| 커밋 | 의미 | 판정 |
|---|---|---|
| `10686821` | PostgreSQL contention probe 추가 | 채택 |
| `9329e593` | fallback 직원 주간 Quota 검사 수정 | 채택 |
| `710166c9` | DB lock 관측 보완 | 채택 |
| `4b1d2fa3` | 중복 Tenant cost advisory lock 제거 | 채택 |
| `8ec13ad6` | focused B/C probe 지원 | 채택 |
| `24187a6f` | reservation persistence batch 후보 | 미채택 |
| `b4bbb1d4` | batch 후보 revert | 최종 상태 |

원시 CSV·JSON·PostgreSQL resource sample은 보안 데이터 없이 `reports/perf/tenant-chat-quota/<timestamp>/`에 생성되며 Git에서 제외된다. 이 문서에는 재검산 가능한 조건과 대표 수치를 보존한다.

## 11. 60초 발표 대본

Tenant Chat에 직원별 누적 토큰 Quota를 적용하면서 사용자, 직원 주간, Tenant 비용을 하나의 PostgreSQL transaction에서 예약하고 정산해야 했습니다. 처음에는 개인별 대상이 늘어난 것이 문제라고 예상했지만, 실제 A/B/C 동시 부하를 만들어 측정해 보니 같은 Tenant의 요청들이 공유 cost period 행에서 직렬화되고 있었습니다. 특히 이 행은 `FOR UPDATE`로 이미 보호되는데 transaction 초반에 Tenant advisory lock까지 중복으로 잡고 있었습니다. 비용 ledger의 정합성 구조는 유지하고 중복 advisory lock만 제거한 결과, 동일 Tenant·직원 16명·동시성 8에서 처리량 중앙값이 36.97에서 55.26 ops/s로 49.5% 증가했고 한도 초과, 중복 정산, deadlock은 0건이었습니다. 다만 Begin p95는 악화되고 대기가 행 잠금으로 이동했습니다. 후속으로 `pgx.Batch`도 실험했지만 일반 경로만 함께 빨라지고 Tenant 경합은 충분히 줄지 않아 채택하지 않았습니다. 즉 Redis를 먼저 도입한 것이 아니라, 정합성을 유지한 채 실제 측정으로 중복 잠금을 제거하고 남은 한계까지 확인한 작업입니다.

## 12. 이력서·포트폴리오 문구

> Tenant Chat 개인별 Token Quota의 PostgreSQL transaction 경합을 A/B/C 부하 테스트로 재현하고, 중복 Tenant advisory lock을 제거해 동일 Tenant 동시성 8 처리량을 36.97에서 55.26 ops/s로 49.5% 개선했습니다. 사용자·직원·Tenant 한도 초과와 중복 정산·deadlock은 0건을 유지했으며, p95 행 잠금 병목과 미채택 `pgx.Batch` 실험도 별도 근거로 남겼습니다.

짧은 이력서 bullet에서는 p95를 개선했다고 쓰지 않는다. 면접이나 포트폴리오 본문에서는 처리량 개선과 tail latency 한계를 함께 설명한다.

## 13. 면접 예상 질문

### 왜 Redis로 옮기지 않았나요?

Request Rate Limit과 달리 누적 Token Quota는 예약, 실제 사용량 정산, 실패 후 미확정 처리, 중복 replay와 감사 ledger가 필요하다. Redis를 추가하면 PostgreSQL 원본과의 이중 쓰기·복구 문제가 생기므로, 측정된 병목이 Redis 부재인지 먼저 확인했다. 이번 병목은 PostgreSQL 내부의 중복 lock이었다.

### advisory lock이 중복이라는 것을 어떻게 확인했나요?

Tenant cost period 행이 모든 비용 갱신 경로에서 `FOR UPDATE`로 잠기고 같은 transaction에서 balance와 ledger를 갱신하는 것을 코드로 확인했다. advisory lock만 제거한 뒤 동시 hard stop, 중복 정산, 혼합 receipt·reconciliation 테스트를 실행해 초과 승인과 합계 불일치가 없음을 검증했다.

### 처리량은 좋아졌는데 p95가 나빠진 변경을 왜 채택했나요?

목표를 처리량과 회귀 조건으로 분리했다. B 처리량은 세 반복 모두 32.6~64.0% 증가했고 고동시성 대조군 회귀는 10% 이내였다. 다만 p95 악화를 명시적으로 한계로 남겼다. 이 변경을 tail-latency 개선이라고 주장하지 않으며, 제품 요구가 p95 중심이라면 별도 후속 최적화가 필요하다.

### 중복 정산 0건은 어떻게 보장했나요?

reservation의 상태와 ledger version을 transaction에서 잠그고, 동일 정산 16회를 동시에 replay했다. 결과는 settlement ledger 1건과 confirmed 합계 1회분이었다. 이것은 성능 성과가 아니라 최적화 전후 정합성 회귀 방지 조건이다.

### `pgx.Batch` 수치도 좋아졌는데 왜 되돌렸나요?

B만 좋아진 것이 아니라 C도 비슷한 폭으로 빨라졌고, B/C p95 비율은 9.58에서 8.68로만 줄었다. 일반 왕복 비용은 감소했지만 해결하려던 Tenant 직렬화는 남았다고 판단했다. 사전 기준을 바꾸지 않고 후보를 revert했다.

### 다음 최적화 후보는 무엇인가요?

Tenant cost 행을 점유하는 임계 구역 축소나 조건부 atomic SQL 갱신이 후보지만, 직원 주간 trigger와 receipt·reconciliation의 잠금 순서를 함께 검토해야 한다. 현재 성과를 위해 무리하게 도입하지 않고 별도 설계와 동일 probe 검증이 필요하다.

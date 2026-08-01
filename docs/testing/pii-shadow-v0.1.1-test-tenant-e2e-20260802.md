# PII v0.1.1 테스트 테넌트 Shadow E2E

## 1. 결론

기존 AWS PII primary 한 대에서 기존 테스트 테넌트만 exact allowlist에 넣고,
canonical `v0.1.1`을 기준과 후보에 동일하게 사용한 격리 Shadow E2E를
완료했다. allowlist 요청 1,000건 중 52건(5.2%)이 결정적으로 선택됐고,
52건 모두 비교되어 100% 일치했다. 별도 non-allowlisted control 요청 1건은
성공했지만 Shadow 대상으로 선택되지 않았다.

이 결과는 target Linux host에서의 동일 모델 Shadow 배관과 안전장치 검증이다.
새 후보 모델 품질, production traffic, production 배포 또는 SLA를 승인하지
않는다.

## 2. Evidence binding

| 항목 | 값 |
|---|---|
| 실행일 | 2026-08-02 KST |
| 기준 Git SHA | `c51ed09670d675c795b1761b289ac1965ba9451b` |
| 기준 모델 | canonical `v0.1.1` |
| 후보 모델 | 동일 canonical `v0.1.1` |
| 모델 ONNX SHA-256 | `8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381` |
| 집계 JSON | [`pii-shadow-v0.1.1-test-tenant-e2e-20260802.json`](pii-shadow-v0.1.1-test-tenant-e2e-20260802.json) |
| tracked source | clean |

## 3. 비식별 환경과 실행 범위

- 기존 AWS PII primary `c7i.xlarge`, Linux, logical CPU 4
- ONNX Runtime `1.27.0`
- 운영 추론 active `2`, intra-op `2`, inter-op `1`, spinning 비활성
- 후보 추론 active `1`, intra-op `1`, inter-op `1`, spinning 비활성
- 검증 컨테이너 상한 CPU 4, memory 4 GiB, read-only root filesystem
- 외부 네트워크 없음, host port publish 없음
- 저장소의 합성 corpus만 사용
- production 배포·재시작·환경 변수 변경·서비스 트래픽 없음

고정 실행 창은 02:00~05:00 KST지만, 이번 실행은 사용자의 즉시 실행 승인에
따른 명시적 예외로 창 밖에서 수행했다. 결과에는
`explicitUserOverride=true`를 기록했으며, 정상 야간 창 동작을 검증했다고
간주하지 않는다.

## 4. 집계 결과

| 지표 | 결과 |
|---|---:|
| 전체 요청 | 1,001 |
| allowlisted / control 요청 | 1,000 / 1 |
| 성공 / 오류 | 1,001 / 0 |
| Shadow 선택 | 52 (5.2%) |
| deterministic replay 선택 | 52 |
| control Shadow 선택 | 0 |
| 비교 / 일치 / 불일치 | 52 / 52 / 0 |
| agreement | 100.0% |
| 실제 모델 동작 비교 | 21 |
| 기준 / 후보 모델 invocation | 21 / 21 |
| 기준 / 후보 accepted model detection | 14 / 14 |
| capture / inference / decrypt error | 0 / 0 / 0 |
| expired / evicted / oversized | 0 / 0 / 0 |
| live request로 pause | 1 |

## 5. 지연시간 집계

| 경로 | count | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| Gateway 전체 요청 | 1,000 | 44.223 ms | 47.207 ms | 48.218 ms | 74.873 ms |
| Gateway Shadow 선택 요청 | 52 | 45.013 ms | 47.896 ms | 48.092 ms | 48.092 ms |
| 기준 추론 | 52 | 2 ms | 5 ms | 5 ms | 5 ms |
| 후보 추론 | 52 | 2 ms | 4 ms | 4 ms | 4 ms |

Gateway 집계는 합성 loopback workload의 단일 실행 결과다. 현재 계약에 없는
SLA 임계값을 만들거나 production tail latency로 해석하지 않는다.

## 6. 검증한 보안 조건

- 기존 테스트 테넌트만 exact allowlist에 포함되고 control tenant는 제외됨
- 선택된 입력이 후보 추론 전에 AES-256-GCM으로 즉시 암호화됨
- buffer는 process memory에만 존재하며 최대 5,000건 또는 암호문과 nonce
  합계 10 MiB, TTL 12시간으로 제한됨
- 운영 요청이 대기 중일 때 다음 후보 추론을 시작하지 않음
- TTL 만료, 용량 eviction, oversized capture, AES-GCM 복호화 실패, 후보 추론
  실패가 각각 1건씩 의도적으로 주입되어 올바른 counter에 집계됨
- process 재시작 시 pending sample을 버리고 교체 키로 이전 sample을 복호화할
  수 없음
- evidence는 aggregate만 포함하며 원문, 개별 탐지값, tenant/request 식별자,
  credential과 로컬 경로를 포함하지 않음
- 검증용 이미지·컨테이너·일회용 전달 키를 제거한 뒤 기존 primary를 중지함

위 fault counter 1건씩은 오류 처리 검증을 위한 격리 주입값이다. 실제 1,001건
workload의 capture, inference와 decrypt 오류는 모두 0건이다.

## 7. 확인하지 못한 한계

- 정상 02:00~05:00 KST 창에서의 실행과 12시간 장시간 TTL 동작
- production traffic 또는 외부 Provider가 있는 환경의 지연 영향
- 실제 배포된 production 서비스 프로세스와 authenticated 전체 Chat API 경로
- multi-worker·두 PII replica의 합산 동작과 장시간 Shadow/Canary
- 새 `v0.1.2-dev.n` 후보의 오탐·미탐·품질과 승격 기준
- durable aggregate 저장·조회와 rollback 운영 절차

따라서 결론은 `same_model_test_tenant_shadow_plumbing_validated`로 제한한다.

# PII v0.1.1 고정 4 CPU 예산 조합 검증

## 1. 결론

같은 4 CPU 예산에서 요청 동시성과 ONNX intra-op 스레드를 나눠 본 결과,
2×2를 목표 환경 재검증 후보로 선택했다. 1×4 대비 direct 추론 처리량은
33.571% 증가했고, 사용한 CPU를 고려한 처리 효율도 17.982% 증가했다.
3,000건 모두 추론 오류와 출력 불일치가 없었다.

이 측정만으로는 운영 기본값을 바꾸지 않았지만, 2026-08-01 실제 4-vCPU
Linux PII host에서 같은 v0.1.1 artifact를 aggregate-only direct 방식으로
추가 확인한 뒤 고정 AWS profile을 2×2로 선택했다. 이 결정은 Uvicorn socket,
Gateway 경로와 Shadow 부하까지 검증했다는 뜻이 아니며, 임시 Gateway timeout
300ms에 대한 end-to-end 여유도 후속 검증으로 남긴다.

## 2. 검증 대상과 조건

| 항목 | 값 |
|---|---|
| 모델 버전 | v0.1.1 |
| 과거 모델 표기 | v3.14 |
| ONNX SHA-256 | 8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381 |
| Git SHA | 63c3f6f1a83694386d915b3ca6519bd9942ce04b |
| 실행 환경 | Windows 11, Intel Core Ultra 5 226V, Python 3.12.13, ONNX Runtime 1.27.0 |
| CPU 제한 | 각 child process의 affinity를 논리 CPU 4개로 제한 |
| 공통 ONNX 설정 | inter-op 1, spinning 비활성화 |
| 비교 조합 | 요청 동시성 1 × intra-op 4, 2 × 2, 4 × 1 |
| Direct workload | 합성 50 case, 조합별 1,000건 × 3회, 교차 실행 순서 |
| HTTP workload | 합성 hybrid/KoELECTRA 확인 case, 8개 동시 요청 × 20 wave |
| HTTP admission | pending 4, wait 50ms, in-process ASGI transport |

원본 aggregate report:

- [4 CPU matrix report](pii-thread-budget-matrix-v0.1.1-20260731.json)
- [1×4 HTTP baseline](pii-http-admission-v0.1.1-20260731-1x4.json)
- [2×2 HTTP candidate](pii-http-admission-v0.1.1-20260731-2x2.json)

세 report에는 입력 문장, 탐지값, 탐지 위치, 응답 원문, 인증정보와 로컬
파일 경로를 저장하지 않았다.

## 3. Direct 추론 비교

| 조합 | RPS 중앙값 | 1×4 대비 | p50 | p95 | p99 | 회차 최악 p99 | 100ms 초과 | CPU 사용률 | RPS/코어 | 오류 / 불일치 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1×4 | 88.296 | 기준 | 4.510ms | 42.282ms | 49.772ms | 51.358ms | 1 / 3,000 (0.033%) | 59.290% | 37.231 | 0 / 0 |
| 2×2 | 117.938 | +33.571% | 4.317ms | 71.075ms | 81.883ms | 84.297ms | 2 / 3,000 (0.067%) | 67.123% | 43.926 | 0 / 0 |
| 4×1 | 141.665 | +60.443% | 4.856ms | 126.619ms | 149.540ms | 193.483ms | 496 / 3,000 (16.533%) | 82.730% | 42.810 | 0 / 0 |

### 해석

- 2×2는 처리량과 코어당 처리 효율이 모두 좋아졌고 세 회차의 p99가
  100ms 안에 있었다. 따라서 다음 환경에서 다시 볼 후보로는 의미가 있다.
- 4×1은 처리량이 가장 높지만 100ms 초과가 16.533%이고 p99도
  149.540ms이므로 후보에서 제외했다.
- 모든 조합에서 출력 불일치와 추론 오류는 0건이었다.
- 모든 요청이 100ms 이하여야 하는 기존 strict gate는 세 조합 모두
  통과하지 못했다. 2×2라는 선택은 production 승격이 아니라 후속 검증
  우선순위다.
- Windows context switch 카운터는 실행 시간과 운영체제 스케줄링의 영향을
  함께 받는다. 이번 선택의 인과 근거로 사용하지 않고 report에 관측값만
  남겼다.

## 4. Bounded HTTP admission 비교

두 profile 모두 CPU affinity 4, pending 4, wait 50ms, 8개 동시 요청
20 wave로 실행했다. 성공 응답은 실제 hybrid 실행과 KoELECTRA 기여가
모두 확인된 경우다.

| 조합 | HTTP 200 | 성공률 | sanitized 503 | 성공 p50 | 성공 p95 | 성공 p99 | hybrid / KoELECTRA | 기타 오류 / 계약 불일치 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1×4 | 57 / 160 | 35.625% | 103 | 41.038ms | 154.488ms | 167.001ms | 57 / 57 | 0 / 0 |
| 2×2 | 109 / 160 | 68.125% | 51 | 34.233ms | 212.540ms | 278.034ms | 109 / 109 | 0 / 0 |

2×2는 성공 처리 건수를 57건에서 109건으로 늘렸고, 503은 103건에서
51건으로 줄였다. 반면 성공 p99는 66.486% 증가했다. 이 결과는 제한된
CPU에서 더 많은 요청을 완료할 수 있다는 가능성과, 대기열을 포함한 꼬리
지연이 함께 증가한다는 trade-off를 보여준다.

Direct 수치보다 HTTP 지연이 큰 이유는 Direct가 KoELECTRA adapter만
측정하는 반면, HTTP 검증은 primary detector, KoELECTRA, 전체 정책 처리,
process-local 대기를 포함하기 때문이다.

## 5. 적용 결정

1. 2026-08-01 후속 direct 검증을 반영해 고정 4-vCPU AWS profile은
   active 2, intra-op 2를 사용한다.
2. 일반 local과 Self-host 기본값은 CPU 예산이 고정되지 않으므로 active 1을
   유지한다.
3. 목표 환경에서는 Uvicorn socket과 실제 Gateway를 포함해 p95, p99,
   timeout, queued success, sanitized 503, fail-closed 결과를 함께 측정한다.
4. 300ms timeout을 유지할 경우 network 여유까지 포함한 별도 기준을 먼저
   정하고, pending 4와 wait 50ms도 같은 부하에서 다시 조정한다.
5. worker 또는 replica를 늘리는 검증은 process-local active/pending 한도가
   곱해진다는 점을 포함해 별도 수행한다.

### 5.1 2026-08-01 실제 4-vCPU Linux direct 확인

운영 중인 두 PII replica 가운데 한 대에서 서비스 설정과 container를
재시작하지 않고, 동일한 v0.1.1 artifact를 별도 process로 실행했다. 각 조합은
1,000건씩 3회 교차 실행했고 총 9,000건에서 오류와 출력 불일치는 0건이었다.

| 조합 | RPS 중앙값 | p99 중앙값 | CPU 사용률 중앙값 | 사용 CPU당 RPS |
|---:|---:|---:|---:|---:|
| 1×4 | 392.832 | 3.041ms | 48.793% | 200.399 |
| 2×2 | 836.061 | 2.898ms | 67.300% | 310.377 |
| 4×1 | 1,359.220 | 5.161ms | 91.693% | 372.172 |

4×1이 direct 처리량은 가장 높았지만 CPU 사용률이 91.693%라 운영 여유가
작았다. 2×2는 1×4보다 처리량이 높고 세 조합 중 p99가 가장 낮아 고정
4-vCPU profile의 균형점으로 선택했다. 합성 단문 direct 결과이므로 FastAPI,
Regex, network, 대기열과 Gateway 전체 처리량을 나타내지는 않는다.

## 6. 한계

- 초기 Windows process affinity 4는 AWS 4-vCPU Linux quota와 같지 않으며, 후속 AWS 확인도 direct 추론만 포함한다.
- HTTP 비교는 profile별 한 번의 20-wave 실행이며, 운영 RPS 측정이 아니다.
- HTTP transport는 실제 socket이 아닌 in-process ASGI다.
- 실제 Gateway timeout, fail-closed 응답, Provider 미실행은 포함하지 않았다.
- Uvicorn multi-worker, 여러 replica, client disconnect는 포함하지 않았다.
- 합성 corpus를 사용했으며 원문은 메모리에서만 렌더링했다.

## 7. Evidence checksum

| 파일 | SHA-256 |
|---|---|
| pii-thread-budget-matrix-v0.1.1-20260731.json | 3df8dbf83980a0bb39744ae175774a324a81429423cddb749eb2910dc2168ec3 |
| pii-http-admission-v0.1.1-20260731-1x4.json | 75535e653e7d3f6ee8acae90de199b1d69714e223170cc7c104b0477afadc46b |
| pii-http-admission-v0.1.1-20260731-2x2.json | 6cabee8b6aaa9c4f33ebd75fb332c78b26b59cde6f4eded0995db1196490147f |

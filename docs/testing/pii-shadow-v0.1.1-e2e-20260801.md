# PII v0.1.1 동일 모델 Shadow E2E

## 1. 목적

운영 후보를 평가하기 전에 PII Shadow의 연결 자체를 검증했다. Gateway의
tenant allowlist·deterministic sampler와 실제 HTTP adapter에서 시작해 AI
Service의 기준 ONNX 추론, AES-256-GCM process-local buffer, 별도 후보 ONNX
추론과 aggregate 비교까지 한 번에 통과하는지 확인했다.

기준과 후보에는 같은 canonical `v0.1.1` artifact를 사용했다. 따라서 이
검증의 합격은 Shadow 배관이 같은 입력과 결과를 잃지 않고 비교한다는 뜻이며,
새 후보 모델의 품질이나 production 승격을 뜻하지 않는다.

## 2. Evidence binding

| 항목 | 값 |
|---|---|
| 실행일 | 2026-08-01 KST |
| 구현 Git SHA | `faaa3a5f7a859a5ecba24b381889ef2167126566` |
| 모델 버전 | `v0.1.1` |
| 모델 ONNX SHA-256 | `8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381` |
| 집계 JSON | [`pii-shadow-v0.1.1-e2e-20260801.json`](pii-shadow-v0.1.1-e2e-20260801.json) |
| 집계 JSON SHA-256 | `b7f3cb68aebcfaa83628b7cf439e9f75b7c27de4eecedae74bdd5beb9cfb8022` |
| tracked worktree | clean |

runner는 시작 전에 canonical model registry의 모든 model·tokenizer·config
파일 크기와 SHA-256을 검증했다. 보고서에는 artifact의 로컬 경로를 기록하지
않았다.

## 3. 실행 범위

- 기존 50건 synthetic corpus를 메모리에서 반복해 1,000건 요청
- Gateway 실제 sampler와 AI Safety HTTP adapter 사용
- synthetic test tenant 하나만 exact allowlist에 포함
- 설정 샘플 비율 500 basis points, 즉 5%
- loopback TCP의 실제 FastAPI route 사용
- 기준 runtime은 active `2`, ONNX intra-op `2`, inter-op `1`
- 후보 runtime은 한 번에 한 건, ONNX intra-op `1`, inter-op `1`
- E2E 실행을 위해 야간 window만 명시적으로 우회
- Docker, AWS instance, production traffic과 외부 Provider는 사용하지 않음

## 4. 결과

| 지표 | 결과 |
|---|---:|
| 전체 Gateway 요청 | 1,000 |
| 성공 요청 | 1,000 |
| 5% sampler 선택 | 44 (4.4%) |
| 암호화 buffer capture | 44 |
| 비교 완료 | 44 |
| 실제 모델이 동작한 비교 | 13 |
| 기준 모델 invocation | 13 |
| 후보 모델 invocation | 13 |
| 기준 accepted model detection | 11 |
| 후보 accepted model detection | 11 |
| 결과 일치 | 44 |
| 결과 불일치 | 0 |
| agreement | 100.0% |
| capture / inference / decrypt error | 0 / 0 / 0 |
| expired / evicted / oversized | 0 / 0 / 0 |
| 기준 latency p95 | 4 ms |
| 후보 latency p95 | 4 ms |

44건 전체에는 rules-only와 model-active 경로가 함께 들어 있다. 그중 13건은
기준과 후보가 실제 ONNX를 각각 호출했으며 invocation 수와 accepted model
detection 수도 같았다. 따라서 이번 결과는 모델을 미리 load만 한 테스트가
아니라 실제 후보 재추론과 결과 비교를 포함한다.

latency 값은 synthetic mixed workload의 소규모 로컬 측정이다. 운영 4-vCPU
Linux host의 처리량, concurrent traffic tail latency 또는 SLA 수치로 사용하지
않는다.

## 5. 데이터 안전성

runner는 input을 process memory에서만 만들고 Gateway client의 stdin으로
전달했다. AI Service는 선택된 항목을 즉시 AES-256-GCM으로 암호화했으며,
후보 비교가 끝난 항목은 buffer에서 제거했다.

추적한 JSON에는 다음을 넣지 않았다.

- input 또는 input 일부
- redacted text와 preview
- detected value, span, offset와 개별 detection
- tenant, user, request, conversation 식별자와 hash
- raw error body, credential와 로컬 artifact 경로

## 6. 남은 검증

이번 결과만으로 다음 항목은 확인되지 않았다.

- 실제 production tenant traffic의 5% 장시간 수집
- 02:00~05:00 KST 자동 window와 12시간 TTL의 장시간 동작
- live traffic 유입 시 in-flight 한 건 종료 후 Shadow가 멈추는지 여부
- process 재시작 시 buffer와 memory-only key 폐기
- multi-worker·두 PII replica의 합산 동작
- 4-vCPU Linux host의 운영 요청 latency 영향
- 새 후보 모델의 품질·오탐·미탐과 승격 기준
- durable aggregate 저장과 조회

따라서 현재 단계의 결론은 `same_model_shadow_plumbing_validated`로 제한한다.
production 전역 활성화, 후보 모델 승격, production SLA와 DLP 완료를 승인하지
않는다.

## 7. 재현 명령

```bash
cd apps/ai-service
python -m app.services.pii_shadow_e2e_runner \
  --model-dir <canonical-v0.1.1-model-directory> \
  --model-version v0.1.1 \
  --requests 1000 \
  --sample-basis-points 500 \
  --out ../../docs/testing/pii-shadow-v0.1.1-e2e-20260801.json
```

실행 결과는 `eligible=true`, 실제 모델 invocation 1회 이상, 기준·후보 invocation
동수, 100% agreement와 모든 Shadow error 0건을 동시에 만족해야 한다.

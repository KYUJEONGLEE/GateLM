# Tenant Chat PII 소형 모델 4~6단계 계획 및 근거 — 2026-07-16

## 1. 1~3단계의 의미

1~3단계는 단순히 1.6GB 모델 하나만 시험한 과정은 아니다.

| 단계 | 확인한 내용 | 결론 |
|---|---|---|
| 1단계 | 전달받은 OpenAI·KoELECTRA ONNX 모델의 로드, adapter, span 병합, Tenant Chat 연결 | 연결은 가능하지만 연결 가능이 운영 적합성을 뜻하지 않음 |
| 2단계 | rules-only/OpenAI/KoELECTRA/both 정확도 ablation | OpenAI는 전화번호·secret만 품질 후보, 기존 KoELECTRA는 품질 No-Go |
| 3단계 | 선택된 1.6GB OpenAI 모델의 warm/cold 지연, timeout, memory, readiness | model-active p95 627ms, timeout 2건, peak RSS 약 1.27GiB로 production No-Go |

따라서 1~3단계의 최종 결과는 `대형 모델을 연결할 수는 있지만 현재 Tenant Chat 실시간 경로에는 적합하지 않다`이다.

## 2. 새 4~6단계 정의

```text
4단계: KoELECTRA-small 학습 데이터와 재학습 계약
-> 5단계: fine-tuning, ONNX/QInt8 변환, 정확도·지연 promotion gate
-> 6단계: Tenant Chat 배포 연결, E2E, 장애 fallback, rollback
```

### 2.1 4단계 — 데이터와 학습 계약

목표는 고객 원문 없이 재현 가능한 span-level 학습 입력을 만드는 것이다.

- 기존 1,000건 합성 master corpus만 입력으로 사용한다.
- 목표 유형은 이름, 조직명, 주소, 이메일, 전화번호, 주민등록번호다.
- 같은 문장 패턴은 하나의 split에만 들어가도록 group split한다.
- train/validation/holdout은 80/10/10 정책으로 분리한다.
- negative record는 positive의 최대 2배로 제한한다.
- 학습 JSONL에는 합성 문장과 span이 들어가지만 Git-ignored 경로에만 생성한다.
- manifest에는 aggregate, SHA-256, case ID만 기록하고 문장·span은 기록하지 않는다.

현재 4단계 산출 결과는 다음과 같다.

| split | record | positive | negative | group |
|---|---:|---:|---:|---:|
| train | 459 | 153 | 306 | 84 |
| validation | 48 | 16 | 32 | 9 |
| holdout | 33 | 11 | 22 | 7 |

모든 split은 `ADDR, EMA, ORG, PER, PHN, RRN` 라벨을 포함한다. 데이터 계약 unittest 4건이 통과했고, 로컬 산출물은 `.tmp/pii-ner-training-v1/`에 생성된다.

이 데이터는 파이프라인 구현과 smoke fine-tuning에는 사용할 수 있지만, synthetic variant 수와 문장 다양성이 작으므로 production-grade 학습 근거는 아니다.

### 2.2 5단계 — 소형 모델 생성과 promotion gate

학습 backbone은 `monologg/koelectra-small-v3-discriminator`로 고정한다. 산출 모델은 GateLM 전용 label 계약을 사용하고 ONNX dynamic QInt8로 변환한다.

필수 gate는 다음과 같다.

1. holdout span-level precision, recall, F1을 유형별로 산출한다.
2. rules-only 대비 103건 screening exact pass가 증가해야 한다.
3. 신규 hard-negative false positive가 없어야 한다.
4. 이름·조직명·주소 중 최소 하나에서 실제 추가 true positive가 있어야 한다.
5. model-active warm p95 50ms 이하, peak RSS 512MiB 이하를 1차 목표로 둔다.
6. raw text, detected value, span은 평가 보고서에 저장하지 않는다.

한 조건이라도 실패하면 모델 파일은 실험 산출물로만 보존하고 6단계로 승격하지 않는다.

### 2.3 6단계 — Tenant Chat 제한 배포

5단계 gate를 통과한 QInt8 모델만 AI Service sidecar의 단일 primary 모델로 설정한다. 1.6GB OpenAI 모델과 기존 품질 No-Go KoELECTRA를 동시에 로드하지 않는다.

```text
새 사용자 메시지
-> Gateway 필수 규칙
-> 규칙 미탐 후보만 소형 KoELECTRA
-> allow/redact/block
-> sanitized content만 암호화 저장
-> Provider에는 sanitized history와 새 sanitized 메시지만 전달
```

배포 전에는 synthetic Tenant Chat E2E로 redact, block, Provider 억제, timeout fallback, DB·Redis·로그 원문 비저장을 확인한다. 실패하면 sidecar를 끄고 즉시 rules-only로 원복한다.

## 3. 현재 상태

| 단계 | 상태 | 비고 |
|---|---|---|
| 4단계 | 구현·검증 완료 | 합성 span dataset builder와 manifest 계약 완료 |
| 5단계 | 진행 전 | 실제 fine-tuning·ONNX/QInt8·promotion gate 필요 |
| 6단계 | 진행 전 | 5단계 통과 모델이 없으므로 아직 배포 금지 |

현재 서비스 안전 기본값은 계속 rules-only다. 4단계 완료는 학습 준비가 끝났다는 뜻이며, 정확한 모델이 완성됐다는 뜻은 아니다.

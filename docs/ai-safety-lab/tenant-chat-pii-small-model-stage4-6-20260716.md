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

#### 5단계 실제 결과

`monologg/koelectra-small-v3-discriminator` revision `7488f8db0f208beff4a1f3f9bb3ed04650a89ed7`을 합성 train 459건으로 3 epoch fine-tuning했다. holdout은 학습 중 열지 않았고, 학습 완료 후 QInt8 artifact 평가에서 처음 열었다.

| 항목 | 결과 | 판정 |
|---|---:|---|
| validation span micro F1 | 0.153846 | 실패 |
| QInt8 model 크기 | 14,595,587 bytes | 통과 |
| holdout span TP / FP / FN | 0 / 0 / 11 | 실패 |
| holdout micro recall / F1 | 0 / 산출 불가 | 실패 |
| rules-only 대비 103건 exact pass 변화 | 0 | 실패 |
| semantic 유형 추가 기여 | 0건 | 실패 |
| 신규 screening FP | 0건 | 통과 |
| direct warm p50 / p95 | 6.205ms / 13.591ms | 통과 |
| 평가 프로세스 peak RSS | 347.914MiB | 통과 |

결론은 `속도와 크기는 적합하지만 품질은 배포 불가`다. 이 모델은 Git-ignored 실험 artifact로만 남기고 Tenant Chat enforce에는 연결하지 않는다. 합성 후보 평가는 production promotion evidence가 아니며, 현재 데이터 규모로 품질 gate까지 실패했으므로 production gate를 실행할 근거도 없다.

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

#### 6단계 fail-closed 배포 계약

`gatelm-pii-ner-deployment-gate`는 다음 두 증거를 모두 통과한 경우에만 `candidate-activation.env`를 만든다.

1. 5단계 candidate evaluation의 모든 engineering gate 통과
2. owner 승인, artifact 무결성, 품질, warm/cold runtime, 실제 Tenant Chat E2E가 모두 묶인 production promotion evidence 통과

둘 중 하나라도 실패하거나 누락되면 candidate env를 만들지 않고 다음 rules-only rollback env만 생성한다.

```text
GATEWAY_AI_SAFETY_SIDECAR_ENABLED=false
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS=
```

현재 실제 5단계 보고서로 gate를 실행한 결과는 `candidate_engineering_gate_failed` 1건으로 차단됐다. `candidateActivationEnvWritten=false`, `rulesOnlyRollbackEnvWritten=true`를 확인했다. 따라서 실제 서비스 설정이나 배포 image는 변경하지 않았다.

실제 Tenant Chat E2E를 실행하지 않은 상태에서 boolean 증거를 임의로 만들거나 품질 gate를 우회하는 경로는 제공하지 않는다.

## 3. 현재 상태

| 단계 | 상태 | 비고 |
|---|---|---|
| 4단계 | 구현·검증 완료 | 합성 span dataset builder와 manifest 계약 완료 |
| 5단계 | 구현·실측 완료, No-Go | 13.9MiB·p95 13.591ms지만 holdout TP 0으로 품질 gate 실패 |
| 6단계 | fail-closed 계약 구현·검증 완료, 배포 차단 | 실패 후보의 activation env 미생성, rules-only rollback env 생성 확인 |

현재 서비스 안전 기본값은 계속 rules-only다. 이번 결과는 작은 모델이 곧 정확한 모델을 뜻하지 않으며, backbone 교체보다 먼저 학습 데이터와 학습 전략을 개선해야 함을 보여준다.

## 4. 2026-07-16 무료 모델 재학습 v2

Microsoft Azure AI Language PII 컨테이너 도입은 중단했다. Azure adapter, 설정, 테스트, Self-host Compose overlay와 기동·smoke 스크립트는 revert 커밋으로 제거했으며 저장소의 Azure PII 연결 흔적은 0건이다. 앞으로 실시간 PII 보완 탐지는 외부 유료 API 없이 `GateLM KoELECTRA-small ONNX dynamic QInt8`만 후보로 사용한다.

첫 자체 학습 후보가 빠르지만 holdout TP 0으로 실패한 주된 원인은 적은 positive 문장과 토큰 대부분을 차지하는 `O` 라벨 쏠림이다. v2는 다음을 변경했다.

1. positive 문장마다 합성 PII 값을 바꾼 variant를 총 8개 만든다.
2. 학습·검증·holdout의 합성 이름·조직·주소·이메일·전화·주민번호 값 공간을 분리한다.
3. 전체 record를 540건에서 2,260건으로 늘린다.
4. inverse-square-root class weight와 별도 `O` down-weight를 적용한다.
5. 기본 학습을 3 epoch에서 8 epoch로 늘리고 validation micro F1이 가장 높은 epoch만 저장한다.
6. 기존 holdout, screening FP, p95 50ms, RSS 512MiB, production promotion gate는 낮추거나 우회하지 않는다.

| split | 전체 | positive | negative |
|---|---:|---:|---:|
| train | 1,952 | 1,224 | 728 |
| validation | 189 | 128 | 61 |
| holdout | 119 | 88 | 31 |

데이터·학습·배포 gate 단위 테스트 19건은 통과했다. 다만 Codex가 실행되는 WSL과 Windows 사이의 `vsock` 장애로 기존 Windows 가상환경을 호출할 수 없었고, WSL 임시 CPU PyTorch 설치도 10분 제한을 넘겨 실제 v2 재학습 결과는 아직 없다. 따라서 이 변경만으로 모델을 서비스에 활성화하지 않는다.

Windows PowerShell에서 다음 명령 하나로 데이터 생성, 재학습, QInt8 변환, candidate 평가까지 실행한다.

```powershell
cd C:\jungle7\llmops
.\scripts\tenant_chat_pii_models\retrain_gatelm_koelectra.ps1
```

스크립트는 candidate gate가 실패하면 non-zero로 종료하고 모델을 활성화하지 않는다. candidate gate가 통과해도 production promotion evidence와 실제 Tenant Chat E2E가 추가로 통과하기 전에는 rules-only를 유지한다.

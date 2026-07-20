# GateLM KoELECTRA PII NER v3.14 배포 준비서

- 상태: 로컬 배포 패키지 준비 및 검증 완료, 운영 반영은 수행하지 않음
- 범위: v3.14 QInt8 ONNX 단일 모델 번들
- 제외: Shadow, Canary, 운영 Gateway E2E
- 릴리스 ID: `tenant-chat-pii-models-v314-20260721`
- 공개 모델 ID: `gatelm/koelectra-small-v3-pii-ner`

## 전달할 파일

- `tenant-chat-pii-model-bundle-v314-20260721.zip`
- `candidate-activation.env`
- `rules-only-rollback.env`
- 이 문서

ZIP 크기는 11,004,765 bytes이며 SHA-256은
`3d88ac516ba18da888a7400a757df98d6494be2ba9810d1a3a0ce579c2d8eb0b`이다.
모델 ONNX SHA-256은
`8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381`이다.

## 필요한 코드

모델 ZIP만으로는 주소 경계 보완과 한 글자 이름 오탐 방어가 동작하지 않는다.
PII 모델 서버에는 이 릴리스 descriptor와 v3.14 후처리가 포함된 AI Service 코드도 함께 배포해야 한다.

## 설치 순서

1. ZIP을 PII 모델 서버의 비공개 경로 또는 private object storage로 전달한다.
2. 아래 importer로 outer ZIP, manifest, 런타임 파일 6개의 체크섬을 검증해 설치한다.

```bash
python scripts/tenant_chat_pii_models/import_bundle.py \
  /secure/path/tenant-chat-pii-model-bundle-v314-20260721.zip \
  --runtime-root /models \
  --release-id tenant-chat-pii-models-v314-20260721
```

3. 설치된 복사본으로 합성 스모크를 실행한다.

```bash
python scripts/tenant_chat_pii_models/run_gatelm_v314_synthetic_smoke.py \
  --model-dir /models/releases/tenant-chat-pii-models-v314-20260721/gatelm--koelectra-small-v3-pii-ner-quantized
```

4. `candidate-activation.env`의 `AI_SERVICE_` 값을 PII 모델 서버에 적용한다.
5. AI Service를 먼저 시작하고 `/readyz`가 성공하는지 확인한다.
6. 그다음 `GATEWAY_` 값을 Gateway 배포 환경에 적용한다.

현재 템플릿의 PII 서버 주소는 `172.31.32.156:8001`이다.
실제 private IP가 다르면 Gateway 적용 전에 배포 설정을 먼저 수정하고 검증해야 한다.

## 고정 탐지 설정

- 허용 유형: email, organization_name, person_name, phone_number, postal_address, resident_registration_number
- confidence: email 0.99, organization 0.90, person 0.90, phone 0.99, address 0.90, RRN 0.99
- 이름: Gateway 이름 룰을 끄고 v3.14 모델 결과만 사용
- 그 외 고위험 룰: 계속 유지
- 모델 추가 목록: 비움. 이번 번들은 v3.14 한 개만 로드

## 검증 근거

- 제품 어댑터 고정 gate: 5,000건, exact match 98.32%, micro F1 98.716%
- 음성 데이터 신규 오탐: 0건
- 주소 F1: 99.5018%, 사람 이름 F1: 99.7805%
- 설치된 번들의 6개 유형 합성 스모크: 모두 통과
- `너의이름은?` 한 글자 이름 오탐 회귀: 통과
- 로컬 p95 11.181ms는 참고값이며 운영 네트워크 E2E 수치는 아직 아님

## 실패 시 복구

`rules-only-rollback.env`의 네 값을 적용해 sidecar와 이름 모델 전용 모드를 함께 끈다.
이렇게 해야 Gateway의 이름 룰까지 다시 활성화되어 룰 기반 경로로 안전하게 복구된다.

운영 반영 뒤에는 합성 개인정보로 마스킹과 Provider 전달 전 원문 제거를 확인한다.
Shadow와 Canary는 이번 배포 준비에서 제외했으며 별도 단계로 진행한다.

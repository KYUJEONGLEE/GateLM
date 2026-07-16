# Tenant Chat PII 로컬 모델 재현 패키지

기준일은 2026-07-15이며, 이 문서는 저장소에서 실제로 로드되는 모델 파일과 현재 코드 동작을 기준으로 작성했다. 평가 자료와 테스트는 합성·비식별 데이터만 사용하며 실제 개인정보, 원문 고객 프롬프트, raw detected value를 포함하지 않는다.

중요한 결론부터 말하면 현재 구성은 `openai/privacy-filter`와 KoELECTRA ONNX를 함께 사용하지만, 한국 이름과 조직명은 현재의 보수적인 모델 라벨 허용 목록에서 제외되어 규칙 탐지기가 보완한다. 또한 최신 1,000건 합성 평가의 전체 pass rate는 `65.6%`, 이메일 case-level precision은 `12.83%`이므로 production-grade DLP 품질이 증명된 상태가 아니다.

## 1. 모델과 revision

| 용도 | Hugging Face model ID | 고정 revision | 전달 디렉터리 |
|---|---|---|---|
| 주 모델 | `openai/privacy-filter` | `7ffa9a043d54d1be65afb281eddf0ffbe629385b` | `models/openai--privacy-filter` |
| 한국어 보조 모델 | `amoeba04/koelectra-small-v3-privacy-ner` | `9f4e2fd9e35b12bcdb5fc334ac31be4399cb4281` | `models/amoeba04--koelectra-small-v3-privacy-ner-quantized` |

실행 파일 12개의 경로, 크기, SHA-256은 `docs/pii-model-manifest-20260715.json`에 있다. OpenAI 모델은 외부 tensor data를 포함하므로 `model_quantized.onnx`와 `model_quantized.onnx_data`를 반드시 함께 둬야 한다. KoELECTRA 비양자화 `model.onnx`의 SHA-256은 `eb99bedfe2c9cb98a780eea514ab9642e59d55a17930e69b9d8a4ec3c450ceff`이며 실행 패키지는 QInt8 결과만 포함한다.

## 2. 새 환경에서 실행

Windows PowerShell 기준:

```powershell
cd tenant-chat-pii-model-bundle-20260715
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\ai-service\requirements-pii-model.lock
.\.venv\Scripts\python.exe .\scripts\tenant_chat_pii_models\prepare_models.py --runtime-root .\models --verify-only
.\.venv\Scripts\python.exe .\scripts\tenant_chat_pii_models\run_synthetic_smoke.py --bundle-root .
.\scripts\tenant_chat_pii_models\run_ai_service.ps1
```

모델 파일을 다시 받거나 변환하려면 네트워크가 허용된 환경에서 `--verify-only`를 제거한다. 스크립트는 revision을 고정해 다운로드하고 KoELECTRA를 token-classification ONNX로 export한 뒤 `QuantType.QInt8` dynamic quantization을 수행하며 마지막에 모든 해시를 검증한다. 재현 시험에서 export 전후 비양자화 ONNX 및 양자화 결과가 위 해시와 byte-for-byte 일치했다.

API 호출 예:

```powershell
$body = @{ contractVersion = "ai-safety-detector.v1"; input = @{ promptText = "이메일: contact@synthetic.test"; locale = "ko-KR" } } | ConvertTo-Json -Depth 3
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8001/internal/ai-safety/v1/detect -ContentType application/json -Body $body
```

## 3. 의존성과 환경변수

재현 환경은 Windows 11, CPython `3.12.10`, ONNX Runtime `1.27.0`, Transformers `4.57.6`, Optimum `2.1.0`, Optimum ONNX `0.1.0`, ONNX `1.21.0`, Torch `2.12.1`, Tokenizers `0.22.2`, NumPy `2.5.0`, FastAPI `0.115.14`, Uvicorn `0.30.6`이다. 전체 transitive pin은 `ai-service/requirements-pii-model.lock`에 있다.

`onnxruntime==1.21.x`에서는 OpenAI ONNX의 `GatherBlockQuantized` 노드에 있는 `bits` attribute를 인식하지 못해 로드가 실패했다. 실제 구동이 확인된 `1.27.0`을 사용해야 한다.

실행 스크립트가 설정하는 값은 다음과 같다.

| 환경변수 | 값 |
|---|---|
| `AI_SERVICE_HOST` | `127.0.0.1` |
| `AI_SERVICE_PORT` | `8001` |
| `AI_SERVICE_ACCESS_LOG_ENABLED` | `false` |
| `AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME` | `onnx` |
| `AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID` | OpenAI 로컬 디렉터리 |
| `AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS` | KoELECTRA QInt8 로컬 디렉터리 |
| `TRANSFORMERS_OFFLINE`, `HF_HUB_OFFLINE`, `AI_SERVICE_TRANSFORMERS_OFFLINE` | `1` |

## 4. 라벨 매핑과 confidence threshold

모델 config에는 더 많은 라벨이 있지만 현재 adapter가 허용하는 매핑은 아래와 같다. `B-`, `I-`, `E-`, `S-` 또는 뒤쪽 `-B`, `-I` 표기는 aggregation 과정에서 정규화된다.

| 모델 원본 라벨 | GateLM detector type |
|---|---|
| OpenAI `account_number` | `account_number` |
| OpenAI `private_address` | `postal_address` |
| OpenAI `private_date` | `private_date` |
| OpenAI `private_email` | `email` |
| OpenAI `private_phone` | `phone_number` |
| OpenAI `private_url` | `private_url` |
| OpenAI `secret` | `secret` |
| KoELECTRA `EMA` | `email` |
| KoELECTRA `PHN` | `phone_number` |
| KoELECTRA `RRN` | `resident_registration_number` |

OpenAI `private_person`과 KoELECTRA `PER`, `ORG`, `LOC`, `ID`, `PWD`, `CRD`, `ACC`, `PSP`, `DLN`은 현재 모델별 allowlist에서 의도적으로 제외된다. 따라서 `person_name`과 `organization_name` 합성 smoke는 규칙 backstop을 검증하며 모델 성능 증거가 아니다.

기본 confidence는 `0.70`이고 override는 다음과 같다.

| threshold | detector type |
|---:|---|
| `0.97` | `bank_account`, `password_assignment`, `person_name` |
| `0.90` | `email`, `postal_address` |
| `0.85` | `organization_name` |
| `0.65` | `private_date`, `private_url`, `secret` |
| `0.55` | `api_key`, `phone_number` |
| `0.50` | `account_number`, `authorization_header`, `cloud_access_key`, `database_url`, `github_token`, `jwt`, `private_key`, `provider_api_key`, `resident_registration_number`, `session_cookie`, `slack_token`, `webhook_url` |
| `0.70` | 그 밖의 detector type |

## 5. 학습 여부와 데이터 구성

GateLM은 두 공개 모델을 직접 fine-tuning하지 않았다. 공개 checkpoint를 그대로 사용했고, GateLM이 수행한 모델 가공은 KoELECTRA의 ONNX export와 dynamic QInt8 양자화뿐이다.

KoELECTRA upstream model card는 `monologg/koelectra-small-v3-discriminator`를 자체 합성 privacy dataset으로 fine-tuning했다고 설명한다. 공개된 설정은 learning rate `5e-5`, train batch `512`, eval batch `1024`, seed `42`, Adam beta `(0.9, 0.999)`, epsilon `1e-8`, linear scheduler, `1` epoch, Native AMP이며 upstream 환경은 Transformers `4.40.0`, PyTorch `2.2.1+cu118`, Datasets `2.19.0`, Tokenizers `0.19.1`이다. 원본 학습 dataset 자체는 이 저장소와 전달 패키지에 없으므로 upstream train/eval 분리를 독립적으로 감사할 수 없다.

## 6. 평가 결과와 데이터 분리

2026-07-15에 현재 두 모델과 규칙을 합친 pipeline으로 `docs/ai-safety-lab/fixtures/master-safety-eval-corpus.jsonl` 1,000건을 다시 실행했다. 결과는 `656` pass, `344` fail, false-positive case `211`, false-negative case `180`, error `0`이다. locale은 `en-US 662`, `ko-KR 338`이며 값은 합성 placeholder로 materialize된다.

| PII 종류 | Precision | Recall | F1 |
|---|---:|---:|---:|
| account number | 0.7568 | 1.0000 | 0.8615 |
| email | 0.1283 | 1.0000 | 0.2275 |
| organization name (규칙) | 1.0000 | 0.2917 | 0.4516 |
| person name (규칙) | 0.4839 | 0.3409 | 0.4000 |
| phone number | 1.0000 | 0.7692 | 0.8696 |
| postal address | 1.0000 | 1.0000 | 1.0000 |
| private date | 0.9655 | 1.0000 | 0.9825 |
| private URL | 0.5833 | 0.7778 | 0.6667 |
| resident registration number | 1.0000 | 0.7143 | 0.8333 |
| secret | 0.8571 | 0.7742 | 0.8136 |

이는 span-level이나 model-only metric이 아니라 expected/detected type의 case-level 존재 여부다. GateLM 학습에는 쓰지 않았지만 과거 threshold 조정 보고서가 같은 master corpus를 반복 참조했으므로 untouched holdout으로 볼 수 없다. 상세 aggregate는 `docs/pii-model-evaluation-summary-20260715.json`과 `reports/master-corpus-eval-report.json`에 있다. 합성 한국어 확인 사례는 smoke script의 이메일, `홍길동`, `Quorivex Research`이며 스크립트 출력에는 원문을 남기지 않는다.

KoELECTRA upstream model card의 자체 eval 수치(P `0.9999237`, R `0.9998220`, F1 `0.9998729`)는 upstream dataset 결과일 뿐 GateLM 품질 증거로 사용하지 않는다.

## 7. CPU latency와 메모리

Windows 11 로컬 CPU evidence는 production SLA가 아니다.

| 측정 | 결과 |
|---|---|
| KoELECTRA QInt8 ML path 단일 cold 관측 | `335.55 ms` |
| 같은 path warm, 20 warmup + 100 measured | p50 `6.95 ms`, p95 `9.68 ms` |
| 두 모델 구성 첫 ML request 단일 관측, ORT 1.27 | `13,702.51 ms` |
| 두 모델 load 후 process RSS 단일 관측 | `610.34 MiB` |
| 두 모델 mixed workload, 50 warmup + 100 measured | p50 `0 ms`, p95 `294 ms` |

mixed workload는 rule-only fast path를 포함하므로 순수 두 모델 inference latency가 아니다. 반복 프로세스 기동에 기반한 cold p50/p95와 peak RSS는 아직 측정되지 않았다. 따라서 요청 항목 중 cold p50/p95와 peak memory는 현재 증거 부재로 명시하며 단일 관측치를 p50/p95로 포장하지 않는다.

## 8. 라이선스

두 Hugging Face model repository 모두 `Apache-2.0`으로 표시되어 있다.

- OpenAI: <https://huggingface.co/openai/privacy-filter>
- KoELECTRA: <https://huggingface.co/amoeba04/koelectra-small-v3-privacy-ner>
- Apache 2.0 원문: <https://raw.githubusercontent.com/openai/privacy-filter/main/LICENSE>

Apache-2.0 조건을 지키면 사내 및 상업적 사용이 가능하지만, license/notice 보존, 수정 고지, 상표권 미부여, 무보증 조건을 따라야 한다. 이는 법률 의견이 아니므로 배포 전 사내 법무·오픈소스 검토가 필요하다.

## 9. 전달물 확인

- `models/`: 실제 실행 ONNX와 tokenizer/config 전체 파일
- `docs/pii-model-manifest-20260715.json`: 파일별 크기와 SHA-256
- `scripts/tenant_chat_pii_models/prepare_models.py`: 다운로드·export·양자화·검증
- `scripts/tenant_chat_pii_models/run_synthetic_smoke.py`: 합성 이메일·한국 이름·조직명 smoke
- `scripts/tenant_chat_pii_models/run_ai_service.ps1`: offline AI Service 실행
- `ai-service/requirements-pii-model.lock`: 전체 Python pin
- `reports/`: prompt/value를 제외한 aggregate 평가·latency evidence

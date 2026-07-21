# GateLM LightGBM Embedding Experiment Runbook

| Field | Value |
|---|---|
| Status | Offline tooling runbook; not an active runtime contract |
| CLI | `gatelm-lightgbm-embedding-experiment` |
| Config schema | [`schemas/lightgbm-embedding-experiment-config.schema.json`](schemas/lightgbm-embedding-experiment-config.schema.json) |
| Evidence schema | [`schemas/lightgbm-embedding-aggregate-evidence.schema.json`](schemas/lightgbm-embedding-aggregate-evidence.schema.json) |
| Protocol | [`lightgbm-embedding-hyperparameter-experiment-design.md`](lightgbm-embedding-hyperparameter-experiment-design.md) |
| Report template | [`lightgbm-embedding-hyperparameter-experiment-report-template.md`](lightgbm-embedding-hyperparameter-experiment-report-template.md) |
| Execution authorization | Not granted by this document |
| Runtime promotion | Not allowed |

이 문서는 embedding-only LightGBM 실험 도구의 입력 경계와 단계별 실행 방법을 설명한다. 현재 15,000건 candidate dataset은 `training_eligible=false`이므로 `validate`의 dataset gate에서 거부되어야 한다. 이 문서와 코드의 존재는 실제 embedding 생성, 학습, calibration, threshold 선택 또는 Test 접근 승인이 아니다.

## 1. 설치와 고정 환경

공식 실행 기준은 Python 3.12, `lightgbm==4.6.0`, CPU, 단일 thread다. 필요한 dependency는 `lightgbm-embedding-experiment` optional extra에 고정되어 있다. 실험 작업은 네트워크가 차단된 상태에서 미리 staging하고 hash를 검증한 local encoder artifact만 사용한다. CLI는 remote model download와 임의 module import 경로를 제공하지 않는다.

```powershell
python -m pip install -e "scripts/routing_difficulty_model[lightgbm-embedding-experiment,e5-encoder]"
```

위 설치 명령은 환경 준비 예시다. 이 저장소 구현 작업에서는 실행하지 않았다.

## 2. 입력 격리

설정은 Train, Validation, Test와 safe Test membership을 서로 다른 파일로 지정한다.

| Input | 허용 단계 | 내용 |
|---|---|---|
| Train JSONL | `validate`, `tune` | 승인된 safe text, label, family, category, champion prediction, slice membership |
| Validation JSONL | `validate`, `tune` | calibration/threshold 선택용 승인 데이터 |
| Test JSONL | `evaluate-test`만 | pre-Test freeze와 Test 승인 뒤 한 번만 읽음 |
| Safe Test membership | `validate` | content와 label이 없는 record/family identity SHA-256 |
| Dataset manifest | `validate` 이후 모든 단계 | training eligibility, review와 immutable dataset identity |

`tune`에는 Test loader가 존재하지 않는다. `evaluate-test`는 freeze와 artifact hash를 먼저 검증하고 exclusive consumed-access record를 durable하게 만든 뒤에만 Test loader를 호출한다. Loader나 평가가 실패해도 해당 freeze의 Test access는 이미 소비된 것으로 취급한다.

각 Train/Validation/Test JSONL record는 다음 필드만 사용한다.

```text
sample_id
family_id
split
label
category
redacted_prompt
champion_prediction
slices
```

`redacted_prompt`는 승인된 데이터 source에서 encoder 입력으로 process memory에만 사용한다. Report, metadata, log, exception 또는 artifact로 복사하지 않는다.

## 3. 단계

### `validate`

- dataset manifest의 training eligibility와 hash를 확인한다.
- Train/Validation metadata, label, category와 family 분리를 확인한다.
- safe Test membership으로 cross-split family 누수를 확인한다.
- 공통 `StratifiedGroupKFold` 5-fold와 80개 candidate manifest를 결정론적으로 생성한다.
- model training과 Test outcome 접근은 하지 않는다.

```powershell
gatelm-lightgbm-embedding-experiment validate --config <approved-config.json>
```

### `tune`

- 명시적 experiment execution approval reference가 필수다.
- Train과 Validation 파일만 읽고 embedding을 process memory에서 생성한다.
- 같은 5-fold에서 baseline과 frozen 80개 candidate를 평가한다.
- selected parameter refit, Train OOF calibration, Validation threshold scenario를 수행한다.
- `--smoke`는 frozen 목록의 앞 30개만 실행하며 freeze 근거로 사용할 수 없다.

```powershell
gatelm-lightgbm-embedding-experiment tune `
  --config <approved-config.json> `
  --execution-approval-reference <approval-reference>
```

### `prepare-freeze`

Full 80-candidate tuning evidence만 받아 dataset, split/fold, encoder, candidate set, model, calibrator, code/config, champion과 slice policy identity를 하나의 candidate로 묶는다. `C_FN`을 선택하지 않는다.

```powershell
gatelm-lightgbm-embedding-experiment prepare-freeze --config <approved-config.json>
```

### `freeze`

Product/routing owner가 Validation evidence에 실제 존재하는 feasible `C_FN`과 exact threshold를 지정해야 한다. Owner reference와 RFC 3339 UTC timestamp가 없거나 선택값이 evidence와 다르면 거부한다.

```powershell
gatelm-lightgbm-embedding-experiment freeze `
  --config <approved-config.json> `
  --c-fn <1|3|5|10> `
  --threshold <exact-validation-threshold> `
  --owner-decision-reference <decision-reference> `
  --owner-decision-timestamp <YYYY-MM-DDTHH:MM:SSZ>
```

### `evaluate-test`

유효한 freeze, 일치하는 model/calibrator hash, frozen candidate 한 개와 별도 Test 실행 승인이 모두 필요하다. Access record가 이미 존재하면 같은 freeze의 두 번째 실행을 거부한다. Test에서 dimension, parameter, calibrator, `C_FN` 또는 threshold를 다시 선택하지 않는다.

```powershell
gatelm-lightgbm-embedding-experiment evaluate-test `
  --config <approved-config.json> `
  --authorization-reference <test-approval-reference> `
  --authorization-timestamp <YYYY-MM-DDTHH:MM:SSZ>
```

### `render-report`

존재하는 aggregate stage evidence만 읽어 JSON evidence와 Markdown report를 생성한다. Test를 실행하지 않은 상태에서는 Test 수치를 `not_evaluated`로 남기며 임의 metric을 만들지 않는다.

```powershell
gatelm-lightgbm-embedding-experiment render-report --config <approved-config.json>
```

## 4. 산출물

허용 산출물은 다음으로 제한된다.

- candidate/fold safe manifest
- aggregate validation, baseline, CV, calibration과 threshold evidence
- selected LightGBM text model
- JSON calibrator parameter artifact
- immutable offline metadata
- pre-Test freeze candidate와 freeze record
- consumed Test access record
- aggregate Test evidence와 Markdown report

Embedding, matrix, raw logit, sample별 probability/score, feature contribution, tree path와 bootstrap sample은 저장하지 않는다. 모든 JSON은 key sort, UTF-8, final newline으로 결정론적으로 작성하고 output root 밖의 path를 거부한다.

## 5. 검증

실험을 실행하지 않는 구현 검증은 다음 명령을 사용한다.

```powershell
corepack pnpm run verify:routing-lightgbm-embedding-experiment
$env:PYTHONPATH = "scripts/routing_difficulty_model"
python -m unittest discover -s scripts/routing_difficulty_model/tests -p "test_*.py"
corepack pnpm run verify:v2-docs
git diff --check
```

LightGBM이 설치되지 않은 환경에서는 synthetic LightGBM integration test만 명시적으로 skip하고 core pure-function tests는 계속 실행한다. 실제 `tune`, `freeze`, `evaluate-test`는 별도 승인 작업에서만 실행한다.

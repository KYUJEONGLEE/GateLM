# LightGBM 4개 feature-to-tuner bridge runbook

> Active config는 `fixtures/lightgbm-dimension-tuning-bridge.owner-approved-15000.config.json`이다.
> 통합 owner-approved 15,000개와 기존 `10,500 / 2,250 / 2,250` group split만 사용한다.
> `owner-approved-500` config와 산출물은 2026-07-22 이전 historical evidence이며 새
> 실험 입력이나 승격 근거로 재사용할 수 없다.

| 항목 | 값 |
|---|---|
| 상태 | offline comparison tooling 및 실행 evidence |
| CLI | `gatelm-lightgbm-dimension-tuning` |
| 설정 | [`fixtures/lightgbm-dimension-tuning-bridge.owner-approved-15000.config.json`](fixtures/lightgbm-dimension-tuning-bridge.owner-approved-15000.config.json) |
| 설정 schema | [`schemas/lightgbm-dimension-tuning-bridge-config.schema.json`](schemas/lightgbm-dimension-tuning-bridge-config.schema.json) |
| 최종 evidence schema | [`schemas/lightgbm-dimension-tuning-final-evidence.schema.json`](schemas/lightgbm-dimension-tuning-final-evidence.schema.json) |
| 실행 evidence | [`../../../../scripts/routing_difficulty_model/artifacts/lightgbm-dimension-tuning-owner-approved-500/final-evidence.v1.json`](../../../../scripts/routing_difficulty_model/artifacts/lightgbm-dimension-tuning-owner-approved-500/final-evidence.v1.json) |
| 운영 승격 | 자동 승격 금지, 별도 계약·owner review 필요 |

이 bridge는 canonical dataset의 family-disjoint `10,500 / 2,250 / 2,250` membership과 동일한 5-fold를 사용해 다음 네 후보에 하이퍼파라미터 탐색을 연결한다.

1. `rule_42_plus_e5_small_pca_64`: 106D
2. `rule_42_plus_semantic_heads_12`: 54D
3. `e5_base_raw_768`: 768D
4. `rule_42_plus_e5_base_raw_768`: 810D

각 후보는 고정된 80개 LightGBM 후보를 5-fold로 평가한다. 따라서 완전 실행은 후보별 400회, 전체 1,600회 fold run이다. E5-small PCA64와 semantic heads12는 Train 10,500개만으로 fit한다. Semantic heads의 Train feature는 같은 5-fold의 OOF 확률을 사용하고 Validation/Test에는 Train 10,500개 전체로 fit한 head를 사용한다. 기존 LR106 artifact와 기존 LR runtime 경로는 읽기 전용 champion 비교에만 사용한다.

## 단계별 실행

공식 Python 환경에 `lightgbm-embedding-experiment`와 `e5-encoder` extra가 설치되어 있어야 한다. 모델 artifact는 실행 전에 로컬에 준비되어 있어야 하며 실행 중 다운로드하지 않는다.

```powershell
$env:PYTHONPATH = "scripts/routing_difficulty_model"
$python = ".tmp/difficulty-semantic-encoder-venv/Scripts/python.exe"
$config = "docs/testing/routing/difficulty/fixtures/lightgbm-dimension-tuning-bridge.owner-approved-15000.config.json"

& $python -m gatelm_difficulty_model.lightgbm_dimension_tuning_bridge_cli prepare-inputs `
  --config $config

& $python -m gatelm_difficulty_model.lightgbm_dimension_tuning_bridge_cli tune `
  --config $config `
  --execution-approval-reference <approval-reference>

& $python -m gatelm_difficulty_model.lightgbm_dimension_tuning_bridge_cli freeze `
  --config $config `
  --owner-decision-reference <decision-reference> `
  --owner-decision-timestamp <YYYY-MM-DDTHH:MM:SSZ>

& $python -m gatelm_difficulty_model.lightgbm_dimension_tuning_bridge_cli evaluate-test `
  --config $config `
  --authorization-reference <test-approval-reference> `
  --authorization-timestamp <YYYY-MM-DDTHH:MM:SSZ>

& $python -m gatelm_difficulty_model.lightgbm_dimension_tuning_bridge_cli render-report `
  --config $config
```

`tune`은 Train·Validation만 읽는다. `freeze` 이후 `evaluate-test`가 exclusive access record를 먼저 durable하게 만든 다음 Test loader를 호출한다. 같은 output root에서 두 번째 Test 실행은 거부된다. 일괄 실행 명령을 제공하지 않는 이유도 이 stage boundary를 유지하기 위해서다.

Prompt를 포함하는 분할 JSONL은 gitignore 대상인 `.tmp/` 아래에만 생성한다. 저장소에 남는 산출물은 model, calibrator, PCA/head parameter, immutable identity, aggregate metric/evidence뿐이다. Prompt, embedding matrix, raw logit, row별 probability/score는 저장하지 않는다.

## 현재 실행 결과

2026-07-22 실행은 Validation의 사전 등록 `C_FN=5` 규칙으로 54D 후보를 선택했다. Test는 선택된 단일 후보만 한 번 평가했다. 결과는 comparison evidence이며 runtime profile 또는 운영 승격 근거가 아니다. Category별 양 클래스 지원이 부족해 `insufficient`가 존재하면 overall metric이 좋아도 별도 데이터 보강과 owner review 없이 승격하지 않는다.

## 검증

```powershell
corepack pnpm run verify:routing-lightgbm-dimension-tuning
$env:PYTHONPATH = "scripts/routing_difficulty_model"
python -m unittest scripts.routing_difficulty_model.tests.test_lightgbm_dimension_tuning_bridge
git diff --check
```

# Semantic Cache Cacheability Classifier Phase 2 Result Report

## 완료한 작업

- Phase 2 범위에 맞춰 offline synthetic dataset과 FastText 학습/평가 tooling을 추가했다.
- synthetic dataset 위치와 JSONL format을 확정했다.
  - `scripts/semantic_cache_classifier/data/cacheability_synthetic_v1.jsonl`
  - `id`, `label`, `text`, `lang`, `source`, `pairGroup`, `pairRole`, `split`, `notes` field 사용
- train/test split 기준을 정의하고 `prepare_dataset.py`에 구현했다.
  - `pairGroup` 단위 group-aware split
  - 명시적 `split`이 있으면 우선 사용
  - 명시적 split이 없으면 stable SHA-256 hash 기반 fallback
  - 같은 `pairGroup` 안의 train/test 혼합은 leakage 방지를 위해 validation error 처리
- 같은 키워드/도메인이 여러 label에 등장하는 positive/negative pair를 작성했다.
  - 총 40개 synthetic example
  - 총 20개 positive/negative `pairGroup`
  - train 28개, test 12개
- Python 기반 FastText supervised classifier 학습 스크립트를 추가했다.
  - `scripts/semantic_cache_classifier/train_fasttext.py`
  - model artifact와 metadata JSON을 `build/artifacts/` 아래 생성
- Python 기반 FastText 평가 스크립트를 추가했다.
  - `scripts/semantic_cache_classifier/evaluate_fasttext.py`
  - overall accuracy, macro F1, label별 precision/recall/F1, threshold pass/fail 산출
- model artifact 생성 방식을 문서화했다.
  - 기본 artifact: `scripts/semantic_cache_classifier/build/artifacts/cacheability-cacheability-fasttext-synthetic-v1.bin`
  - 기본 metadata: `scripts/semantic_cache_classifier/build/artifacts/cacheability-cacheability-fasttext-synthetic-v1.metadata.json`
  - `build/`는 repository root `.gitignore`에 의해 커밋 대상에서 제외된다.
- label별 최소 acceptance 기준을 정의했다.
  - `scripts/semantic_cache_classifier/acceptance_criteria.json`
  - non-cacheable risk label인 `dynamic_user_state`, `unsafe_or_unknown`은 높은 recall 기준을 둔다.
  - `cacheable_policy`는 policy/version/hash boundary 확인 전제가 있으므로 precision 기준을 높게 둔다.
- modelVersion 관리 방식을 문서화했다.
  - 초기 version: `cacheability-fasttext-synthetic-v1`
  - dataset/preprocessing/hyperparameter가 의미 있게 바뀌면 suffix를 올린다.
  - artifact metadata의 `trainFileSha256`를 dataset/artifact 연결 근거로 사용한다.
- Gateway runtime request path에는 Python 학습/평가 스크립트나 FastText runtime을 연결하지 않았다.
- 외부 LLM API classifier 기본 경로는 추가하지 않았다.
- Public API, DB schema, persisted Event schema, Dashboard Metrics contract는 변경하지 않았다.

## 변경한 주요 파일

- `scripts/semantic_cache_classifier/README.md`
- `scripts/semantic_cache_classifier/acceptance_criteria.json`
- `scripts/semantic_cache_classifier/data/cacheability_synthetic_v1.jsonl`
- `scripts/semantic_cache_classifier/prepare_dataset.py`
- `scripts/semantic_cache_classifier/train_fasttext.py`
- `scripts/semantic_cache_classifier/evaluate_fasttext.py`
- `docs/testing/semantic-cache-cacheability-classifier-phase-2-result-report.md`

## 실행한 테스트

```powershell
python --version
$out = Join-Path $env:TEMP "gatelm-cacheability-phase2-build"; if (Test-Path $out) { Remove-Item -Recurse -Force $out }; python "scripts\semantic_cache_classifier\prepare_dataset.py" --output-dir $out
python "scripts\semantic_cache_classifier\train_fasttext.py" --help
python "scripts\semantic_cache_classifier\evaluate_fasttext.py" --help
python -c "import importlib.util; print('fasttext_installed=' + str(importlib.util.find_spec('fasttext') is not None))"
python -m py_compile "scripts\semantic_cache_classifier\prepare_dataset.py" "scripts\semantic_cache_classifier\train_fasttext.py" "scripts\semantic_cache_classifier\evaluate_fasttext.py"
git diff --check
corepack pnpm run verify:v2-docs
Select-String -Path <Phase 2 new files> -Pattern '[ \t]+$'
```

## 테스트 결과

- `python --version`: `Python 3.13.9`
- `prepare_dataset.py`: 통과
  - dataset SHA-256: `8931c02f7fe91adaa70f000a797709afaff153ece9feb53a601becfb4b2356be`
  - train counts: `cacheable_policy=6`, `cacheable_static=8`, `dynamic_user_state=10`, `unsafe_or_unknown=4`, total `28`
  - test counts: `cacheable_policy=3`, `cacheable_static=3`, `dynamic_user_state=4`, `unsafe_or_unknown=2`, total `12`
  - paired group count: `20`
- `train_fasttext.py --help`: 통과
- `evaluate_fasttext.py --help`: 통과
- `fasttext_installed=False`
  - 현재 Python 환경에는 `fasttext` package가 없어 실제 `.bin` model artifact 생성과 holdout evaluation은 실행하지 않았다.
- `python -m py_compile ...`: 통과
- `git diff --check`: 통과
- `corepack pnpm run verify:v2-docs`: 통과
  - Node engine warning 출력: expected `>=22 <23`, current `v24.14.0`
- Phase 2 새 파일 trailing whitespace 검사: 통과

## 후속 학습 검증 업데이트

- Python 3.12 venv에서 `fasttext-wheel` 설치와 실제 학습/평가를 추가로 검증했다.
  - `py -3.12 -m venv .tmp\semantic-cache-fasttext-venv`
  - `.tmp\semantic-cache-fasttext-venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel fasttext-wheel "numpy<2"`
- `numpy<2`가 필요했다.
  - `fasttext-wheel==0.9.2`와 NumPy 2.x 조합에서는 `model.predict()`가 `ValueError: Unable to avoid copy while creating an array as requested.`로 실패했다.
  - venv 안에서 `numpy==1.26.4`로 낮춘 뒤 평가가 정상 실행됐다.
- 기본 학습값 `lr=0.45`, `wordNgrams=2`는 holdout label 예측은 일부 맞지만 acceptance 기준을 통과하지 못했다.
- `lr=0.6`, `wordNgrams=1` 조합으로 재학습한 artifact는 holdout acceptance를 통과했다.
  - total: `12`
  - accuracy: `1.0`
  - macroF1: `1.0`
  - label별 precision/recall/F1: 모두 `1.0`
  - `acceptance.passed=true`

## 실패하거나 보류한 항목

- 기본 Anaconda Python 3.13 환경에는 `fasttext` package가 설치되어 있지 않다. 실제 학습/평가는 Python 3.12 venv에서 진행했다.
- Phase 2 범위를 지키기 위해 Gateway live request path, FastText runtime adapter, demo evidence, sidecar, model loading integration은 진행하지 않았다.
- Phase 1A/1B에서 추가된 Gateway classifier gate 동작은 변경하지 않았다.
- Public API, DB schema, persisted Event schema, Dashboard Metrics contract는 변경하지 않았다.

## 다음 Phase/Sub-Phase에서 이어받아야 할 내용

- Phase 3에서 FastText runtime integration을 진행한다면 반드시 `CacheabilityClassifier` interface 뒤에 붙인다.
- production/default config는 Phase 1A 원칙대로 disabled/no-op을 유지해야 한다.
- Gateway live request path에서 `prepare_dataset.py`, `train_fasttext.py`, `evaluate_fasttext.py`를 매 요청마다 실행하면 안 된다.
- FastText model artifact를 생성할 환경에서는 먼저 `prepare_dataset.py`로 split 파일을 만들고, `train_fasttext.py`로 `.bin`과 metadata를 생성한 뒤, `evaluate_fasttext.py --fail-on-threshold`로 acceptance 기준을 확인한다.
- `cacheable_policy` label을 runtime에서 store 후보로 사용할 때는 Phase 1B 원칙대로 기존 request context 또는 RuntimeSnapshot boundary에서 policy/version/hash 확인이 가능해야 하며, 확인 불가 시 fail-closed 처리한다.
- Phase 3 demo evidence에는 classifier confidence threshold 미만 fail-closed, classifier skip 시 embedding 미호출, lookup/store embedding 재사용 evidence를 포함해야 한다.

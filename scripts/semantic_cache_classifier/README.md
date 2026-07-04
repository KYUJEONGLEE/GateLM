# Semantic Cache Cacheability Classifier Offline Training

This directory contains Phase 2 offline tooling for the Semantic Cache cacheability classifier.

The scripts in this directory are not part of the Gateway live request path. Gateway runtime must not execute `prepare_dataset.py`, `train_fasttext.py`, or `evaluate_fasttext.py` per request. Runtime integration belongs to a later phase and must stay behind the internal `CacheabilityClassifier` interface.

## Dataset

Canonical synthetic dataset:

```text
scripts/semantic_cache_classifier/data/cacheability_synthetic_v2.jsonl
```

Each line is one JSON object with the following fields:

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Stable synthetic example id. |
| `label` | yes | One of `cacheable_static`, `cacheable_policy`, `dynamic_user_state`, `unsafe_or_unknown`. |
| `text` | yes | Synthetic request-like text used for FastText training. Do not use real user prompts, secrets, or personal data. |
| `lang` | yes | Language hint, currently `ko`, `en`, or `ko-en`. |
| `source` | yes | Dataset source/version marker. |
| `pairGroup` | yes | Stable group for positive/negative contrast examples sharing a keyword or domain. |
| `pairRole` | yes | `positive` for cacheable candidates, `negative` for non-cacheable contrasts. |
| `split` | no | Optional explicit `train` or `test`. If omitted, `prepare_dataset.py` assigns a deterministic group-aware split. |
| `notes` | no | Short sanitized rationale for maintainers. |

FastText supervised files are generated from `label` and `text`:

```text
__label__cacheable_static synthetic text...
```

The dataset intentionally includes the same keywords across cacheable and non-cacheable labels. This is required so the model learns cacheability risk instead of simple keyword matching.

The current `synthetic_v2` dataset is generated from sanitized templates:

```powershell
python scripts/semantic_cache_classifier/generate_synthetic_dataset.py
```

It produces 384 examples across 96 `pairGroup` values. Each group contains one example for each label so train/test splits remain balanced by label while still avoiding pair leakage. The dataset includes hard negative groups for time-sensitive, live-state, user-state, and boundary-missing prompts such as weather, exchange rates, stock prices, breaking news, quota, routing, permissions, and raw provider errors.

## Split Rule

`prepare_dataset.py` applies this split rule:

1. If every record in a `pairGroup` has the same explicit `split`, use that split.
2. If `split` is absent, assign the entire `pairGroup` by stable SHA-256 hash using `--seed` and `--test-ratio`.
3. Mixed train/test records inside one `pairGroup` are rejected to avoid pair leakage.
4. The generated manifest records per-label counts for train and test.

Default generated files:

```text
scripts/semantic_cache_classifier/build/cacheability.train.txt
scripts/semantic_cache_classifier/build/cacheability.test.txt
scripts/semantic_cache_classifier/build/cacheability.dataset_manifest.json
```

The repository root ignores `build/`, so generated split files and model artifacts should not be committed.

## Model Artifact

Training command:

```powershell
python scripts/semantic_cache_classifier/prepare_dataset.py
python scripts/semantic_cache_classifier/train_fasttext.py --model-version cacheability-fasttext-synthetic-v2
```

Windows local setup that has been verified:

```powershell
py -3.12 -m venv .tmp\semantic-cache-fasttext-venv
.tmp\semantic-cache-fasttext-venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel fasttext-wheel "numpy<2"
```

`fasttext-wheel==0.9.2` currently imports as `fasttext`. Keep `numpy<2` in this venv because FastText 0.9.2 prediction can fail with NumPy 2.x.

The checked default training hyperparameters for the synthetic v2 dataset are:

```text
epoch=35
lr=0.6
wordNgrams=1
dim=64
minCount=1
loss=softmax
```

Default artifact outputs:

```text
scripts/semantic_cache_classifier/build/artifacts/cacheability-cacheability-fasttext-synthetic-v2.bin
scripts/semantic_cache_classifier/build/artifacts/cacheability-cacheability-fasttext-synthetic-v2.metadata.json
```

The metadata file records:

- `modelVersion`
- training file hash
- classifier labels
- FastText hyperparameters
- artifact filename
- offline-only runtime boundary note

## Evaluation

Evaluation command:

```powershell
python scripts/semantic_cache_classifier/evaluate_fasttext.py `
  --model-file scripts/semantic_cache_classifier/build/artifacts/cacheability-cacheability-fasttext-synthetic-v2.bin `
  --fail-on-threshold
```

The evaluation script reads `acceptance_criteria.json` by default and reports overall accuracy, macro F1, per-label precision/recall/F1, and threshold pass/fail details.

## Ad Hoc Prompt Check

Use `classify_prompt.py` to inspect how the trained artifact classifies a prompt:

```powershell
.tmp\semantic-cache-fasttext-venv\Scripts\python.exe scripts\semantic_cache_classifier\classify_prompt.py --text "비밀번호 재설정 방법을 알려줘"
```

Omit `--text` to start interactive mode:

```powershell
.tmp\semantic-cache-fasttext-venv\Scripts\python.exe scripts\semantic_cache_classifier\classify_prompt.py
```

## CLINC150 Relabeling Review

CLINC150 can be used as an external auxiliary source for cacheability relabeling review. It is not committed to this repository by default.

Generate a draft review packet from a local or downloaded CLINC150 `data_full.json`:

```powershell
.tmp\semantic-cache-fasttext-venv\Scripts\python.exe scripts\semantic_cache_classifier\import_clinc150.py --download --sample-per-intent 5
```

Default outputs are ignored under `build/` because they include CLINC150 utterance text:

```text
scripts/semantic_cache_classifier/build/clinc150_review/clinc150_summary.json
scripts/semantic_cache_classifier/build/clinc150_review/clinc150_intent_label_map_draft.json
scripts/semantic_cache_classifier/build/clinc150_review/clinc150_review_sample.csv
scripts/semantic_cache_classifier/build/clinc150_review/cacheability_clinc150_relabel_draft.jsonl
```

All generated CLINC150 labels are draft suggestions with `reviewStatus=review_required`. Do not mix them into training data until the label map and sampled utterances have been manually reviewed.

## KoAlpaca-RealQA Relabeling Review

KoAlpaca-RealQA is a better source for Korean prompt-style cacheability review than CLINC150, but the Hugging Face dataset is gated and licensed as `CC-BY-SA-4.0`. Accept the dataset conditions first and set `HF_TOKEN`, `HUGGINGFACE_HUB_TOKEN`, or `HF_HUB_TOKEN` before downloading.

```powershell
.tmp\semantic-cache-fasttext-venv\Scripts\python.exe -m pip install pyarrow
.tmp\semantic-cache-fasttext-venv\Scripts\python.exe scripts\semantic_cache_classifier\import_koalpaca_realqa.py --download --sample-per-label 200
```

Default outputs are ignored under `build/` because they include Korean real-user-style prompts:

```text
scripts/semantic_cache_classifier/build/koalpaca_realqa_review/koalpaca_realqa_summary.json
scripts/semantic_cache_classifier/build/koalpaca_realqa_review/koalpaca_realqa_review_sample.csv
scripts/semantic_cache_classifier/build/koalpaca_realqa_review/cacheability_koalpaca_realqa_relabel_draft.jsonl
```

All generated KoAlpaca-RealQA labels are draft suggestions with `reviewStatus=review_required`. Use the review sample as a hard holdout candidate first; do not mix it into training data until privacy, attribution, license, and label review are complete.

## AI Hub Korean Dialogue Relabeling Review

AI Hub Korean Dialogue can be used as a Korean Q/A dialogue relabeling source after the dataset download is approved on AI Hub. Pass the downloaded ZIP file or extracted directory to the importer:

```powershell
.tmp\semantic-cache-fasttext-venv\Scripts\python.exe scripts\semantic_cache_classifier\import_aihub_korean_dialogue.py --source-path .tmp\aihub_korean_dialogue --sample-per-label 200
```

Supported source inputs:

```text
directory containing JSON/JSONL/CSV/TSV/ZIP files
single ZIP file
single JSON/JSONL/CSV/TSV file
```

Default outputs are ignored under `build/` because they may include Korean dialogue text:

```text
scripts/semantic_cache_classifier/build/aihub_korean_dialogue_review/aihub_korean_dialogue_summary.json
scripts/semantic_cache_classifier/build/aihub_korean_dialogue_review/aihub_korean_dialogue_review_sample.csv
scripts/semantic_cache_classifier/build/aihub_korean_dialogue_review/cacheability_aihub_korean_dialogue_relabel_draft.jsonl
```

The importer extracts likely user utterance fields such as main question, user answer, and Korean equivalents. System answer fields are excluded by default. All generated labels are draft suggestions with `reviewStatus=review_required`.

## Runtime Sidecar

Phase 3 adds an optional HTTP sidecar path for Gateway runtime integration. The sidecar loads a trained `.bin` artifact once at process startup and serves classification over HTTP:

```powershell
python scripts/semantic_cache_classifier/serve_fasttext_classifier.py `
  --model-file scripts/semantic_cache_classifier/build/artifacts/cacheability-cacheability-fasttext-synthetic-v2.bin `
  --model-version cacheability-fasttext-synthetic-v2 `
  --host 127.0.0.1 `
  --port 8765
```

Gateway env for the sidecar path:

```dotenv
SEMANTIC_CACHE_CLASSIFIER_ENABLED=true
SEMANTIC_CACHE_CLASSIFIER_TYPE=fasttext
SEMANTIC_CACHE_CLASSIFIER_ENDPOINT=http://127.0.0.1:8765/classify
SEMANTIC_CACHE_CLASSIFIER_MIN_CONFIDENCE=0.90
SEMANTIC_CACHE_CLASSIFIER_TIMEOUT_MS=30
```

This runtime path calls only the already-running sidecar. It does not invoke `prepare_dataset.py`, `train_fasttext.py`, or `evaluate_fasttext.py` per Gateway request.

## Acceptance

Minimum acceptance criteria are defined in:

```text
scripts/semantic_cache_classifier/acceptance_criteria.json
```

The high-risk labels `dynamic_user_state` and `unsafe_or_unknown` use stricter recall thresholds because false cacheable predictions must fail closed. `cacheable_policy` requires strong precision because policy explanations can only be reused when the Gateway boundary already includes a verified policy/version/hash from existing runtime context.

## Model Version

Current default model version:

```text
cacheability-fasttext-synthetic-v2
```

Versioning rules:

- Increment the suffix when the committed dataset, labels, preprocessing, or training hyperparameters change materially.
- Keep the model artifact metadata next to the `.bin` artifact.
- Treat `datasetSha256` in the generated dataset manifest and `trainFileSha256` in model metadata as the reproducibility link between dataset and artifact.
- Do not introduce a public API, DB field, Event field, or Metrics label solely for model versioning in Phase 2.

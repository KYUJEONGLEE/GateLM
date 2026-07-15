# GateLM Difficulty E5 Encoder Contract

| Field | Value |
|---|---|
| Status | Canonical offline component; Gateway runtime에는 미활성 |
| Model | `intfloat/multilingual-e5-small` |
| Source revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| Runtime | NumPy + ONNX Runtime CPU, dynamic QInt8 |
| Canonical output | L2-normalized `float32[batch,64]` |
| Manifest | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v1.json`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v1.json) |
| PCA artifact | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-pca-64.npz`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-pca-64.npz) |
| Last reviewed | 2026-07-15 |

이 계약은 difficulty semantic 후보가 사용하는 유일한 offline encoder 경로를 고정한다. 과거의 다중 encoder 후보 benchmark, custom 128-token head-tail 처리와 provisional projection은 사용하지 않는다. 이 component의 존재는 Gateway hot path 또는 active routing contract의 변경을 뜻하지 않는다.

## 1. Canonical Pipeline

```text
PromptFeatures.instructionText
  -> 빈 문자열이면 not_applicable
  -> "query: " prefix
  -> Hugging Face tokenizer
     - special tokens 포함
     - max_length=128
     - right truncation
     - batch-longest right padding
  -> int64 input_ids + attention_mask (+ token_type_ids)
  -> pinned multilingual-e5-small dynamic-QInt8 ONNX
  -> float32 last_hidden_state[batch,sequence,384]
  -> attention-mask mean pooling
  -> raw pooled float32[batch,384]
  -> train-only PCA: (pooled - mean[384]) @ components[64,384].T
  -> L2 normalization(epsilon=1e-12)
  -> float32[batch,64]
```

Attention-mask mean pooling은 mask가 `1`인 token만 합산하고 각 sample의 유효 token 수로 나눈다. Padding 위치는 pooling에서 제외한다. 모든 token mask가 `0`이거나 intermediate가 non-finite이면 `invalid_embedding`으로 fail closed한다.

Tokenizer와 encoder에는 `instructionText`만 전달한다. `normalizedText`, `payloadText`, raw prompt 전체, attachment body 또는 provider/model metadata로 fallback하지 않는다. Empty instruction은 tokenizer를 호출하거나 zero vector로 바꾸지 않고 `not_applicable`로 제외한다.

## 2. PCA Fit Contract

PCA는 owner-approved dataset의 `train` 300건에서 얻은 **L2 정규화 전 raw pooled E5 embedding**만으로 fit한다. Calibration 100건과 untouched holdout 100건은 PCA fit에 사용할 수 없다. Split은 `difficulty-family-constrained-split.2026-07-15.v1`, seed `20260715`이며 prompt family가 split 사이에 겹치면 안 된다.

```python
pca = PCA(n_components=64, svd_solver="full", whiten=False)
pca.fit(train_embeddings)  # exact shape [300,384]

projected = (pooled_embedding - pca.mean_) @ pca.components_.T
projected /= max(np.linalg.norm(projected), 1e-12)
```

Committed NPZ는 `mean`의 exact shape `[384]`과 `components`의 exact shape `[64,384]`만 포함한다. 두 array는 finite `float32`여야 한다. PCA parameter, file, source dataset과 runtime component hash는 manifest로 검증한다. Projection norm이 finite가 아니거나 `1e-12` 이하이면 zero vector를 반환하지 않고 `invalid_embedding`으로 처리한다.

### 2.1 Candidate selection과 untouched Holdout

42D·106D·118D candidate는 `difficulty-semantic-candidate-selection.2026-07-15.v1`에 따라 calibration split의 selected-calibrator family-grouped CV log loss로 선택한다. Tie는 Brier score, lower dimension 순서로만 해소한다. Candidate별 Holdout metric을 생성하거나 Holdout accuracy로 candidate를 선택하면 안 된다.

선택된 candidate의 model, calibrator, threshold, encoder/PCA/semantic-head hash를 먼저 freeze한 다음 그 candidate만 untouched Holdout 100건에 한 번 적용한다. Non-selected candidate report에는 Holdout outcome을 남기지 않는다. Holdout 결과를 확인한 뒤 feature, model, calibrator 또는 threshold 중 하나라도 변경하면 기존 final evidence를 폐기하고 새 evidence run으로 취급한다. 이때 새 immutable artifact version과 기존에 결과를 확인한 Holdout을 포함하지 않는 새 untouched Holdout으로 다시 검증해야 하며, 현재 Holdout을 반복 튜닝에 사용하면 leakage다.

## 3. Artifact And Distribution Contract

PCA NPZ와 작은 manifest는 source control에 포함한다. Tokenizer와 ONNX model처럼 큰 runtime artifact는 Git에 포함하지 않는다. 개발 환경에서는 `.tmp/difficulty-semantic-encoder-artifacts`의 로컬 artifact cache에 exact pinned revision과 hash로 준비한다.

배포 환경은 다음 규칙을 지켜야 한다.

- 향후 Docker image build 단계에서 manifest에 나열된 tokenizer 파일과 dynamic-QInt8 ONNX model을 image에 반드시 포함한다.
- 같은 image에는 committed PCA NPZ와 manifest도 함께 포함한다.
- Container/runtime 시작 이후 Hugging Face 또는 다른 network source에서 artifact를 다운로드하면 안 된다.
- 시작 시 모든 runtime artifact의 path, byte size와 SHA-256, PCA file/parameter hash와 manifest bundle hash를 검증한다.
- 누락, hash mismatch, shape mismatch 또는 지원하지 않는 revision이면 encoder를 실행하지 않고 fail closed한다.

`prepare`는 개발 또는 image build처럼 명시적으로 허용된 artifact 준비 단계에서만 network를 사용할 수 있다. `fit-pca`, `verify`, semantic-head training과 실제 inference는 local-only이며 network-disabled 상태로 실행한다.

## 4. Data Safety

Token text, token ID, attention mask, hidden state, pooled 384D embedding, projected 64D embedding과 semantic-head input/output은 process-local 민감 파생값이다. API, DB, Event, Metrics, structured log, report, fixture, artifact 또는 cache key에 직렬화하지 않는다. Committed PCA parameter는 request별 파생값이 아니며 immutable model artifact로 취급한다.

## 5. Commands

```powershell
corepack pnpm run v2.1:routing:setup-e5-encoder
corepack pnpm run v2.1:routing:prepare-e5-encoder
corepack pnpm run v2.1:routing:fit-e5-pca
corepack pnpm run v2.1:routing:test-e5-encoder
corepack pnpm run verify:v2.1-e5-encoder
```

`prepare`는 large artifact를 로컬 cache에 만들기 때문에 별도 단계다. 일반 verifier는 network download를 대신 수행하지 않는다.

## 6. Runtime Boundary

이 encoder는 offline evaluation과 semantic-head/difficulty-head artifact 생성에만 사용하며 Gateway request path에서는 아직 실행하지 않는다. Selected 118D checked-in Go bundle은 이 encoder의 attention-mask mean-pooled `float32[384]` 출력 이후 PCA·L2·semantic-head·final score만 재현한다. Tokenizer/ONNX 호출, image packaging과 request-level shadow adapter는 포함하지 않는다. Gateway의 current `difficulty-feature-vector.v1`, rule-based classifier, `DifficultyResult`, RuntimeSnapshot, routing policy, API, DB, Event와 Metrics는 변경하지 않는다.

Gateway hot path 승격 전에는 다음 경계를 모두 충족해야 한다.

- 실패한 per-category safety regression을 새 evidence run에서 해결
- pinned tokenizer·encoder·PCA·semantic-head·difficulty-head·calibrator를 포함하는 image/runtime packaging과 시작 시 hash 검증
- supported runtime의 latency, memory와 failure isolation evidence
- supported runtime별 Python inference와 generated Go inference의 numeric tolerance 및 label parity
- [`contracts.md`](contracts.md), [`classification-pipeline.md`](classification-pipeline.md)와 필요한 verifier를 포함한 active runtime contract 승인

위 조건을 충족한 artifact도 먼저 opt-in shadow로 실행한다. Shadow 결과와 rollback 준비를 검토한 뒤 owner가 exact artifact version, bundle hash와 threshold policy를 명시적으로 promotion해야 하며 자동 승격은 허용하지 않는다.

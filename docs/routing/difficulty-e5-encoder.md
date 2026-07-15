# GateLM Difficulty E5 Encoder Contract

| Field | Value |
|---|---|
| Status | Canonical offline component + opt-in Gateway startup shadow; 제품 request/routing에는 미활성 |
| Model | `intfloat/multilingual-e5-small` |
| Source revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| Runtime | Canonical Python ORT CPU + optional Go/Linux amd64 native ORT CPU, dynamic QInt8 |
| Canonical output | L2-normalized `float32[batch,64]` |
| Manifest | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v1.json`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v1.json) |
| Gateway runtime lock | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-runtime-lock.linux-amd64.v1.json`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-runtime-lock.linux-amd64.v1.json) |
| PCA artifact | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-pca-64.npz`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-pca-64.npz) |
| Last reviewed | 2026-07-15 |

이 계약은 difficulty semantic 후보가 사용하는 유일한 encoder 경로를 고정한다. 과거의 다중 encoder 후보 benchmark, custom 128-token head-tail 처리와 provisional projection은 사용하지 않는다. Optional Gateway image는 같은 경로를 process-local startup shadow로 검증하지만 요청별 결과를 제품 routing에 연결하지 않는다. 이 component의 존재는 active routing contract의 변경을 뜻하지 않는다.

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

Optional Gateway shadow 배포 환경은 다음 규칙을 지켜야 한다.

- [`../../infra/docker/gateway-core-e5-shadow.Dockerfile`](../../infra/docker/gateway-core-e5-shadow.Dockerfile)은 검증된 local bundle을 `difficulty_e5` named build context로만 받는다. 기본 [`../../infra/docker/gateway-core.Dockerfile`](../../infra/docker/gateway-core.Dockerfile)은 계속 CGO-free이며 E5를 포함하지 않는다.
- Optional image build 단계에서 manifest에 나열된 tokenizer 파일, dynamic-QInt8 ONNX model, encoder manifest, Linux amd64 runtime lock과 ONNX Runtime shared library를 포함한다.
- Rust tokenizer static library는 image build에만 사용하고 최종 runtime image에는 넣지 않는다. 최종 image에는 request inference에 필요한 model/tokenizer와 ONNX Runtime shared library만 둔다.
- Container/runtime 시작 이후 Hugging Face 또는 다른 network source에서 artifact를 다운로드하면 안 된다.
- Image build는 [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-image.linux-amd64.v1.sha256`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-image.linux-amd64.v1.sha256)의 exact file allowlist와 전체 checksum을 검증하며 추가 파일과 symlink를 거부한다. Gateway 시작은 runtime lock, 모든 encoder artifact와 ONNX Runtime library의 path, byte size와 SHA-256을 다시 검증한다.
- 누락, hash mismatch, shape mismatch 또는 지원하지 않는 revision이면 encoder를 실행하지 않고 fail closed한다.

Gateway Linux amd64 profile은 `github.com/daulet/tokenizers v1.23.0`과 그 release의 Rust tokenizer core `0.22.0`, `github.com/yalue/onnxruntime_go v1.22.0`, ONNX Runtime `1.22.1`을 고정한다. Canonical Python environment의 tokenizer는 `0.21.2`이므로 버전 문자열을 동일하다고 가정하지 않는다. 대신 Gateway와 동일한 단건 shape에서 고정된 비민감 English/Korean/right-truncation instruction 3건의 pooled 384개 값을 모두 `1e-5` tolerance로 비교한다. QInt8 결과는 batch shape에 따라 미세하게 달라질 수 있으므로 batch와 단건 결과를 직접 parity 기준으로 섞지 않는다. Padding mask 제외는 별도의 순수 pooling test로 검증한다.

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
corepack pnpm run v2.1:routing:setup-gateway-e5-shadow-native
corepack pnpm run v2.1:routing:prepare-gateway-e5-shadow
corepack pnpm run verify:v2.1-difficulty-gateway-bundle
corepack pnpm run verify:v2.1-gateway-e5-shadow
```

`prepare`는 large artifact를 로컬 cache에 만들기 때문에 별도 단계다. Gateway bundle 준비 명령은 이미 존재하는 pinned encoder cache, tokenizer native archive와 ONNX Runtime NuGet package를 검증해 `.tmp` 아래 Docker build context로 조립한다. Native package가 없는 개발 환경은 명시적인 `setup-gateway-e5-shadow-native` 명령에서만 pinned GitHub release/NuGet URL을 사용하며 다운로드 완료 전 임시 파일의 size와 SHA-256을 검증한다. Encoder/model artifact는 기존 `prepare-e5-encoder` 단계가 소유한다. 일반 verifier와 container runtime은 network download를 대신 수행하지 않는다.

## 6. Runtime Boundary

Gateway에는 build tag `difficulty_e5_onnx && linux && cgo`로 제한된 local tokenizer/ONNX adapter와 request-independent startup shadow가 존재한다. `GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED=true`일 때만 artifact를 검증하고 고정된 비민감 instruction으로 tokenizer → QInt8 encoder → attention-mask mean pooling → PCA 64D → 4 semantic head/12D → final 118D score를 한 번 실행한다. 실패하면 Gateway 시작을 중단한다. 지원하지 않는 기본 CGO-free build에서 enable하면 `unavailable`로 fail closed한다.

Package-level evaluator는 실제 `PromptFeatures.instructionText`만 받으며 동시 ONNX 실행을 1개로 제한한다. 빈 instruction은 tokenizer 전 `not_applicable`, 경합은 `busy`, runtime 실패는 안전한 상태 코드로 반환하고 raw text, token, embedding, head output 또는 native error detail을 노출하지 않는다. 현재 Gateway router는 이 evaluator를 제품 요청에 등록하지 않는다. 따라서 startup shadow 결과는 routing, RuntimeSnapshot, API, DB, Event, Metrics, log schema와 `difficulty-feature-vector.v1` 42차원 외부 계약을 변경하지 않는다.

Selected 118D checked-in Go bundle은 pooled 384D 이후 `42D rule + PCA 64D + fixed 4-head probability 12D`를 고정 배열로 정확히 조립하고 final difficulty head, Platt calibration과 threshold를 적용한다.

Gateway hot path 승격 전에는 다음 경계를 모두 충족해야 한다.

- 실패한 per-category safety regression을 새 evidence run에서 해결
- request-level shadow 실행 위치와 bounded overhead 정책 승인
- supported runtime의 latency, memory와 failure isolation evidence
- 새 promotion artifact에 대한 supported runtime별 end-to-end label parity
- [`contracts.md`](contracts.md), [`classification-pipeline.md`](classification-pipeline.md)와 필요한 verifier를 포함한 active runtime contract 승인

위 조건을 충족한 artifact도 먼저 opt-in shadow로 실행한다. Shadow 결과와 rollback 준비를 검토한 뒤 owner가 exact artifact version, bundle hash와 threshold policy를 명시적으로 promotion해야 하며 자동 승격은 허용하지 않는다.

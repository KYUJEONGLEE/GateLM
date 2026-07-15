# GateLM Difficulty E5 Encoder Contract

| Field | Value |
|---|---|
| Status | Canonical offline component + opt-in Gateway request shadow; product route decision에는 미활성 |
| Model | `intfloat/multilingual-e5-small` |
| Source revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| Runtime | Canonical Python ORT CPU + optional Go/Linux amd64 native ORT CPU, dynamic QInt8 |
| Canonical output | L2-normalized `float32[1,64]`; one request per encoder invocation |
| Execution shape | `difficulty-e5-single-request-execution.2026-07-15.v1` (`batchSize=1`) |
| Manifest | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json) |
| Gateway runtime lock | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json) |
| PCA artifact | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-pca-64.v2.npz`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-pca-64.v2.npz) |
| Last reviewed | 2026-07-15 |

이 계약은 difficulty semantic 후보가 사용하는 유일한 encoder 경로를 고정한다. 과거의 다중 encoder 후보 benchmark, custom 128-token head-tail 처리와 provisional projection은 사용하지 않는다. Optional Gateway image는 같은 경로를 process-local startup smoke와 request shadow에서 검증하지만 요청별 결과를 제품 routing decision에 연결하지 않는다. 이 component의 존재는 model promotion을 뜻하지 않는다.

## 1. Canonical Pipeline

```text
PromptFeatures.instructionText
  -> 빈 문자열이면 not_applicable
  -> "query: " prefix
  -> Hugging Face tokenizer
     - special tokens 포함
     - max_length=128
     - right truncation
     - one request only; padding scope is within that request
  -> int64 input_ids + attention_mask (+ token_type_ids)
  -> pinned multilingual-e5-small dynamic-QInt8 ONNX
  -> float32 last_hidden_state[1,sequence,384]
  -> attention-mask mean pooling
  -> raw pooled float32[1,384]
  -> train-only PCA: (pooled - mean[384]) @ components[64,384].T
  -> L2 normalization(epsilon=1e-12)
  -> float32[1,64]
```

Training, calibration, diagnostic evaluation과 Gateway replay는 모두 요청 하나마다 tokenizer와 QInt8 encoder를 한 번 호출한다. 여러 요청을 한 ONNX batch로 묶거나 batch-longest padding을 공유한 뒤 결과를 학습 material로 사용하면 안 된다. 여러 sample의 matrix가 필요한 단계는 단건 결과를 순서대로 계산한 뒤에만 stack한다.

Attention-mask mean pooling은 mask가 `1`인 token만 합산하고 각 sample의 유효 token 수로 나눈다. Padding 위치는 pooling에서 제외한다. 모든 token mask가 `0`이거나 intermediate가 non-finite이면 `invalid_embedding`으로 fail closed한다.

Tokenizer와 encoder에는 `instructionText`만 전달한다. `normalizedText`, `payloadText`, raw prompt 전체, attachment body 또는 provider/model metadata로 fallback하지 않는다. Empty instruction은 tokenizer를 호출하거나 zero vector로 바꾸지 않고 `not_applicable`로 제외한다.

## 2. PCA Fit Contract

PCA는 owner-approved dataset의 `train` 300건에서 얻은 **L2 정규화 전 raw pooled E5 embedding**만으로 fit한다. Calibration 100건과 untouched holdout 100건은 PCA fit에 사용할 수 없다. Split은 `difficulty-family-constrained-split.2026-07-15.v1`, seed `20260715`이며 prompt family가 split 사이에 겹치면 안 된다.

```python
pca = PCA(n_components=64, svd_solver="full", whiten=False)
pca.fit(train_embeddings)  # 300 single-request results stacked to exact shape [300,384]

projected = (pooled_embedding - pca.mean_) @ pca.components_.T
projected /= max(np.linalg.norm(projected), 1e-12)
```

Committed NPZ는 `mean`의 exact shape `[384]`과 `components`의 exact shape `[64,384]`만 포함한다. 두 array는 finite `float32`여야 한다. PCA parameter, file, source dataset과 runtime component hash는 manifest로 검증한다. Projection norm이 finite가 아니거나 `1e-12` 이하이면 zero vector를 반환하지 않고 `invalid_embedding`으로 처리한다.

### 2.1 Frozen 118D retraining과 diagnostic Holdout

기존에 선택된 Candidate C 118D 구조는 `fixed_candidate_retrain`으로 유지하고, encoder/PCA·semantic head·difficulty head·calibrator를 single-request execution shape로 다시 생성한다. 이 작업은 42D·106D·118D architecture를 재선택하는 단계가 아니다. Calibration은 단건 결과만 사용하며 Holdout accuracy로 model, calibrator 또는 threshold를 바꾸면 안 된다.

새 immutable artifact는 `difficulty-candidate-c-118d.owner-approved-500.v3.json`이며 weight 118개, bias, Platt coefficient/intercept, `difficulty-threshold-v1 = 0.45`, PCA와 semantic-head hash를 고정한다. 기존 Holdout 100건은 이전 결과를 이미 확인했으므로 이 artifact에는 diagnostic replay로만 사용할 수 있다. Diagnostic 결과 `accuracy=0.91`, `complex -> simple=1`은 구현 parity 확인값이며 promotion evidence가 아니다.

### 2.2 새 promotion Holdout 결과

[`../v2.1.0/evaluation/difficulty-promotion-holdout-100.v1.json`](../v2.1.0/evaluation/difficulty-promotion-holdout-100.v1.json)은 owner-approved expansion의 아직 보지 않은 holdout 40 family/400건에서 model score를 읽기 전에 category별 SHA-256 rank 상위 whole family 2개씩을 선택한다. 선택된 10 family/100건은 이전 500건 family와 겹치지 않고 category마다 20건, simple/complex 각각 10건이다. Artifact version, bundle/content hash, `0.45`, accuracy `>=0.91`, 전체 `complex -> simple <=1`과 category별 rule baseline 비악화 gate도 첫 score access 전에 고정했다.

2026-07-15 첫 single-request evaluation은 [`../testing/difficulty-promotion-holdout-100-result.json`](../testing/difficulty-promotion-holdout-100-result.json)에 aggregate로만 보존한다. 결과는 candidate accuracy `0.70`/rule baseline `0.78`, candidate `complex -> simple=0`이며 category별 complex-to-simple 비악화는 모두 통과했다. 그러나 accuracy gate가 실패했으므로 현재 artifact는 promotion eligible이 아니다. 이 결과를 확인한 Holdout으로 model, PCA, semantic head, calibrator, threshold 또는 subset을 바꾸지 않는다.

## 3. Artifact And Distribution Contract

PCA NPZ와 작은 manifest는 source control에 포함한다. Tokenizer와 ONNX model처럼 큰 runtime artifact는 Git에 포함하지 않는다. 개발 환경에서는 `.tmp/difficulty-semantic-encoder-artifacts`의 로컬 artifact cache에 exact pinned revision과 hash로 준비한다.

Optional Gateway shadow 배포 환경은 다음 규칙을 지켜야 한다.

- [`../../infra/docker/gateway-core-e5-shadow.Dockerfile`](../../infra/docker/gateway-core-e5-shadow.Dockerfile)은 검증된 local bundle을 `difficulty_e5` named build context로만 받는다. 기본 [`../../infra/docker/gateway-core.Dockerfile`](../../infra/docker/gateway-core.Dockerfile)은 계속 CGO-free이며 E5를 포함하지 않는다.
- Optional image build 단계에서 manifest에 나열된 tokenizer 파일, dynamic-QInt8 ONNX model, encoder manifest, Linux amd64 runtime lock과 ONNX Runtime shared library를 포함한다.
- Rust tokenizer static library는 image build에만 사용하고 최종 runtime image에는 넣지 않는다. 최종 image에는 request inference에 필요한 model/tokenizer와 ONNX Runtime shared library만 둔다.
- Container/runtime 시작 이후 Hugging Face 또는 다른 network source에서 artifact를 다운로드하면 안 된다.
- Image build는 [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-image.linux-amd64.v2.sha256`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-image.linux-amd64.v2.sha256)의 exact file allowlist와 전체 checksum을 검증하며 추가 파일과 symlink를 거부한다. Gateway 시작은 runtime lock, 모든 encoder artifact와 ONNX Runtime library의 path, byte size와 SHA-256을 다시 검증한다.
- 누락, hash mismatch, shape mismatch 또는 지원하지 않는 revision이면 encoder를 실행하지 않고 fail closed한다.

Gateway Linux amd64 profile은 `github.com/daulet/tokenizers v1.23.0`과 그 release의 Rust tokenizer core `0.22.0`, `github.com/yalue/onnxruntime_go v1.22.0`, ONNX Runtime `1.22.1`을 고정한다. Canonical Python environment의 tokenizer는 `0.21.2`이므로 버전 문자열을 동일하다고 가정하지 않는다. 대신 Gateway와 동일한 단건 shape에서 고정된 비민감 English/Korean/right-truncation instruction 3건의 pooled 384개 값을 모두 `1e-5` tolerance로 비교한다. Offline fit·training·calibration·evaluation도 이 단건 shape만 사용하므로 batch와 단건 reference를 섞는 경로가 없다. Padding mask 제외는 별도의 순수 pooling test로 검증한다.

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
corepack pnpm run verify:v2.1-difficulty-promotion-holdout
corepack pnpm run v2.1:routing:measure-gateway-holdout
corepack pnpm run verify:v2.1-gateway-e5-shadow
```

`prepare`는 large artifact를 로컬 cache에 만들기 때문에 별도 단계다. Gateway bundle 준비 명령은 이미 존재하는 pinned encoder cache, tokenizer native archive와 ONNX Runtime NuGet package를 검증해 `.tmp` 아래 Docker build context로 조립한다. Native package가 없는 개발 환경은 명시적인 `setup-gateway-e5-shadow-native` 명령에서만 pinned GitHub release/NuGet URL을 사용하며 다운로드 완료 전 임시 파일의 size와 SHA-256을 검증한다. Encoder/model artifact는 기존 `prepare-e5-encoder` 단계가 소유한다. 일반 verifier와 container runtime은 network download를 대신 수행하지 않는다. Promotion Holdout evaluator는 이미 첫 결과를 기록했으므로 같은 canonical output에 다시 실행하면 fail closed한다. 정기 검증은 score를 다시 계산하지 않고 freeze·source·artifact·aggregate report hash와 gate 산술만 검사한다.

## 6. Runtime Boundary

Gateway에는 build tag `difficulty_e5_onnx && linux && cgo`로 제한된 local tokenizer/ONNX adapter가 존재한다. `GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED=true`일 때만 artifact를 검증하고 고정된 비민감 instruction으로 tokenizer → QInt8 encoder → attention-mask mean pooling → PCA 64D → 4 semantic head/12D → final 118D score를 한 번 smoke 실행한 뒤 request shadow runner를 만든다. 초기화·smoke 실패와 지원하지 않는 기본 CGO-free build는 shadow만 `unavailable`로 내리고 Gateway는 기존 rule-only mode로 시작한다. Shadow는 readiness 필수 dependency가 아니다.

Package-level evaluator는 masking 이후 실제 `PromptFeatures.instructionText`만 받으며 동시 ONNX 실행을 1개로 제한한다. 빈 instruction은 tokenizer 전 `not_applicable`, 경합은 `busy`, timeout·runtime 실패·panic은 안전한 상태 코드로 반환하고 raw text, token, embedding, head output, 개별 score 또는 native error detail을 노출하지 않는다. Gateway router는 정상 auto route를 rule 결과로 완성한 뒤에만 worker 1개와 대기 job 1개의 runner에 non-blocking submit한다. Default timeout은 `100ms`, 허용 범위는 `1..1000ms`이며 manual/route failure 요청은 제출하지 않는다. Shadow 결과는 routing, modelRef, cache, provider 호출, RuntimeSnapshot, API, DB, Event와 log schema를 변경하지 않으며 [`contracts.md`](contracts.md)가 허용한 두 aggregate metric에만 반영한다.

Selected 118D checked-in Go bundle은 pooled 384D 이후 `42D rule + PCA 64D + fixed 4-head probability 12D`를 고정 배열로 정확히 조립하고 final difficulty head, Platt calibration과 threshold를 적용한다.

Gateway hot path 승격 전에는 다음 경계를 모두 충족해야 한다.

- 실패한 per-category safety regression을 새 evidence run에서 해결
- 새 immutable artifact를 생성한 뒤 수집한 untouched Holdout과 category별 safety evidence
- 제한된 개발 scope live shadow의 aggregate disagreement와 directional error evidence
- 새 promotion artifact에 대한 supported runtime별 end-to-end label parity
- [`contracts.md`](contracts.md), [`classification-pipeline.md`](classification-pipeline.md)와 필요한 verifier를 포함한 active runtime contract 승인

위 조건을 충족한 artifact도 먼저 opt-in shadow로 실행한다. Shadow 결과와 rollback 준비를 검토한 뒤 owner가 exact artifact version, bundle hash와 threshold policy를 명시적으로 promotion해야 하며 자동 승격은 허용하지 않는다.

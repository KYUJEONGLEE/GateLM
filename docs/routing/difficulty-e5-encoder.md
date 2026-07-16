# GateLM Difficulty E5 Encoder Contract

| Field | Value |
|---|---|
| Status | Canonical offline component + authoritative optional Gateway difficulty runtime |
| Model | `intfloat/multilingual-e5-small` |
| Source revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| Runtime | Canonical Python ORT CPU + optional Go/Linux amd64 native ORT CPU, dynamic QInt8 |
| Canonical output | L2-normalized `float32[1,64]`; one request per encoder invocation |
| Execution shape | `difficulty-e5-single-request-execution.2026-07-15.v1` (`batchSize=1`) |
| Manifest | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json) |
| Gateway runtime lock | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json) |
| PCA artifact | [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-pca-64.v2.npz`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-pca-64.v2.npz) |
| Last reviewed | 2026-07-15 |

이 계약은 difficulty semantic 후보가 사용하는 유일한 encoder 경로를 고정한다. 과거의 다중 encoder 후보 benchmark, custom 128-token head-tail 처리와 provisional projection은 사용하지 않는다. Optional Gateway image는 같은 경로를 process-local startup smoke와 request runtime에서 사용한다. 현재 명시적으로 승격된 106D artifact만 model-path difficulty를 제품 routing decision에 연결하며, 다른 artifact나 encoder component의 존재는 자동 promotion을 뜻하지 않는다.

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

### 2.3 Threshold-only v4 복구 시도

소비한 promotion Holdout을 보지 않고 기존 calibration 100건의 family-grouped out-of-fold calibrated probability만 고정 `0.01` grid로 검사했다. `0.45`는 accuracy `0.93`, `complex -> simple=4`였고, calibration safety gate를 만족한 `difficulty-threshold-v2 = 0.06`은 accuracy `0.95`, `complex -> simple=0`, `simple -> complex=5`였다. 이에 weight 118개, bias, Platt calibrator, PCA, semantic head와 component hash는 바꾸지 않고 threshold와 artifact/bundle identity만 바꾼 v4 offline candidate를 만들었다.

그 뒤 v1에서 소비한 10 family를 제외한 새 whole-family Holdout 10 family/100건을 score access 전에 고정했다. 첫 평가 결과는 accuracy `0.56`, `complex -> simple=0`, `simple -> complex=44`로 accuracy gate를 실패했다. 따라서 calibration의 threshold-only operating point는 새 family로 일반화되지 않았고 v4는 Go bundle, parity replay, live shadow 또는 product routing으로 승격하지 않는다. 새 Holdout도 이제 소비됐으며 재튜닝에 사용할 수 없다. 상세 aggregate evidence와 다음 경계는 [`../testing/difficulty-threshold-v4-evaluation.md`](../testing/difficulty-threshold-v4-evaluation.md)에 기록한다.

이후 canonical sentinel 경계가 `semantic-empty / combined score-8` v2로 변경되어 v3가 학습된 historical model-path membership과 달라졌다. Generated v3 material은 historical boundary identity를 별도로 pin하고 Gateway는 encoder 생성 전에 current boundary와 비교한다. 정상 경로에서는 불일치가 `unavailable`로 fail closed된다. 다만 routing owner는 정확도 승격이 아니라 Gateway E2E 배선 검증만을 위해 exact v3 artifact/bundle/content hash와 `difficulty-threshold-v1 = 0.45`에 한정된 one-time waiver `difficulty-shadow-baseline-e2e-v3.2026-07-15.v1`를 승인했다. Global enable, exact-pair allowlist와 waiver가 모두 일치할 때만 optional shadow를 시작하며 rule routing은 계속 authoritative다. 이 waiver는 v4나 future artifact에 재사용할 수 없고, 새 artifact는 기존 accuracy·directional error·category·owner approval gate를 모두 통과해야 한다.

### 2.4 Current 106D model-path-5000 runtime

2026-07-16 model-path 전용 5,000건을 train 3,000 / calibration 1,000 / test 1,000으로 family-disjoint하게 고정했다. Train과 calibration에서 semantic heads, 42D/106D/118D Logistic Regression, Platt/Isotonic과 threshold를 비교한 결과 Candidate B `42D rule + 64D PCA`, L2/liblinear `C=10`, Platt, global threshold `0.096`을 freeze했다. Frozen 뒤 test 1,000건을 한 번만 열었고 joint routing accuracy `62.6%`(95% CI `59.1–65.9%`), difficulty accuracy `97.8%`를 기록했다. 상세 aggregate evidence는 [`../../reports/routing-difficulty-model/20260716-model-path-5000/REPORT.md`](../../reports/routing-difficulty-model/20260716-model-path-5000/REPORT.md)에 있다.

Gateway artifact는 `difficulty-candidate-b-106d.model-path-5000.shadow.v1.json`이고 content hash는 `sha256:4c2c4f516206530d3b3f9c393b0633b7694a2e0aa5e20400d65faf088a184f5d`다. Deployment artifact 생성은 original frozen selection manifest와 PCA/head/LR/calibrator hash가 모두 일치하는 selection-only replay만 허용하며 test outcome을 다시 열지 않는다. Semantic-head artifact는 학습 provenance에 남지만 선택된 106D vector에는 포함되지 않으므로 Gateway hot path는 semantic-head probability를 계산하지 않는다. Artifact는 current decision boundary를 pin하므로 historical baseline waiver를 사용하지 않는다. 2026-07-16 explicit owner directive에 따라 이 exact artifact를 optional E5 Gateway profile의 authoritative model-path difficulty runtime으로 승격한다. Category와 non-model-path sentinel/hard-rule difficulty는 계속 rule-based다.

## 3. Artifact And Distribution Contract

PCA NPZ와 작은 manifest는 source control에 포함한다. Tokenizer와 ONNX model처럼 큰 runtime artifact는 Git에 포함하지 않는다. 개발 환경에서는 `.tmp/difficulty-semantic-encoder-artifacts`의 로컬 artifact cache에 exact pinned revision과 hash로 준비한다.

Optional Gateway E5 runtime 배포 환경은 다음 규칙을 지켜야 한다.

- [`../../infra/docker/gateway-core-e5-runtime.Dockerfile`](../../infra/docker/gateway-core-e5-runtime.Dockerfile)은 검증된 local bundle을 `difficulty_e5` named build context로만 받는다. 기본 [`../../infra/docker/gateway-core.Dockerfile`](../../infra/docker/gateway-core.Dockerfile)은 계속 CGO-free이며 E5를 포함하지 않는다.
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
corepack pnpm run v2.1:routing:setup-gateway-e5-runtime-native
corepack pnpm run v2.1:routing:prepare-gateway-e5-runtime
corepack pnpm run verify:v2.1-difficulty-gateway-bundle
corepack pnpm run verify:v2.1-difficulty-promotion-holdout
corepack pnpm run v2.1:routing:measure-gateway-holdout
corepack pnpm run verify:v2.1-gateway-e5-runtime
```

`prepare`는 large artifact를 로컬 cache에 만들기 때문에 별도 단계다. Gateway bundle 준비 명령은 이미 존재하는 pinned encoder cache, tokenizer native archive와 ONNX Runtime NuGet package를 검증해 `.tmp` 아래 Docker build context로 조립한다. Native package가 없는 개발 환경은 명시적인 `setup-gateway-e5-runtime-native` 명령에서만 pinned GitHub release/NuGet URL을 사용하며 다운로드 완료 전 임시 파일의 size와 SHA-256을 검증한다. Encoder/model artifact는 기존 `prepare-e5-encoder` 단계가 소유한다. 일반 verifier와 container runtime은 network download를 대신 수행하지 않는다. Promotion Holdout evaluator는 이미 첫 결과를 기록했으므로 같은 canonical output에 다시 실행하면 fail closed한다. 정기 검증은 score를 다시 계산하지 않고 freeze·source·artifact·aggregate report hash와 gate 산술만 검사한다.

## 6. Runtime Boundary

Gateway에는 build tag `difficulty_e5_onnx && linux && cgo`로 제한된 local tokenizer/ONNX adapter가 존재한다. `GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED=true`일 때 artifact를 검증하고 고정된 비민감 instruction으로 tokenizer → QInt8 encoder → attention-mask mean pooling → PCA 64D → final 106D score를 한 번 smoke 실행한 뒤 authoritative difficulty runtime을 만든다. 초기화·smoke 실패와 지원하지 않는 기본 CGO-free build는 semantic runtime을 `unavailable`로 내리고 Gateway는 rule difficulty fallback mode로 시작한다. E5 runtime은 readiness 필수 dependency가 아니다.

Package-level evaluator는 masking 이후 실제 `PromptFeatures.instructionText`만 받으며 동시 ONNX 실행을 1개로 제한한다. 빈 instruction은 tokenizer 전 `not_applicable`, queue 포화는 `busy`, timeout·runtime 실패·panic은 안전한 상태 코드로 반환하고 raw text, token, embedding, head output, 개별 score 또는 native error detail을 노출하지 않는다. Gateway router는 manual과 auto-disabled 경로를 먼저 종료하고, 정상 auto 요청만 worker 1개와 bounded 대기 job 4개의 synchronous dispatcher에 전달한다. Default timeout은 `100ms`, 허용 범위는 `1..1000ms`다.

Semantic result가 `ready`이면 106D `simple | complex`가 routing matrix cell, ordered modelRef candidate와 decision key의 권위 difficulty가 된다. Non-model-path `not_applicable`과 `unavailable | busy | timeout | invalid_embedding | inference_failed | panic_recovered`는 해당 요청에서 기존 rule difficulty를 유지한다. Category는 항상 rule classifier 결과다. Runtime과 historical non-authoritative shadow는 동시에 활성화할 수 없다.

Selected 106D checked-in Go bundle은 pooled 384D 이후 `42D rule + PCA 64D`를 고정 배열로 정확히 조립하고 final difficulty head, Platt calibration과 threshold `0.096`을 적용한다. Runtime promotion은 artifact version, content hash와 model selection을 변경하지 않았고 frozen test 1,000건을 다시 열지 않았다. Rollback은 `GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED=false`로 재시작하여 process 전체를 rule difficulty mode로 되돌린다.

## 7. Production Build Path

AWS production Compose는 기본 CGO-free Gateway image 대신 optional E5 runtime Dockerfile을 사용한다. [`../../deploy/aws-triage/scripts/prepare-gateway-e5-runtime-bundle.sh`](../../deploy/aws-triage/scripts/prepare-gateway-e5-runtime-bundle.sh)는 target commit checkout 이후 image build 전에 pinned Hugging Face revision, tokenizer release와 ONNX Runtime package를 내려받고 byte size·SHA-256·exact file allowlist를 검증해 `.tmp/gateway-e5-runtime-bundle`을 만든다. 검증 실패는 image build와 cutover 전에 deployment를 중단한다.

Compose는 이 디렉터리를 `difficulty_e5` named build context로 전달한다. Image build가 끝난 뒤 container startup과 request runtime은 network download를 수행하지 않는다. Runtime artifact는 production Compose가 주입하는 Tenant Chat secret owner UID/GID에서도 읽을 수 있도록 read-only permission으로 패키징한다.

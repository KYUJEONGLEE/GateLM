# GateLM Isolated LightGBM Difficulty Shadow

| Field | Value |
|---|---|
| Status | Implemented four-profile offline-shadow runtime; no authoritative promotion |
| Authority | Non-authoritative; the existing E5-small 384D → PCA 64D + rule 42D → LR 106D path remains authoritative |
| Runtime profiles | E5-small PCA64 106D, semantic-heads 54D, E5-base 768D and 810D |
| Internal contract | `gatelm.internal.routing-difficulty-lightgbm-shadow.v1` |
| Last verified | 2026-07-22 |

이 문서는 기존 106D Logistic Regression 경로를 교체하지 않고 네 LightGBM head를 격리하는 계약을 정의한다. LightGBM 106D는 LR 106D와 차원만 같고 model family, artifact, threshold, version과 runtime identity가 전부 별개다. 구현 순서는 offline 평가가 먼저이며, 승인된 artifact가 생긴 뒤에만 exact tenant/application allowlist와 bounded sampling을 사용하는 제한된 shadow를 켤 수 있다. Shadow 결과는 routing matrix, `modelRef`, provider 호출, cache, budget 또는 외부 응답을 바꾸지 않는다.

## 1. Split Architecture

```text
masking 이후 공통 instructionText + 공통 PromptFeatures
├─ LR 권위 경로
│  └─ multilingual-e5-small 384D → train-only PCA 64D
│     + difficulty-feature-vector.v1 규칙 42D → LR 106D → route decision
└─ LightGBM 비권위 경로
   ├─ 기존 multilingual-e5-small 384D encoder/PCA64 read-only 재사용
   │  ├─ 규칙 42D + PCA64 → LightGBM 106D
   │  └─ PCA64 → 고정 semantic heads 4×3 → 규칙 42D + probability 12D
   │     → LightGBM 54D
   └─ 별도 multilingual-e5-base 768D encoder
      ├─ raw 768D → LightGBM 768D
      ├─ 규칙 42D + raw 768D → LightGBM 810D
      ├─ train-only PCA 128D + 규칙 42D → LightGBM 170D
      └─ train-only PCA 256D + 규칙 42D → LightGBM 298D
```

공통 `instructionText`와 42D rule vector는 Gateway에서 요청당 한 번 만든다. LR 응답이 `ready`이면 그 결과가 먼저 권위 difficulty로 확정된다. LightGBM 작업은 그 뒤 bounded background queue에 non-blocking으로 제출되므로 queue full, timeout, unavailable, artifact 오류 또는 process 장애가 route latency와 route 결과를 변경하지 않는다.

## 2. Encoder And Feature Contract

각 profile은 `encoderMode`, exact model ID/source revision, pooling, semantic pipeline과 최종 feature order를 함께 고정한다. E5-base는 `intfloat/multilingual-e5-base@d13f1b27baf31030b7fd040960d60d909913633f`의 finite `float32[768]`을 사용한다. E5-small은 기존 LR bundle을 수정하지 않고 `intfloat/multilingual-e5-small@614241f622f53c4eeff9890bdc4f31cfecc418b3`, bundle hash `0f828d6a...26f76e`, attention-mask mean pooling과 frozen train-only PCA64 file/parameter hash를 읽기 전용으로 재사용한다. 다른 encoder family/revision, 누락 artifact, size/SHA 불일치, PCA parameter hash 불일치 또는 degenerate projection은 startup/inference를 fail closed한다.

E5-base shadow 학습 후보는 `tabular_only`, `embedding_only_768`, `raw_768`, `pca_128`, `pca_256` 다섯 개다. `embedding_only_768`은 규칙 특징 없이 pooled `float32[768]`을 그대로 사용하고, `raw_768`은 기존 의미대로 42D rule vector를 앞에 붙인 810D다. `tabular_only`는 semantic 후보의 비교 baseline일 뿐 runtime 선택 대상이 아니다. PCA는 train split에만 fit하고 모든 split에 transform한 뒤 각 행을 L2 normalize한다. 후보 선택은 validation accuracy, `complex → simple`, log loss, 차원 순으로 deterministic하게 수행하고 선택을 freeze한 뒤에만 test를 연다. Runtime manifest가 허용하는 최종 shape는 768D, 810D, 170D 또는 298D다.

### 2.1 Four-way feature comparison

LightGBM feature 표현 자체를 비교하는 별도 offline runner는 다음 네 후보를 같은 승인 dataset, 같은 family-disjoint split, 같은 LightGBM parameter와 seed로 모두 학습한다.

| Candidate | Input | Dimension |
|---|---|---:|
| `rule_42_plus_e5_small_pca_64` | 기존 exact 42D rule + 기존 E5-small train-only PCA64 | 106 |
| `rule_42_plus_semantic_heads_12` | 기존 exact 42D rule + E5-small PCA64에서 계산한 고정 4-head × 3-class probability | 54 |
| `e5_base_raw_768` | 별도 E5-base attention-mask mean pooled vector | 768 |
| `rule_42_plus_e5_base_raw_768` | exact 42D rule + 같은 E5-base pooled vector | 810 |

Runner는 [`../../scripts/routing_difficulty_model/gatelm_difficulty_model/lightgbm_four_way.py`](../../scripts/routing_difficulty_model/gatelm_difficulty_model/lightgbm_four_way.py)와 CLI에 격리한다. E5-small LR artifact와 Gateway 등록 코드는 읽기 전용 입력으로만 사용하며 수정하지 않는다. 네 model head와 aggregate report는 저장할 수 있지만 prompt, pooled/PCA embedding, semantic-head row, rule row와 sample score는 직렬화하지 않는다. 각 process는 설정된 profile 하나만 로드하며 여러 profile을 동시에 노출하는 API를 만들지 않는다.

실제 offline-shadow bundle은 [`../../scripts/routing_difficulty_model/artifacts/lightgbm-four-way-owner-approved-500/`](../../scripts/routing_difficulty_model/artifacts/lightgbm-four-way-owner-approved-500/)에 둔다. 저장소에는 네 LightGBM text model, 네 runtime profile, aggregate evaluation, runtime bundle lock과 E5-base artifact lock을 보관한다.

| Candidate | Runtime profile | Model |
|---|---|---|
| 106D | `rule_42_plus_e5_small_pca_64.shadow-profile.v1.json` | `rule_42_plus_e5_small_pca_64.lightgbm.txt` |
| 54D | `rule_42_plus_semantic_heads_12.shadow-profile.v1.json` | `rule_42_plus_semantic_heads_12.lightgbm.txt` |
| 768D | `e5_base_raw_768.shadow-profile.v1.json` | `e5_base_raw_768.lightgbm.txt` |
| 810D | `rule_42_plus_e5_base_raw_768.shadow-profile.v1.json` | `rule_42_plus_e5_base_raw_768.lightgbm.txt` |

E5-small profile은 기존 [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json), `difficulty-e5-pca-64.v2.npz`와 `artifacts/candidates/difficulty-semantic-heads.owner-approved-500.v2.json`의 identity를 고정한다. 54D profile의 `headOrder`와 `classOrder`는 학습기의 `SEMANTIC_HEAD_SPECS_V1`인 `semanticTaskBucket`, `semanticConstraintBucket`, `semanticScopeBucket`, `semanticDependencyBucket`의 각 3 classes 순서와 exact match해야 한다. 약 855 MB인 quantized E5-base ONNX와 약 407 MB인 E5-small ONNX는 Git binary로 커밋하지 않고 각각 `.tmp/difficulty-lightgbm-e5-base-artifacts`와 `.tmp/difficulty-semantic-encoder-artifacts`에 hydrate한다.

```powershell
$env:PYTHONPATH='scripts/routing_difficulty_model'
python -m gatelm_difficulty_model.lightgbm_four_way_cli prepare-e5-base
python -m gatelm_difficulty_model.lightgbm_four_way_cli train
```

Machine-readable profile은 [`schemas/difficulty-lightgbm-shadow-profile.schema.json`](schemas/difficulty-lightgbm-shadow-profile.schema.json), shape 예시는 [`fixtures/difficulty-lightgbm-shadow-profile.fixture.json`](fixtures/difficulty-lightgbm-shadow-profile.fixture.json)에 있다. Fixture의 가짜 artifact identity는 schema 검증 전용이며 runtime artifact가 아니다.

## 3. Dataset And Offline Gate

Offline 학습 함수는 [`../../scripts/routing_difficulty_model/gatelm_difficulty_model/lightgbm_shadow.py`](../../scripts/routing_difficulty_model/gatelm_difficulty_model/lightgbm_shadow.py)에 있다. Prompt-derived rule vector와 768D embedding은 같은 process의 메모리로만 전달하며 matrix, embedding 또는 sample별 score를 파일로 저장하는 입력/출력 API를 제공하지 않는다. 출력 bundle root에는 descriptor가 가리키는 pinned E5-base encoder artifact가 미리 staging되어 있어야 하며 학습 도구도 각 파일의 safe relative path, size와 SHA-256을 확인한다. 출력은 선택된 LightGBM text model, 선택 시 train-only PCA parameter, immutable runtime profile과 aggregate evaluation report뿐이다.

학습 전에 dataset manifest가 다음 조건을 모두 만족해야 한다.

- `scope.training_eligible = true`
- `review.production_gold = true`
- `review.human_reviewed = true`와 `review.review_status = approved`
- `counts.human_reviewed_records > 0`
- train/validation/test가 모두 존재하고 각 split에 simple/complex가 있으며 prompt family가 split 사이에서 겹치지 않음
- exact 42D rule vector와 exact 768D pooled embedding, finite 값과 허용 범위

현재 [`datasets/difficulty/data/initial-routing-difficulty-15000.manifest.json`](datasets/difficulty/data/initial-routing-difficulty-15000.manifest.json)은 `training_eligible=false`이고 사람 검수 전이므로 이 학습 gate에서 거부된다. 따라서 이 변경은 해당 15,000건으로 model artifact, threshold 또는 promotion evidence를 생성하지 않는다.

## 4. Isolated AI Service Profile

LightGBM runtime과 LR runtime은 같은 AI Service process에서 동시에 활성화할 수 없다. `Settings` validation이 이를 거부하며, [`../../deploy/aws-triage/docker-compose.routing-lightgbm-shadow.yml`](../../deploy/aws-triage/docker-compose.routing-lightgbm-shadow.yml)은 별도 container, port, dependency extra, read-only artifact mount, health check와 resource limit을 제공한다. 기본값은 disabled다.

LightGBM process의 private endpoint는 다음 하나다.

```text
POST /internal/routing/difficulty/lightgbm-shadow/v1/classify
X-GateLM-AI-Service-Token: <separate service token>
```

Request는 contract version, model version/content hash, rule vector version, bounded `instructionText`와 exact 42D vector만 허용한다. 768D profile은 전송된 rule vector를 검증하되 model input에 결합하지 않고, 54D·106D·810D profile만 규칙 42D를 최종 feature 앞에 결합한다. Response는 contract version, `ready`, `simple | complex`, model identity만 반환한다. Model score, token, embedding, vector 또는 오류 detail은 반환하지 않는다. Startup은 profile manifest 자체의 configured SHA-256, encoder manifest/tokenizer/ONNX, PCA, optional semantic heads와 LightGBM model의 relative path·size·SHA-256을 검증한다. 로드된 `booster.num_feature()`는 profile의 `model.numFeatures`와 `featureShape.totalDimension` 양쪽에 exact match해야 하며, 고정된 비민감 instruction warmup까지 성공한 뒤에만 `/readyz`를 통과한다.

주요 AI Service 설정은 다음과 같다.

```text
AI_SERVICE_ROUTING_DIFFICULTY_ENABLED=false
AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_ENABLED=true
AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_SERVICE_TOKEN=<separate secret>
AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_ARTIFACT_ROOT=/opt/gatelm/difficulty-lightgbm-shadow
AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_PROFILE_MANIFEST=/opt/gatelm/difficulty-lightgbm-shadow/difficulty-lightgbm-shadow-profile.v1.json
AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_PROFILE_MANIFEST_SHA256=<64 lowercase hex>
AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_MAX_CONCURRENT=4
AI_SERVICE_ROUTING_LIGHTGBM_SHADOW_WORKER_COUNT=1
```

## 5. Limited Gateway Shadow

Gateway는 기존 LR local 또는 remote runtime이 활성화돼 있을 때만 LightGBM shadow 설정을 받는다. Allowlist 형식은 comma-separated exact `tenantId/applicationId` pair이며 wildcard, partial match, 빈 request ID를 허용하지 않는다. `1..10000` basis points sampling은 tenant/application/request ID의 deterministic hash로 적용한다.

```text
GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_ENABLED=true
GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_ALLOWED_SCOPES=tenant-a/app-a,tenant-b/app-b
GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_SAMPLING_BASIS_POINTS=1000
GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_URL=http://ai-service-lightgbm-shadow:8003/internal/routing/difficulty/lightgbm-shadow/v1/classify
GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_SERVICE_TOKEN=<separate secret>
GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_MODEL_VERSION=<manifest model.version>
GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_MODEL_CONTENT_HASH=<manifest model.contentHash>
GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_TIMEOUT_MS=500
GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_MAX_CONCURRENT=4
```

Gateway의 configured model identity와 AI response identity가 다르면 result는 non-ready다. Production-like 환경은 32자 이상의 non-placeholder token과 HTTPS 또는 private service address를 요구한다. Separate container 예시는 명시적으로 overlay와 `routing-lightgbm-shadow` profile을 선택해야 실행되며, default/production compose에 자동으로 추가되지 않는다.

## 6. Observability And Data Safety

허용되는 관측은 다음 aggregate metric뿐이다.

- `gatelm_routing_difficulty_lightgbm_shadow_total{status,category,comparison}`
- `gatelm_routing_difficulty_lightgbm_shadow_duration_seconds{status}`

`comparison`은 `match | authoritative_simple_shadow_complex | authoritative_complex_shadow_simple | not_compared`만 허용한다. Status와 category도 기존 bounded enum으로 normalize한다. Raw/redacted prompt, instruction/payload text, token, 42D vector, 384D/768D embedding, PCA vector, semantic-head probability, model score, threshold, artifact hash, request/trace ID, tenant/application ID, modelRef, provider/model과 raw error detail은 API response, log, event, DB 또는 metric label에 기록하지 않는다. 모든 중간 feature는 AI Service process memory 안에서만 전달한다.

## 7. Promotion Boundary

이 profile의 manifest는 `promotionState=offline_shadow_only`만 허용한다. Shadow aggregate evidence가 존재해도 LightGBM을 권위 경로로 자동 승격하지 않는다. 권위 전환은 별도 active contract, 승인된 human-reviewed dataset, frozen artifact/evaluation evidence, latency·capacity·failure-isolation 검증과 rollback 계획이 필요한 후속 변경이다. 그 전까지 LR 106D 경로와 현재 public API/DB/Event/RuntimeSnapshot/routing policy 계약은 변경되지 않는다.

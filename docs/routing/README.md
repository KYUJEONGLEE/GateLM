# GateLM Active Routing Contract

| Field | Value |
|---|---|
| Status | Active scoped contract |
| Applies to | General Gateway routing, Control Plane routing policy, published RuntimeSnapshot routing |
| Schema version | `gatelm.routing-policy.v2` |
| Active entrypoint | [`../current/README.md`](../current/README.md) |
| Last verified | 2026-07-20 |

이 폴더는 일반 Gateway 라우팅의 현재 기준이다. [`contracts.md`](contracts.md)가 의미 계약이고, [`classification-pipeline.md`](classification-pipeline.md)가 category·difficulty 분류의 active 구현 구조이며, `schemas/`와 `fixtures/`는 정책 계약의 machine-readable pairing이다.

## Contract Artifacts

| Path | Role |
|---|---|
| [`contracts.md`](contracts.md) | category, difficulty, auto/manual, migration, event/log 경계 |
| [`classification-pipeline.md`](classification-pipeline.md) | 공통 feature 추출, category 결과, category-aware difficulty 분류의 canonical 내부 구조 |
| [`difficulty-feature-vector-v1.md`](difficulty-feature-vector-v1.md) | `difficulty-feature-vector.v1`의 42차원 순서, scaling, enum과 zero-fill 계약 |
| [`difficulty-logistic-training.md`](difficulty-logistic-training.md) | 새 실험의 owner-approved 15,000건 단일 입력 경계와 기존 500·5,000건 historical replay evidence |
| [`difficulty-e5-encoder.md`](difficulty-e5-encoder.md) | Pinned `multilingual-e5-small` QInt8, attention-mask mean pooling, train-only PCA 384→64와 verified AI Service runtime bundle |
| [`difficulty-lightgbm-shadow.md`](difficulty-lightgbm-shadow.md) | 기존 LR 경로를 유지한 E5-small PCA64/semantic-heads 및 별도 E5-base LightGBM offline/제한 shadow 계약 |
| [`remote-e5-inference-experiment.md`](remote-e5-inference-experiment.md) | Gateway local E5 병목의 측정 근거, private AI Service 전환 결정과 운영 guardrail |
| [`schemas/routing-policy.schema.json`](schemas/routing-policy.schema.json) | 전역 Simple/Complex/단일 fallback을 5 category × 2 difficulty에 투영하는 routing policy v2 schema |
| [`fixtures/routing-policy.fixture.json`](fixtures/routing-policy.fixture.json) | 모든 셀이 `mock-balanced`인 안전한 bootstrap fixture |
| [`schemas/runtime-snapshot-routing.schema.json`](schemas/runtime-snapshot-routing.schema.json) | published RuntimeSnapshot routing v2 section schema |
| [`fixtures/runtime-snapshot-routing.fixture.json`](fixtures/runtime-snapshot-routing.fixture.json) | routingPolicyHash를 포함한 RuntimeSnapshot routing bootstrap fixture |
| [`schemas/difficulty-lightgbm-shadow-profile.schema.json`](schemas/difficulty-lightgbm-shadow-profile.schema.json) | E5-small 54D/106D와 E5-base 768D/810D를 encoder family·feature pipeline별로 구분하는 LightGBM artifact schema |
| [`fixtures/difficulty-lightgbm-shadow-profile.fixture.json`](fixtures/difficulty-lightgbm-shadow-profile.fixture.json) | schema 검증 전용 LightGBM shadow profile fixture; runtime artifact가 아님 |

## Dataset Work Area

| Path | Status | Scope |
|---|---|---|
| [`datasets/difficulty/README.md`](datasets/difficulty/README.md) | Active data work area; owner-approved training revision available | 제품 SemVer와 분리된 Simple/Complex 데이터 구축 계획, 공개 7,000건·합성 6,000건·경계 사례 2,000건과 통합 15,000건 |

이 데이터 영역은 active runtime API/DB/Event/Metrics 계약을 변경하지 않는다. 후보 revision은 검수 전 증거로 보존한다. `initial-routing-difficulty-15000.owner-approved.jsonl`은 전수 사람 검수와 dataset-owner 승인 및 의미 중복 감사를 통과해 학습용 gold label로 사용할 수 있지만, 이 사실만으로 threshold 선택이나 runtime promotion을 승인하지 않는다. 기존 `docs/v2.1.0` offline fixture는 과거 versioned evidence로 그대로 보존한다.

새 라우팅 실험의 데이터 입력은 위 owner-approved 15,000개 통합 JSONL 하나로
고정한다. 기존 Dataset 1·2와 model-path 5,000은 historical replay에만 남으며,
새 학습·calibration·ablation·tuning에는 사용할 수 없다. 실험 도구는 canonical
manifest가 아닌 경로를 fail-closed로 거부하고 기존 group split을 재사용한다.

## Non-active Proposals

| Path | Status | Scope |
|---|---|---|
| [`difficulty-feature-vector-v2-proposal.md`](difficulty-feature-vector-v2-proposal.md) | Proposed; not active | Exact v1 42D를 보존하고 `instructionText` projection과 4-head/12D probability를 분리해 비교하는 offline/shadow difficulty candidate |
| [`difficulty-decision-loss-threshold-experiment.md`](difficulty-decision-loss-threshold-experiment.md) | Offline experiment; not active | 고정 threshold grid의 FP/FN, Expected Decision Loss, break-even `C_FN`과 safety-constrained optimum을 aggregate로 비교 |

이 표의 문서는 active contract가 아니다. 별도 승인과 source-of-truth 승격 전에는 Gateway hot path, routing policy 또는 제품 surface의 근거로 사용할 수 없다.

## Authority And Boundaries

이 계약은 일반 Gateway 라우팅 범위에서 `docs/v2.0.0`의 `category -> tier -> model`, legacy `routingPolicy` provider/model 필드, `selectedProvider`/`selectedModel` 의미를 대체한다. `docs/v2.0.0` 원문은 historical baseline으로 보존하며 이 문서로 새 의미를 읽는다.

현재 authoring profile은 Simple, Complex와 선택 사항인 전역 fallback 하나만 노출한다. 저장·발행 shape는 향후 category별 또는 검증된 ML 기반 routing으로 확장할 수 있도록 완전한 5 × 2 matrix를 유지한다.

다음은 이 계약의 범위 밖이다.

- [`../tenant-chat/README.md`](../tenant-chat/README.md)의 별도 Tenant Chat tier
- Provider Catalog metadata의 `routing.costTier`
- provider adapter 자체의 wire protocol과 credential resolution

## Verification

```powershell
corepack pnpm run verify:routing-contract
corepack pnpm run verify:routing-experiment-dataset
corepack pnpm run verify:routing-difficulty-enterprise-8000
corepack pnpm run verify:routing-difficulty-public-7000
corepack pnpm run verify:v2.1-category-eval
corepack pnpm run verify:v2.1-difficulty-eval
corepack pnpm run verify:v2.1-difficulty-gateway-bundle
corepack pnpm run verify:v2-docs
```

Local pinned E5 artifact cache와 Docker가 준비된 환경에서는 `corepack pnpm run verify:v2.1-gateway-e5-shadow`로 Linux amd64 native/Python parity, optional image build와 startup smoke를 추가 검증한다. 이 명령은 runtime download를 수행하지 않는다.

106D difficulty runtime의 활성화, 장애 시 rule fallback, worker/queue guardrail과 rollback 절차는 [`contracts.md`](contracts.md)와 [`remote-e5-inference-experiment.md`](remote-e5-inference-experiment.md)를 따른다. Historical request shadow와 local/remote runtime은 동시에 활성화할 수 없다. 별도 LightGBM profile은 default disabled이며 LR과 같은 process에 올리지 않고 [`difficulty-lightgbm-shadow.md`](difficulty-lightgbm-shadow.md)의 offline/제한 shadow 경계만 따른다.

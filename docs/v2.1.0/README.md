# GateLM v2.1.0 Documentation Status

| Field | Value |
|---|---|
| Status | Latest versioned scope reference |
| Active entrypoint | [`../current/README.md`](../current/README.md) |
| Release status | 저장소 근거만으로 공식 v2.1.0 release를 확정할 수 없음 |
| Scope | Self-host delivery, Advanced Routing offline evidence |

v2.1.0은 저장소에 존재하는 최신 versioned 문서다. 그러나 최근의 모든 post-v2 제품 기능을 포괄하는 단일 umbrella contract는 아니다.

## Self-host Delivery

| Document | Role |
|---|---|
| `contracts.md` | Single-node Docker Compose self-host delivery contract |
| `implementation-plan.md` | Versioned planning reference |
| `implementation-tasks.md` | Versioned task plan/reference |
| `acceptance-test-matrix.md` | Versioned acceptance criteria |
| `production-images.md` | Production image targets |

Self-host 계획과 산출물이 존재한다는 사실만으로 current HEAD의 fresh-host acceptance 또는 공식 release 완료를 의미하지 않는다.

## Advanced Routing Offline Evidence

| Document | Role |
|---|---|
| `category-evaluation-dataset-contract.md` | Synthetic/redacted category evaluation contract |
| `schemas/category-evaluation-record.schema.json` | Category-only evaluation record schema |
| `fixtures/category-evaluation-*.fixture.jsonl` | Category evaluation/probe fixtures |
| `difficulty-evaluation-dataset-contract.md` | Synthetic/redacted difficulty evaluation contract |
| `schemas/difficulty-evaluation-record.schema.json` | Difficulty-only evaluation record schema |
| `fixtures/difficulty-evaluation-dataset.fixture.jsonl` | Difficulty evaluation fixture |
| `difficulty-label-guide.md` | 모델 작업보다 먼저 적용하는 label taxonomy, reviewer와 family readiness 계약 |
| `schemas/difficulty-label-record.schema.json` | 4-head·12차원 target class order와 empty-instruction fail-closed를 포함하는 canonical v2 annotation schema |
| `schemas/difficulty-label-dataset-manifest.schema.json` | Semantic-head eligibility, family 수, slice coverage와 training gate를 관리하는 canonical v2 manifest schema |
| `schemas/difficulty-label-record.v1.schema.json` | 이전 bucket taxonomy의 non-active historical snapshot |
| `schemas/difficulty-label-dataset-manifest.v1.schema.json` | 이전 label manifest의 non-active historical snapshot |
| `fixtures/difficulty-label-contract-smoke.*` | 필수 label/slice를 검증하는 5개 family의 synthetic contract smoke와 manifest |
| `fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl` | Human-review-pending synthetic training-tooling smoke; 학습 evidence가 아님 |
| `fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json` | 500건 pilot의 `trainingEligible=false` sidecar |
| `schemas/difficulty-training-split-manifest.schema.json` | 500건 smoke tooling의 family-disjoint partition manifest schema |
| `fixtures/difficulty-training-split-manifest.v1.json` | 500건 smoke tooling 내부 partition; production evidence split이 아님 |
| `schemas/difficulty-model-artifact.schema.json` | Offline Logistic Regression·calibrator candidate artifact schema |
| `routing-advanced-plan.md` | Evaluation-based routing plan |
| `routing-performance-test-scenario.md` | Performance evidence scenario |
| `routing-random-probe.md` | Unlabeled synthetic distribution probe |

이 범위는 Gateway hot path의 API/DB/Event/Metrics 계약을 새로 정의하지 않는다.

일반 Gateway hot path의 현재 category × difficulty 라우팅 계약은 [`../routing/README.md`](../routing/README.md)를 따른다. Offline category와 difficulty record는 서로 다른 schema/fixture/verifier를 사용한다. category evaluation v1 schema가 남아 있더라도 non-active historical snapshot이며 verifier/evaluator 입력으로 허용하지 않는다.

`difficulty-label-record.v2`는 두 evaluator schema를 합친 record가 아니라 difficulty용 human annotation source다. 네 bucket은 `semanticTaskBucket`, `semanticConstraintBucket`, `semanticScopeBucket`, `semanticDependencyBucket`의 고정 12-class output order와 일치한다. Empty instruction의 `not_applicable`은 head class가 아니며 initial offline candidate에서 fail closed한다. Category-only evaluator에는 계속 category projection만 전달한다. 현재 500건 pilot과 기존 train/calibration/holdout 이름은 tooling smoke에만 사용하며, 독립적인 approved human-reviewed family minimum이 versioned policy로 결정되기 전에는 어떤 dataset도 training-ready로 선언하지 않는다.

## Inherited Compatibility

v2.1 문서에서 `docs/v2.0.0/contracts.md`를 참조하는 부분은 아직 대체되지 않은 행동 계약을 보존하기 위한 inherited compatibility다.

이는 다음을 의미하지 않는다.

- v2.0.0 implementation plan/task가 현재 backlog라는 뜻
- 모든 post-v2 기능이 v2.0.0 문서에 의해 정의된다는 뜻
- v2.1.0이 공식 출시됐다는 뜻

현재 작업의 문서 권한과 충돌 처리는 [`../current/source-of-truth.md`](../current/source-of-truth.md)를 따른다.

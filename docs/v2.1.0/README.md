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
| `schemas/category-evaluation-record.schema.json` | Evaluation record schema |
| `fixtures/*.fixture.jsonl` | Offline evaluation/probe fixtures |
| `routing-advanced-plan.md` | Evaluation-based routing plan |
| `routing-performance-test-scenario.md` | Performance evidence scenario |
| `routing-random-probe.md` | Unlabeled synthetic distribution probe |

이 범위는 Gateway hot path의 API/DB/Event/Metrics 계약을 새로 정의하지 않는다.

## Inherited Compatibility

v2.1 문서에서 `docs/v2.0.0/contracts.md`를 참조하는 부분은 아직 대체되지 않은 행동 계약을 보존하기 위한 inherited compatibility다.

이는 다음을 의미하지 않는다.

- v2.0.0 implementation plan/task가 현재 backlog라는 뜻
- 모든 post-v2 기능이 v2.0.0 문서에 의해 정의된다는 뜻
- v2.1.0이 공식 출시됐다는 뜻

현재 작업의 문서 권한과 충돌 처리는 [`../current/source-of-truth.md`](../current/source-of-truth.md)를 따른다.

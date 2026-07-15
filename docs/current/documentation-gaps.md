# GateLM Documentation Gaps

| Field | Value |
|---|---|
| Status | Active issue register |
| Authority | 확인된 문서/구현 불일치와 결정 대기 항목 |
| Baseline | `origin/dev @ b650d2caf` |
| Last verified | 2026-07-15 |

이 문서는 후보를 계약으로 승격하지 않는다. 확실한 불일치를 기록하고, 사람 결정이 필요한 항목을 구현 작업과 분리한다.

## Open Decisions

| ID | Finding | Evidence | Required decision |
|---|---|---|---|
| DOC-001 | 다음 개발 SemVer를 확정할 수 없다 | GitHub `v0.0.1`, root `0.0.0`, app `0.1.0`, docs v2.x가 불일치 | release owner가 tag/package/docs version policy 결정 |
| DOC-002 | `dev`와 `main`이 동일 snapshot이 아니다 | 2026-07-13 기준 `origin/dev @ 79bf254d`, `origin/main @ d0dde8ce`이며 `dev -> main`은 별도 PR | current 구현 기준을 계속 `dev`로 둘지 release 기준과 분리할지 결정 |
| DOC-003 | v2.1.0은 전체 post-v2 제품 계약이 아니다 | self-host contract와 routing evidence가 같은 폴더에 있고 최근 UI/직원/정책 흐름은 포괄하지 않음 | 다음 versioned umbrella contract 또는 scope별 contract 구조 결정 |
| DOC-004 | v2.0 행동 계약의 current 상속 범위가 완전하게 감사되지 않았다 | v2.1 문서가 v2.0을 상속하지만 현재 코드가 크게 확장됨 | API/DB/Event/Metrics/Security 영역별 promote/supersede 목록 승인 |
| DOC-005 | v2.0 RC release evidence가 공식 v2 tag와 연결되지 않는다 | RC notes는 not tagged 상태이고 remote v2 tag가 없음 | v2를 historical baseline으로만 둘지 release evidence를 보완할지 결정 |
| DOC-006 | self-host completion을 단정할 최신 fresh-host evidence가 없다 | bundle은 존재하지만 current HEAD release smoke evidence와 contract gap이 남음 | acceptance 재실행 후 complete/beta 상태 결정 |
| DOC-007 | Advanced Routing, Semantic Cache, AI sidecar의 maturity가 미정이다 | 코드/테스트는 있으나 GA/beta/experimental 승인 문서 없음 | 제품 owner가 기능별 maturity 선언 |
| DOC-008 | 일반 Markdown link checker가 없다 | `verify:v2-docs`는 schema/fixture와 literal entry path만 검사 | CI에 Markdown relative link/anchor 검사 추가 여부 결정 |
| DOC-009 | 여러 architecture/policy/reference/archive 문서가 v1을 현재 기준으로 표기한다 | 파일 상단의 과거 상태 문구와 active router가 충돌 | 문서별 재검증 후 status metadata 추가 또는 archive 이동 |
| DOC-010 | docs verification 명령 이름이 v2에 고정돼 있다 | verifier는 current entrypoint도 검사하도록 갱신됐지만 package/CI 명령은 `verify:v2-docs`로 남음 | 후속 PR에서 중립적인 `verify:docs` alias/rename을 추가할지 결정 |
| DOC-011 | Tenant Chat의 tenant admin `employeeId` 허용 규칙이 일치하지 않는다 | `contracts.md`는 employee actor에서만 존재한다고 쓰지만 request/JWT schema와 DDL은 tenant admin의 non-null employeeId를 금지하지 않음 | actor별 employeeId 존재 규칙을 schema와 DDL에 동일하게 반영 |
| DOC-012 | Tenant Chat admission/log의 Employee FK가 same-tenant 관계를 DB에서 보장하지 않는다 | usage DDL은 `employee_id -> employees(id)`만 참조하고 record의 `tenant_id`와 Employee tenant를 결합하지 않음 | composite FK를 추가할지 signed writer 검증과 contract test로 고정할지 결정 |
| DOC-013 | Tenant Chat terminal replay에서 assistant content 복구 경계가 없다 | final SSE는 terminal facts만 포함하고 Gateway는 content를 저장하지 않아 Chat API가 ciphertext 저장 전에 장애가 나면 응답 본문을 복구할 계약이 없음. Execution bridge는 interim으로 sequence/content 재구성이 불가능한 성공 replay를 `TerminalReplayContentUnavailable`로 fail closed함 | encrypted final result handoff 또는 재처리 불변조건 확정. Interim negative behavior는 유지하되 gap을 닫지 않음 |
| DOC-014 | `userId`별 quota override 의미는 있으나 실행 schema가 없다 | `contracts.md`는 audit 후 새 RuntimeSnapshot부터 override 적용을 요구하지만 RuntimeSnapshot에는 default quota만 있고 Gateway-owned period table을 Control Plane이 직접 수정할 수도 없음 | versioned user override schema, writer, audit, snapshot binding 및 Gateway materialization 규칙 추가 |
| DOC-015 | primary realistic category fixture의 생성 provenance를 재현할 수 없다 | challenge/ambiguous fixture에는 checked-in generator가 있지만 `category-evaluation-dataset.fixture.jsonl`을 재생성하는 generator, seed 또는 manual review 기록은 확인되지 않음 | deterministic generator와 seed/version을 추가하거나 manual fixture라면 생성·검토 provenance를 명시 |
| DOC-016 | Hybrid `ComplexityScore`의 single-request immutable artifact가 두 번의 새 promotion Holdout accuracy gate를 통과하지 못했다 | v3는 첫 score-independent whole-family Holdout에서 accuracy `0.70`, `complex -> simple=0`으로 실패했다. 이 Holdout을 재사용하지 않고 기존 family-disjoint calibration의 out-of-fold score만 threshold sweep한 결과 `0.06`이 calibration accuracy `0.95`, `complex -> simple=0`으로 gate를 통과했다. Weight, bias, Platt calibrator, PCA와 semantic head를 그대로 둔 v4를 만들고 소비된 10 family를 제외한 두 번째 whole-family Holdout을 먼저 동결했지만, 첫 aggregate-only evaluation은 accuracy `0.56`, `complex -> simple=0`, `simple -> complex=44`였다. 상세 evidence는 [`../testing/difficulty-threshold-v4-evaluation.md`](../testing/difficulty-threshold-v4-evaluation.md)에 보존한다 | v3와 v4 어느 것도 product routing으로 승격하지 않음. 두 Holdout 모두 재튜닝·재선택에 사용하지 않으며, 후속 후보는 독립 train/calibration family, grouped nested validation, hard-simple 보강과 또 다른 outcome-untouched whole-family Holdout을 요구함 |
| DOC-021 | 현재 decision boundary에 맞춘 v4 후속 학습 데이터는 아직 owner-approved가 아니다 | 부족분 3,120건을 train 1,595 / calibration 525 / evaluation 750 / promotion 250의 whole-family-disjoint synthetic candidate로 생성했고, Go audit에서 전부 current model path임을 확인했다. 그러나 전 record와 family는 `pending`, `reviewerCount=0`, `trainingEligible=false`다 | Owner가 각 family의 category/difficulty/boundary와 hard-simple·short-complex 품질을 검토·승인한 뒤에만 새 training policy로 nested/group CV를 수행한다. 승인 전에는 artifact version/hash/threshold policy를 만들거나 Holdout outcome을 열지 않음 |
| DOC-017 | PR #303에서 기존 전역 low/default/high/fallback 역할이 category별 ordered multi-fallback authoring으로 한 번에 대체되어 현재 제품의 예측 가능한 설정 의미와 충돌한다 | `docs/routing/contracts.md`의 `modelRefs[1..n]`, 10-cell Web 편집기, RuntimeConfig DTO가 제한 없는 fallback을 허용하며 별도 사람 계약 리뷰 기록이 없다 | RuntimeSnapshot v2 matrix는 유지하되 신규 authoring을 전역 Simple=low/default, Complex=high, optional 단일 fallback profile로 교정하고 기존 v2 data는 명시적 전환 전까지 read/execution compatibility로 보존 |
| DOC-018 | `difficulty-feature-vector.v2`의 opt-in request shadow는 구현됐고 exact v3 baseline E2E waiver로만 활성화할 수 있지만 live evidence는 아직 없다 | Single-request v2 encoder/PCA manifest와 v3 118D artifact의 historical Linux amd64 native replay는 Python/Go label `100/100`, score tolerance, rule routing/modelRef 불변과 failure isolation을 확인했다. v3 promotion Holdout accuracy `0.70`과 v4 untouched Holdout accuracy `0.56`은 계속 실패 evidence다. Routing owner는 품질 승격이 아닌 tokenizer→encoder→pooling→PCA→118D→aggregate metric E2E 확인을 위해 exact v3 identity, threshold `0.45`, `2 GiB` memory limit과 rollback 기준을 one-time waiver로 승인했다. 기본은 disabled이며 global enable, exact-pair allowlist, exact waiver가 모두 필요하다 | 개발 pair 1개부터 opt-in하고 aggregate disagreement, directional error, memory와 isolation만 관찰한다. v3/v4를 product routing으로 사용하지 않으며 future artifact는 waiver 없이 accuracy `>=0.91`, `complex -> simple <=1`, category 비악화와 새 owner approval을 통과해야 함 |
| DOC-020 | Canonical difficulty decision boundary가 semantic-empty simple sentinel과 combined hard evidence `8+`로 갱신되어 기존 single-request v3/v4 artifact의 학습 membership과 달라졌다 | Owner-approved 2,500개 실제 Go 재감사에서 semantic-empty mismatch는 `100 -> 0`, hard/simple 충돌은 `129 -> 0`이 됐고 현재 model path는 train `1,405`, calibration `475`, legacy holdout `477`이다. [`../testing/difficulty-decision-boundary-audit-2026-07-15.md`](../testing/difficulty-decision-boundary-audit-2026-07-15.md). Generated v3 identity는 historical boundary를 pin하고 정상 Gateway admission은 encoder 생성 전에 mismatch를 거부한다. Exact v3 baseline waiver만 이 거부를 E2E shadow에 한해 좁게 우회한다 | 기존 artifact version을 덮어쓰거나 새 boundary의 promotion evidence로 사용하지 않는다. One-time waiver는 신규 학습이나 future artifact에 재사용하지 않으며, 신규 데이터 owner review와 decision-boundary-aware 재학습·평가 요구는 그대로 유지한다 |

## Resolved Decisions

| ID | Resolution | Evidence |
|---|---|---|
| DOC-019 | 2026-07-14 dataset owner가 `difficulty-training-minimum-family-policy.2026-07-14.v1`과 현재 500건 전체를 승인했다. Overall 89, category 15, category × difficulty 9, 지원 language 50, required slice 1 approved family minimum을 사용한다. | [`../v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json`](../v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json), [`../v2.1.0/reviews/difficulty-training-candidate-500.owner-approval.json`](../v2.1.0/reviews/difficulty-training-candidate-500.owner-approval.json) |

## Known Documentation Drift

- 기존 entry 문서는 v2.0.0 implementation plan/task를 현재 작업 순서로 고정하고 있었다.
- 기존 `docs/README.md`는 v2.1 self-host contract와 production image 문서를 충분히 연결하지 않았다.
- v2.0.0 contract의 schema/fixture 목록에는 실제 존재하는 `chat-conversation` pair가 누락돼 있었다.
- `docs/dashboard-dev-state-check.md`와 일부 testing 문서는 특정 branch/commit의 point-in-time evidence다.
- `docs/reference/master-spec.md`, bundle manifest, 일부 architecture/archive 문서는 과거 v1 상태 선언을 포함한다.

## Contract Change Candidates

다음 항목은 이번 문서 정리에서 의미를 변경하지 않는다.

- v2.0.0 Gateway/API/DB/Event/Metrics field의 current 승격 또는 폐기
- Semantic Cache live path의 공식 지원 상태
- self-host image/runtime contract와 실제 Compose 차이
- 실제 vendor별 production support claim
- Observability SLA와 release evidence 기준

각 항목은 별도 owner 승인과 contract PR이 필요하다.

## Snapshot Notes

- 이전 `origin/dev @ e8152d87`의 unmerged 후보 목록은 후속 PR이 `dev`에 병합되어 제거했다.
- branch와 PR queue는 변동 가능하므로 이 문서에 backlog로 복제하지 않는다. 현재 구현 사실은 [`implementation-status.md`](implementation-status.md)와 기준 commit에서 확인한다.

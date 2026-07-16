# GateLM Documentation Gaps

| Field | Value |
|---|---|
| Status | Active issue register |
| Authority | 확인된 문서/구현 불일치와 결정 대기 항목 |
| Baseline | `origin/dev @ 0c637455` |
| Last verified | 2026-07-16 |

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
| DOC-016 | Hybrid `ComplexityScore`의 offline candidate 선택과 untouched Holdout evidence는 생성됐지만 runtime 승격 gate를 통과하지 못했다 | Owner-approved 500건/89-family의 family-disjoint 300/100/100 partition에서 42D·106D·118D 후보를 calibration family-grouped CV log loss/Brier/lower-dimension 순서로만 선택한다. 선택된 118D candidate의 model·Platt calibrator·threshold·component hash를 freeze한 뒤 그 candidate만 untouched Holdout 100건에 적용했다. 전체 accuracy는 rule baseline `0.86`에서 `0.91`, 전체 `complex -> simple`은 `10`에서 `1`로 개선됐지만 `general` category는 `0`에서 `1`로 악화되어 per-category 비악화 gate가 실패했다. Runtime latency/failure-isolation과 active contract 승인도 아직 없음 | 현재 artifact를 runtime으로 승격하지 않음. Holdout 결과를 근거로 component를 바꾸거나 재선택하면 현재 Holdout은 소비된 것으로 보고 새 artifact version과 새 untouched Holdout으로 다시 검증 |
| DOC-017 | PR #303에서 기존 전역 low/default/high/fallback 역할이 category별 ordered multi-fallback authoring으로 한 번에 대체되어 현재 제품의 예측 가능한 설정 의미와 충돌한다 | `docs/routing/contracts.md`의 `modelRefs[1..n]`, 10-cell Web 편집기, RuntimeConfig DTO가 제한 없는 fallback을 허용하며 별도 사람 계약 리뷰 기록이 없다 | RuntimeSnapshot v2 matrix는 유지하되 신규 authoring을 전역 Simple=low/default, Complex=high, optional 단일 fallback profile로 교정하고 기존 v2 data는 명시적 전환 전까지 read/execution compatibility로 보존 |
| DOC-018 | `difficulty-feature-vector.v2`의 complete offline bundle은 생성됐지만 runtime packaging과 승격 evidence가 없다 | [`../routing/difficulty-e5-encoder.md`](../routing/difficulty-e5-encoder.md)의 pinned QInt8 encoder/PCA 64D, fixed 4-head/12D와 calibration-only candidate selection으로 고정한 118D decision head·calibrator가 exact component hash를 가진 offline artifact로 생성됐다. 선택 후 단일 frozen candidate의 untouched Holdout evidence는 존재하지만 per-category safety gate가 실패했고 Docker packaging, supported-runtime numeric tolerance와 active runtime contract도 pending임 | 현재 bundle을 active contract나 Gateway runtime으로 승격하지 않음. 후속 candidate는 새 version, 새 untouched Holdout, image packaging, deterministic replay와 latency/memory/failure-isolation evidence를 모두 요구 |
| DOC-020 | Tenant Chat PII ONNX bundle의 production 승격 기준과 승인 evidence가 없다 | 2026-07-15 전달본은 public checkpoint 그대로이며 combined rule+model synthetic pass rate `65.6%`, email precision `12.83%`다. 평가는 untouched holdout·span-level·model ablation이 아니고 person/organization 결과도 model이 아닌 rule backstop이다. 반복 cold p50/p95, peak RSS, realistic history/concurrency와 timeout/fallback evidence도 승인 기준을 충족하지 않는다. | 제품·보안 owner가 locale/detector별 최소 precision/recall/F1, false-redaction budget, latency/resource budget과 승인된 untouched holdout을 확정하기 전에는 production-grade 또는 DLP로 승격하지 않는다. 저장소의 자동 gate는 evidence 완전성과 owner 승인 없이는 fail closed해야 한다. |
| DOC-021 | Tenant Chat mask-once provenance의 legacy rollout 및 fresh E2E evidence가 아직 없다 | 2026-07-16 계약은 새 user message를 저장 전 sanitization하고 schema v2 AAD와 signed completion input으로 provenance를 인증한다. 기존 schema v1 user는 `legacy_unverified`이며 metadata-only backfill을 금지하지만, current branch의 migration/replay/failure-isolation과 브라우저 optimistic raw replacement를 fresh-host에서 입증한 release evidence는 아직 없다. 같은 idempotency key를 여러 Chat API/Gateway instance가 동시에 처리할 때 sanitization과 completion을 하나의 owner로 직렬화하는 distributed claim/lease도 아직 없다. | v1 user를 제외/fail-close하거나 one-time sanitize+v2 re-encrypt하는 rollout 정책, rollback 시 provenance 보존, block/timeout/idempotent replay/E2E와 multi-node claim/lease를 승인하고 검증하기 전에는 no-recheck 경로를 production default로 승격하지 않는다. |

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

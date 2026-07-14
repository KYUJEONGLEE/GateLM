# GateLM Documentation Gaps

| Field | Value |
|---|---|
| Status | Active issue register |
| Authority | 확인된 문서/구현 불일치와 결정 대기 항목 |
| Baseline | `origin/dev @ 0b3d7f24` |
| Last verified | 2026-07-14 |

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
| DOC-013 | Tenant Chat terminal replay에서 assistant content 복구 경계가 없다 | final SSE는 terminal facts만 포함하고 Gateway는 content를 저장하지 않아 Chat API가 ciphertext 저장 전에 장애가 나면 응답 본문을 복구할 계약이 없음 | encrypted final result handoff 또는 재처리 불변조건 확정 |
| DOC-014 | `userId`별 quota override 의미는 있으나 실행 schema가 없다 | `contracts.md`는 audit 후 새 RuntimeSnapshot부터 override 적용을 요구하지만 RuntimeSnapshot에는 default quota만 있고 Gateway-owned period table을 Control Plane이 직접 수정할 수도 없음 | versioned user override schema, writer, audit, snapshot binding 및 Gateway materialization 규칙 추가 |
| DOC-015 | primary realistic category fixture의 생성 provenance를 재현할 수 없다 | challenge/ambiguous fixture에는 checked-in generator가 있지만 `category-evaluation-dataset.fixture.jsonl`을 재생성하는 generator, seed 또는 manual review 기록은 확인되지 않음 | deterministic generator와 seed/version을 추가하거나 manual fixture라면 생성·검토 provenance를 명시 |
| DOC-016 | Hybrid `ComplexityScore` target과 opt-in shadow scorer는 구현됐지만 model/calibrator artifact와 승격 evidence가 없다 | 2026-07-14 local feature branch에서 42차원 encoder, deterministic `0.0`/`1.0` sentinel, artifact-backed Logistic Regression·calibration scorer와 current rule-based 비교 evaluator가 존재하지만 checked-in artifact가 없고 500건 synthetic pilot은 `human review pending`, `trainingEligible=false`인 tooling smoke임 | 승인된 dataset으로 versioned model/calibrator artifact와 family-disjoint train/calibration/holdout evidence를 만들고, current rule-based baseline 대비 전체·category별 `complex -> simple` 비악화 holdout gate 전에는 runtime을 변경하지 않음 |
| DOC-017 | `difficulty-feature-vector.v2` semantic shadow contract는 제안됐지만 exact artifact bundle과 승격 evidence가 없다 | [`../routing/difficulty-feature-vector-v2-proposal.md`](../routing/difficulty-feature-vector-v2-proposal.md)는 v1 42D 불변, `instructionText`-only semantic input, deterministic payload statistics와 non-exposure 경계를 고정하지만 tokenizer/encoder/projection/head/calibrator, exact dimension과 approved dataset은 아직 pending임 | Exact component manifest와 feature layout을 승인하고 family-disjoint offline/holdout, data safety, latency·memory와 current baseline 비악화 evidence를 확보하기 전에는 proposal을 active contract나 runtime으로 승격하지 않음 |
| DOC-018 | Difficulty training readiness의 최소 approved human-reviewed family 수가 결정되지 않았다 | `difficulty-label-record.v1`과 manifest는 전체/category/difficulty/language/slice별 family 수를 계산하지만 승인된 전체·cell·slice minimum policy가 없으며 현재 10건/500건 fixture는 모두 smoke-only임 | Dataset owner가 overall, category × difficulty, language와 required slice별 minimum을 versioned policy로 승인하기 전에는 모든 manifest를 `trainingEligible=false`로 유지 |

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

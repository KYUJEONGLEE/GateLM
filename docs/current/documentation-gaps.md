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

| DOC-022 | Tenant Chat PII ONNX bundle??production ?밴꺽 湲곗?怨??뱀씤 evidence媛 ?꾩쭅 ?녿떎 | v3.6? aggregate ?됯?? QInt8 artifact瑜?媛뽰톬吏留??ㅼ젣 Gateway E2E 500ms budget, realistic concurrency, timeout/fallback, ?좉퇋 鍮꾧났媛?holdout??理쒖쥌 ?밴꺽 evidence媛 ?꾩쭅 ?꾧껐?섏? ?딆븯?? | locale/detector蹂?理쒖냼 precision/recall/F1, false-redaction budget, Gateway E2E latency/resource budget怨??뱀씤??untouched holdout??紐⑤몢 留뚯”???뚭퉴吏 production-grade ?먮뒗 DLP濡??좎뼵?섏? ?딅뒗?? |
| DOC-023 | Tenant Chat mask-once provenance??legacy rollout 諛?multi-node evidence媛 ?꾩쭅 ?녿떎 | ??user message???????sanitization?섍퀬 schema v2 AAD? signed completion input?쇰줈 provenance瑜??몄쬆?쒕떎. 湲곗〈 schema v1 user??legacy_unverified?대ŉ metadata-only backfill??湲덉??섏?留?fresh-host rollback, browser optimistic raw replacement, multi-node idempotency evidence???꾩쭅 ?녿떎. | v1 user??one-time sanitize+v2 re-encrypt ?뺤콉, rollback ??provenance 蹂댁〈, block/timeout/replay/E2E? multi-node claim/lease瑜?寃利앺븯湲??꾩뿉??no-recheck 寃쎈줈瑜?production default濡??밴꺽?섏? ?딅뒗?? |
| DOC-024 | Tenant Chat active terminal outcome `policy_ack_required`가 Dashboard Rollup canonical totals에서 누락된다 | active Tenant Chat DDL은 `policy_ack_required`를 허용하지만 `DashboardRollupService.rebuildTenantChatHour`의 `blocked_request_count` 분류에는 포함되지 않는다. 이 경우 canonical status 합이 `request_count`보다 작아질 수 있다 | [`proposals/tenant-unified-reliability-read-contract.md`](proposals/tenant-unified-reliability-read-contract.md)의 `policy_ack_required -> blocked` mapping을 승인한 뒤 writer를 수정하고 영향 bucket을 replacement rebuild하며 raw/rollup parity를 검증 |
## Resolved Decisions

| ID | Resolution | Evidence |
|---|---|---|
| DOC-019 | 2026-07-14 dataset owner가 `difficulty-training-minimum-family-policy.2026-07-14.v1`과 현재 500건 전체를 승인했다. Overall 89, category 15, category × difficulty 9, 지원 language 50, required slice 1 approved family minimum을 사용한다. | [`../v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json`](../v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json), [`../v2.1.0/reviews/difficulty-training-candidate-500.owner-approval.json`](../v2.1.0/reviews/difficulty-training-candidate-500.owner-approval.json) |
| DOC-018 | Historical v3/v4 quality failures와 waiver는 그대로 보존하되, current-boundary model-path 5,000건에서 별도로 선택·동결한 106D Candidate B를 2026-07-16 explicit owner directive로 authoritative Gateway difficulty runtime에 승격했다. Category는 rule-based이고 semantic non-ready는 request-local rule fallback이다. | [`../../reports/routing-difficulty-model/20260716-model-path-5000/REPORT.md`](../../reports/routing-difficulty-model/20260716-model-path-5000/REPORT.md), [`../routing/contracts.md`](../routing/contracts.md), [`../testing/difficulty-live-shadow-runbook.md`](../testing/difficulty-live-shadow-runbook.md) |
| DOC-020 | 새 106D artifact가 current `semantic-empty / combined score-8` decision boundary를 직접 pin하고 selection replay hash가 원본 freeze와 일치했다. Historical baseline waiver는 runtime admission에 사용하지 않는다. | `difficulty-candidate-b-106d.model-path-5000.shadow.v1.json`, content hash `sha256:4c2c4f516206530d3b3f9c393b0633b7694a2e0aa5e20400d65faf088a184f5d` |
| DOC-022 | Admin Runtime OpenAPI가 구현과 active contract가 허용하는 `cacheEnabled` compatibility activation payload를 표현하지 못하고, mandatory safety detector 규칙도 schema에서 기계 검증하지 못하던 drift를 해소했다. Current와 compatibility request를 닫힌 두 variant로 분리하고 mandatory detector 존재·비활성화 금지 및 verifier의 정상·거부 fixture를 고정했다. 런타임 의미 변경은 없다. | [`../tenant-chat/openapi/admin-runtime.openapi.json`](../tenant-chat/openapi/admin-runtime.openapi.json), [`../../scripts/verify-v2-docs.mjs`](../../scripts/verify-v2-docs.mjs), [`../tenant-chat/contracts.md`](../tenant-chat/contracts.md) |

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

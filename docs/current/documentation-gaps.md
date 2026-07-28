# GateLM Documentation Gaps

| Field | Value |
|---|---|
| Status | Active issue register |
| Authority | 확인된 문서/구현 불일치와 결정 대기 항목 |
| Baseline | `origin/dev @ e54d35b94d0409cf4b6ceba8036735f1ee7afe6e` |
| Main cross-check | `origin/main @ 7e6eff7d2bfb315998028c4382ca671065eace49` |
| Last verified | 2026-07-27 |

이 문서는 후보를 계약으로 승격하지 않는다. 확실한 불일치를 기록하고, 사람 결정이 필요한 항목을 구현 작업과 분리한다. ID는 Open/Resolved 전체에서 유일하며 한 번 부여한 ID를 다른 의미로 재사용하지 않는다.

## Open Decisions

| ID | Finding | Evidence | Required decision |
|---|---|---|---|
| DOC-001 | 목표 제품 버전은 `v1.0.0`으로 정했지만 release identity와 evidence가 아직 정렬되지 않았다 | 공식 최신 release는 `v0.0.1`, root `0.0.0`, app `0.1.0`, self-host image 예시는 `2.1.0`이다. 원격 v1 tag/release는 없고 local-only stale `v1.0.0-rc.1`만 관찰됐다 | release owner가 exact candidate SHA, branch, tag/package/image/docs 정렬과 전체 gate evidence를 승인 |
| DOC-002 | current 개발 기준과 release 승격 기준이 같은 ref가 아니다 | 2026-07-27 기준 `origin/dev @ e54d35b94...`는 `origin/main @ 7e6eff7d...`의 조상이고 main만 7개 commit 앞선다. tree 차이는 root `README.md`다 | current 구현 기준은 `origin/dev`로 유지하되 release owner가 별도 exact RC SHA와 승격 branch를 결정 |
| DOC-003 | former v2.1.0 pre-v1 workstream에 Self-host 계약과 Routing evidence가 섞여 있다 | 기능별 current contract가 아닌 release-like 폴더에 대용량 review/artifact provenance와 배포 계약이 함께 있음 | 실행 의존성을 분리한 뒤 Self-host 계약과 Routing evidence를 기능별 경로로 승격·이관 |
| DOC-004 | v2.0 행동 계약의 current 상속 범위가 완전하게 감사되지 않았다 | v2.1 문서가 v2.0을 상속하지만 현재 코드가 크게 확장됨 | API/DB/Event/Metrics/Security 영역별 promote/supersede 목록 승인 |
| DOC-006 | self-host completion을 단정할 최신 fresh-host evidence가 없다 | bundle과 script는 존재하지만 current baseline의 clean install, upgrade/rollback/restore 전체 evidence는 확인되지 않음 | exact RC SHA에서 acceptance를 재실행한 뒤 complete/beta 상태 결정 |
| DOC-007 | Advanced Routing, Semantic Cache, AI sidecar의 maturity가 미정이다 | 코드와 test/evidence는 있으나 GA/beta/experimental 제품 선언이 일관되지 않음 | 제품 owner가 기능별 maturity와 release 포함 범위 선언 |
| DOC-008 | 저장소 전체 Markdown link/anchor checker가 없다 | `verify:docs`는 관리 대상 current/pre-v1/routing 문서의 relative file link를 검사하지만 전체 문서와 anchor는 검사하지 않음 | CI에 repo-wide Markdown relative link/anchor 검사 추가 여부 결정 |
| DOC-009 | 여러 architecture/policy/reference/archive 문서가 과거 v1을 현재 기준으로 표기한다 | 파일 상단의 point-in-time 상태 문구와 active router가 충돌할 수 있음 | 문서별 재검증 후 status metadata 추가 또는 archive 이동 |
| DOC-011 | Tenant Chat의 tenant admin `employeeId` 규칙을 schema가 완전히 강제하지 않는다 | active 계약은 `tenant_admin`의 `employeeId=null`을 요구하지만 entitlement/session schema는 employee actor의 non-null만 조건부 강제하고 admin의 non-null을 금지하지 않음 | actor별 `employeeId` 존재 규칙을 schema, DTO와 DDL에 동일하게 반영 |
| DOC-012 | Tenant Chat admission/log의 Employee same-tenant 관계가 DB constraint가 아니라 writer invariant에 의존한다 | runtime은 tenant/user로 employee를 조회하고 claim을 비교하지만 usage/invocation 관계에는 `(employeeId,tenantId)` composite FK가 없음 | v1 방어선으로 composite FK를 추가할지 signed writer 검증과 contract test로 충분한지 DB/Security owner가 결정 |
| DOC-015 | primary realistic category fixture의 생성 provenance를 재현할 수 없다 | challenge/ambiguous fixture에는 checked-in generator가 있지만 `category-evaluation-dataset.fixture.jsonl`의 generator, seed 또는 manual review 기록은 확인되지 않음 | deterministic generator와 seed/version을 추가하거나 manual fixture 생성·검토 provenance 명시 |
| DOC-023 | Tenant Chat mask-once provenance의 legacy rollout과 multi-node evidence가 아직 없다 | 새 user message는 저장 전 sanitization하고 schema v2 AAD와 signed completion input으로 provenance를 인증한다. 기존 schema v1 user는 `legacy_unverified`이며 metadata-only backfill을 금지하지만 fresh-host rollback, browser optimistic raw replacement와 multi-node idempotency evidence는 완결되지 않음 | v1 user one-time sanitize+v2 re-encrypt 정책, rollback provenance, block/timeout/replay E2E와 multi-node claim/lease를 검증하기 전에는 no-recheck 경로를 production default로 승격하지 않음 |
| DOC-025 | Tenant Chat PII v3.14는 배포 패키지 준비 상태이며 production 승격 evidence가 아직 없다 | v3.14 QInt8 bundle의 offline gate와 local smoke는 통과했지만 자료가 명시적으로 운영 반영, Shadow/Canary, remote readiness와 Gateway E2E를 제외함 | Security/Product owner가 private install, readiness, realistic concurrency/timeout/fallback와 Gateway E2E를 승인하기 전에는 production-grade 또는 DLP로 선언하지 않음 |
| DOC-026 | Employee notice acknowledgement는 active 계약에 있지만 end-to-end 구현이 없다 | 계약은 `employeeNoticeVersion` acknowledgement와 `CHAT_POLICY_ACK_REQUIRED`를 요구한다. 현재 code에는 snapshot/binding 전달만 있고 직원별 ack state/API/UI와 admission 비교가 확인되지 않음 | acknowledgement를 구현할지 active 계약에서 follow-up으로 내릴지 결정한 뒤 API/DB/Security contract와 구현을 분리 |
| DOC-027 | Admin Content Diagnostic의 active MVP 계약과 전역 forbidden-data policy가 충돌하고 구현도 없다 | Tenant Chat 계약은 step-up/purpose/one-time grant/audit 기반 단건 decrypt를 요구하지만 프로젝트 규칙은 raw prompt/response의 API response와 UI 평문 노출을 금지한다. baseline app code에도 route, grant/audit persistence와 UI가 확인되지 않음 | 기능을 MVP에서 제외할지 제한된 security exception을 명시할지 먼저 결정. 구현 시 Full Content Logging retention, API/DB/Security 계약을 승인한 뒤 별도 구현 PR 진행 |
| DOC-028 | 기존 기본 챗봇 종료 범위가 active compatibility와 아직 합의되지 않았다 | 신규 개발 대상은 Tenant Chat이지만 source-of-truth는 기존 Project/Application Chat과 public `/v1`을 inherited compatibility로 보존함 | `apps/application`과 legacy conversation surface의 종료 대상, redirect/`410` 기간, 데이터 retention/migration을 `LEG-00`에서 승인하고 public `/v1` 및 Project/Application core 보존 범위를 고정 |
| DOC-029 | self-host 보안 hardening 목표가 active v2.1 delivery contract와 충돌한다 | v2.1 contract는 Mock Provider를 필수 service로 두고 기본 local port 노출과 demo/mock bootstrap을 허용한다. production/local-demo profile 분리 없이 port와 Mock을 제거하면 계약 변경이 됨 | `SEC-00` contract에서 production ingress/egress, local-demo, Mock 허용 범위와 Provider/SMTP/S3 egress를 승인한 뒤 구현 |
| DOC-030 | self-host production secret validation 범위가 불완전하다 | env/install script는 일부 secret만 강하게 검사하고 PostgreSQL, cache, demo credential 등은 warning에 머문다. active contract는 선택 mode의 unsafe default를 fail-fast하도록 요구함 | production과 local-demo mode별 필수 secret class, placeholder 금지, rotation/rollback을 Security/Delivery contract로 고정하고 구현 |
| DOC-031 | employee daily-token usage 집계의 canonical ledger와 장애 복구 의미가 미결정이다 | Gateway main wiring에서 downstream enqueue 실패가 Redis daily-token usage 집계를 건너뛸 수 있어 파생 counter가 요청 처리/logging failure와 결합됨 | `BILL-00`/`LEDGER-00`에서 canonical source, idempotent replay/rebuild, queue·Redis·DB 장애 parity를 승인한 뒤 큰 module 분해보다 먼저 구현 |
| DOC-032 | authoritative 106D routing artifact의 원본 aggregate 성능 보고서가 source control에 없다 | `reports/routing-difficulty-model/20260716-model-path-5000/REPORT.md`는 `.gitignore` 대상이며 현재 checkout에 없다. artifact와 runtime contract는 추적되지만 joint/difficulty accuracy 수치의 독립 재검증 문서는 없다 | 원본 manifest와 frozen output에서 민감정보 없는 aggregate evidence를 재현해 `docs/testing/`에 승격하기 전까지 정확도 수치를 release·이력서 근거로 사용하지 않음 |
| DOC-033 | release-like pre-v1 문서 경로가 실행 코드, Docker, verifier와 provenance에 결합돼 있다 | `docs/v1.0.0`, `docs/v2.0.0`, `docs/v2.1.0`은 fixture import, Docker `COPY`, schema `$id`, manifest source path와 artifact hash consumer를 가짐 | `PVR-00`에서 consumer를 분리하고 기능별 계약 승격과 archive 이동을 hash/provenance 검증과 함께 수행 |
| DOC-034 | target `v1.0.0` 전체 release gate와 freeze automation이 없다 | `verify:v2-final`과 `v2:rc:freeze`는 former v2 workstream의 범위·출력에 고정돼 있어 v1 release evidence로 사용할 수 없음 | exact v1 범위와 baseline commit manifest, package/image/docs 정렬, 공개 registry image tag·digest·consumer 확인, fresh-host·security·rollback evidence를 묶는 별도 release contract와 자동화 승인 |

## Resolved Decisions

| ID | Resolution | Evidence |
|---|---|---|
| DOC-005 | former v2.0 RC notes는 출시 evidence가 아니라 pre-v1 historical draft로 분류한다. 없는 v2 tag를 보완하거나 release를 소급 생성하지 않는다. | [`../pre-v1/README.md`](../pre-v1/README.md), [`../v2.0.0/README.md`](../v2.0.0/README.md) |
| DOC-010 | 제품 버전에 중립적인 `verify:docs` 명령을 추가하고 CI와 current 안내의 기본 문서 검증 명령을 전환했다. 기존 `verify:v2-docs`는 호환 alias로 유지한다. | [`../../package.json`](../../package.json), [`../../.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |
| DOC-013 | completed turn의 encrypted assistant가 있으면 Chat API가 decrypt해 bounded replay하고, Gateway terminal facts만 있으며 local final이 없으면 `CHAT_TERMINAL_REPLAY_UNAVAILABLE`로 fail closed한다. | [`../tenant-chat/contracts.md`](../tenant-chat/contracts.md), [`../tenant-chat/execution-contract.md`](../tenant-chat/execution-contract.md), [`../../apps/chat-api/src/content/conversation.service.ts`](../../apps/chat-api/src/content/conversation.service.ts) |
| DOC-014 | unsupported `userId` quota override wording을 제거했다. Tenant Chat은 signed employee weekly token quota를 RuntimeSnapshot, policy/audit row와 weekly ledger로 정의한다. | [`../tenant-chat/contracts.md`](../tenant-chat/contracts.md), `tenant_chat_employee_weekly_token_*` migration |
| DOC-016 | v3/v4 Holdout 실패는 historical evidence로 보존한다. 별도 current-boundary model-path 5,000건에서 선택한 106D Candidate B가 현재 authoritative runtime으로 승격되어 기존 open blocker 의미는 supersede됐다. historical candidate가 통과했다고 해석하지 않는다. | [`../routing/contracts.md`](../routing/contracts.md), [`../routing/difficulty-e5-encoder.md`](../routing/difficulty-e5-encoder.md), [`../../scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-b-106d.model-path-5000.shadow.v1.json`](../../scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-b-106d.model-path-5000.shadow.v1.json) |
| DOC-017 | 신규 authoring은 전역 Simple/Complex primary와 선택적 단일 fallback을 5×2 matrix에 투영하며, 기존 category별/multi-fallback matrix는 read/execution compatibility로만 보존한다. | [`../routing/contracts.md`](../routing/contracts.md), [`../routing/schemas/routing-policy.schema.json`](../routing/schemas/routing-policy.schema.json), [`../../apps/control-plane-api/src/modules/runtime-configs/runtime-configs.service.ts`](../../apps/control-plane-api/src/modules/runtime-configs/runtime-configs.service.ts) |
| DOC-018 | historical v3/v4 quality failure와 waiver는 보존하되 current-boundary 106D Candidate B를 explicit owner decision으로 authoritative Gateway difficulty runtime에 승격했다. Category와 non-model-path는 rule fallback을 유지한다. | [`../../scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-b-106d.model-path-5000.shadow.v1.json`](../../scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-b-106d.model-path-5000.shadow.v1.json), [`../routing/contracts.md`](../routing/contracts.md), [`../testing/difficulty-live-shadow-runbook.md`](../testing/difficulty-live-shadow-runbook.md) |
| DOC-019 | dataset owner가 `difficulty-training-minimum-family-policy.2026-07-14.v1`과 500건 전체를 승인했다. | [`../v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json`](../v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json), [`../v2.1.0/reviews/difficulty-training-candidate-500.owner-approval.json`](../v2.1.0/reviews/difficulty-training-candidate-500.owner-approval.json) |
| DOC-020 | 새 106D artifact가 current decision boundary를 pin하고 selection replay hash가 원본 freeze와 일치한다. Historical baseline waiver는 runtime admission에 사용하지 않는다. | [`difficulty-candidate-b-106d.model-path-5000.shadow.v1.json`](../../scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-b-106d.model-path-5000.shadow.v1.json), content hash `sha256:4c2c4f516206530d3b3f9c393b0633b7694a2e0aa5e20400d65faf088a184f5d` |
| DOC-021 | 3,120건 expansion과 5,000건 model-path dataset은 owner-approved, `trainingEligible=true`, complete coverage로 승격됐다. 현재 runtime artifact selection은 별도 frozen evidence를 사용한다. | [`../v2.1.0/training/difficulty-model-path-expansion-3120.owner-approved.manifest.json`](../v2.1.0/training/difficulty-model-path-expansion-3120.owner-approved.manifest.json), [`../v2.1.0/training/difficulty-model-path-5000.owner-approved.manifest.json`](../v2.1.0/training/difficulty-model-path-5000.owner-approved.manifest.json) |
| DOC-022 | Admin Runtime OpenAPI의 `cacheEnabled` compatibility activation payload와 mandatory safety detector 규칙을 closed variants와 verifier fixture로 정렬했다. 런타임 의미 변경은 없다. | [`../tenant-chat/openapi/admin-runtime.openapi.json`](../tenant-chat/openapi/admin-runtime.openapi.json), [`../../scripts/verify-v2-docs.mjs`](../../scripts/verify-v2-docs.mjs), [`../tenant-chat/contracts.md`](../tenant-chat/contracts.md) |
| DOC-024 | Tenant Chat rollup writer는 `policy_ack_required`를 blocked/canonical total과 `policy_outcome` dimension에 포함한다. 과거 bucket rebuild evidence는 mapping 해결과 별도로 proposal rollout gate에서 추적한다. | [`../../apps/control-plane-api/src/modules/dashboard-rollup/dashboard-rollup.service.ts`](../../apps/control-plane-api/src/modules/dashboard-rollup/dashboard-rollup.service.ts), [`proposals/tenant-unified-reliability-read-contract.md`](proposals/tenant-unified-reliability-read-contract.md) |

## Known Documentation Drift

- 일부 architecture, policy, testing 문서는 특정 branch/commit의 point-in-time evidence다.
- `docs/reference/master-spec.md`, bundle manifest와 일부 archive는 과거 v1 상태 선언을 포함한다.
- pre-v1 workstream docs의 존재는 현재 전체 제품 maturity나 release를 뜻하지 않는다.
- 원격 v1 tag/release는 없으며, 이번 감사 환경의 local-only `v1.0.0-rc.1`은 공유 release history가 아니다.

## Contract Change Candidates

다음 항목은 이번 문서 정리에서 의미를 변경하지 않는다.

- former v2.0.0 pre-v1 Gateway/API/DB/Event/Metrics field의 current 승격 또는 폐기
- Semantic Cache live path의 공식 지원 상태
- self-host production/local-demo topology, port, Mock Provider와 secret policy
- Tenant Chat acknowledgement와 Content Diagnostic
- 기존 기본 챗봇 종료와 conversation data retention
- employee usage ledger의 장애 parity와 rebuild
- 실제 vendor별 production support claim
- Observability SLA와 release evidence 기준

각 항목은 별도 owner 승인과 contract PR이 필요하다.

## Snapshot Notes

- current as-built 기준은 `origin/dev @ e54d35b94d0409cf4b6ceba8036735f1ee7afe6e`다.
- 과거 `main @ 7e6eff7d...`에서 실행한 감사 결과는 별도 historical evidence이며 dev baseline의 PASS로 복제하지 않는다.
- branch와 PR queue는 변동 가능하므로 이 문서에 backlog로 복제하지 않는다. 현재 구현 사실은 [`implementation-status.md`](implementation-status.md)와 기준 commit에서 확인한다.

# GateLM Current Implementation Status

| Field | Value |
|---|---|
| Status | Active as-built snapshot |
| Baseline | `origin/dev @ e54d35b94d0409cf4b6ceba8036735f1ee7afe6e` |
| Main cross-check | `origin/main @ 7e6eff7d2bfb315998028c4382ca671065eace49` |
| Verified at | 2026-07-27 |
| Verification scope | code tree와 first-parent merge history 재조사; fresh-host/release gate 재실행 아님 |
| Release meaning | `Unreleased`; refactor/release gate 완료 후 target `v1.0.0` |
| Official latest release | `v0.0.1` |

이 문서는 API/DB/Event/Metrics 계약을 새로 정의하지 않는다. 현재 `origin/dev`에 병합된 코드와 이력에서 확인한 as-built 상태만 요약한다. 구현 존재는 acceptance, GA, production-ready 또는 release 완료를 뜻하지 않는다.

## 1. Runtime Topology

| Component | Verified implementation |
|---|---|
| Web Console | Next.js 15, React 19, TypeScript 기반 관리·Dashboard·Analytics UI |
| Tenant Chat Web | Next.js 15 기반 auth/tenant selection, conversation/composer, SSE와 RAG/usage UX |
| Tenant Chat API | NestJS 기반 auth/session, EncryptedChatStore, conversation/turn/SSE, private execution과 RAG orchestration |
| Legacy Application surface | `apps/application`에 남아 있는 기존 기본 챗봇. 신규 기능 동결 및 단계적 종료 후보 |
| Control Plane API | NestJS, Prisma 기반 관리 plane, Tenant Chat runtime/usage/RAG/analytics module |
| Gateway data plane | Go 1.24 public `/v1` data plane과 private Tenant Chat execution path |
| AI Service | Python 3.12+ FastAPI 기반 PII, RAG extraction과 routing difficulty inference |
| State and dependencies | PostgreSQL, Redis, ClickHouse analytics mirror, Mock Provider; RAG code에는 object storage/KMS adapter 경계가 존재 |
| Delivery | production Dockerfiles, Compose와 `deploy/selfhost` bundle |
| Observability | Prometheus/Grafana, dashboard rollup, live traffic와 request/usage analytics 경로 |

`apps/worker`와 일부 package 디렉터리는 독립 production service로 단정하지 않는다. 실제 RAG ingestion/deletion worker의 현재 process 소유권은 코드와 배포 profile을 함께 확인해야 한다.

## 2. Verified Product Areas

현재 baseline에서 코드와 병합 이력으로 확인되는 범위다.

- Tenant, Project, Application, Provider connection, credential metadata와 RuntimeConfig/RuntimeSnapshot 관리
- 조직 초대, 직원 관리, 프로젝트 배정, 계정 복구와 관리자 계정 연결 UI/API
- public Gateway auth, rate limit, budget, masking/safety, routing, cache, Provider/fallback과 outcome logging
- OpenAI-compatible, Anthropic Messages, Gemini-compatible endpoint와 Mock adapter 코드/테스트
- category × difficulty routing, authoritative private 106D difficulty runtime과 offline evaluation harness
- Exact Cache와 optional Semantic Cache code/evaluation guard
- Request Log, Dashboard rollup, Live Requests, Request Detail, Analytics와 Gateway Pipeline UI
- PostgreSQL invocation log monthly partitioning과 ClickHouse mirror/backfill/readers/rollup/live traffic 경로
- Tenant Chat invitation/password/Google auth, rotating refresh session과 tenant selection
- Tenant Chat encrypted conversation CRUD/history, bounded turn/SSE, composer와 terminal replay fail-closed 경계
- Tenant Chat private workload binding/JWT, admission/sanitization/completion/cancel, Provider/fallback와 usage settlement
- Tenant Chat exact cache, weekly employee token quota, masking provenance/observability와 horizontal PII runtime 구성
- Tenant Chat RAG admin/retrieval/ingestion code, conversation knowledge mode, citation, cost Dashboard와 exact-cache integration
- Tenant Chat 직원 사용량 ranking API/UI와 tenant admin account link
- Self-host Compose, migration/seed/smoke script와 운영 문서
- mutation auth, demo/public 노출 제한, raw response capture 제한과 production secret/config hardening

기존 기본 챗봇의 코드가 남아 있다는 사실은 계속 지원한다는 제품 결정이 아니다. 신규 개발 대상은 Tenant Chat이며, legacy surface 제거는 [`proposals/v1-release-candidate-refactoring-baseline.md`](proposals/v1-release-candidate-refactoring-baseline.md)의 `LEG-00` inventory와 별도 계약 결정을 먼저 거친다.

## 3. Status Boundaries

| Area | Safe statement | Do not assume |
|---|---|---|
| Tenant Chat | auth, encrypted conversation/SSE/composer, private execution, exact cache, quota, masking과 RAG code path가 `dev`에 병합됨 | employee notice acknowledgement, Admin Content Diagnostic, fresh-host acceptance, 전체 browser E2E, GA |
| Tenant Chat RAG | admin/API/worker/retrieval/citation과 cost/cache integration code가 존재 | 실제 staging S3/KMS/embedding 검증, hard-delete/orphan 복구, production acceptance |
| AI Safety/PII | 최초 합격 `v0.1.0` 이후 고도화한 [`v0.1.1`](pii-model-versions.md)이 production에 배포돼 PII role health와 Tenant Chat smoke를 통과했고, fail-closed/horizontal runtime code가 존재 | 현재 서버 online 상태, model-active Gateway PII E2E·Shadow/Canary, production-grade DLP 검증 완료 |
| Advanced Routing | active 106D model-path contract, private inference와 rule fallback code가 존재 | 모든 traffic/locale의 운영 정확도와 SLA |
| ClickHouse Analytics | mirror, backfill, reader, rollup과 live traffic code가 존재 | 모든 기간 parity, 장애 복구, 보존·비용 SLA 완료 |
| Provider adapters | adapter code와 test가 존재 | 모든 vendor의 production credential live 검증 완료 |
| Account recovery | Control Plane/Web code가 존재 | 실제 production email delivery와 abuse-resistance acceptance 완료 |
| Legacy Application Chat | `apps/application`과 legacy conversation surface가 현재 존재 | 즉시 삭제해도 public `/v1`, Project/Application 관리와 데이터가 안전함 |
| Self-host | bundle, image와 script가 존재 | 최신 SHA의 clean fresh-host, upgrade/rollback/restore 완료 |
| Observability | metric/log/dashboard/rollup code와 설정이 존재 | 운영 SLA, alert delivery와 current baseline 전체 evidence 완료 |

## 4. Contracted But Unconnected Product Surfaces

### Employee notice acknowledgement

`employeeNoticeVersion`은 RuntimeSnapshot, private metadata와 execution binding으로 전달된다. 그러나 직원별 acknowledgement state/API/UI와 admission 비교는 baseline app code에서 확인되지 않았다. active Tenant Chat 계약의 `CHAT_POLICY_ACK_REQUIRED`와 구현 사이의 gap은 `DOC-026`으로 관리한다.

### Admin Content Diagnostic

active Tenant Chat 계약은 step-up, allowlisted purpose, 60초 one-time decrypt grant와 append-only audit를 가진 단건 diagnostic을 MVP로 두지만, 전역 forbidden-data policy의 raw prompt/response UI·API 금지와 충돌한다. baseline app code에도 해당 route, grant/audit persistence와 UI가 확인되지 않았다. `DOC-027`에서 기능 제외 또는 제한된 Security exception을 먼저 결정한다.

## 5. Representative Merged Development Flow

다음은 오래된 2026-07-13 snapshot 이후 현재 baseline에 포함된 대표 변경이다. 전체 release evidence 목록이 아니다.

- PR #341: Tenant Chat encrypted conversation과 SSE
- PR #377: Tenant Chat routing v2
- PR #392: Tenant Chat RAG 기반 구현
- PR #433: Tenant Chat 주간 직원 token quota
- PR #442: Tenant Chat RAG Exact Cache
- PR #457, #487: PII runtime 고도화와 v0.1.1 배포 준비
- PR #510, #513, #516: v0.1.1 production target 승격·main 반영·설치 권한 수정; deploy run `29846604941` 성공
- PR #497, #503, #524: PostgreSQL 월 partition, ClickHouse mirror와 log reader
- PR #536: PII horizontal scale
- PR #540: account recovery
- PR #544, #551: Tenant Chat 직원 사용량 ranking UI/API
- PR #553: Analytics live project traffic

열린 PR이나 원격 feature branch는 `dev`에 병합되기 전까지 current 구현으로 기록하지 않는다.

## 6. Verification Boundary

DOC-01에서는 다음을 확인했다.

- baseline commit과 main/dev ancestry 및 tree 차이
- app/package topology와 manifest runtime version
- current contract와 implementation gap의 code search
- first-parent merged development history

DOC-01에서 전체 app build, 모든 unit/integration/browser E2E, fresh migration, load/failover, real Provider/RAG staging과 security scan은 다시 실행하지 않았다. 과거 `main @ 7e6eff7d...` 감사 결과도 이 dev baseline의 PASS로 재표기하지 않는다. exact RC SHA를 고른 뒤 전체 release gate를 별도로 실행한다.

## 7. Version Evidence

현재 저장소의 목표 제품 버전은 정해졌지만 release identity는 아직 정렬되지 않았다.

- GitHub latest release: `v0.0.1`
- remote tags: `v0.0.1`, `v0.0.1-rc.1`
- local-only historical tag observed in this audit: `v1.0.0-rc.1` (`cd41a682...`); 원격 tag나 release evidence가 아니며 재사용하지 않음
- target product release: `v1.0.0`
- root package: `0.0.0`
- 일부 app package: `0.1.0`
- pre-v1 workstream paths: `docs/v1.0.0`, `docs/v2.0.0`, `docs/v2.1.0`
- self-host image examples: `2.1.0`
- current PII model: [`v0.1.1`](pii-model-versions.md); 제품 SemVer와 독립

따라서 이 문서는 현재 dev를 `v1.0.0` 또는 GA로 선언하지 않는다. 리팩토링 완료 후 exact release SHA를 선택하고 tag/package/image/docs와 전체 evidence를 정렬해야 한다.

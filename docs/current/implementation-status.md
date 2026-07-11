# GateLM Current Implementation Status

| Field | Value |
|---|---|
| Status | Active as-built snapshot |
| Baseline | `origin/dev @ e8152d87` |
| Verified at | 2026-07-11 |
| Release meaning | Unreleased development snapshot |
| Official latest release | `v0.0.1` |

이 문서는 API/DB/Event/Metrics 계약을 새로 정의하지 않는다. 현재 `origin/dev`에 병합된 코드와 PR 흐름에서 확인되는 구현 상태만 요약한다.

## 1. Runtime Topology

| Component | Verified implementation |
|---|---|
| Web Console | Next.js 15, React 19, TypeScript |
| Application surface | Next.js/React 기반 Application/Chat |
| Control Plane API | NestJS, Prisma |
| Gateway data plane | Go 1.24 |
| AI service | Python 3.12, FastAPI |
| State and dependencies | PostgreSQL, Redis, Mock Provider |
| Delivery | Production Dockerfiles와 `deploy/selfhost` bundle |
| Observability | Prometheus/Grafana 설정과 Gateway metrics/logging 경로 |

`apps/worker`와 일부 package 디렉터리는 scaffold 수준이므로 완성된 독립 서비스로 분류하지 않는다.

## 2. Verified Product Areas

현재 `dev`에서 코드와 병합 이력으로 확인되는 범위다.

- Tenant, Project, Application, Provider connection, credential metadata, RuntimeConfig/RuntimeSnapshot 관리
- 조직 초대, 직원 관리, 프로젝트 배정과 직원 통제 UI/API
- Gateway auth, rate limit, budget, masking/safety, routing, cache, provider, fallback, outcome logging stages
- OpenAI-compatible adapter(OpenAI/Gemini-compatible endpoint), Anthropic Messages adapter, Mock adapter 코드와 테스트
- Category-aware/advanced routing 코드와 offline evaluation harness
- Exact Cache와 optional Semantic Cache 코드, 평가 및 guard
- 비용/예산/쿼터/Redis rate-limit 관련 domain과 Control Plane 모델
- Request Log, Dashboard, Live Requests, Request Detail, Gateway Pipeline UI
- Application Chat과 conversation 경로
- Self-host Compose bundle, migration/seed/smoke/운영 문서
- mutation auth, demo/public 노출 제한, raw response capture 제한 등 보안 hardening

## 3. Status Boundaries

구현 존재와 제품 활성 상태를 구분한다.

| Area | Safe statement | Do not assume |
|---|---|---|
| Semantic Cache | 코드와 테스트가 존재하며 기본 설정은 disabled/shadow | 기본 live response path 또는 GA |
| Advanced Routing | 분류/정책/evaluation harness가 존재 | 최신 정확도, SLA, production quality |
| Provider adapters | adapter 코드와 테스트가 존재 | 모든 vendor의 production credential live 검증 완료 |
| AI Safety | masking, NER/privacy evaluation, sidecar 경로가 존재 | production-grade DLP 또는 승인된 품질 수준 |
| Self-host | bundle과 스크립트가 존재 | fresh-host acceptance와 release 완료 |
| Observability | metrics/log/dashboard 코드와 설정이 존재 | 운영 SLA 또는 현재 HEAD 전체 evidence 완료 |

## 4. Recent Merged Development Flow

다음 항목은 2026-07-11(KST) 기준 `dev`에 병합된 최근 제품 변경의 예다.

- PR #281: Live Requests 및 요청 상세 UI 개선
- PR #278: 정책 관리 UI 및 설정 화면 개선
- PR #276: Control Plane 로컬 환경 bootstrap 안정화
- PR #274: 직원 통제와 조직 초대 흐름
- PR #271: Demo Tenant/Fallback 격리 강화
- PR #269: raw response capture 범위 제한
- PR #268: demo/admin/public 노출 차단
- PR #267: Control Plane mutation 인증 강화
- PR #266: Provider routing 정책 흐름 개선

열린 PR은 병합되기 전까지 위 current 구현 목록에 포함하지 않는다.

## 5. Version Evidence

현재 저장소의 버전 신호는 일치하지 않는다.

- GitHub latest release: `v0.0.1`
- remote release tags: `v0.0.1`, `v0.0.1-rc.1`
- root package: `0.0.0`
- 일부 app package: `0.1.0`
- docs: `v2.0.0`, `v2.1.0`
- self-host image examples: `2.1.0`

따라서 이 문서는 `v2.1.0 released` 또는 새로운 SemVer를 선언하지 않는다. 다음 버전은 release owner의 결정과 tag/package/docs 정렬이 필요하다.

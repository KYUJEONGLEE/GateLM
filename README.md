# GateLM

GateLM은 기업의 LLM 요청을 승인된 Gateway 경로로 모아 보안, 비용, 정책, 로그, 관측을 중앙에서 관리하기 위한 B2B LLMOps Gateway 프로젝트입니다.

현재 공개 릴리즈 기준 최신 버전은 `v0.0.1`이며, 다음 준비 목표는 `v0.1.0 - Organization-Based Gateway MVP`입니다. `v2.0.0`은 소프트웨어 릴리즈 번호가 아니라 Gateway 계약과 schema/fixture의 spec version입니다.

## 현재 상태

GateLM은 아직 production-ready SaaS나 안정 self-host 제품으로 선언하지 않습니다. 현재 목표는 조직 기반 LLM Gateway MVP의 핵심 경로를 검증 가능한 형태로 정리하고, 이후 AWS 배포형 SaaS와 self-host 배포로 확장할 수 있는 기반을 만드는 것입니다.

현재 구현과 문서의 기준:

- Software release: `v0.1.0` 준비 중
- Gateway spec: `specs/gateway/v2.0.0`
- Latest GitHub Release: `v0.0.1`
- Self-host bundle: `deploy/selfhost`에 draft가 있으나 `v0.1.0`의 검증된 지원 경로로 보지 않습니다.
- AWS/SaaS deployment: 계획 방향으로만 문서화하며, 검증된 운영 배포로 주장하지 않습니다.

## 핵심 흐름

```text
Customer App / Employee Chat
-> Gateway
-> published RuntimeSnapshot policy
-> budget / rate limit / safety / routing-aware exact cache
-> Actual Provider or Mock fallback
-> Request Log / Request Detail / Dashboard / Metrics / evidence
```

GateLM의 핵심은 단순 Provider proxy가 아니라 운영자가 설명할 수 있는 LLMOps control plane과 gateway data plane입니다.

## 주요 기능 범위

| 영역 | 현재 방향 |
|---|---|
| Control Plane | organization, tenant/project/application, RuntimeConfig publish, RuntimeSnapshot, Provider/Model catalog |
| Gateway Core | auth/context, RuntimeSnapshot load, budget/rate limit, request-side safety, routing, exact cache, provider adapter, fallback, streaming thin slice |
| Web Console | onboarding, policy editor, model/provider surfaces, Request Log/Detail, Dashboard, metrics/demo surfaces |
| Provider | OpenAI-compatible, Anthropic/Gemini 관련 adapter 작업 흔적, Mock fallback |
| Observability | Gateway-produced `terminalStatus + domainOutcomes`, Request Log/Detail, Dashboard aggregate, Prometheus-compatible metrics |
| Evidence | smoke, k6, provider E2E, rate limit performance report, release readiness checks |

## 저장소 구조

| Path | Purpose |
|---|---|
| `apps/control-plane-api` | Control Plane API와 Prisma 기반 관리 경로 |
| `apps/gateway-core` | Go Gateway data plane |
| `apps/web` | Admin/Developer/Employee Web Console |
| `apps/application` | customer/application-facing demo surface |
| `apps/ai-service` | safety/evaluation lab 및 sidecar 후보 |
| `specs/gateway/v2.0.0` | 현재 Gateway 계약, JSON Schema, fixture |
| `docs/` | 사람이 읽는 공개 문서와 개발/운영 안내 |
| `docs/archive/` | historical milestone, legacy plan, old release-readiness material |
| `docs/drafts/` | future/draft material, current release의 source of truth가 아님 |
| `deploy/selfhost/` | self-host Docker Compose draft |
| `reports/` | 사람이 검토할 수 있는 성능/evidence 리포트 |

## 빠른 시작

필수 baseline:

| Runtime | Version |
|---|---|
| Node.js | `22` |
| pnpm | `9.15.0` |
| Go | `apps/gateway-core/go.mod` 기준 |
| PostgreSQL | `16` |
| Redis | `7` |

```powershell
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
docker compose up -d
```

문서와 기본 검증:

```powershell
corepack pnpm run verify:v2-docs
corepack pnpm run verify:v2-final
```

영향 범위에 따라 추가로 실행합니다.

```powershell
pnpm --filter @gatelm/control-plane-api typecheck
pnpm --filter @gatelm/web typecheck
pnpm --filter @gatelm/application typecheck
go test ./...
```

더 자세한 실행 안내는 [Getting Started](docs/getting-started.md)를 봅니다.

## 문서 지도

- [Documentation Guide](docs/README.md): 문서 권위와 읽는 순서
- [Architecture](docs/architecture/README.md): 현재 시스템 구조와 요청 흐름
- [Configuration](docs/configuration.md): 주요 환경 변수와 runtime mode
- [Development](docs/development.md): 브랜치, 검증, 계약 변경 규칙
- [Deployment](docs/deployment.md): 로컬, self-host draft, AWS/SaaS positioning
- [Roadmap](docs/roadmap.md): `v0.1.x`, `v0.2.0`, `v1.0.0` 기준
- [v0.1.0 Release Draft](docs/releases/v0.1.0.md): release readiness 감사와 release note 초안
- [Gateway v2.0.0 Spec](specs/gateway/v2.0.0/README.md): 현재 Gateway 계약 entry point

## 보안 원칙

아래 값은 API response, DB record, fixture, structured log, metric label, UI, release evidence에 평문으로 남기지 않습니다.

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret

Provider와 Model은 DB enum 또는 code enum으로 고정하지 않습니다. Gateway는 client-provided budget scope를 신뢰하지 않습니다.

## 릴리즈

다음 릴리즈 준비 목표는 `v0.1.0 - Organization-Based Gateway MVP`입니다. 실제 tag 생성, GitHub Release publish, shared branch push는 팀 리뷰 이후 별도 승인 단계에서 진행합니다.

릴리즈 초안과 known gaps는 [docs/releases/v0.1.0.md](docs/releases/v0.1.0.md)에 기록합니다.

## 라이선스

아직 `LICENSE` 파일이 없습니다. 외부 공개 범위와 라이선스는 `v0.1.0` 리뷰 과정에서 결정해야 할 항목입니다.
